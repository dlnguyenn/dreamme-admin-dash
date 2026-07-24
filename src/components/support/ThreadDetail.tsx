"use client";

/**
 * Support Inbox — thread detail: message history, the two AI reply drafts
 * (editable, confirm-gated send), free-form compose, close/snooze/re-triage,
 * plus the user/actions rail (UserSidebar).
 */
import * as React from "react";
import { Button, Chip, useToast } from "../ui";
import { ConfirmDialog } from "../ConfirmDialog";
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
      <div style={{ flex: 1, minWidth: 0, width: isMobile ? "100%" : undefined }}>
        {/* Header row */}
        <div style={{ marginBottom: 14 }}>
          <div
            className="serif"
            style={{ fontSize: 22, letterSpacing: "-0.01em", marginBottom: 6 }}
          >
            {thread.subject || "(no subject)"}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {thread.counterpart_name || ""}{" "}
              {thread.counterpart_email ? `<${thread.counterpart_email}>` : ""}
            </span>
            <Chip>{thread.status.replace("_", " ")}</Chip>
            {thread.urgency === "high" && <Chip tone="accent">urgent</Chip>}
          </div>
          {thread.triage?.summary && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
              {thread.triage.summary}
            </div>
          )}
          {thread.triage?.error && (
            <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 6 }}>
              Triage error: {thread.triage.error}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <Button size="sm" variant="secondary" onClick={doRetriage} disabled={busy}>
            Re-triage
          </Button>
          {thread.status !== "closed" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => doPatch({ status: "closed" }, "Closed")}
              disabled={busy}
            >
              Close
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => doPatch({ status: "new" }, "Reopened")}
              disabled={busy}
            >
              Reopen
            </Button>
          )}
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

        {/* Messages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {(detail?.messages ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {!detail && !error && (
            <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading messages…</div>
          )}
        </div>

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
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "var(--ink-4)",
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

function MessageBubble({ message }: { message: SupportMessageRow }) {
  const inbound = message.direction === "inbound";
  const images = (message.attachments ?? []).filter((a) => a.url);
  const files = (message.attachments ?? []).filter((a) => !a.url && a.filename);
  return (
    <div
      style={{
        alignSelf: inbound ? "flex-start" : "flex-end",
        maxWidth: "85%",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "10px 14px",
        background: inbound ? "var(--surface)" : "var(--surface-2)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          marginBottom: 6,
        }}
      >
        {inbound
          ? `${message.from_email ?? (message.via === "feedback" ? "in-app" : "user")}`
          : "you"}{" "}
        · {timeAgo(message.sent_at)}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        {(message.body_text ?? "").trim() || "(no text)"}
      </div>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {images.map((img, i) => (
            <a key={i} href={img.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`attachment ${i + 1}`}
                style={{
                  width: 90,
                  height: 90,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                }}
              />
            </a>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>
          {files.map((f) => f.filename).join(", ")}
        </div>
      )}
    </div>
  );
}
