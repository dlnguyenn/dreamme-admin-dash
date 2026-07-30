"use client";

/**
 * First-visit onboarding for a clipper's public dashboard. Auto-opens the very
 * first time someone lands on their /clip/[token] page (remembered per code in
 * localStorage), and stays available behind a "How it works" button.
 *
 * Inline styles + CSS vars (the app's convention — Tailwind is not wired up).
 */
import * as React from "react";

const STORAGE_PREFIX = "dreamme.clip.onboarded.";
const ACCENT = "#c96a4a";

interface Step {
  n: number;
  title: string;
  body: React.ReactNode;
}

export function Onboarding({ name, code }: { name: string; code: string }) {
  const [open, setOpen] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_PREFIX + code)) setOpen(true);
    } catch {
      /* private mode / no storage — just don't auto-open */
    }
    setReady(true);
  }, [code]);

  const dismiss = React.useCallback(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + code, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, [code]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  const steps: Step[] = [
    {
      n: 1,
      title: "Share your code",
      body: (
        <>
          Put <b style={{ fontFamily: "var(--font-geist-mono), monospace", color: ACCENT }}>{code}</b>{" "}
          in your videos and bio. Anyone who enters it at signup gets 10% off the yearly plan, and
          they&apos;re credited to you.
        </>
      ),
    },
    {
      n: 2,
      title: "Connect your Facebook page",
      body: (
        <>
          Paste your page link under &ldquo;Your videos&rdquo; and we&apos;ll find your clips
          automatically — new posts get picked up and view counts refresh every day. One-off video?
          Paste that link too.
        </>
      ),
    },
    {
      n: 3,
      title: "You earn 20%",
      body: (
        <>
          Of every subscriber&apos;s payments (after app-store fees), renewals included, for their
          first 12 months.
        </>
      ),
    },
    {
      n: 4,
      title: "Paid after 30 days",
      body: (
        <>
          Each payment shows as <b>Pending</b> for 30 days (that covers the refund window), then
          moves to <b>Payable now</b>. That&apos;s your money.
        </>
      ),
    },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          borderRadius: 999,
          border: "1px solid #d9d2c6",
          background: "#fff",
          padding: "6px 14px",
          fontSize: 14,
          fontWeight: 500,
          color: "#6b6159",
          cursor: "pointer",
        }}
      >
        How it works
      </button>

      {open && ready ? (
        <div
          onClick={dismiss}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: "90vh",
              width: "100%",
              maxWidth: 460,
              overflowY: "auto",
              borderRadius: 24,
              background: "#faf7f2",
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                color: ACCENT,
              }}
            >
              DreamMe Creator Program
            </div>
            <h2 style={{ margin: "6px 0 0", fontSize: 24, fontWeight: 600, color: "#1a1816" }}>
              Welcome{name ? `, ${name}` : ""} 👋
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#8a8078" }}>
              Your creator dashboard, in 30 seconds.
            </p>

            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 16 }}>
              {steps.map((s) => (
                <div key={s.n} style={{ display: "flex", gap: 14 }}>
                  <div
                    style={{
                      flex: "0 0 auto",
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: ACCENT,
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {s.n}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: "#4a423b" }}>
                    <div style={{ fontWeight: 600, color: "#1a1816" }}>{s.title}</div>
                    <div style={{ marginTop: 2 }}>{s.body}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={dismiss}
              style={{
                marginTop: 24,
                width: "100%",
                borderRadius: 12,
                border: "none",
                background: ACCENT,
                padding: "12px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Got it, show my dashboard
            </button>
            <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 12, color: "#9a8f85" }}>
              You can reopen this anytime with &ldquo;How it works&rdquo;.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
