"use client";

import * as React from "react";
import { Button } from "./ui";
import { Icons } from "./Icons";

const TEAM_PASSWORD = "dreamme";

export function Gate({ onEnter }: { onEnter: () => void }) {
  const [pw, setPw] = React.useState("");
  const [err, setErr] = React.useState(false);
  const [shake, setShake] = React.useState(false);

  const submit = (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (pw.trim().toLowerCase() === TEAM_PASSWORD) {
      sessionStorage.setItem("dreamme.auth", "1");
      onEnter();
    } else {
      setErr(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
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
          maxWidth: 440,
          background: "color-mix(in oklab, var(--surface) 85%, transparent)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          border: "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
          borderRadius: 24,
          padding: "40px 36px 32px",
          boxShadow: "var(--shadow-lg)",
          animation: shake ? "shake 400ms ease" : "fadeIn 500ms ease",
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
            fontSize: 36,
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
          Private workspace for the DreamMe team. Enter the shared password to
          continue.
        </p>

        <form onSubmit={submit}>
          <label
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              fontWeight: 500,
              display: "block",
              marginBottom: 8,
            }}
          >
            Team password
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setErr(false);
              }}
              placeholder="••••••••"
              style={{
                width: "100%",
                padding: "13px 14px 13px 40px",
                fontSize: 14,
                background: "var(--surface-2)",
                border: `1px solid ${err ? "var(--accent)" : "var(--line-2)"}`,
                borderRadius: 10,
                outline: "none",
                color: "var(--ink)",
                transition: "border-color 160ms ease",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 14,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <Icons.Lock size={16} stroke="var(--ink-4)" />
            </div>
          </div>
          {err && (
            <div
              style={{
                color: "var(--accent)",
                fontSize: 12,
                marginTop: 8,
              }}
            >
              That&apos;s not it. Try again.
            </div>
          )}
          <Button
            variant="primary"
            size="lg"
            type="submit"
            style={{
              width: "100%",
              marginTop: 20,
              justifyContent: "center",
            }}
            onClick={submit}
          >
            Enter workspace
          </Button>
        </form>

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid var(--line)",
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          hint — password is:{" "}
          <span style={{ color: "var(--ink-3)" }}>dreamme</span>
        </div>
      </div>
    </div>
  );
}
