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
  | "viral-slideshows"
  | "our-slideshows"
  | "poster"
  | "resources"
  | "spend"
  | "growth"
  | "marketing"
  | "creatives"
  | "requests"
  | "synthid-research"
  | "image-studio"
  | "integrations"
  | "clippers"
  | "support";

export interface NavItem {
  id: DashId;
  label: string;
  icon: IconName;
  status: "live" | "soon";
  desc: string;
  adminOnly?: boolean;
  /** Porcelain: quiet group label rendered above this item */
  group?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "content", label: "Content Pipeline", icon: "Sun", status: "live", desc: "Daily 3-persona output", group: "Content" },
  { id: "captions", label: "Caption Library", icon: "Chat", status: "live", desc: "All captions, searchable" },
  { id: "analytics", label: "Posting Analytics", icon: "Chart", status: "soon", desc: "Views, engagement, growth", adminOnly: true },
  { id: "comments", label: "Comment Monitoring", icon: "ChatLines", status: "soon", desc: "Replies across personas", adminOnly: true },
  { id: "spy", label: "Spy Tool", icon: "Search", status: "live", desc: "What's going viral in GLP-1", adminOnly: true },
  { id: "viral-slideshows", label: "Viral Slideshows", icon: "Film", status: "live", desc: "Collect TikTok slideshow images for analysis", adminOnly: true },
  { id: "our-slideshows", label: "Our Slideshows", icon: "Layers", status: "live", desc: "Text-card decks we generate daily", adminOnly: true },
  { id: "hooks", label: "Hook Analytics", icon: "Music", status: "live", desc: "What's stopping the scroll" },
  { id: "resources", label: "Resources", icon: "Bookmark", status: "live", desc: "Creator toolkit & references" },
  { id: "poster", label: "Content Poster", icon: "Send", status: "soon", desc: "Queue + schedule to TikTok" },
  { id: "spend", label: "Spend", icon: "Dollar", status: "live", desc: "AI + business expenses", adminOnly: true, group: "Growth" },
  { id: "growth", label: "Growth AI", icon: "Spark", status: "live", desc: "Creative analytics + AI marketing brain", adminOnly: true },
  { id: "marketing", label: "Marketing Efficiency", icon: "Trend", status: "live", desc: "Blended CAC / MER · paid vs revenue", adminOnly: true },
  { id: "creatives", label: "Creatives", icon: "Image", status: "live", desc: "Meta ad performance + qualified CPA", adminOnly: true },
  { id: "requests", label: "Feature Requests", icon: "Flag", status: "live", desc: "User-submitted product asks", adminOnly: true, group: "Product" },
  { id: "synthid-research", label: "SynthID Research", icon: "Flask", status: "live", desc: "Internal: study Gemini watermark robustness", adminOnly: true },
  { id: "image-studio", label: "Image Studio", icon: "Aperture", status: "live", desc: "Generate images + self-hosted MCP for Claude", adminOnly: true },
  { id: "integrations", label: "Integrations", icon: "Grid", status: "live", desc: "Connect Meta (Login with Facebook) for the Ads MCP", adminOnly: true },
  { id: "clippers", label: "Clippers", icon: "Scissors", status: "live", desc: "Rev-share: videos, conversions, payouts", adminOnly: true },
  { id: "support", label: "Support Inbox", icon: "Inbox", status: "live", desc: "help@ email + in-app feedback triage", adminOnly: true, group: "Support" },
];

export function visibleNavItems(viewAs: "admin" | "user"): NavItem[] {
  return viewAs === "admin" ? NAV_ITEMS : NAV_ITEMS.filter((n) => !n.adminOnly);
}

