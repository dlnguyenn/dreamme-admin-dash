"use client";

/**
 * Support Inbox — thread detail: message history, the two AI reply drafts
 * (editable, confirm-gated send), free-form compose, close/snooze/re-triage,
 * plus the user/actions rail (UserSidebar).
 */
import * as React from "react";
import { Button, Chip, useToast } from "../ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { hueFromName, InitialsAvatar } from "../porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import type {
  SupportDraftRow,
  SupportMessageRow,
  SupportThreadRow,
  ThreadDetailPayload,
} from "@/lib/support/types";
import {
  fetchThreadDetail,
  patchThread,
  retriage,
  sendReply,
  timeAgo,
} from "./api";
import { splitQuotedText } from "@/lib/support/email-text";
import { UserSidebar } from "./UserSidebar";

export function ThreadDetail({
  threadId,
  summaryRow,
  onChanged,
}: {
  threadId: string;
  /** row from the list (renders instantly while detail loads) */
  summaryRow: SupportThreadRow | null;
  onChanged: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [detail, setDetail] = React.useState<ThreadDetailPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draftEdits, setDraftEdits] = React.useState<Record<string, string>>({});
  const [compose, setCompose] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmSend, setConfirmSend] = React.useState<{
    body: string;
    draftId?: string;
  } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const d = await fetchThreadDetail(threadId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const thread = detail?.thread ?? summaryRow;
  if (!thread) {
    return error ? (
      <div style={{ color: "var(--accent)", fontSize: 13 }}>{error}</div>
    ) : (
      <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
    );
  }

  const latestGen = detail?.drafts.reduce((m, d) => Math.max(m, d.generation), 0) ?? 0;
  const activeDrafts = (detail?.drafts ?? []).filter(
    (d) => d.generation === latestGen && d.status !== "discarded",
  );
  const replyTo = thread.counterpart_email;

  const doSend = async (body: string, draftId?: string) => {
    setBusy(true);
    try {
      await sendReply(threadId, { body, draftId });
      toast(`Sent to ${replyTo}`);
      setCompose("");
      await load();
      onChanged();
    } catch (e) {
      toast(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setConfirmSend(null);
    }
  };

  const doPatch = async (
    patch: Parameters<typeof patchThread>[1],
    msg: string,
  ) => {
    setBusy(true);
    try {
      await patchThread(threadId, patch);
      toast(msg);
      await load();
      onChanged();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doRetriage = async () => {
    setBusy(true);
    try {
      await retriage(threadId);
      toast("Re-triaged");
      await load();
      onChanged();
    } catch (e) {
      toast(`Re-triage failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const snooze = (days: number) => {
    const until = new Date(Date.now() + days * 86400_000).toISOString();
    doPatch({ snoozed_until: until }, `Snoozed ${days}d`);
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 20,
        alignItems: "flex-start",
        flexDirection: isMobile ? "column" : "row",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          width: isMobile ? "100%" : undefined,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <InitialsAvatar
              name={thread.counterpart_name || thread.counterpart_email || "?"}
              hue={
                thread.counterpart_name || thread.counterpart_email
                  ? hueFromName(
                      thread.counterpart_name || thread.counterpart_email || "?",
                    )
                  : null
              }
              size={36}
            />
            <span
              style={{
                font: "650 20px var(--font-ui)",
                letterSpacing: "-0.01em",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {thread.subject || "(no subject)"}
            </span>
            <Chip>{thread.status.replace("_", " ")}</Chip>
            {thread.urgency === "high" && <Chip tone="danger">urgent</Chip>}
          </div>
          <div
            style={{
              font: "400 13px var(--font-ui)",
              color: "var(--ink-3)",
              marginTop: 4,
            }}
          >
            {thread.counterpart_name || ""}
            {thread.counterpart_email && (
              <>
                {thread.counterpart_name ? " · " : ""}
                <a
                  href={`mailto:${thread.counterpart_email}`}
                  style={{
                    color: "var(--link)",
                    textDecoration: "none",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {thread.counterpart_email}
                </a>
              </>
            )}
          </div>
          {thread.triage?.summary && (
            <div
              style={{
                font: "400 13.5px/1.55 var(--font-ui)",
                color: "var(--ink-2)",
                marginTop: 8,
              }}
            >
              {thread.triage.summary}
            </div>
          )}
          {thread.triage?.error && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--danger-text)",
                marginTop: 6,
              }}
            >
              Triage error: {thread.triage.error}
            </div>
          )}

          {/* Action row: one primary, everything else ghost */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 12,
            }}
          >
            {thread.status !== "closed" ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => doPatch({ status: "closed" }, "Closed")}
                disabled={busy}
              >
                Close
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => doPatch({ status: "new" }, "Reopened")}
                disabled={busy}
              >
                Reopen
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={doRetriage} disabled={busy}>
              Re-triage
            </Button>
            <Button size="sm" variant="ghost" onClick={() => snooze(1)} disabled={busy}>
              Snooze 1d
            </Button>
            <Button size="sm" variant="ghost" onClick={() => snooze(3)} disabled={busy}>
              3d
            </Button>
            <Button size="sm" variant="ghost" onClick={() => snooze(7)} disabled={busy}>
              7d
            </Button>
          </div>
        </div>

        {/* Messages — iMessage-style transcript */}
        <div
          style={{
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {buildTranscript(detail?.messages ?? []).map((item) =>
            item.kind === "separator" ? (
              <TimeSeparator key={item.key} at={item.at} />
            ) : (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                firstInGroup={item.firstInGroup}
                lastInGroup={item.lastInGroup}
              />
            ),
          )}
          {!detail && !error && (
            <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading messages…</div>
          )}
        </div>

        <div style={{ padding: "0 22px 20px" }}>

        {/* Drafts */}
        {activeDrafts.length > 0 && replyTo && (
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>AI drafts, pick one, edit, send</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 12,
              }}
            >
              {activeDrafts.map((d) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  value={draftEdits[d.id] ?? d.body}
                  onChange={(v) => setDraftEdits((s) => ({ ...s, [d.id]: v }))}
                  onSend={() =>
                    setConfirmSend({
                      body: draftEdits[d.id] ?? d.body,
                      draftId: d.id,
                    })
                  }
                  disabled={busy || d.status === "sent"}
                />
              ))}
            </div>
          </div>
        )}

        {/* Free-form compose */}
        {replyTo ? (
          <div>
            <SectionLabel>Or write your own</SectionLabel>
            <textarea
              value={compose}
              onChange={(e) => setCompose(e.target.value)}
              placeholder={`Reply to ${replyTo}…`}
              rows={5}
              style={textareaStyle}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !compose.trim()}
                onClick={() => setConfirmSend({ body: compose })}
              >
                Send reply
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            No reply email on this {thread.source === "feedback" ? "feedback" : "thread"} —
            the user submitted without an address.
          </div>
        )}
        </div>
      </div>

      {/* User + actions rail */}
      <div
        style={{
          width: isMobile ? "100%" : 300,
          minWidth: isMobile ? undefined : 300,
        }}
      >
        <UserSidebar
          thread={thread}
          actions={detail?.actions ?? []}
          onInsertTemplate={(text) => setCompose(text)}
          onActionDone={async () => {
            await load();
            onChanged();
          }}
        />
      </div>

      {confirmSend && (
        <ConfirmDialog
          title="Send this reply?"
          message={
            <div>
              <div style={{ marginBottom: 8 }}>
                To: <strong>{replyTo}</strong>
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 220,
                  overflowY: "auto",
                  padding: 10,
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {confirmSend.body}
              </div>
            </div>
          }
          confirmLabel="Send"
          onConfirm={() => doSend(confirmSend.body, confirmSend.draftId)}
          onCancel={() => setConfirmSend(null)}
        />
      )}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line-2)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "inherit",
  resize: "vertical",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        font: "650 11.5px var(--font-ui)",
        color: "var(--ink-3)",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function DraftCard({
  draft,
  value,
  onChange,
  onSend,
  disabled,
}: {
  draft: SupportDraftRow;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 12,
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip tone={draft.variant === 1 ? "ink" : "neutral"}>
          Draft {draft.variant === 1 ? "A" : "B"}
        </Chip>
        {draft.status === "sent" && <Chip tone="success">sent</Chip>}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={9}
        style={{ ...textareaStyle, fontSize: 12.5 }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="primary" size="sm" onClick={onSend} disabled={disabled}>
          Send this reply
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// iMessage-style transcript: consecutive same-side messages cluster into
// groups (tight gaps, one tail), and a centered timestamp separates runs
// more than an hour apart — no per-bubble labels.

const GROUP_GAP_MS = 10 * 60_000;
const SEPARATOR_GAP_MS = 60 * 60_000;

type TranscriptItem =
  | { kind: "separator"; key: string; at: string }
  | {
      kind: "message";
      message: SupportMessageRow;
      firstInGroup: boolean;
      lastInGroup: boolean;
    };

function buildTranscript(messages: SupportMessageRow[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const gapBefore = prev
      ? new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime()
      : Infinity;
    const gapAfter = next
      ? new Date(next.sent_at).getTime() - new Date(m.sent_at).getTime()
      : Infinity;
    const separated = gapBefore > SEPARATOR_GAP_MS;
    if (separated) {
      items.push({ kind: "separator", key: `sep-${m.id}`, at: m.sent_at });
    }
    items.push({
      kind: "message",
      message: m,
      firstInGroup:
        separated || !prev || prev.direction !== m.direction || gapBefore > GROUP_GAP_MS,
      lastInGroup:
        !next || next.direction !== m.direction || gapAfter > GROUP_GAP_MS,
    });
  }
  return items;
}

function TimeSeparator({ at }: { at: string }) {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const label = `${
    sameDay
      ? "Today"
      : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  } ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return (
    <div
      style={{
        textAlign: "center",
        font: "650 11px var(--font-ui)",
        color: "var(--ink-4)",
        margin: "14px 0 10px",
      }}
    >
      {label}
    </div>
  );
}

/**
 * Body text with the quoted reply chain ("On … wrote:" + "> …") collapsed
 * behind a Gmail-style ⋯ toggle. `inverted` restyles for the filled
 * outgoing bubble (white text on accent).
 */
function MessageBody({
  body,
  inverted,
}: {
  body: string | null;
  inverted: boolean;
}) {
  const [showQuoted, setShowQuoted] = React.useState(false);
  const { main, quoted } = React.useMemo(() => splitQuotedText(body), [body]);
  // --on-accent flips white→deep-brown in dark mode, keeping AA on the
  // filled bubble in both themes.
  const dim = inverted
    ? "color-mix(in oklab, var(--on-accent) 78%, transparent)"
    : "var(--ink-3)";
  return (
    <div>
      <div
        style={{
          font: "400 13.5px/1.5 var(--font-ui)",
          color: inverted ? "var(--on-accent)" : "var(--ink)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {main || "(no text)"}
      </div>
      {quoted && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowQuoted((v) => !v)}
            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
            style={{
              border: "none",
              background: inverted
                ? "color-mix(in oklab, var(--on-accent) 22%, transparent)"
                : "var(--line)",
              color: dim,
              borderRadius: 999,
              padding: "2px 10px",
              font: "650 11px var(--font-ui)",
              letterSpacing: "0.08em",
              cursor: "pointer",
              lineHeight: "14px",
            }}
          >
            •••
          </button>
          {showQuoted && (
            <div
              style={{
                marginTop: 8,
                paddingLeft: 10,
                borderLeft: `2px solid ${inverted ? "color-mix(in oklab, var(--on-accent) 40%, transparent)" : "var(--line-2)"}`,
                font: "400 12.5px/1.5 var(--font-ui)",
                color: dim,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {quoted}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  firstInGroup,
  lastInGroup,
}: {
  message: SupportMessageRow;
  firstInGroup: boolean;
  lastInGroup: boolean;
}) {
  const inbound = message.direction === "inbound";
  const images = (message.attachments ?? []).filter((a) => a.url);
  const files = (message.attachments ?? []).filter((a) => !a.url && a.filename);

  // iMessage geometry: 18px corners, with the near-side corners tightened
  // inside a group; the tight bottom-near corner reads as the tail.
  const R = 18;
  const r = 5;
  const borderRadius = inbound
    ? `${firstInGroup ? R : r}px ${R}px ${R}px ${r}px`
    : `${R}px ${firstInGroup ? R : r}px ${r}px ${R}px`;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: inbound ? "flex-start" : "flex-end",
        marginTop: firstInGroup ? 10 : 2,
        marginBottom: lastInGroup ? 2 : 0,
      }}
      title={new Date(message.sent_at).toLocaleString()}
    >
      <div
        style={{
          background: inbound ? "var(--surface-2)" : "var(--accent)",
          borderRadius,
          padding: "9px 13px",
          maxWidth: "72%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          boxShadow: inbound ? "none" : "0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        <MessageBody body={message.body_text} inverted={!inbound} />
        {images.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {images.map((img, i) => (
              <a key={i} href={img.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`attachment ${i + 1}`}
                  style={{
                    width: 110,
                    height: 110,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                  }}
                />
              </a>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: inbound
                ? "var(--ink-4)"
                : "color-mix(in oklab, var(--on-accent) 78%, transparent)",
            }}
          >
            📎 {files.map((f) => f.filename).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
