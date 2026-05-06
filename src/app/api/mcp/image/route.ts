/**
 * Self-hosted Streamable-HTTP MCP server.
 *
 * Auth supports two modes:
 *   1. Static bearer token via `MCP_IMAGE_BEARER_TOKEN` env var — simple
 *      path for Claude Code, which lets you set custom headers in its
 *      MCP client config.
 *   2. OAuth 2.1 with dynamic client registration + PKCE — required by
 *      claude.ai custom connectors, which don't accept static bearers.
 *      Tokens issued by /api/oauth/token after the user authorizes via
 *      /api/oauth/authorize. Discovery via /.well-known.
 *
 * We implement the JSON-RPC + Streamable-HTTP framing directly rather than
 * pulling in `@modelcontextprotocol/sdk` — the SDK's transports are built
 * around Node `IncomingMessage`/`ServerResponse` and don't fit cleanly
 * into Next.js App Router's Web Request/Response model.
 */
import { NextResponse } from "next/server";
import {
  ASPECT_RATIOS,
  RateLimitError,
  generateImage,
  imageGenerationConfigured,
  type AspectRatio,
} from "@/lib/image-generation";
import { originFromRequest, validateBearer } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "dreamme-mcp-image",
  version: "1.0.0",
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const TOOL_DEFINITION = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using Google Gemini. Returns a public URL pointing to the stored PNG/JPEG. Optionally accepts a reference image_url (or base64) for image-to-image edits — pass the URL of a previous output plus a prompt like \"make it green\" to iterate.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text description of the image to generate (or the edit instruction when a reference image is supplied).",
      },
      aspect_ratio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Optional aspect ratio. Defaults to 1:1.",
      },
      image_url: {
        type: "string",
        format: "uri",
        description:
          "Optional public http(s) URL of a reference image. When provided, the model edits / re-renders that image guided by the prompt (image-to-image). Useful for iterative tweaks (e.g. \"make it green\" with the previous output URL).",
      },
      image_base64: {
        type: "string",
        description:
          "Optional base64-encoded reference image bytes (alternative to image_url). Pair with image_mime_type when set.",
      },
      image_mime_type: {
        type: "string",
        enum: ["image/png", "image/jpeg", "image/webp", "image/gif"],
        description:
          "MIME type for image_base64. Defaults to image/png.",
      },
    },
    required: ["prompt"],
  },
} as const;

async function extractAndValidateBearer(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return validateBearer(match[1]);
}

function unauthorized(req: Request): Response {
  // Per RFC 9728 + the MCP auth spec, point clients at the protected-
  // resource metadata so they can discover the OAuth authorization server.
  const origin = originFromRequest(req);
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/api/mcp/image`;
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="mcp-image", resource_metadata="${resourceMetadata}"`,
    },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method;

  // Notifications (no `id`) get no response.
  const isNotification = req.id === undefined || req.id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: [TOOL_DEFINITION] });
  }

  if (method === "tools/call") {
    const params = (req.params ?? {}) as {
      name?: string;
      arguments?: {
        prompt?: unknown;
        aspect_ratio?: unknown;
        image_url?: unknown;
        image_base64?: unknown;
        image_mime_type?: unknown;
      };
    };
    if (params.name !== "generate_image") {
      return rpcError(id, -32602, `Unknown tool: ${params.name ?? "<missing>"}`);
    }
    const args = params.arguments ?? {};
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (!prompt.trim()) {
      return rpcError(id, -32602, "prompt is required and must be a non-empty string");
    }
    const aspectRaw =
      typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined;
    const aspectRatio =
      aspectRaw && (ASPECT_RATIOS as readonly string[]).includes(aspectRaw)
        ? (aspectRaw as AspectRatio)
        : undefined;

    let referenceImageUrl: string | undefined;
    if (args.image_url !== undefined) {
      if (typeof args.image_url !== "string") {
        return rpcError(id, -32602, "image_url must be a string");
      }
      try {
        const parsed = new URL(args.image_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return rpcError(id, -32602, `image_url must be http(s); got ${parsed.protocol}`);
        }
      } catch {
        return rpcError(id, -32602, `Invalid image_url: ${args.image_url}`);
      }
      referenceImageUrl = args.image_url;
    }

    let referenceImageBase64: string | undefined;
    let referenceImageMimeType: string | undefined;
    if (args.image_base64 !== undefined) {
      if (typeof args.image_base64 !== "string") {
        return rpcError(id, -32602, "image_base64 must be a base64-encoded string");
      }
      referenceImageBase64 = args.image_base64;
      if (args.image_mime_type !== undefined) {
        if (typeof args.image_mime_type !== "string") {
          return rpcError(id, -32602, "image_mime_type must be a string");
        }
        referenceImageMimeType = args.image_mime_type;
      }
    }

    if (referenceImageUrl && referenceImageBase64) {
      return rpcError(id, -32602, "Provide either image_url or image_base64, not both");
    }

    if (!imageGenerationConfigured()) {
      return rpcError(id, -32002, "Image generation not configured on the server");
    }

    try {
      const result = await generateImage({
        prompt,
        aspectRatio,
        referenceImageUrl,
        referenceImageBase64,
        referenceImageMimeType,
        source: "mcp",
      });
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: result.imageUrl,
          },
        ],
        structuredContent: {
          image_url: result.imageUrl,
          id: result.id,
          aspect_ratio: result.aspectRatio,
          gemini_model: result.geminiModel,
          created_at: result.createdAt,
          reference_image_url: result.referenceImageUrl,
        },
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return rpcError(id, -32003, err.message, {
          window: err.window,
          limit: err.limit,
        });
      }
      const message = (err as Error).message ?? "image generation failed";
      return rpcError(id, -32000, message);
    }
  }

  if (isNotification) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function formatResponse(
  body: JsonRpcResponse | null,
  acceptsSse: boolean,
): Response {
  if (body === null) {
    // Notification-only — Streamable HTTP spec returns 202 Accepted.
    return new Response(null, { status: 202 });
  }
  if (acceptsSse) {
    const sse =
      `event: message\ndata: ${JSON.stringify(body)}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }
  return NextResponse.json(body, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      rpcError(null, -32700, "Parse error"),
      { status: 400 },
    );
  }

  const accept = req.headers.get("accept") ?? "";
  const acceptsSse = accept.includes("text/event-stream");

  // Batch (array) requests. Per JSON-RPC 2.0, respond with an array of
  // responses for the non-notification entries; if all are notifications,
  // respond with 202.
  if (Array.isArray(payload)) {
    const responses: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const res = await handleRequest(entry as JsonRpcRequest);
      if (res) responses.push(res);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202 });
    }
    if (acceptsSse) {
      const sse = responses
        .map((r) => `event: message\ndata: ${JSON.stringify(r)}\n\n`)
        .join("");
      return new Response(sse, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    return NextResponse.json(responses, { status: 200 });
  }

  const single = await handleRequest(payload as JsonRpcRequest);
  return formatResponse(single, acceptsSse);
}

export async function GET(req: Request): Promise<Response> {
  // We don't support server-initiated streams in stateless mode. Bearer
  // check still applies so unauthenticated probes can't fingerprint the
  // endpoint shape.
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE(req: Request): Promise<Response> {
  // No session to terminate.
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
