"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { SideDrawer } from "./SideDrawer";
import { visibleNavItems, type DashId, type NavItem } from "./Shell";

/**
 * Phone-only top chrome. 56px sticky bar with a hamburger, current-page
 * title, and (for admins) a tiny role pill. Tap hamburger → left-side
 * drawer slides in with the same nav items the desktop sidebar renders.
 *
 * Rendered by <App /> only when useIsMobile() is true. Desktop gets the
 * classic sticky sidebar instead.
 */
export function MobileTopBar({
  current,
  setCurrent,
  onLogout,
  role,
  viewAs,
  setViewAs,
}: {
  current: DashId;
  setCurrent: (id: DashId) => void;
  onLogout: () => void;
  role: "admin" | "user";
  viewAs: "admin" | "user";
  setViewAs: (v: "admin" | "user") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const items = visibleNavItems(viewAs);
  const currentItem = items.find((n) => n.id === current) ?? items[0];

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          height: 56,
          paddingTop: "env(safe-area-inset-top)",
          background:
            "color-mix(in oklab, var(--surface) 85%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 0 4px",
        }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icons.Menu size={22} stroke="var(--ink)" />
        </button>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            className="serif"
            style={{
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {currentItem.label}
          </div>
          {role === "admin" && viewAs === "user" && (
            <span
              title="Currently viewing as user"
              style={{
                fontSize: 9,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--bg-2)",
                color: "var(--ink-3)",
              }}
            >
              as user
            </span>
          )}
        </div>
      </header>

      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        side="left"
        ariaLabel="Navigation"
      >
        <DrawerBrand />
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "0 10px",
            flex: 1,
            overflowY: "auto",
          }}
        >
          {items.map((item) => (
            <NavItemRow
              key={item.id}
              item={item}
              active={current === item.id}
              onClick={() => {
                setCurrent(item.id);
                setOpen(false);
              }}
            />
          ))}
        </nav>
        <div
          style={{
            padding: "12px 14px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {role === "admin" && (
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
          )}
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px",
              width: "100%",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 10,
              fontSize: 14,
              color: "var(--ink-3)",
              textAlign: "left",
            }}
          >
            <Icons.Logout size={18} stroke="var(--ink-3)" />
            Sign out
          </button>
        </div>
      </SideDrawer>
    </>
  );
}

function DrawerBrand() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "20px 18px 18px",
      }}
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
      <div style={{ overflow: "hidden" }}>
        <div
          className="serif"
          style={{
            fontSize: 19,
            fontWeight: 500,
            letterSpacing: "-0.01em",
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
    </div>
  );
}

function NavItemRow({
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
        minHeight: 52,
      }}
    >
      <IconComp size={20} stroke={active ? "var(--ink)" : "var(--ink-3)"} />
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
    </button>
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
        padding: "8px",
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
