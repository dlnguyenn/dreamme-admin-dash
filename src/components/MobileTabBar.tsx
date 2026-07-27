"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Sheet } from "./Sheet";
import { visibleNavItems, type DashId, type NavItem } from "./Shell";

/**
 * iOS-style bottom tab bar. Replaces the hamburger drawer on mobile.
 *
 * Five tabs always visible:
 *   Pipeline · Captions · Hooks · Transformation · More
 *
 * "Transformation" is a pseudo-tab that routes to Content Pipeline in
 * `before` mode (internally still the "before" data channel — that's the DB
 * shape; only the label is user-facing "Transformation"). Creators jump
 * between the library and the generator constantly, so it earns its slot.
 *
 * "More" opens a bottom sheet containing the remaining destinations
 * (Spend / Feature Requests / etc for admins) plus the admin view-as toggle
 * and sign-out. Those are infrequent on phone use.
 *
 * Height 52px + env(safe-area-inset-bottom) so it respects the iPhone home
 * indicator. The top bar (MobileScreenTitle) still handles the top safe-area.
 */

export type MobileTab =
  | "pipeline"
  | "captions"
  | "hooks"
  | "before"
  | "support"
  | "more";

interface TabDef {
  id: MobileTab;
  label: string;
  icon: keyof typeof Icons;
}

const PRIMARY_TABS: TabDef[] = [
  { id: "pipeline", label: "Pipeline", icon: "Grid" },
  { id: "captions", label: "Captions", icon: "Message" },
  { id: "hooks", label: "Hooks", icon: "Chart" },
  { id: "before", label: "Transformation", icon: "Sparkles" },
  { id: "more", label: "More", icon: "MoreVertical" },
];

// Admins triage support daily, so Support earns the fourth slot; the
// Transformation library stays reachable inside Pipeline's After/Before
// tabs. Creators keep the original lineup.
const ADMIN_TABS: TabDef[] = [
  { id: "pipeline", label: "Pipeline", icon: "Grid" },
  { id: "captions", label: "Captions", icon: "Message" },
  { id: "hooks", label: "Hooks", icon: "Chart" },
  { id: "support", label: "Support", icon: "Send" },
  { id: "more", label: "More", icon: "MoreVertical" },
];

/** Map a DashId (desktop nav state) + mode hint to a tab-bar selection. */
export function tabForDash(
  current: DashId,
  pipelineMode: "after" | "before",
): MobileTab {
  if (current === "content") return pipelineMode === "before" ? "before" : "pipeline";
  if (current === "captions") return "captions";
  if (current === "hooks") return "hooks";
  if (current === "support") return "support";
  return "more";
}

