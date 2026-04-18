"use client";

import * as React from "react";
import { Chip } from "./ui";
import { PageHeader, type NavItem } from "./Shell";
import { Icons } from "./Icons";

const BULLETS: Record<string, string[]> = {
  analytics: [
    "Views and completion rate per video",
    "Follower growth by persona",
    "Best-performing posting times",
    "Weekly rollup email summary",
  ],
  comments: [
    "Unified inbox across Andrea, Emma, Olivia",
    "Flag high-intent replies (DM requests, product questions)",
    "Reply templates per persona voice",
    "Sentiment trend over time",
  ],
  hooks: [
    "First 3 seconds: retention breakdown",
    "Compare hook formats (question, stat, scene)",
    "Winning hooks library for the next workflow",
    "A/B hook scoring",
  ],
  poster: [
    "Queue from caption library → TikTok",
    "Schedule per persona time slots",
    "Auto-attach image + caption from pipeline",
    "Mirror to IG Reels",
  ],
};

const TINTS: Record<string, string> = {
  analytics: "var(--p-emma)",
  comments: "var(--p-olivia)",
  hooks: "var(--p-andrea)",
  poster: "var(--accent)",
};

export function ComingSoon({ item }: { item: NavItem }) {
  const IconComp = Icons[item.icon];
  const things = BULLETS[item.id] ?? [];
  const tint = TINTS[item.id] ?? "var(--accent)";

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard · coming soon"
        title={<span style={{ fontStyle: "italic" }}>{item.label}</span>}
        subtitle={
          item.desc +
          ". Designed but not wired up yet — scaffolded here so the team knows what's coming."
        }
        tint={`color-mix(in oklab, ${tint} 35%, transparent)`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 20,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: 32,
            minHeight: 320,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -80,
              right: -80,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: `radial-gradient(circle, color-mix(in oklab, ${tint} 40%, transparent), transparent 70%)`,
              filter: "blur(30px)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: `color-mix(in oklab, ${tint} 15%, var(--surface-2))`,
                border: `1px solid color-mix(in oklab, ${tint} 30%, var(--line))`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <IconComp size={22} stroke={tint} />
            </div>
            <div
              className="serif"
              style={{
                fontSize: 28,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                fontStyle: "italic",
                marginBottom: 10,
              }}
            >
              In the oven.
            </div>
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 14,
                lineHeight: 1.6,
                margin: 0,
                maxWidth: 440,
              }}
            >
              This dashboard is scaffolded and waiting for its data source.
              When it&apos;s ready, it&apos;ll show up here — same shell, same
              language, same feel.
            </p>
          </div>
          <div
            style={{
              position: "relative",
              display: "flex",
              gap: 8,
              marginTop: 24,
            }}
          >
            <Chip tone="accent">Planned</Chip>
            <Chip>Q2 2026</Chip>
          </div>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: 28,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--ink-4)",
              marginBottom: 16,
            }}
          >
            What goes here
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {things.map((t, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--ink-4)",
                    minWidth: 20,
                    paddingTop: 2,
                  }}
                >
                  0{i + 1}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                  }}
                >
                  {t}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        style={{
          background: "var(--surface-2)",
          border: "1px dashed var(--line-2)",
          borderRadius: 20,
          padding: 24,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-4)",
            marginBottom: 16,
          }}
        >
          Preview — layout placeholder
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 12,
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 120,
                background: "var(--surface)",
                borderRadius: 12,
                border: "1px solid var(--line)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            height: 240,
            background: "var(--surface)",
            borderRadius: 12,
            border: "1px solid var(--line)",
          }}
        />
      </div>
    </div>
  );
}
