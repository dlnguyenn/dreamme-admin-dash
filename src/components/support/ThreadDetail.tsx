"use client";

/**
 * Support Inbox — thread detail: message history, the two AI reply drafts
 * (editable, confirm-gated send), free-form compose, close/snooze/re-triage,
 * plus the user/actions rail (UserSidebar).
 */
import * as React from "react";
import { Button, Chip, useCopy, useToast } from "../ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { hueFromName, InitialsAvatar } from "../porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  inFeatureRequestFolder,
  isFeatureRequest,
  needsAttention,
  type SupportDraftRow,
  type SupportMessageRow,
  type SupportThreadRow,
  type ThreadDetailPayload,
} from "@/lib/support/types";
import {
  claimThreadOfferCode,
  fetchThreadDetail,
  patchThread,
  releaseThreadOfferCode,
  retriage,
  sendReply,
  timeAgo,
} from "./api";
import {
  askedForDiscount,
  iphoneSignal,
  offerCodeReply,
  YEARLY_SPECIAL_PRICE,
  type OfferCodeRow,
} from "@/lib/support/offer-codes";
import { messageText, splitQuotedText } from "@/lib/support/email-text";
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
    /** minted when the dialog opens; dedupes retries server-side */
    key: string;
  } | null>(null);
  // Synchronous in-flight latch. React state updates on the NEXT render, so
  // two clicks in the same tick both pass a state-based check — a ref is
  // set immediately (this is how the double-send got through).
  const sendingRef = React.useRef(false);
  const composeRef = React.useRef<HTMLTextAreaElement>(null);

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

  const doSend = async (body: string, draftId?: string, key?: string) => {
    if (sendingRef.current) return; // double click / Enter, same tick
    sendingRef.current = true;
    setBusy(true);
    try {
      await sendReply(threadId, { body, draftId, idempotencyKey: key });
      toast(`Sent to ${replyTo}`);
      setCompose("");
      await load();
      onChanged();
    } catch (e) {
      toast(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      sendingRef.current = false;
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

  /** Drop a reply into the compose box and bring it into view. */
  const fillCompose = (text: string) => {
    setCompose(text);
    requestAnimationFrame(() => {
      composeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      composeRef.current?.focus();
    });
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
            {needsAttention(thread) && <Chip tone="danger">needs attention!</Chip>}
            {isFeatureRequest(thread) && <Chip tone="accent">feature request</Chip>}
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
            {/* Ignored threads never enter the folder, so no button there.
                Back to inbox only undoes a manual move: a thread the 24h
                rule foldered would stay put after clearing the stamp. */}
            {thread.status !== "ignored" &&
              (!inFeatureRequestFolder(thread) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    doPatch(
                      { feature_request_moved_at: new Date().toISOString() },
                      "Moved to Feature requests",
                    )
                  }
                  disabled={busy}
                >
                  Move to Feature requests
                </Button>
              ) : (
                thread.feature_request_moved_at &&
                !inFeatureRequestFolder({ ...thread, feature_request_moved_at: null }) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      doPatch({ feature_request_moved_at: null }, "Moved back to the inbox")
                    }
                    disabled={busy}
                  >
                    Back to inbox
                  </Button>
                )
              ))}
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

        {/* Discount ask -> one-click Yearly Special code */}
        {detail && replyTo && (askedForDiscount(thread, detail.messages) || detail.offerCode) && (
          <OfferCodeCard
            thread={thread}
            messages={detail.messages}
            assigned={detail.offerCode ?? null}
            onInsert={fillCompose}
            onChanged={load}
          />
        )}

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
                      key: crypto.randomUUID(),
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
              ref={composeRef}
              value={compose}
              onChange={(e) => setCompose(e.target.value)}
              placeholder={`Reply to ${replyTo}…`}
              rows={compose.length > 400 ? 12 : 5}
              style={textareaStyle(isMobile)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !compose.trim()}
                onClick={() =>
                  setConfirmSend({ body: compose, key: crypto.randomUUID() })
                }
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
          rcProjectId={detail?.revenueCatProjectId ?? null}
          onInsertTemplate={fillCompose}
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
          busy={busy}
          busyLabel="Sending…"
          onConfirm={() =>
            doSend(confirmSend.body, confirmSend.draftId, confirmSend.key)
          }
          onCancel={() => setConfirmSend(null)}
        />
      )}
    </div>
  );
}

