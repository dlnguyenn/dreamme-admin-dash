/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728), as required by the MCP
 * spec for HTTP-transport servers. claude.ai's custom-connector flow
 * fetches this to discover the authorization server.
 *
 * Optional catch-all so we serve both:
 *   /.well-known/oauth-protected-resource
 *   /.well-known/oauth-protected-resource/api/mcp/image
 * — different MCP clients pick different shapes; both point at the same
 * MCP resource.
 */
import { NextResponse } from "next/server";
import { originFromRequest } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildMetadata(origin: string, resourcePath: string) {
  return {
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_documentation: `${origin}/`,
  };
}

export async function GET(req: Request) {
  const origin = originFromRequest(req);
  // Always advertise the MCP image endpoint as the protected resource;
  // we only have one.
  const body = buildMetadata(origin, "/api/mcp/image");
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
