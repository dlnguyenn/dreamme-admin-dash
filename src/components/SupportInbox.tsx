"use client";

/**
 * Support Inbox — help@ email + in-app feedback triage.
 *
 * Left: filterable thread list. Right: thread detail (messages, AI drafts,
 * send) with a user/actions rail. All sends and subscription actions are
 * manual and confirm-gated.
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
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

const CATEGORY_LABEL: Record<string, string> = {
  refund_request: "refund",
  cancel_trial: "cancel",
  question: "question",
  feedback: "feedback",
  other: "other",
};

const STORE_LABEL: Record<string, string> = {
  STRIPE: "Stripe",
  PLAY_STORE: "Google",
  APP_STORE: "Apple",
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

  const load = React.useCallback(
    async (f: Filter = filter) => {
      try {
        setError(null);
        const { threads, unreadCount } = await fetchThreads(f);
        setThreads(threads);
        onUnreadChange?.(unreadCount);
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
        eyebrow="Support"
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            tone={filter === f.id ? "ink" : "neutral"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line))",
            color: "var(--accent)",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {showList && (
          <div
            style={{
              width: isMobile ? "100%" : 340,
              minWidth: isMobile ? undefined : 340,
              display: "flex",
              flexDirection: "column",
              gap: 6,
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
                  borderRadius: 12,
                }}
              >
                Nothing here. Inbox zero.
              </div>
            ) : (
              threads.map((t) => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  active={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                />
              ))
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
  onClick,
}: {
  thread: SupportThreadRow;
  active: boolean;
  onClick: () => void;
}) {
  const name =
    thread.counterpart_name ||
    thread.counterpart_email ||
    (thread.source === "feedback" ? "In-app feedback" : "Unknown sender");
  const summary =
    thread.triage?.summary && thread.triage.summary !== "(no summary)"
      ? thread.triage.summary
      : thread.subject || "";
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid",
        borderColor: active ? "var(--line-2)" : "var(--line)",
        background: active ? "var(--surface-2)" : "var(--surface)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {thread.unread && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent)",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: thread.unread ? 600 : 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-4)", flexShrink: 0 }}>
          {timeAgo(thread.last_message_at)}
        </span>
      </div>
      {summary && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {thread.category && (
          <Chip
            tone={
              thread.category === "refund_request" ||
              thread.category === "cancel_trial"
                ? "accent"
                : "neutral"
            }
          >
            {CATEGORY_LABEL[thread.category] ?? thread.category}
          </Chip>
        )}
        {thread.resolved_store && (
          <Chip>{STORE_LABEL[thread.resolved_store] ?? thread.resolved_store}</Chip>
        )}
        {thread.source === "feedback" && <Chip>in-app</Chip>}
        {thread.status === "drafts_ready" && <Chip tone="success">drafts</Chip>}
        {thread.triage?.internal && <Chip>internal</Chip>}
        {thread.triage?.error && <Chip tone="accent">triage failed</Chip>}
      </div>
    </button>
  );
}
