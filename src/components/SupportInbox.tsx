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

  const load = React.useCallback(
    async (f: Filter = filter) => {
      try {
        setError(null);
        const { threads, unreadCount } = await fetchThreads(f);
        setThreads(threads);
        onUnreadChange?.(unreadCount);
        if (f === "open") {
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
    [filter, onUnreadChange],
  );

  React.useEffect(() => {
    setLoading(true);
    load(filter);
  }, [filter, load]);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const { report } = await pollNow();
      toast(
        `Polled: ${report.emailsInserted} email, ${report.feedbackInserted} feedback, ${report.threadsTriaged} triaged`,
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

      {/* Mobile: one thumb-scrollable row (wrapping eats vertical space);
          desktop: wrap as before. Negative margins let the row bleed to the
          screen edge under the shell's 16px padding. */}
      <div
        style={
          isMobile
            ? {
                display: "flex",
                gap: 8,
                marginBottom: 14,
                overflowX: "auto",
                whiteSpace: "nowrap",
                margin: "0 -16px 14px",
                padding: "0 16px 4px",
                scrollbarWidth: "none",
              }
            : { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }
        }
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
                Nothing here. Inbox zero.
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
                    onClick={() => setSelectedId(t.id)}
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
                onClick={() => setSelectedId(null)}
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
  onClick,
}: {
  thread: SupportThreadRow;
  active: boolean;
  first: boolean;
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