export function MobileTabBar({
  tab,
  onTabChange,
  onOpenMore,
  showSupport = false,
  supportBadge = 0,
}: {
  tab: MobileTab;
  onTabChange: (t: MobileTab) => void;
  onOpenMore: () => void;
  /** admins get a Support slot in place of Transformation */
  showSupport?: boolean;
  /** unread support threads — red count pill on the Support tab */
  supportBadge?: number;
}) {
  const tabs = showSupport ? ADMIN_TABS : PRIMARY_TABS;
  return (
    <nav
      aria-label="Primary"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        background:
          "color-mix(in oklab, var(--surface) 92%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid var(--line)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div style={{ display: "flex", height: 52 }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          const IconComp = Icons[t.icon];
          const handle =
            t.id === "more" ? onOpenMore : () => onTabChange(t.id);
          const badge = t.id === "support" ? supportBadge : 0;
          return (
            <button
              key={t.id}
              onClick={handle}
              aria-current={active ? "page" : undefined}
              aria-label={badge ? `${t.label}, ${badge} unread` : t.label}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                background: "transparent",
                border: "none",
                color: active ? "var(--ink)" : "var(--ink-4)",
                // Deliberately override the global 44px min-height because
                // the bar is itself 52px and the internal layout is tight.
                minHeight: 0,
                padding: 0,
              }}
            >
              <span style={{ position: "relative", display: "inline-flex" }}>
                <IconComp
                  size={22}
                  stroke={active ? "var(--ink)" : "var(--ink-4)"}
                  strokeWidth={active ? 2 : 1.6}
                />
                {badge > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -10,
                      minWidth: 16,
                      height: 16,
                      padding: "0 4px",
                      borderRadius: 999,
                      background: "var(--danger)",
                      color: "#fff",
                      font: "700 9.5px var(--font-ui)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: "0.02em",
                }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Thin top title bar for mobile — 54px, screen name only. No hamburger. */
export function MobileScreenTitle({ title }: { title: string }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background:
          "color-mix(in oklab, var(--surface) 90%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--line)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div
        style={{
          height: 54,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 16px",
        }}
      >
        <div
          className="serif"
          style={{
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      </div>
    </header>
  );
}

/** The "More" bottom sheet — secondary destinations, view-as toggle, sign-out. */
export function MoreSheet({
  open,
  onClose,
  current,
  onNavigate,
  role,
  viewAs,
  setViewAs,
  onLogout,
  excludeIds = [],
}: {
  open: boolean;
  onClose: () => void;
  current: DashId;
  onNavigate: (id: DashId) => void;
  role: "admin" | "user";
  viewAs: "admin" | "user";
  setViewAs: (v: "admin" | "user") => void;
  onLogout: () => void;
  /** ids that already have a bottom-bar slot (e.g. support for admins) */
  excludeIds?: DashId[];
}) {
  // Secondary destinations = everything the user can see except the primary
  // tabs we already surface at the bottom.
  const PRIMARY_IDS: DashId[] = ["content", "captions", "hooks", ...excludeIds];
  const secondary = visibleNavItems(viewAs).filter(
    (n) => !PRIMARY_IDS.includes(n.id),
  );

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="More">
      <div
        className="serif"
        style={{
          fontSize: 22,
          fontWeight: 500,
          fontStyle: "italic",
          letterSpacing: "-0.01em",
          marginBottom: 4,
        }}
      >
        More
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 14,
        }}
      >
        Destinations · Settings
      </div>

      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginBottom: 16,
        }}
      >
        {secondary.map((item) => (
          <MoreNavRow
            key={item.id}
            item={item}
            active={current === item.id}
            onClick={() => {
              onNavigate(item.id);
              onClose();
            }}
          />
        ))}
      </nav>

      {role === "admin" && (
        <div style={{ marginBottom: 12 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 8,
              paddingLeft: 4,
            }}
          >
            Viewing as
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 4,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: 10,
            }}
          >
            <ViewToggle
              label="Admin"
              active={viewAs === "admin"}
              onClick={() => setViewAs("admin")}
            />
            <ViewToggle
              label="User"
              active={viewAs === "user"}
              onClick={() => setViewAs("user")}
            />
          </div>
        </div>
      )}

      <button
        onClick={() => {
          onClose();
          onLogout();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 12px",
          width: "100%",
          background: "transparent",
          border: "1px solid var(--line)",
          borderRadius: 12,
          fontSize: 14,
          color: "var(--ink-2)",
          textAlign: "left",
        }}
      >
        <Icons.Logout size={18} stroke="var(--ink-3)" />
        Sign out
      </button>
    </Sheet>
  );
}

function MoreNavRow({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const IconComp = Icons[item.icon];
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 12px",
        background: active ? "var(--surface-2)" : "transparent",
        border: "1px solid",
        borderColor: active ? "var(--line-2)" : "transparent",
        borderRadius: 12,
        fontSize: 15,
        fontWeight: active ? 500 : 400,
        color: active ? "var(--ink)" : "var(--ink-2)",
        textAlign: "left",
        width: "100%",
      }}
    >
      <IconComp size={20} stroke={active ? "var(--ink)" : "var(--ink-3)"} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <span>{item.label}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontWeight: 400,
          }}
        >
          {item.desc}
        </span>
      </div>
      {item.status === "soon" && (
        <span
          className="mono"
          style={{
            fontSize: 9,
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
    </button>
  );
}

function ViewToggle({
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
        padding: "10px",
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
      }}
    >
      {label}
    </button>
  );
}
