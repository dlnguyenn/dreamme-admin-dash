"use client";

import * as React from "react";
import Link from "next/link";
import { Icons } from "./Icons";
import { Button, PersonaChip, ToastProvider, useCopy, useToast } from "./ui";
import { Gate } from "./Gate";
import { useIsMobile } from "@/lib/useIsMobile";
import { API } from "@/lib/supabase";
import { PERSONAS } from "@/lib/personas";
import { formatDate, formatTime } from "@/lib/format";
import type { Delivery } from "@/lib/types";

export function ItemView({ id }: { id: string }) {
  const [hydrated, setHydrated] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);

  React.useEffect(() => {
    try {
      if (sessionStorage.getItem("dreamme.auth") === "1") setAuthed(true);
    } catch {}
    setHydrated(true);
  }, []);

  if (!hydrated) return null;

  if (!authed) {
    return (
      <ToastProvider>
        <Gate onEnter={() => setAuthed(true)} /* role ignored on item page */ />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ItemBody id={id} />
    </ToastProvider>
  );
}

function ItemBody({ id }: { id: string }) {
  const [item, setItem] = React.useState<Delivery | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { copied, copy } = useCopy();
  const toast = useToast();
  const isMobile = useIsMobile();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await API.fetchDelivery(id);
        if (!cancelled) setItem(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
        <div className="serif" style={{ fontSize: 24, fontStyle: "italic" }}>
          Loading…
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div
        style={{
          padding: 80,
          maxWidth: 520,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div
          className="serif"
          style={{ fontSize: 28, fontStyle: "italic", marginBottom: 8 }}
        >
          {error ? "Something went wrong." : "Item not found."}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 22 }}>
          {error ?? "This delivery may have been deleted."}
        </div>
        <Link href="/" style={{ textDecoration: "none" }}>
          <Button variant="primary" icon={<Icons.Grid />}>
            Back to pipeline
          </Button>
        </Link>
      </div>
    );
  }

  const persona = PERSONAS[item.personaId];

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "0 auto",
        padding: isMobile ? "16px 14px 80px" : "40px 28px 80px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--ink-3)",
            textDecoration: "none",
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          ← Back to pipeline
        </Link>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            icon={copied ? <Icons.Check /> : <Icons.Link />}
            onClick={() => {
              copy(window.location.href);
              toast("Link copied");
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            icon={<Icons.Download />}
            onClick={() => window.open(item.imageUrl, "_blank")}
          >
            Open image
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <PersonaChip persona={persona} size="md" />
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {formatDate(item.createdAt)} · {formatTime(item.createdAt)}
        </div>
        {item.posted && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "3px 8px",
              borderRadius: 999,
              background:
                "color-mix(in oklab, var(--p-olivia) 20%, var(--surface))",
              border:
                "1px solid color-mix(in oklab, var(--p-olivia) 40%, transparent)",
            }}
          >
            Posted
          </span>
        )}
      </div>

      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid var(--line)",
          marginBottom: 24,
          background: persona.soft,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt=""
          style={{
            width: "100%",
            display: "block",
            aspectRatio: "4/5",
            objectFit: "cover",
          }}
        />
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface)",
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Caption
        </div>
        <div
          style={{
            padding: "20px 22px",
            fontSize: 14,
            lineHeight: 1.7,
            color: "var(--ink-2)",
            whiteSpace: "pre-wrap",
          }}
        >
          {item.caption}
        </div>
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "12px 14px",
            display: "flex",
            justifyContent: "flex-end",
            background: "var(--surface)",
          }}
        >
          <Button
            size="sm"
            icon={<Icons.Copy />}
            onClick={() => {
              copy(item.caption);
              toast("Caption copied");
            }}
          >
            Copy caption
          </Button>
        </div>
      </div>
    </div>
  );
}