/**
 * Mobile textareas must be ≥16px or iOS Safari zooms the whole page on
 * focus; desktop keeps the denser 13px.
 */
function textareaStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--line-2)",
    background: "var(--surface)",
    color: "var(--ink)",
    fontSize: isMobile ? 16 : 13,
    lineHeight: 1.5,
    fontFamily: "inherit",
    resize: "vertical",
  };
}

/**
 * Shown when the customer asked for a discount (or already has a code).
 * One click claims the next free Yearly Special code for this thread and
 * writes the reply into the compose box; sending stays the usual
 * confirm-gated Send. App Store codes do nothing for Play or web
 * subscribers, so the button is off when we know they are not on iPhone.
 */
function OfferCodeCard({
  thread,
  messages,
  assigned,
  onInsert,
  onChanged,
}: {
  thread: SupportThreadRow;
  messages: SupportMessageRow[];
  assigned: OfferCodeRow | null;
  onInsert: (text: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const { copied, copy } = useCopy();
  const [busy, setBusy] = React.useState(false);
  const [confirmRelease, setConfirmRelease] = React.useState(false);
  const claimingRef = React.useRef(false);
  const signal = iphoneSignal(thread, messages);
  const blocked = signal.ios === "no" && !assigned;

  const claim = async () => {
    if (claimingRef.current) return;
    claimingRef.current = true;
    setBusy(true);
    try {
      const { code, created } = await claimThreadOfferCode(thread.id);
      onInsert(offerCodeReply(thread, code, messages));
      toast(created ? `Code ${code.code} reserved for this thread` : `Using this thread's code ${code.code}`);
      await onChanged();
    } catch (e) {
      toast(`Couldn't get a code: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      claimingRef.current = false;
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      const { released } = await releaseThreadOfferCode(thread.id);
      toast(`${released} is back in the pool`);
      await onChanged();
    } catch (e) {
      toast(`Release failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setConfirmRelease(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--surface-2)",
        borderRadius: 14,
        padding: "12px 14px",
        marginBottom: 18,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ font: "650 13px var(--font-ui)", color: "var(--ink)" }}>
          {assigned ? "Yearly Special code assigned" : "Asked for a discount"}
        </span>
        <Chip tone={signal.ios === "yes" ? "success" : signal.ios === "no" ? "danger" : "warning"}>
          {signal.ios === "yes" ? "iPhone" : signal.ios === "no" ? "not iPhone" : "device unknown"}
        </Chip>
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{signal.reason}</span>
      </div>
      <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>
        {assigned ? (
          <>
            <span
              style={{
                font: "600 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                color: "var(--ink)",
              }}
            >
              {assigned.code}
            </span>{" "}
            (#{assigned.position}) was reserved {timeAgo(assigned.used_at)}. Re-inserting
            reuses it, so the same person never burns two codes.
          </>
        ) : blocked ? (
          <>App Store offer codes only redeem on iPhone, so a code won&apos;t help this {signal.reason}.</>
        ) : (
          <>
            Sends a one-time App Store code for the Yearly Special ({YEARLY_SPECIAL_PRICE}/yr).
            {signal.ios === "unknown" && " Check they're on iPhone before you send it."}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" onClick={claim} disabled={busy || blocked}>
          {busy ? "Getting a code…" : assigned ? "Insert code reply again" : "Insert Yearly Special code"}
        </Button>
        {assigned && (
          <>
            <Button size="sm" variant="ghost" onClick={() => copy(assigned.redeem_url)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRelease(true)} disabled={busy}>
              Release code
            </Button>
          </>
        )}
      </div>
      {confirmRelease && assigned && (
        <ConfirmDialog
          title="Put this code back in the pool?"
          message={`Only do this if ${assigned.code} was never sent. If the customer already has it, the next person would get a code that no longer works.`}
          confirmLabel="Release"
          busy={busy}
          busyLabel="Releasing…"
          onConfirm={release}
          onCancel={() => setConfirmRelease(false)}
        />
      )}
    </div>
  );
}

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
  const isMobile = useIsMobile();
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
        style={{ ...textareaStyle(isMobile), fontSize: isMobile ? 16 : 12.5 }}
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
        <MessageBody
          body={messageText(message.body_text, message.body_html)}
          inverted={!inbound}
        />
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
