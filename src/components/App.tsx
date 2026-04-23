"use client";

import * as React from "react";
import { Gate } from "./Gate";
import { NAV_ITEMS, Sidebar, visibleNavItems, type DashId } from "./Shell";
import { MobileTopBar } from "./MobileTopBar";
import { useIsMobile } from "@/lib/useIsMobile";
import { ContentPipeline } from "./ContentPipeline";
import { CaptionLibrary } from "./CaptionLibrary";
import { HookAnalytics } from "./HookAnalytics";
import { SpendDashboard } from "./SpendDashboard";
import { FeatureRequestsDashboard } from "./FeatureRequestsDashboard";
import { ComingSoon } from "./ComingSoon";
import { TweaksPanel, type Tweaks } from "./TweaksPanel";
import { ToastProvider } from "./ui";
import { API } from "@/lib/supabase";
import type { DashState } from "@/lib/types";

const TWEAK_DEFAULTS: Tweaks = { theme: "light", gridSize: 4 };

export function App() {
  const [hydrated, setHydrated] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);
  const [role, setRole] = React.useState<"admin" | "user">("user");
  const [viewAs, setViewAs] = React.useState<"admin" | "user">("user");

  const [state, setState] = React.useState<DashState>({
    items: [],
    savedCaptions: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const [current, setCurrent] = React.useState<DashId>("content");
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [tweaks, setTweaks] = React.useState<Tweaks>(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);

  // Hydrate from storage after mount to avoid SSR/CSR mismatch
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem("dreamme.auth") === "1") setAuthed(true);
      const savedRole = sessionStorage.getItem("dreamme.role");
      if (savedRole === "admin" || savedRole === "user") {
        setRole(savedRole);
        const savedView = localStorage.getItem("dreamme.viewAs");
        if (savedRole === "admin" && (savedView === "admin" || savedView === "user")) {
          setViewAs(savedView);
        } else {
          setViewAs(savedRole);
        }
      }
      const savedCur = localStorage.getItem("dreamme.currentDash");
      if (
        savedCur &&
        NAV_ITEMS.some((n) => n.id === savedCur)
      ) {
        setCurrent(savedCur as DashId);
      }
      const savedTweaks = localStorage.getItem("dreamme.tweaks");
      if (savedTweaks) {
        setTweaks({ ...TWEAK_DEFAULTS, ...JSON.parse(savedTweaks) });
      }
    } catch {}
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dreamme.currentDash", current);
  }, [current, hydrated]);

  React.useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dreamme.viewAs", viewAs);
  }, [viewAs, hydrated]);

  React.useEffect(() => {
    const allowed = visibleNavItems(viewAs).map((n) => n.id);
    if (!allowed.includes(current)) setCurrent(allowed[0]);
  }, [viewAs, current]);

  React.useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dreamme.tweaks", JSON.stringify(tweaks));
    document.documentElement.setAttribute("data-theme", tweaks.theme);
  }, [tweaks, hydrated]);

  const refresh = React.useCallback(async () => {
    try {
      setSyncError(null);
      const data = await API.fetchAll();
      setState(data);
    } catch (e) {
      console.error(e);
      setSyncError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!authed) return;
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [authed, refresh]);

  // Keyboard shortcut: Cmd/Ctrl+. to toggle Tweaks panel
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setTweaksOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hydrated) return null;

  if (!authed) {
    return (
      <ToastProvider>
        <Gate
          onEnter={(r) => {
            setRole(r);
            setViewAs(r);
            setAuthed(true);
          }}
        />
      </ToastProvider>
    );
  }

  const logout = () => {
    sessionStorage.removeItem("dreamme.auth");
    sessionStorage.removeItem("dreamme.role");
    setAuthed(false);
  };

  const currentItem =
    NAV_ITEMS.find((x) => x.id === current) ?? NAV_ITEMS[0];

  let screen: React.ReactNode;
  if (loading) {
    screen = <LoadingScreen />;
  } else if (current === "content") {
    screen = (
      <ContentPipeline
        state={state}
        setState={setState}
        gridSize={tweaks.gridSize}
        refresh={refresh}
        syncError={syncError}
      />
    );
  } else if (current === "captions") {
    screen = (
      <CaptionLibrary
        state={state}
        setState={setState}
        gridSize={tweaks.gridSize}
        refresh={refresh}
      />
    );
  } else if (current === "hooks") {
    screen = <HookAnalytics />;
  } else if (current === "spend") {
    screen = <SpendDashboard />;
  } else if (current === "requests") {
    screen = <FeatureRequestsDashboard />;
  } else {
    screen = <ComingSoon item={currentItem} />;
  }

  return (
    <ToastProvider>
      <AppShell
        current={current}
        setCurrent={setCurrent}
        logout={logout}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        role={role}
        viewAs={viewAs}
        setViewAs={setViewAs}
      >
        {screen}
      </AppShell>
      <TweaksPanel
        tweaks={tweaks}
        setTweaks={setTweaks}
        visible={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
      />
    </ToastProvider>
  );
}

function AppShell({
  current,
  setCurrent,
  logout,
  sidebarCollapsed,
  setSidebarCollapsed,
  role,
  viewAs,
  setViewAs,
  children,
}: {
  current: DashId;
  setCurrent: (id: DashId) => void;
  logout: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  role: "admin" | "user";
  viewAs: "admin" | "user";
  setViewAs: (v: "admin" | "user") => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <MobileTopBar
          current={current}
          setCurrent={setCurrent}
          onLogout={logout}
          role={role}
          viewAs={viewAs}
          setViewAs={setViewAs}
        />
        <main
          key={current}
          style={{
            padding: "16px 16px 96px",
            animation: "fadeIn 280ms ease",
          }}
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "stretch",
      }}
    >
      <Sidebar
        current={current}
        setCurrent={setCurrent}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        role={role}
        viewAs={viewAs}
        setViewAs={setViewAs}
      />
      <main
        key={current}
        style={{
          flex: 1,
          padding: "40px 44px 80px",
          maxWidth: 1400,
          width: "100%",
          animation: "fadeIn 280ms ease",
        }}
      >
        {children}
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
      <div
        className="serif"
        style={{ fontSize: 28, fontStyle: "italic", marginBottom: 8 }}
      >
        Syncing with Supabase…
      </div>
      <div style={{ fontSize: 13 }}>
        Fetching deliveries and caption library.
      </div>
    </div>
  );
}
