"use client";

import * as React from "react";
import { Button } from "./ui";
import { useIsMobile } from "@/lib/useIsMobile";

export type Role = "user" | "admin";

/** Why the last sign-in didn't work, from the callback's ?signin= code. */
const SIGNIN_MESSAGES: Record<string, string> = {
  denied: "That Google account isn’t on the dashboard’s list. Ask Dan to add it, then try again.",
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Try again.",
  link_expired: "That sign-in link has expired or was already used.",
  not_configured: "Google sign-in isn’t set up on this server yet.",
  error: "Google sign-in didn’t work. Try again.",
};

/**
 * The sign-in screen. People sign in with Google (see /api/auth/google/start);
 * the server sets a 90-day cookie, so this only shows when that is missing.
 */
export function Gate({ googleReady = true }: { googleReady?: boolean }) {
  const isMobile = useIsMobile();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [going, setGoing] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("signin");
    if (!code) return;
    setNotice(SIGNIN_MESSAGES[code] ?? SIGNIN_MESSAGES.error);
    params.delete("signin");
    const q = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
  }, []);

  const signIn = () => {
    setGoing(true);
    const next = window.location.pathname + window.location.search;
    window.location.href = `/api/auth/google/start?next=${encodeURIComponent(next)}`;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        position: "relative",
      }}
    >
      {/* Soft drifting orbs */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-10%",
            left: "10%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--p-andrea) 40%, transparent), transparent 70%)",
            filter: "blur(20px)",
            animation: "float 18s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            right: "5%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--p-emma) 30%, transparent), transparent 70%)",
            filter: "blur(20px)",
            animation: "float 22s ease-in-out infinite reverse",
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: isMobile ? 360 : 440,
          background: "color-mix(in oklab, var(--surface) 85%, transparent)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          border: "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
          borderRadius: 24,
          padding: isMobile ? "28px 22px 24px" : "40px 36px 32px",
          boxShadow: "var(--shadow-lg)",
          animation: "fadeIn 500ms ease",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background:
              "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
            boxShadow:
              "0 8px 24px color-mix(in oklab, var(--p-emma) 30%, transparent)",
          }}
        >
          <span
            className="serif"
            style={{
              fontSize: 28,
              color: "white",
              fontWeight: 500,
              fontStyle: "italic",
            }}
          >
            d
          </span>
        </div>

        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-3)",
            marginBottom: 6,
          }}
        >
          DreamMe · Internal
        </div>
        <h1
          className="serif"
          style={{
            fontSize: isMobile ? 28 : 36,
            fontWeight: 400,
            margin: "0 0 8px",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Welcome back.
        </h1>
        <p
          style={{
            color: "var(--ink-3)",
            fontSize: 14,
            margin: "0 0 28px",
            lineHeight: 1.55,
          }}
        >
          Private workspace for the DreamMe team. Sign in with your Google
          account. You&apos;ll stay signed in on this browser.
        </p>

        <Button
          variant="primary"
          size="lg"
          type="button"
          disabled={going || !googleReady}
          style={{ width: "100%", justifyContent: "center", gap: 10 }}
          onClick={signIn}
        >
          <GoogleMark />
          {going ? "Opening Google…" : "Continue with Google"}
        </Button>

        {(notice || !googleReady) && (
          <div
            role="status"
            style={{
              color: notice && notice !== SIGNIN_MESSAGES.cancelled ? "var(--accent)" : "var(--ink-3)",
              fontSize: 13,
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            {notice ?? SIGNIN_MESSAGES.not_configured}
          </div>
        )}

      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
    <svg width="15" height="15" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
    </span>
  );
}