/** Porcelain logo mark — the one true serif left in the product. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: "linear-gradient(135deg, #C9B8F5, #E9C6DE)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `italic 600 ${Math.round(size * 0.56)}px ui-serif, Georgia, serif`,
        color: "#453370",
        flexShrink: 0,
      }}
    >
      d
    </div>
  );
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
  badges,
}: {
  current: DashId;
  setCurrent: (id: DashId) => void;
  onLogout: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  role: "admin" | "user";
  viewAs: "admin" | "user";
  setViewAs: (v: "admin" | "user") => void;
  /** optional per-tab count pills (e.g. unread support threads) */
  badges?: Partial<Record<DashId, number>>;
}) {
  const w = collapsed ? 76 : 236;
  const items = visibleNavItems(viewAs);
  return (
    <aside
      style={{
        width: w,
        minWidth: w,
        height: "100vh",
        position: "sticky",
        top: 0,
        background: "var(--bg)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        padding: "20px 12px 16px",
        transition:
          "width 240ms cubic-bezier(.4,0,.2,1), min-width 240ms cubic-bezier(.4,0,.2,1)",
        zIndex: 10,
        overflowY: "auto",
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: collapsed ? "0 0 16px" : "0 10px 16px",
          justifyContent: collapsed ? "center" : "flex-start",
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <LogoMark />
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                font: "650 15px var(--font-ui)",
                color: "var(--ink)",
                whiteSpace: "nowrap",
              }}
            >
              DreamMe
            </div>
            <div
              style={{
                font: "600 9.5px var(--font-ui)",
                letterSpacing: "0.09em",
                color: "var(--ink-3)",
              }}
            >
              INTERNAL
            </div>
          </div>
        )}
      </div>

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
            <React.Fragment key={item.id}>
              {item.group && !collapsed && (
                <div
                  style={{
                    font: "600 11px var(--font-ui)",
                    color: "var(--ink-3)",
                    padding: "10px 10px 5px",
                  }}
                >
                  {item.group}
                </div>
              )}
              <button
                onClick={() => setCurrent(item.id)}
                title={collapsed ? item.label : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: collapsed ? "9px" : "6.5px 10px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: active ? "var(--accent-soft)" : "transparent",
                  border: "none",
                  borderRadius: 10,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--accent-text)" : "var(--ink-2)",
                  textAlign: "left",
                  transition: "background 140ms ease, color 140ms ease",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    e.currentTarget.style.background = "var(--neutral-soft)";
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <IconComp
                  size={16}
                  stroke={active ? "var(--accent)" : "var(--ink-3)"}
                />
                {!collapsed && (
                  <>
                    <span
                      style={{
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.label}
                    </span>
                    {!!badges?.[item.id] && (
                      <span
                        style={{
                          minWidth: 18,
                          height: 18,
                          padding: "0 5px",
                          borderRadius: 999,
                          background: "var(--accent)",
                          color: "var(--on-accent)",
                          font: "650 10.5px var(--font-ui)",
                          fontVariantNumeric: "tabular-nums",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {badges[item.id]! > 99 ? "99+" : badges[item.id]}
                      </span>
                    )}
                    {item.status === "soon" && (
                      <span
                        style={{
                          font: "650 9px var(--font-ui)",
                          letterSpacing: "0.05em",
                          color: "var(--ink-3)",
                          background: "var(--neutral-soft)",
                          border: "1px solid var(--line)",
                          padding: "2px 6px",
                          borderRadius: 99,
                        }}
                      >
                        SOON
                      </span>
                    )}
                  </>
                )}
                {collapsed && !!badges?.[item.id] && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--accent)",
                    }}
                  />
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
            </React.Fragment>
          );
        })}
      </nav>

      <div
        style={{
          marginTop: "auto",
          padding: collapsed ? "14px 0 0" : "14px 4px 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {role === "admin" && (
          <>
            {!collapsed ? (
              <div
                style={{
                  display: "flex",
                  background: "var(--bg-2)",
                  borderRadius: 10,
                  padding: 3,
                  gap: 2,
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
                  padding: "7px 0",
                  background: "var(--bg-2)",
                  border: "none",
                  borderRadius: 10,
                  font: "650 12px var(--font-ui)",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {viewAs === "admin" ? "A" : "U"}
              </button>
            )}
          </>
        )}
        <button
          onClick={onLogout}
          title={collapsed ? "Sign out" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: collapsed ? "6px 0" : "2px 8px",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            background: "transparent",
            border: "none",
            font: "500 13px var(--font-ui)",
            color: "var(--ink-3)",
            textAlign: "left",
            cursor: "pointer",
            transition: "color 140ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-2)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-3)")}
        >
          <Icons.SignOut size={15} />
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
        textAlign: "center",
        padding: "5px 0",
        border: "none",
        borderRadius: 8,
        background: active ? "var(--surface)" : "transparent",
        boxShadow: active ? "var(--shadow-xs)" : "none",
        font: `${active ? 650 : 500} 12px var(--font-ui)`,
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        transition: "background 140ms ease, color 140ms ease",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--ink-3)";
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
  /** deprecated — Porcelain has no background aura; kept for call-site compat */
  tint?: string;
}) {
  void tint;
  const isMobile = useIsMobile();
  return (
    <div style={{ marginBottom: isMobile ? 20 : 26 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: isMobile ? "1 1 100%" : undefined }}>
          {eyebrow && (
            <div
              style={{
                font: "500 12px var(--font-ui)",
                color: "var(--ink-3)",
              }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            style={{
              font: `700 ${isMobile ? 28 : 38}px/1.08 var(--font-display)`,
              margin: "7px 0 10px",
              letterSpacing: "-0.015em",
              color: "var(--ink)",
            }}
          >
            {title}
          </h1>
          {subtitle && !isMobile && (
            <p
              style={{
                font: "400 14px/1.55 var(--font-ui)",
                color: "var(--ink-2)",
                maxWidth: 600,
                margin: 0,
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
