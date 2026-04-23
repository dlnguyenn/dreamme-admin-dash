"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, useCopy } from "./ui";
import { Sheet } from "./Sheet";
import { useIsMobile } from "@/lib/useIsMobile";
import { SUPABASE_URL, SUPABASE_ANON, SUPABASE_BUCKET } from "@/lib/supabase";

export function WebhookModal({ onClose }: { onClose: () => void }) {
  const { copied, copy } = useCopy();
  const [tab, setTab] = React.useState<"http" | "storage" | "curl">("http");
  const isMobile = useIsMobile();

  const httpConfig = `METHOD:   POST
URL:      ${SUPABASE_URL}/rest/v1/deliveries

HEADERS:
  apikey          ${SUPABASE_ANON}
  Authorization   Bearer ${SUPABASE_ANON}
  Content-Type    application/json
  Prefer          return=minimal

BODY (JSON):
{
  "persona": "andrea",
  "image_url": "{{ $json.imageUrl }}",
  "caption":   "{{ $json.caption }}"
}`;

  const curlTest = `curl -X POST '${SUPABASE_URL}/rest/v1/deliveries' \\
  -H 'apikey: ${SUPABASE_ANON}' \\
  -H 'Authorization: Bearer ${SUPABASE_ANON}' \\
  -H 'Content-Type: application/json' \\
  -H 'Prefer: return=minimal' \\
  -d '{"persona":"andrea","image_url":"https://picsum.photos/400/500","caption":"Test caption from curl"}'`;

  const imgUploadNote = `If your n8n workflow has the image as binary (not a URL), upload it first:

METHOD:   POST
URL:      ${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/andrea-{{ $now.format('YYYYMMDD-HHmmss') }}.png

HEADERS:
  apikey          ${SUPABASE_ANON}
  Authorization   Bearer ${SUPABASE_ANON}
  Content-Type    image/png

BODY: (binary image)

Then use the public URL:
${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/<filename>
…as the image_url in the deliveries POST above.

Alternate: POST to this app's /api/ingest/content-pipeline with the
X-DreamMe-Secret header — accepts base64 or a source URL and writes
the row server-side.`;

  const content = tab === "http" ? httpConfig : tab === "curl" ? curlTest : imgUploadNote;

  return (
    <Sheet
      open={true}
      onClose={onClose}
      desktopMaxWidth={720}
      padded={false}
      ariaLabel="n8n Supabase setup"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxHeight: isMobile ? "92vh" : "88vh",
        }}
      >
        <div
          style={{
            padding: isMobile ? "14px 16px" : "22px 26px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--ink-3)",
              }}
            >
              Integration
            </div>
            <div
              className="serif"
              style={{ fontSize: isMobile ? 20 : 24, fontWeight: 400, marginTop: 4 }}
            >
              n8n → Supabase setup
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "transparent",
              border: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icons.Close size={16} />
          </button>
        </div>

        <div
          className={isMobile ? "mobile-hscroll" : undefined}
          style={{
            padding: isMobile ? "12px 16px 0" : "18px 26px 0",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            gap: 4,
            overflowX: isMobile ? "auto" : "visible",
          }}
        >
          {[
            { id: "http" as const, label: "HTTP Request node" },
            { id: "storage" as const, label: "Image upload" },
            { id: "curl" as const, label: "Test with curl" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "9px 14px",
                fontSize: 12,
                fontWeight: 500,
                background: "transparent",
                border: "none",
                color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: `2px solid ${tab === t.id ? "var(--ink)" : "transparent"}`,
                cursor: "pointer",
                marginBottom: -1,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          style={{
            padding: isMobile ? "16px" : "20px 26px 24px",
            overflow: "auto",
          }}
        >
          {tab === "http" && (
            <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px" }}>
              Add an{" "}
              <span className="mono" style={{ background: "var(--surface-2)", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>
                HTTP Request
              </span>{" "}
              node after each persona&apos;s image generation. Run it 3× (once
              per persona) — just change{" "}
              <span className="mono" style={{ fontSize: 12 }}>&quot;persona&quot;</span> to{" "}
              <span className="mono" style={{ fontSize: 12 }}>andrea</span>,{" "}
              <span className="mono" style={{ fontSize: 12 }}>emma</span>, or{" "}
              <span className="mono" style={{ fontSize: 12 }}>olivia</span>.
            </p>
          )}
          {tab === "storage" && (
            <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px" }}>
              Your bucket{" "}
              <span className="mono" style={{ fontSize: 12 }}>{SUPABASE_BUCKET}</span>{" "}
              is public. Upload the PNG, then use its public URL as{" "}
              <span className="mono" style={{ fontSize: 12 }}>image_url</span>.
            </p>
          )}
          {tab === "curl" && (
            <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px" }}>
              Run this in a terminal to verify the wiring. A row should appear
              in this dashboard within 30 seconds (or click Refresh).
            </p>
          )}
          <div style={{ position: "relative" }}>
            <pre
              style={{
                margin: 0,
                padding: "18px 20px",
                background: "var(--ink)",
                color: "#ebe4d8",
                borderRadius: 12,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 12,
                lineHeight: 1.65,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 360,
              }}
            >
              {content}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? <Icons.Check /> : <Icons.Copy />}
              style={{ position: "absolute", top: 12, right: 12 }}
              onClick={() => copy(content)}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: "var(--surface-2)",
              borderRadius: 12,
              border: "1px solid var(--line)",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ fontWeight: 600 }}>Notes</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--ink-3)" }}>
              <li>
                Persona must be exactly{" "}
                <span className="mono" style={{ fontSize: 12 }}>andrea</span>,{" "}
                <span className="mono" style={{ fontSize: 12 }}>emma</span>, or{" "}
                <span className="mono" style={{ fontSize: 12 }}>olivia</span>{" "}
                (lowercase).
              </li>
              <li>Dashboard polls Supabase every 30s; hit <strong>Refresh</strong> to pull immediately.</li>
              <li>
                The anon key is baked into the frontend — fine for a private
                team URL, but don&apos;t post this HTML publicly.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
