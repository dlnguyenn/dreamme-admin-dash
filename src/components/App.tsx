"use client";

import * as React from "react";
import { Gate } from "./Gate";
import { NAV_ITEMS, Sidebar, visibleNavItems, type DashId } from "./Shell";
import {
  MobileTabBar,
  MobileScreenTitle,
  MoreSheet,
  tabForDash,
  type MobileTab,
} from "./MobileTabBar";
import { useIsMobile } from "@/lib/useIsMobile";
import { ContentPipeline } from "./ContentPipeline";
import { CaptionLibrary } from "./CaptionLibrary";
import { HookAnalytics } from "./HookAnalytics";
import { SpyTool } from "./SpyTool";
import { SpendDashboard } from "./SpendDashboard";
import { GrowthAI } from "./GrowthAI";
import { MarketingEfficiency } from "./MarketingEfficiency";
import { CreativeAnalytics } from "./CreativeAnalytics";
import { FeatureRequestsDashboard } from "./FeatureRequestsDashboard";
import { Resources } from "./Resources";
import { SynthIDResearch } from "./SynthIDResearch";
import { ImageStudio } from "./ImageStudio";
import { Integrations } from "./Integrations";
import { ComingSoon } from "./ComingSoon";
import { TweaksPanel, type Tweaks } from "./TweaksPanel";
import { ToastProvider } from "./ui";
import { API } from "@/lib/supabase";
import type { DashState } from "@/lib/types";

const TWEAK_DEFAULTS: Tweaks = { theme: "light", gridSize: 4 };

export function App() {
  const isMobile = useIsMobile();
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
  // Mobile-only: Pipeline vs Before are separate tabs in the bottom bar, but
  // share the ContentPipeline screen under the hood. The parent owns the
  // mode so the tab bar selection and the screen stay in sync.
  const [mobilePipelineMode, setMobilePipelineMode] = React.useState<
    "after" | "before"
  >("after");

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
    if (typeof document !== "undefined" && document.hidden) return;
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
    const id = setInterval(refresh, 120000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
        // Only parent-drive the mode on mobile — desktop keeps its existing
        // segmented-control behavior inside ContentPipeline itself.
        modeOverride={isMobile ? mobilePipelineMode : undefined}
        onModeOverrideChange={isMobile ? setMobilePipelineMode : undefined}
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
  } else if (current === "spy") {
    screen = <SpyTool />;
  } else if (current === "spend") {
    screen = <SpendDashboard />;
  } else if (current === "growth") {
    // Admin-only surface (same defense-in-depth as SynthID/ImageStudio):
    // nav hides it for non-admins, but the dash id persists in localStorage
    // so re-check the role at render time.
    screen = role === "admin" ? <GrowthAI /> : <ComingSoon item={currentItem} />;
  } else if (current === "marketing") {
    screen = <MarketingEfficiency />;
  } else if (current === "creatives") {
    screen = role === "admin" ? <CreativeAnalytics /> : <ComingSoon item={currentItem} />;
  } else if (current === "requests") {
    screen = <FeatureRequestsDashboard />;
  } else if (current === "resources") {
    screen = <Resources isAdmin={role === "admin"} />;
  } else if (current === "synthid-research") {
    // Defense-in-depth: nav is hidden for non-admins via visibleNavItems(),
    // but the dash id can persist in localStorage so re-check role at render
    // time and bounce non-admins back to a safe default.
    screen = role === "admin"
      ? <SynthIDResearch />
      : <ComingSoon item={currentItem} />;
  } else if (current === "image-studio") {
    screen = role === "admin"
      ? <ImageStudio />
      : <ComingSoon item={currentItem} />;
  } else if (current === "integrations") {
    screen = role === "admin"
      ? <Integrations />
      : <ComingSoon item={currentItem} />;
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
        mobilePipelineMode={mobilePipelineMode}
        setMobilePipelineMode={setMobilePipelineMode}
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
  mobilePipelineMode,
  setMobilePipelineMode,
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
  mobilePipelineMode: "after" | "before";
  setMobilePipelineMode: (v: "after" | "before") => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [moreOpen, setMoreOpen] = React.useState(false);

  if (isMobile) {
    const tab: MobileTab = tabForDash(current, mobilePipelineMode);
    // Screen title shown in the 54px top bar. Transformation is its own tab
    // so we label the screen accordingly; otherwise fall back to the nav
    // item's label (with a friendly name for Content Pipeline).
    const navLabel = NAV_ITEMS.find((n) => n.id === current)?.label ?? "";
    const title =
      current === "content"
        ? mobilePipelineMode === "before"
          ? "Transformation"
          : "Pipeline"
        : navLabel;

    const handleTabChange = (next: MobileTab) => {
      if (next === "pipeline") {
        setCurrent("content");
        setMobilePipelineMode("after");
      } else if (next === "before") {
        setCurrent("content");
        setMobilePipelineMode("before");
      } else if (next === "captions") {
        setCurrent("captions");
      } else if (next === "hooks") {
        setCurrent("hooks");
      }
    };

    return (
      <div style={{ minHeight: "100vh" }}>
        <MobileScreenTitle title={title} />
        <main
          key={`${current}-${mobilePipelineMode}`}
          style={{
            // Bottom padding clears the 52px tab bar + home indicator safe
            // area so content never hides behind the fixed nav. Horizontal
            // padding matches the previous mobile shell so existing screens
            // that assume a padded main don't need to change; screens that
            // want full-bleed rails / hero images use negative margins.
            padding:
              "12px 16px calc(72px + env(safe-area-inset-bottom))",
            animation: "fadeIn 280ms ease",
          }}
        >
          {children}
        </main>
        <MobileTabBar
          tab={tab}
          onTabChange={handleTabChange}
          onOpenMore={() => setMoreOpen(true)}
        />
        <MoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          current={current}
          onNavigate={(id) => setCurrent(id)}
          role={role}
          viewAs={viewAs}
          setViewAs={setViewAs}
          onLogout={logout}
        />
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
