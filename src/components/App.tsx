"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ToastProvider } from "./ui";
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
import { Overview } from "./Overview";
import { ComingSoon } from "./ComingSoon";
import { TweaksPanel, type Tweaks } from "./TweaksPanel";
import { API } from "@/lib/supabase";
import { devAuthBypass } from "@/lib/dev-auth";
import type { DashState } from "@/lib/types";

// Every tab but Overview loads its code when first opened, so the first page
// load downloads the landing screen instead of all ~30 tabs (it was one 1 MB
// chunk). ssr: false because App is client-only behind the Gate anyway.
function TabLoading() {
  return (
    <div style={{ padding: "40px 0", font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>Loading…</div>
  );
}
const ContentPipeline = dynamic(() => import("./ContentPipeline").then((m) => m.ContentPipeline), { ssr: false, loading: TabLoading });
const CaptionLibrary = dynamic(() => import("./CaptionLibrary").then((m) => m.CaptionLibrary), { ssr: false, loading: TabLoading });
const HookAnalytics = dynamic(() => import("./HookAnalytics").then((m) => m.HookAnalytics), { ssr: false, loading: TabLoading });
const SpyTool = dynamic(() => import("./SpyTool").then((m) => m.SpyTool), { ssr: false, loading: TabLoading });
const ViralSlideshows = dynamic(() => import("./ViralSlideshows").then((m) => m.ViralSlideshows), { ssr: false, loading: TabLoading });
const OurSlideshows = dynamic(() => import("./OurSlideshows").then((m) => m.OurSlideshows), { ssr: false, loading: TabLoading });
const SpendDashboard = dynamic(() => import("./SpendDashboard").then((m) => m.SpendDashboard), { ssr: false, loading: TabLoading });
const GrowthAI = dynamic(() => import("./GrowthAI").then((m) => m.GrowthAI), { ssr: false, loading: TabLoading });
const MarketingEfficiency = dynamic(() => import("./MarketingEfficiency").then((m) => m.MarketingEfficiency), { ssr: false, loading: TabLoading });
const SwitchbackTest = dynamic(() => import("./SwitchbackTest").then((m) => m.SwitchbackTest), { ssr: false, loading: TabLoading });
const TrialEmails = dynamic(() => import("./TrialEmails").then((m) => m.TrialEmails), { ssr: false, loading: TabLoading });
const Mmp = dynamic(() => import("./mmp/Mmp").then((m) => m.Mmp), { ssr: false, loading: TabLoading });
const AprilPlan = dynamic(() => import("./plan/AprilPlan").then((m) => m.AprilPlan), { ssr: false, loading: TabLoading });
const StoreReviews = dynamic(() => import("./StoreReviews").then((m) => m.StoreReviews), { ssr: false, loading: TabLoading });
const CreativeAnalytics = dynamic(() => import("./CreativeAnalytics").then((m) => m.CreativeAnalytics), { ssr: false, loading: TabLoading });
const FeatureRequestsDashboard = dynamic(() => import("./FeatureRequestsDashboard").then((m) => m.FeatureRequestsDashboard), { ssr: false, loading: TabLoading });
const Roadmap = dynamic(() => import("./Roadmap").then((m) => m.Roadmap), { ssr: false, loading: TabLoading });
const ExperimentLog = dynamic(() => import("./ExperimentLog").then((m) => m.ExperimentLog), { ssr: false, loading: TabLoading });
const AppAnalytics = dynamic(() => import("./AppAnalytics").then((m) => m.AppAnalytics), { ssr: false, loading: TabLoading });
const Resources = dynamic(() => import("./Resources").then((m) => m.Resources), { ssr: false, loading: TabLoading });
const Knowledge = dynamic(() => import("./Knowledge").then((m) => m.Knowledge), { ssr: false, loading: TabLoading });
const SynthIDResearch = dynamic(() => import("./SynthIDResearch").then((m) => m.SynthIDResearch), { ssr: false, loading: TabLoading });
const ImageStudio = dynamic(() => import("./ImageStudio").then((m) => m.ImageStudio), { ssr: false, loading: TabLoading });
const AccessoryStudio = dynamic(() => import("./AccessoryStudio").then((m) => m.AccessoryStudio), { ssr: false, loading: TabLoading });
const BackgroundStudio = dynamic(() => import("./BackgroundStudio").then((m) => m.BackgroundStudio), { ssr: false, loading: TabLoading });
const Integrations = dynamic(() => import("./Integrations").then((m) => m.Integrations), { ssr: false, loading: TabLoading });
const ClipperAdmin = dynamic(() => import("./ClipperAdmin").then((m) => m.ClipperAdmin), { ssr: false, loading: TabLoading });
const SupportInbox = dynamic(() => import("./SupportInbox").then((m) => m.SupportInbox), { ssr: false, loading: TabLoading });


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

  const [current, setCurrent] = React.useState<DashId>("overview");
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
  // Threads unanswered >24h: red "!" + Support Inbox pinned to the top.
  const [supportAttention, setSupportAttention] = React.useState(0);

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
        // viewAs is read from sessionStorage, NOT localStorage, and is cleared
        // when the browser closes. It exists so an admin can preview what a
        // creator sees; it is a debug affordance, not a saved preference.
        //
        // In localStorage it was a trap with no visible cause: one click of the
        // sidebar Admin/User toggle, at any point, silently demoted you on
        // every subsequent visit forever. Every adminOnly screen vanished and
        // the visibleNavItems bounce dropped you on Content Pipeline, which
        // reads exactly like "the new landing tab didn't ship".
        const savedView = sessionStorage.getItem("dreamme.viewAs");
        if (savedRole === "admin" && (savedView === "admin" || savedView === "user")) {
          setViewAs(savedView);
        } else {
          setViewAs(savedRole);
        }
        // Clear the old localStorage key so a value stored by a previous build
        // can't keep demoting this browser.
        localStorage.removeItem("dreamme.viewAs");
      }
      // Deliberately NOT restoring the last-visited tab. Every launch lands on
      // Overview (the `current` initial state), because the whole point of that
      // screen is to be the thing you see before you go looking for anything
      // else — and a remembered tab meant one trip to Support left you landing
      // on Support every morning after.
      //
      // Viewers can't see Overview (adminOnly), so the visibleNavItems bounce
      // below drops them onto Content Pipeline as before.
      //
      // ?tab= still wins, so a link from elsewhere (a Trello ticket, a
      // bookmark) lands where it points. Validated against NAV_ITEMS — never
      // trust the param.
      const urlTab = new URLSearchParams(window.location.search).get("tab");
      if (urlTab && NAV_ITEMS.some((n) => n.id === urlTab)) {
        setCurrent(urlTab as DashId);
      }
      const savedTweaks = localStorage.getItem("dreamme.tweaks");
      if (savedTweaks) {
        setTweaks({ ...TWEAK_DEFAULTS, ...JSON.parse(savedTweaks) });
      }
    } catch {}
    setHydrated(true);
  }, []);

  // No tab persistence: nothing reads it back, so writing it would only leave
  // a stale key behind for the next person to wonder about.

  React.useEffect(() => {
    if (!hydrated) return;
    // sessionStorage: the viewer preview lasts for this browser session only.
    sessionStorage.setItem("dreamme.viewAs", viewAs);
  }, [viewAs, hydrated]);

  React.useEffect(() => {
    // Must wait for hydration AND auth: viewAs starts at "user" and only
    // becomes "admin" once storage is read — or, in a FRESH browser, only
    // when the Gate's onEnter fires. Running earlier bounces the adminOnly
    // landing tab (Overview) to Content Pipeline behind the password gate,
    // and the bounce is never undone because Content Pipeline is legal for
    // admins too. That was the "fresh browser always lands on Content
    // Pipeline" bug (2026-08-07): hydration alone didn't cover the
    // no-saved-session case, where the true role arrives at login, not at
    // hydration. Nothing is visible before auth anyway, so deferring the
    // bounce costs nothing.
    if (!hydrated || !authed) return;
    const allowed = visibleNavItems(viewAs).map((n) => n.id);
    if (!allowed.includes(current)) setCurrent(allowed[0]);
  }, [viewAs, current, hydrated, authed]);

  React.useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dreamme.tweaks", JSON.stringify(tweaks));
    document.documentElement.setAttribute("data-theme", tweaks.theme);
    // Colour-scheme preview: ?palette=tide|ink|slate (globals.css). Temporary, until one is picked.
    const palette = new URLSearchParams(window.location.search).get("palette");
    if (palette) document.documentElement.setAttribute("data-palette", palette);
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
          | { ok?: boolean; unreadCount?: number; needsAttentionCount?: number }
          | null;
        if (!cancelled && body?.ok && typeof body.unreadCount === "number") {
          setSupportUnread(body.unreadCount);
        }
        if (!cancelled && body?.ok && typeof body.needsAttentionCount === "number") {
          setSupportAttention(body.needsAttentionCount);
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
  } else if (current === "overview") {
    // Defense-in-depth: nav hides it for non-admins, but the dash id persists
    // in localStorage so re-check the role at render time.
    screen = role === "admin"
      ? <Overview onNavigate={setCurrent} />
      : <ComingSoon item={currentItem} />;
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
  } else if (current === "mmp") {
    screen = role === "admin" ? <Mmp /> : <ComingSoon item={currentItem} />;
  } else if (current === "plan") {
    screen = role === "admin" ? <AprilPlan /> : <ComingSoon item={currentItem} />;
  } else if (current === "stepdown") {
    screen = role === "admin" ? <SwitchbackTest /> : <ComingSoon item={currentItem} />;
  } else if (current === "trial-emails") {
    screen = role === "admin" ? <TrialEmails /> : <ComingSoon item={currentItem} />;
  } else if (current === "creatives") {
    screen = role === "admin" ? <CreativeAnalytics /> : <ComingSoon item={currentItem} />;
  } else if (current === "roadmap") {
    screen = role === "admin" ? <Roadmap /> : <ComingSoon item={currentItem} />;
  } else if (current === "experiments") {
    screen = role === "admin" ? <ExperimentLog /> : <ComingSoon item={currentItem} />;
  } else if (current === "app-analytics") {
    screen = role === "admin" ? <AppAnalytics /> : <ComingSoon item={currentItem} />;
  } else if (current === "requests") {
    screen = <FeatureRequestsDashboard />;
  } else if (current === "knowledge") {
    screen = role === "admin" ? <Knowledge /> : <ComingSoon item={currentItem} />;
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
  } else if (current === "accessory-studio") {
    screen = role === "admin"
      ? <AccessoryStudio />
      : <ComingSoon item={currentItem} />;
  } else if (current === "backgrounds") {
    screen = role === "admin"
      ? <BackgroundStudio />
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
  } else if (current === "reviews") {
    screen = role === "admin" ? <StoreReviews isAdmin /> : <ComingSoon item={currentItem} />;
  } else if (current === "support") {
    screen = role === "admin"
      ? <SupportInbox
          onUnreadChange={setSupportUnread}
          onAttentionChange={setSupportAttention}
        />
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
        alerts={supportAttention > 0 ? { support: true } : undefined}
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
  alerts,
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
  alerts?: Partial<Record<DashId, boolean>>;
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
      if (next === "overview") {
        setCurrent("overview");
      } else if (next === "pipeline") {
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
          excludeIds={supportInBar ? ["overview", "support"] : []}
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
        alerts={alerts}
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
        style={{ fontSize: 28, marginBottom: 8 }}
      >
        Syncing with Supabase…
      </div>
      <div style={{ fontSize: 13 }}>
        Fetching deliveries and caption library.
      </div>
    </div>
  );
}
