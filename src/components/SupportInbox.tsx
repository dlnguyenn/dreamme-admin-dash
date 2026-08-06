"use client";

/**
 * Support Inbox — help@ email + in-app feedback triage.
 *
 * Left: filterable thread list (one card, Apple Mail-style hairline rows).
 * Right: thread detail (messages, AI drafts, send) with a user/actions rail.
 * All sends and subscription actions are manual and confirm-gated.
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import {
  CategoryTag,
  ErrorBanner,
  FilterPill,
  hueFromName,
  InitialsAvatar,
  SourceTag,
  type Family,
} from "./porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import type { SupportThreadRow, ThreadStatus } from "@/lib/support/types";
import { fetchThreads, pollNow, timeAgo } from "./support/api";
import { ThreadDetail } from "./support/ThreadDetail";

type Filter = "open" | ThreadStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "new", label: "New" },
  { id: "drafts_ready", label: "Drafts ready" },
  { id: "waiting_user", label: "Waiting" },
  { id: "closed", label: "Closed" },
  { id: "ignored", label: "Ignored" },
];

// Porcelain: category tags are FILLED soft chips — color carries meaning.
const CATEGORY_META: Record<string, { label: string; family: Family }> = {
  refund_request: { label: "REFUND", family: "danger" },
  cancel_trial: { label: "CANCEL", family: "danger" },
  question: { label: "QUESTION", family: "info" },
  feedback: { label: "FEEDBACK", family: "info" },
  other: { label: "OTHER", family: "neutral" },
};

// Source tags are OUTLINED ghosts — where it came from, not what it is.
const STORE_LABEL: Record<string, string> = {
  STRIPE: "STRIPE",
  PLAY_STORE: "GOOGLE",
  APP_STORE: "APPLE",
};

export function SupportInbox({
  onUnreadChange,
}: {
  onUnreadChange?: (n: number) => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [filter, setFilter] = React.useState<Filter>("open");
  const [threads, setThreads] = React.useState<SupportThreadRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);
  // Per-status counts derived from the "open" superset (no counts endpoint).
  const [counts, setCounts] = React.useState<Partial<Record<Filter, number>>>({});
  // Search by name/email — overrides the status filter while non-empty.
  const [search, setSearch] = React.useState("");
  const searching = search.trim().length > 0;
  // Set when the ingest cursor has stopped advancing. A stalled inbox and a
  // quiet one look identical, so this has to be stated on screen rather than
  // inferred from an empty list.
  const [health, setHealth] = React.useState<string | null>(null);

  // ---- deep links ---------------------------------------------------------
  // A thread is addressable as ?tab=support&thread=<id>, which is what the
  // Trello ticket links back to. Read on mount rather than in the useState
  // initializer so the server render (always null) and the first client
  // render agree.
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("thread");
    if (id) setSelectedId(id);
  }, []);

  /** Keep the URL in step with the open thread, without adding history
   *  entries — the mobile "← Back to list" button owns back-navigation. */
  const selectThread = React.useCallback((id: string | null) => {
    setSelectedId(id);
    try {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set("tab", "support");
        url.searchParams.set("thread", id);
      } else {
        url.searchParams.delete("thread");
      }
      window.history.replaceState(null, "", url.toString());
    } catch {}
  }, []);

  const load = React.useCallback(
    async (f: Filter = filter, q: string = search) => {
      try {
        setError(null);
        const { threads, unreadCount, health } = await fetchThreads(f, q);
        setThreads(threads);
        setHealth(health ?? null);
        onUnreadChange?.(unreadCount);
        if (f === "open" && !q.trim()) {
          const c: Partial<Record<Filter, number>> = { open: threads.length };
          for (const t of threads) {
            c[t.status as Filter] = (c[t.status as Filter] ?? 0) + 1;
          }
          setCounts(c);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [filter, search, onUnreadChange],
  );

  React.useEffect(() => {
    setLoading(true);
    if (!searching) {
      load(filter, "");
      return;
    }
    // Debounce keystrokes so we don't query per character.
    const t = setTimeout(() => load(filter, search), 300);
    return () => clearTimeout(t);
  }, [filter, search, searching, load]);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const { report } = await pollNow();
      toast(
        report.healthAlert
          ? `Polled, but ingestion looks stalled: ${report.healthAlert}`
          : `Polled: ${report.emailsInserted} email, ${report.feedbackInserted} feedback, ${report.threadsTriaged} triaged`,
      );
      await load();
    } catch (e) {
      toast(`Poll failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPolling(false);
    }
  };

  const selected = threads.find((t) => t.id === selectedId) ?? null;
  const showList = !isMobile || !selectedId;
  const showDetail = !!selectedId && (!isMobile || !!selectedId);

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Support"
        title="Support Inbox"
        subtitle="help@ email and in-app feedback, triaged with two reply drafts each. Nothing sends without your click."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Icons.Download />}
            onClick={handlePoll}
            disabled={polling}
          >
            {polling ? "Polling…" : "Poll now"}
          </Button>
        }
      />

      {health && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            border: "1px solid var(--danger)",
            background: "var(--danger-soft)",
            color: "var(--danger-text)",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 12,
            font: "500 13px var(--font-ui)",
          }}
        >
          <span aria-hidden style={{ flex: "none", lineHeight: 1.4 }}>⚠</span>
          <span>
            {health}{" "}
            <button
              type="button"
              onClick={handlePoll}
              disabled={polling}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                font: "600 13px var(--font-ui)",
                color: "inherit",
                textDecoration: "underline",
                cursor: polling ? "default" : "pointer",
              }}
            >
              {polling ? "Polling…" : "Run a poll now"}
            </button>{" "}
            and check the result for leg errors.
          </span>
        </div>
      )}

      {/* Search by name or email — spans every status, incl. closed/ignored */}
      <div style={{ position: "relative", maxWidth: isMobile ? "100%" : 340, marginBottom: 12 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search threads by name or email"
          style={{
            width: "100%",
            padding: "9px 34px 9px 13px",
            borderRadius: 12,
            border: "1px solid var(--line-2)",
            background: "var(--surface)",
            color: "var(--ink)",
            font: `400 ${isMobile ? 16 : 13.5}px var(--font-ui)`,
            outline: "none",
            boxShadow: "var(--shadow-card)",
          }}
        />
        {searching && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "none",
              background: "var(--surface-2)",
              color: "var(--ink-3)",
              cursor: "pointer",
              font: "600 12px var(--font-ui)",
              lineHeight: "24px",
              minHeight: 0,
              padding: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Mobile: one thumb-scrollable row (wrapping eats vertical space);
          desktop: wrap as before. Negative margins let the row bleed to the
          screen edge under the shell's 16px padding. */}
      <div
        style={{
          ...(isMobile
            ? {
                display: "flex" as const,
                gap: 8,
                marginBottom: 14,
                overflowX: "auto" as const,
                whiteSpace: "nowrap" as const,
                margin: "0 -16px 14px",
                padding: "0 16px 4px",
                scrollbarWidth: "none" as const,
              }
            : {
                display: "flex" as const,
                gap: 8,
                flexWrap: "wrap" as const,
                marginBottom: 18,
              }),
          // Filters don't apply while a search is active.
          ...(searching ? { opacity: 0.45, pointerEvents: "none" as const } : {}),
        }}
      >
        {FILTERS.map((f) => (
          <FilterPill
            key={f.id}
            label={f.label}
            selected={filter === f.id}
            count={counts[f.id] || undefined}
            attention={f.id === "drafts_ready"}
            onClick={() => setFilter(f.id)}
          />
        ))}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {showList && (
          <div
            style={{
              width: isMobile ? "100%" : 340,
              minWidth: isMobile ? undefined : 340,
            }}
          >
            {loading ? (
              <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20 }}>
                Loading threads…
              </div>
            ) : threads.length === 0 ? (
              <div
                style={{
                  color: "var(--ink-3)",
                  fontSize: 13,
                  padding: "28px 16px",
                  textAlign: "center",
                  border: "1px dashed var(--line-2)",
                  borderRadius: 16,
                }}
              >
                {searching
                  ? `No threads match "${search.trim()}"`
                  : "Nothing here. Inbox zero."}
              </div>
            ) : (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  boxShadow: "var(--shadow-card)",
                  overflow: "hidden",
                }}
              >
                {threads.map((t, i) => (
                  <ThreadListItem
                    key={t.id}
                    thread={t}
                    first={i === 0}
                    active={t.id === selectedId}
                    showStatus={searching}
                    onClick={() => selectThread(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {showDetail && selectedId && (
          <div style={{ flex: 1, minWidth: 0, width: isMobile ? "100%" : undefined }}>
            {isMobile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectThread(null)}
                style={{ marginBottom: 10 }}
              >
                ← Back to list
              </Button>
            )}
            <ThreadDetail
              key={selectedId}
              threadId={selectedId}
              summaryRow={selected}
              onChanged={() => load()}
            />
          </div>
        )}

        {!showDetail && !isMobile && (
          <div
            style={{
              flex: 1,
              color: "var(--ink-4)",
              fontSize: 13,
              padding: "60px 20px",
              textAlign: "center",
            }}
          >
            Select a thread to read and reply.
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadListItem({
  thread,
  active,
  first,
  showStatus = false,
  onClick,
}: {
  thread: SupportThreadRow;
  active: boolean;
  first: boolean;
  /** search results span all statuses, so say which one each row is in */
  showStatus?: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const system =
    !thread.counterpart_name && !thread.counterpart_email
      ? true
      : /feedback|dreamme/i.test(thread.counterpart_name ?? "");
  const name =
    thread.counterpart_name ||
    thread.counterpart_email ||
    (thread.source === "feedback" ? "In-app feedback" : "Unknown sender");
  const summary =
    thread.triage?.summary && thread.triage.summary !== "(no summary)"
      ? thread.triage.summary
      : thread.subject || "";
  const cat = thread.category ? CATEGORY_META[thread.category] : null;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="button"
      style={{
        background: active
          ? "var(--accent-soft)"
          : hover
            ? "var(--surface-2)"
            : "transparent",
        borderTop: first ? "none" : "1px solid var(--line)",
        padding: "11px 16px",
        cursor: "pointer",
        display: "flex",
        gap: 10,
        transition: "background 120ms ease",
      }}
    >
      <span style={{ marginTop: 2 }}>
        <InitialsAvatar
          name={name}
          hue={system ? null : hueFromName(name)}
          size={32}
        />
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {thread.unread && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
          )}
          <span
            style={{
              flex: 1,
              font: "650 13.5px var(--font-ui)",
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          <span
            style={{
              font: "400 11.5px var(--font-ui)",
              color: "var(--ink-3)",
              flexShrink: 0,
            }}
          >
            {timeAgo(thread.last_message_at)}
          </span>
        </div>
        {summary && (
          <div
            style={{
              font: "400 12.5px var(--font-ui)",
              color: "var(--ink-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {summary}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {showStatus && (
            <SourceTag size={9.5}>
              {thread.status.replace("_", " ").toUpperCase()}
            </SourceTag>
          )}
          {cat && (
            <CategoryTag family={cat.family} size={9.5}>
              {cat.label}
            </CategoryTag>
          )}
          {thread.category && !cat && (
            <CategoryTag family="neutral" size={9.5}>
              {thread.category.toUpperCase()}
            </CategoryTag>
          )}
          {thread.resolved_store && (
            <SourceTag size={9.5}>
              {STORE_LABEL[thread.resolved_store] ?? thread.resolved_store}
            </SourceTag>
          )}
          {thread.source === "feedback" && <SourceTag size={9.5}>IN-APP</SourceTag>}
          {thread.status === "drafts_ready" && (
            <CategoryTag family="attention" size={9.5}>
              DRAFTS
            </CategoryTag>
          )}
          {thread.triage?.internal && <SourceTag size={9.5}>INTERNAL</SourceTag>}
          {thread.triage?.error && (
            <CategoryTag family="danger" size={9.5}>
              TRIAGE FAILED
            </CategoryTag>
          )}
        </div>
      </div>
    </div>
  );
}
