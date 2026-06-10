"use client";

import * as React from "react";
import { Icons, type IconName } from "./Icons";
import { useIsMobile } from "@/lib/useIsMobile";

export type DashId =
  | "content"
  | "captions"
  | "analytics"
  | "comments"
  | "hooks"
  | "spy"
  | "poster"
  | "resources"
  | "spend"
  | "marketing"
  | "requests"
  | "synthid-research"
  | "image-studio";

export interface NavItem {
  id: DashId;
  label: string;
  icon: IconName;
  status: "live" | "soon";
  desc: string;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "content", label: "Content Pipeline", icon: "Sparkles", status: "live", desc: "Daily 3-persona output" },
  { id: "captions", label: "Caption Library", icon: "Message", status: "live", desc: "All captions, searchable" },
  { id: "analytics", label: "Posting Analytics", icon: "Chart", status: "soon", desc: "Views, engagement, growth", adminOnly: true },
  { id: "comments", label: "Comment Monitoring", icon: "Message", status: "soon", desc: "Replies across personas", adminOnly: true },
  { id: "spy", label: "Spy Tool", icon: "Search", status: "live", desc: "What's going viral in GLP-1", adminOnly: true },
  { id: "hooks", label: "Hook Analytics", icon: "Hook", status: "live", desc: "What's stopping the scroll" },
  { id: "resources", label: "Resources", icon: "Bookmark", status: "live", desc: "Creator toolkit & references" },
  { id: "poster", label: "Content Poster", icon: "Send", status: "soon", desc: "Queue + schedule to TikTok" },
  { id: "spend", label: "Spend", icon: "Chart", status: "live", desc: "AI + business expenses", adminOnly: true },
  { id: "marketing", label: "Marketing Efficiency", icon: "Chart", status: "live", desc: "Blended CAC / MER · paid vs revenue", adminOnly: true },
  { id: "requests", label: "Feature Requests", icon: "Bookmark", status: "live", desc: "User-submitted product asks", adminOnly: true },
  { id: "synthid-research", label: "SynthID Research", icon: "Image", status: "live", desc: "Internal: study Gemini watermark robustness", adminOnly: true },
  { id: "image-studio", label: "Image Studio", icon: "Image", status: "live", desc: "Generate images + self-hosted MCP for Claude", adminOnly: true },
];

export function visibleNavItems(viewAs: "admin" | "user"): NavItem[] {
  return viewAs === "admin" ? NAV_ITEMS : NAV_ITEMS.filter((n) => !n.adminOnly);
}

export function Sidebar({
  current,
  setCurrent,
  onLogout,
  collapsed,
  setCollapsed,
  role,
  viewAs,
  setViewAs,
}: {
  current: DashId;
  setCurrent: (id: DashId) => void;
  onLogout: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  role: "admin" | "user";
  viewAs: "admin" | "user";
  setViewAs: (v: "admin" | "user") => void;
}) {
  const w = collapsed ? 76 : 260;
  const items = visibleNavItems(viewAs);
  return (
    <aside
      style={{
        width: w,
        minWidth: w,
        height: "100vh",
        position: "sticky",
        top: 0,
        background: "color-mix(in oklab, var(--surface) 70%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
        transition:
          "width 240ms cubic-bezier(.4,0,.2,1), min-width 240ms cubic-bezier(.4,0,.2,1)",
        zIndex: 10,
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 8px",
          marginBottom: 28,
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background:
              "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 4px 14px color-mix(in oklab, var(--p-emma) 30%, transparent)",
            flexShrink: 0,
          }}
        >
          <span
            className="serif"
            style={{
              fontSize: 19,
              color: "white",
              fontWeight: 500,
              fontStyle: "italic",
              marginTop: -1,
            }}
          >
            d
          </span>
        </div>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div
              className="serif"
              style={{
                fontSize: 19,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
              }}
            >
              DreamMe
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-4)",
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginTop: 1,
              }}
            >
              Internal
            </div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            padding: "0 10px",
            marginBottom: 8,
          }}
        >
          Dashboards
        </div>
      )}

      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: 1,
        }}
      >
        {items.map((item) => {
          const active = current === item.id;
          const IconComp = Icons[item.icon];
          return (
            <button
              key={item.id}
              onClick={() => setCurrent(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: collapsed ? "11px" : "10px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                background: active ? "var(--surface-2)" : "transparent",
                border: "1px solid",
                borderColor: active ? "var(--line-2)" : "transparent",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active ? "var(--ink)" : "var(--ink-2)",
                textAlign: "left",
                transition: "background 140ms ease, color 140ms ease",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <IconComp
                size={17}
                stroke={active ? "var(--ink)" : "var(--ink-3)"}
              />
              {!collapsed && (
                <>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.status === "soon" && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-geist-mono), monospace",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--ink-4)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--bg-2)",
                      }}
                    >
                      soon
                    </span>
                  )}
                </>
              )}
              {collapsed && item.status === "soon" && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--ink-4)",
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
        }}
      >
        {role === "admin" && (
          <div style={{ marginBottom: 10 }}>
            {!collapsed ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 4,
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                }}
                title="Switch between admin and regular-user view"
              >
                <ViewToggleButton
                  label="Admin"
                  active={viewAs === "admin"}
                  onClick={() => setViewAs("admin")}
                />
                <ViewToggleButton
                  label="User"
                  active={viewAs === "user"}
                  onClick={() => setViewAs("user")}
                />
              </div>
            ) : (
              <button
                onClick={() =>
                  setViewAs(viewAs === "admin" ? "user" : "admin")
                }
                title={`View: ${viewAs}. Click to toggle.`}
                style={{
                  width: "100%",
                  padding: "9px 0",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  fontSize: 10,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color:
                    viewAs === "admin" ? "var(--ink)" : "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                {viewAs === "admin" ? "A" : "U"}
              </button>
            )}
          </div>
        )}
        <button
          onClick={onLogout}
          title={collapsed ? "Sign out" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: collapsed ? "11px" : "10px 12px",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--ink-3)",
            textAlign: "left",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface-2)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <Icons.Logout size={16} stroke="var(--ink-3)" />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );
}

function ViewToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "6px 8px",
        border: "none",
        borderRadius: 7,
        background: active ? "var(--surface)" : "transparent",
        boxShadow: active ? "var(--shadow-sm)" : "none",
        color: active ? "var(--ink)" : "var(--ink-3)",
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        transition: "background 140ms ease, color 140ms ease",
      }}
    >
      {label}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  tint,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  tint?: string;
}) {
  const isMobile = useIsMobile();
  return (
    <div style={{ marginBottom: isMobile ? 20 : 32, position: "relative" }}>
      {tint && !isMobile && (
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            width: 300,
            height: 200,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${tint}, transparent 70%)`,
            filter: "blur(40px)",
            opacity: 0.6,
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: isMobile ? "1 1 100%" : undefined }}>
          {eyebrow && (
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--ink-3)",
                marginBottom: isMobile ? 6 : 10,
              }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            className="serif"
            style={{
              fontSize: isMobile ? 26 : 44,
              fontWeight: 400,
              margin: 0,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
            }}
          >
            {title}
          </h1>
          {subtitle && !isMobile && (
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 15,
                margin: "10px 0 0",
                maxWidth: 620,
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div
            style={{
              display: "flex",
              gap: isMobile ? 8 : 10,
              alignItems: "center",
              flexWrap: "wrap",
              width: isMobile ? "100%" : undefined,
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
