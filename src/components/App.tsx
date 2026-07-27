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
import { ViralSlideshows } from "./ViralSlideshows";
import { OurSlideshows } from "./OurSlideshows";
import { SpendDashboard } from "./SpendDashboard";
import { GrowthAI } from "./GrowthAI";
import { MarketingEfficiency } from "./MarketingEfficiency";
import { CreativeAnalytics } from "./CreativeAnalytics";
import { FeatureRequestsDashboard } from "./FeatureRequestsDashboard";
import { Resources } from "./Resources";
import { SynthIDResearch } from "./SynthIDResearch";
import { ImageStudio } from "./ImageStudio";
import { Integrations } from "./Integrations";
import { ClipperAdmin } from "./ClipperAdmin";
import { SupportInbox } from "./SupportInbox";
import { ComingSoon } from "./ComingSoon";
import { TweaksPanel, type Tweaks } from "./TweaksPanel";
import { ToastProvider } from "./ui";
import { API } from "@/lib/supabase";
import { devAuthBypass } from "@/lib/dev-auth";
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
  // Unread support-thread count for the sidebar badge (admin only).
  const [supportUnread, setSupportUnread] = React.useState(0);

  // Hydrate from storage after mount to avoid SSR/CSR mismatch
  React.useEffect(() => {
    try {
      // On localhost in dev, skip the password gate (see lib/dev-auth).
      // Compiles away in production builds, so deployed prod stays gated.
      const bypass = devAuthBypass();
      if (bypass || sessionStorage.getItem("dreamme.auth") === "1") setAuthed(true);
      const stored = sessionStorage.getItem("dreamme.role");
      const savedRole =
        stored === "admin" || stored === "user" ? stored : bypass ? "admin" : null;
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
    // Skip background polls while the tab is hidden (saves Supabase quota).
    // The guard lives here, not inside refresh(), so the *initial* load always
    // runs — otherwise a tab that starts hidden is stranded on the loading
    // screen forever, since the early return skipped setLoading(false).
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 120000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authed, refresh]);

  // Poll the support unread count for the sidebar badge (admin only).
  React.useEffect(() => {
    if (!authed || role !== "admin") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/support/threads?countOnly=1", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; unreadCount?: number }
          | null;
        if (!cancelled && body?.ok && typeof body.unreadCount === "number") {
          setSupportUnread(body.unreadCount);
        }
      } catch {}
    };
    poll();
    const id = setInterval(() => {
      if (!document.hidden) poll();
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authed, role]);

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

  // Make the dev bypass obvious so it's never silently "logged in".
  const devBadge = devAuthBypass() ? (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 9999,
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: "#8B5CF6",
        color: "#fff",
        pointerEvents: "none",
        opacity: 0.85,
      }}
    >
      dev · localhost · auth bypassed
    </div>
  ) : null;

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
  } else if (current === "viral-slideshows") {
    // Defense-in-depth: nav hides it for non-admins, but the dash id persists
    // in localStorage so re-check the role at render time.
    screen = role === "admin" ? <ViralSlideshows /> : <ComingSoon item={currentItem} />;
  } else if (current === "our-slideshows") {
    screen = role === "admin" ? <OurSlideshows /> : <ComingSoon item={currentItem} />;
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
  } else if (current === "clippers") {
    // Defense-in-depth: nav hides it for non-admins, but the dash id can
    // persist in localStorage so re-check role at render.
    screen = role === "admin"
      ? <ClipperAdmin />
      : <ComingSoon item={currentItem} />;
  } else if (current === "support") {
    screen = role === "admin"
      ? <SupportInbox onUnreadChange={setSupportUnread} />
      : <ComingSoon item={currentItem} />;
  } else {
    screen = <ComingSoon item={currentItem} />;
  }

  return (
    <ToastProvider>
      {devBadge}
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
        badges={supportUnread > 0 ? { support: supportUnread } : undefined}
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
  badges,
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
  badges?: Partial<Record<DashId, number>>;
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
      } else if (next === "support") {
        setCurrent("support");
      }
    };

    // Support gets a bottom-bar slot (with unread badge) for admins only.
    const supportInBar = role === "admin" && viewAs === "admin";

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
          showSupport={supportInBar}
          supportBadge={supportInBar ? (badges?.support ?? 0) : 0}
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
          excludeIds={supportInBar ? ["support"] : []}
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
        badges={badges}
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
