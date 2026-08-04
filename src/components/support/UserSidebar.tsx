"use client";

/**
 * Support Inbox — right rail: resolved user card, per-store subscription
 * actions (all ConfirmDialog-gated + audit-logged server-side), and the
 * action log for the thread.
 *
 * Store rules:
 *   STRIPE      — cancel (period end / now) + refund latest charge, via
 *                 Stripe API. Confirm dialog shows live amount/date fetched
 *                 with a stripe_lookup call before enabling Confirm.
 *   PLAY_STORE  — refund & revoke via RevenueCat v1; cancel is user-side
 *                 (template reply).
 *   APP_STORE   — no API. Templates for cancel / refund instructions.
 */
import * as React from "react";
import { Button, Chip, useToast } from "../ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { Icons, type IconName } from "../Icons";
import { fam, type Family } from "../porcelain";
import type {
  SubscriptionInfo,
  SupportActionRow,
  SupportThreadRow,
} from "@/lib/support/types";
import {
  fetchSuggestions,
  linkStripeCustomer,
  runAction,
  timeAgo,
  type StripeLookupResult,
  type StripeSuggestion,
} from "./api";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  APPLE_REFUND_TEMPLATE,
  appleRefundTemplate,
  appleRelayStatus,
} from "@/lib/support/apple-relay";
import { actionLock, type ActionLock } from "@/lib/support/action-effects";

const APPLE_CANCEL_TEMPLATE = `Hi there! Thanks so much for reaching out.

Your subscription runs through Apple, so it has to be cancelled from your Apple account (Apple keeps that control, I can't do it from my side). Good news, it only takes about 20 seconds:

1. Open Settings on your iPhone
2. Tap your name at the top, then Subscriptions
3. Tap DreamMe and hit Cancel Subscription

That's it, no more charges! If you were already charged and want a refund, Apple handles those at https://reportaproblem.apple.com and they are usually quick about it.

Sorry for the extra hoop, and thanks so much for giving DreamMe a try!

Dan, co-founder of DreamMe`;

const PLAY_CANCEL_TEMPLATE = `Hi there! Thanks so much for reaching out.

Your subscription runs through Google Play, so cancelling takes about 20 seconds right on your phone:

1. Open the Play Store app
2. Tap your profile picture, then Payments and subscriptions
3. Tap Subscriptions, pick DreamMe, and hit Cancel

That's it, no more charges! If your screen looks different, send me a screenshot and I will walk you through it.

Thanks so much for giving DreamMe a try!

Dan, co-founder of DreamMe`;

/** "3d" / "6w" / "4mo" / "1.5y" — compact age for support context. */
function formatAge(iso: string): string {
  const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days < 1) return "today";
  if (days < 14) return `${Math.round(days)}d`;
  if (days < 70) return `${Math.round(days / 7)}w`;
  if (days < 330) return `${Math.round(days / 30.4)}mo`;
  const years = days / 365.25;
  return `${years < 3 ? years.toFixed(1) : Math.round(years)}y`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UserSidebar({
  thread,
  actions,
  onInsertTemplate,
  onActionDone,
}: {
  thread: SupportThreadRow;
  actions: SupportActionRow[];
  onInsertTemplate: (text: string) => void;
  onActionDone: () => void;
}) {
  const ctx = thread.user_context;
  const subs = ctx?.subscriptions ?? [];
  // Apple refunds only ever happen at reportaproblem.apple.com — surface
  // that reply for confirmed Apple users AND for senders we couldn't match
  // anywhere (usually Hide My Email).
  const relayStatus = appleRelayStatus(thread.counterpart_email, ctx);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* User card */}
      <Card title="User" glyph="UserOutline" glyphFamily="accent">
        {!ctx || ctx.noAccount ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
              No DreamMe account matched{" "}
              {thread.counterpart_email ? (
                <strong>{thread.counterpart_email}</strong>
              ) : (
                "this thread"
              )}
              . They may use a different email in the app (common with Apple
              Hide My Email) or pay from another address.
            </div>
            <StripeMatchPanel
              thread={thread}
              onActionDone={onActionDone}
            />
            {relayStatus !== "no" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onInsertTemplate(appleRefundTemplate(relayStatus))}
                title="Drops a reply into the compose box pointing them at reportaproblem.apple.com"
              >
                {relayStatus === "confirmed"
                  ? "Insert Apple refund steps"
                  : "Insert Apple refund steps (likely hidden email)"}
              </Button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <Row label="Name" value={ctx.name ?? "—"} />
            <Row label="Email" value={ctx.email ?? "—"} />
            <Row label="Journey" value={ctx.journeyStage ?? "—"} />
            {ctx.accountCreatedAt && (
              <Row
                label="Member for"
                value={`${formatAge(ctx.accountCreatedAt)} · since ${shortDate(ctx.accountCreatedAt)}`}
              />
            )}
            {ctx.lastSeenAt && (
              <Row label="Last seen" value={timeAgo(ctx.lastSeenAt)} />
            )}
            <Row label="Total spent" value={`$${ctx.totalSpentUsd.toFixed(2)}`} />
            {ctx.sandboxOnly && (
              <Chip tone="warning" style={{ alignSelf: "flex-start" }}>
                sandbox only
              </Chip>
            )}
          </div>
        )}
      </Card>

      {/* File as a Trello ticket — deliberately outside the User card and
          the subscription cards, because the threads most worth ticketing
          are often the ones that matched no account at all. */}
      <TrelloTicketCard thread={thread} actions={actions} onActionDone={onActionDone} />

      {/* Per-subscription cards */}
      {subs.map((sub, i) => (
        <SubscriptionCard
          key={`${sub.originalTransactionId ?? i}`}
          thread={thread}
          sub={sub}
          actions={actions}
          onInsertTemplate={onInsertTemplate}
          onActionDone={onActionDone}
        />
      ))}
      {ctx && !ctx.noAccount && subs.length === 0 && (
        <Card title="Subscription">
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            No subscriptions on record for this account.
          </div>
        </Card>
      )}

      {/* Action log */}
      {actions.length > 0 && (
        <Card title="Action log" glyph="InfoCircle" glyphFamily="neutral">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {actions.map((a) => (
              <div key={a.id} style={{ fontSize: 12.5 }}>
                <span
                  style={{
                    color:
                      a.status === "success"
                        ? "var(--ink)"
                        : "var(--danger-text)",
                    fontWeight: 600,
                  }}
                >
                  {a.action_type}
                </span>{" "}
                <span style={{ color: "var(--ink-4)" }}>
                  · {a.status} · {timeAgo(a.created_at)}
                </span>
                {a.error && (
                  <div style={{ color: "var(--danger-text)", marginTop: 2 }}>
                    {a.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type PendingAction =
  | { kind: "stripe_cancel"; atPeriodEnd: boolean; lookup: StripeLookupResult }
  | { kind: "stripe_refund"; lookup: StripeLookupResult }
  | { kind: "play_refund"; productId: string };

/**
 * File the thread as a Trello card (plus a duplicate in Feature Requests),
 * so a feature ask that arrives by email lands on the roadmap board instead
 * of being retyped by hand or forgotten.
 *
 * Locks after one success — per THREAD, not per user, matching the server
 * guard: the same person writing in twice with two different ideas should
 * get two cards.
 */
function TrelloTicketCard({
  thread,
  actions,
  onActionDone,
}: {
  thread: SupportThreadRow;
  actions: SupportActionRow[];
  onActionDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  // Synchronous latch — state alone misses same-tick double clicks, and a
  // duplicate card is exactly what this feature must not produce.
  const runningRef = React.useRef(false);

  // The sidebar is handed a USER-scoped action list (it spans the person's
  // other threads); a ticket is per-conversation, so narrow it here.
  const threadActions = React.useMemo(
    () => actions.filter((a) => a.thread_id === thread.id),
    [actions, thread.id],
  );
  const lock = React.useMemo(
    () => actionLock("trello_create_card", null, threadActions),
    [threadActions],
  );
  const existingCardUrl = React.useMemo(() => {
    const done = threadActions.find(
      (a) => a.action_type === "trello_create_card" && a.status === "success",
    );
    const url = done?.response?.cardUrl;
    return typeof url === "string" ? url : null;
  }, [threadActions]);

  const execute = async () => {
    if (runningRef.current) return; // no double-fire
    runningRef.current = true;
    setBusy(true);
    try {
      const res = (await runAction(thread.id, { type: "trello_create_card" })) as {
        response?: { featureCardUrl?: string; featureCardError?: string };
      };
      const r = res.response ?? {};
      // A missing duplicate is worth saying out loud — the primary card
      // landed, so silence would read as "both filed".
      if (r.featureCardError) {
        toast(`Ticket created, but the Feature Requests copy failed: ${r.featureCardError}`);
      } else if (r.featureCardUrl) {
        toast("Ticket created in both lists!");
      } else {
        toast("Ticket created!");
      }
      onActionDone();
    } catch (e) {
      toast(`Could not create ticket: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      runningRef.current = false;
      setBusy(false);
      setConfirming(false);
    }
  };

  const title = cardTitlePreview(thread);

  return (
    <Card title="Trello" glyph="Bookmark" glyphFamily="accent">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Files this thread as a card carrying their email, their own words,
          and a link back here.
        </div>
        <LockedAction lock={lock}>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || lock.disabled}
            onClick={() => setConfirming(true)}
            style={{ alignSelf: "flex-start" }}
          >
            Create ticket
          </Button>
        </LockedAction>
        {existingCardUrl && (
          <a
            href={existingCardUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              font: "600 12px var(--font-ui)",
              color: "var(--accent)",
              textDecoration: "none",
              alignSelf: "flex-start",
            }}
          >
            View ticket →
          </a>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Create Trello ticket?"
          message={
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div>
                Card title: <strong>{title}</strong>
              </div>
              <div style={{ color: "var(--ink-3)" }}>
                Goes on your default list, with a duplicate in Feature
                Requests. Nothing is sent to the user.
              </div>
            </div>
          }
          confirmLabel="Create ticket"
          busy={busy}
          busyLabel="Creating…"
          onConfirm={execute}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Card>
  );
}

/** Mirrors cardTitle() server-side so the dialog previews the real title. */
function cardTitlePreview(thread: SupportThreadRow): string {
  const raw =
    thread.triage?.summary?.trim() ||
    thread.subject?.trim() ||
    (thread.counterpart_email
      ? `Support request from ${thread.counterpart_email}`
      : "Support request");
  return raw.length > 100 ? `${raw.slice(0, 99).trimEnd()}…` : raw;
}

/**
 * "Maybe this user?" — Stripe customers whose card billing name matches
 * the sender's display name, plus a manual name search. Exists because
 * people email support from a different address than the card on file,
 * and Stripe itself cannot be searched by name (we index billing names
 * from charges instead).
 */
function StripeMatchPanel({
  thread,
  onActionDone,
}: {
  thread: SupportThreadRow;
  onActionDone: () => void;
}) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const linkedId = thread.user_context?.linkedStripeCustomerId ?? null;
  const [suggestions, setSuggestions] = React.useState<StripeSuggestion[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState<StripeSuggestion | null>(null);
  const linkingRef = React.useRef(false);

  const load = React.useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const { suggestions } = await fetchSuggestions(thread.id, q);
        setSuggestions(suggestions);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [thread.id],
  );

  // Auto-suggest on open (skip once linked — the match is settled).
  React.useEffect(() => {
    if (linkedId) return;
    if (!query.trim()) {
      load("");
      return;
    }
    const t = setTimeout(() => load(query), 300);
    return () => clearTimeout(t);
  }, [query, linkedId, load]);

  const doLink = async (s: StripeSuggestion) => {
    if (linkingRef.current) return; // same-tick double click
    linkingRef.current = true;
    setBusy(true);
    try {
      await linkStripeCustomer(thread.id, {
        customerId: s.customerId,
        name: s.name,
      });
      toast(`Linked ${s.name ?? s.customerId}`);
      onActionDone();
    } catch (e) {
      toast(`Link failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      linkingRef.current = false;
      setBusy(false);
      setConfirm(null);
    }
  };

  const doUnlink = async () => {
    if (linkingRef.current) return;
    linkingRef.current = true;
    setBusy(true);
    try {
      await linkStripeCustomer(thread.id, { unlink: true });
      toast("Unlinked");
      onActionDone();
    } catch (e) {
      toast(`Unlink failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      linkingRef.current = false;
      setBusy(false);
    }
  };

  if (linkedId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
        }}
      >
        <span style={{ flex: 1, font: "500 12px var(--font-ui)", color: "var(--ink-2)" }}>
          Linked to Stripe customer{" "}
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>
            {linkedId}
          </span>
        </span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={doUnlink}>
          Unlink
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Stripe by name…"
        aria-label="Search Stripe customers by name"
        style={{
          width: "100%",
          padding: "8px 11px",
          borderRadius: 10,
          border: "1px solid var(--line-2)",
          background: "var(--surface)",
          color: "var(--ink)",
          font: `400 ${isMobile ? 16 : 13}px var(--font-ui)`,
          outline: "none",
        }}
      />
      {loading && (
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>
          Searching…
        </span>
      )}
      {!loading && suggestions.length > 0 && (
        <>
          <span style={{ font: "650 11px var(--font-ui)", color: "var(--ink-3)" }}>
            {query.trim() ? "Stripe matches" : "Maybe this user?"}
          </span>
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.customerId}
              s={s}
              disabled={busy}
              onLink={() => setConfirm(s)}
            />
          ))}
        </>
      )}
      {!loading && query.trim().length >= 2 && suggestions.length === 0 && (
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>
          No Stripe customer matches that name.
        </span>
      )}

      {confirm && (
        <ConfirmDialog
          title="Link this Stripe customer?"
          message={
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                Attaches <strong>{confirm.name ?? confirm.customerId}</strong>
                {confirm.email ? ` (${confirm.email})` : ""} to this thread, so
                their subscription and the cancel/refund buttons become
                available here.
              </div>
              <div style={{ color: "var(--ink-4)", fontSize: 12 }}>
                Only do this if you are confident it is the same person. You can
                unlink again at any time.
              </div>
            </div>
          }
          confirmLabel="Link"
          busy={busy}
          busyLabel="Linking…"
          onConfirm={() => doLink(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function SuggestionRow({
  s,
  disabled,
  onLink,
}: {
  s: StripeSuggestion;
  disabled: boolean;
  onLink: () => void;
}) {
  const sub = s.subscriptions[0];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid var(--line)",
        background: "var(--surface)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            font: "650 12.5px var(--font-ui)",
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {s.name ?? "(no name on card)"}
        </div>
        <div
          style={{
            font: "400 11.5px var(--font-ui)",
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {s.email ?? s.customerId}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
          {sub?.plan && <Chip tone="neutral">{sub.plan}</Chip>}
          {sub && (
            <Chip tone={sub.isActive ? "success" : "neutral"}>
              {sub.isActive ? (sub.isTrial ? "trial" : "active") : "inactive"}
            </Chip>
          )}
          {s.totalSpentUsd > 0 && (
            <Chip tone="neutral">${s.totalSpentUsd.toFixed(2)}</Chip>
          )}
        </div>
        {/* Dates are how you confirm it's the right person before linking,
            and they usually answer the complaint too ("cancelled in the
            trial but still charged" = trial end vs first charge). */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            marginTop: 5,
            font: "400 11px var(--font-ui)",
            color: "var(--ink-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>
            Trial{" "}
            {s.trialStartedAt || s.trialEndsAt ? (
              <>
                {s.trialStartedAt ? shortDate(s.trialStartedAt) : "?"} →{" "}
                {s.trialEndsAt ? shortDate(s.trialEndsAt) : "?"}
              </>
            ) : (
              <span style={{ color: "var(--ink-4)" }}>none</span>
            )}
          </span>
          <span>
            First charge{" "}
            {s.firstChargeAt ? (
              <>
                {shortDate(s.firstChargeAt)}
                {s.chargedUsd > 0 ? ` · $${s.chargedUsd.toFixed(2)}` : ""}
                {s.chargeCount > 1 ? ` (${s.chargeCount}x)` : ""}
                {/* net $0 with a real charge behind it means refunded —
                    say so, or the row reads like they never paid */}
                {s.refundedUsd > 0 && (
                  <span style={{ color: "var(--warning-text, var(--ink-3))" }}>
                    {s.refundedUsd >= s.chargedUsd
                      ? " · refunded"
                      : ` · $${s.refundedUsd.toFixed(2)} refunded`}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "var(--ink-4)" }}>never charged</span>
            )}
          </span>
        </div>
      </div>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={onLink}>
        Link
      </Button>
    </div>
  );
}

/** Wraps an action button with the "already done" note underneath. */
function LockedAction({
  lock,
  children,
}: {
  lock: ActionLock;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {children}
      {lock.disabled && lock.reason && (
        <span
          style={{
            font: "500 11px var(--font-ui)",
            color: "var(--ink-4)",
            paddingLeft: 2,
          }}
        >
          {lock.reason}
          {lock.at ? ` · ${timeAgo(lock.at)}` : ""}
        </span>
      )}
    </div>
  );
}

function SubscriptionCard({
  thread,
  sub,
  actions,
  onInsertTemplate,
  onActionDone,
}: {
  thread: SupportThreadRow;
  sub: SubscriptionInfo;
  actions: SupportActionRow[];
  onInsertTemplate: (text: string) => void;
  onActionDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  // Money actions lock once they've succeeded for this user (across all
  // their threads), and cancels lock when there's nothing left to cancel.
  const locks = React.useMemo(
    () => ({
      stripe_cancel_at_period_end: actionLock(
        "stripe_cancel_at_period_end",
        sub,
        actions,
      ),
      stripe_cancel_now: actionLock("stripe_cancel_now", sub, actions),
      stripe_refund: actionLock("stripe_refund", sub, actions),
      rc_play_refund_revoke: actionLock("rc_play_refund_revoke", sub, actions),
    }),
    [sub, actions],
  );
  // Synchronous latch — state-based checks miss same-tick double clicks,
  // and a duplicate refund is real money.
  const runningRef = React.useRef(false);

  const storeLabel =
    sub.store === "STRIPE"
      ? "Stripe (web)"
      : sub.store === "PLAY_STORE"
        ? "Google Play"
        : sub.store === "APP_STORE"
          ? "Apple"
          : sub.store;

  const lookupStripe = async (): Promise<StripeLookupResult | null> => {
    try {
      const res = (await runAction(thread.id, {
        type: "stripe_lookup",
        transactionId: sub.transactionId ?? undefined,
      })) as unknown as StripeLookupResult;
      return res;
    } catch (e) {
      toast(`Stripe lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const startStripeCancel = async (atPeriodEnd: boolean) => {
    setBusy(true);
    const lookup = await lookupStripe();
    setBusy(false);
    if (lookup) setPending({ kind: "stripe_cancel", atPeriodEnd, lookup });
  };

  const startStripeRefund = async () => {
    setBusy(true);
    const lookup = await lookupStripe();
    setBusy(false);
    if (!lookup) return;
    if (!lookup.latestCharge) {
      toast("Nothing refundable — no successful charge on this customer");
      return;
    }
    if (lookup.latestCharge.refunded) {
      toast("Latest charge is already refunded");
      return;
    }
    setPending({ kind: "stripe_refund", lookup });
  };

  const execute = async () => {
    if (!pending || runningRef.current) return; // no double-fire
    runningRef.current = true;
    setBusy(true);
    try {
      if (pending.kind === "stripe_cancel") {
        await runAction(thread.id, {
          type: pending.atPeriodEnd ? "stripe_cancel_at_period_end" : "stripe_cancel_now",
          subscriptionId: pending.lookup.subscription.id,
        });
        toast(pending.atPeriodEnd ? "Will cancel at period end" : "Cancelled now");
      } else if (pending.kind === "stripe_refund") {
        await runAction(thread.id, {
          type: "stripe_refund",
          chargeId: pending.lookup.latestCharge!.chargeId,
          paymentIntentId: pending.lookup.latestCharge!.paymentIntentId,
        });
        toast("Refund issued");
      } else {
        await runAction(thread.id, {
          type: "rc_play_refund_revoke",
          productId: pending.productId,
        });
        toast("Refunded and revoked via RevenueCat");
      }
      onActionDone();
    } catch (e) {
      toast(`Action failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      runningRef.current = false;
      setBusy(false);
      setPending(null);
    }
  };

  // "will lapse": still active but auto-renew already off — the user (or
  // Dan) cancelled and access simply runs out. Changes the right reply.
  const willLapse = sub.isActive && sub.autoRenew === false;

  return (
    <Card
      title={
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {storeLabel}
          {sub.plan && <Chip tone="neutral">{sub.plan}</Chip>}
          {sub.isTrial ? (
            <Chip tone="info">trial</Chip>
          ) : (
            <Chip tone="info">paid</Chip>
          )}
          {sub.isActive ? <Chip tone="success">active</Chip> : <Chip>inactive</Chip>}
          {willLapse && <Chip tone="warning">won&apos;t renew</Chip>}
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
        <Row
          label="Plan"
          value={
            sub.plan
              ? `${sub.plan}${sub.isTrial ? " (in trial)" : ""}`
              : sub.isTrial
                ? "trial"
                : "—"
          }
        />
        {sub.startedAt && (
          <Row
            label="Subscriber for"
            value={`${formatAge(sub.startedAt)} · ${shortDate(sub.startedAt)}`}
          />
        )}
        <Row
          label={sub.isActive ? (willLapse ? "Ends" : "Renews") : "Ended"}
          value={sub.expiresAt ? sub.expiresAt.slice(0, 10) : "—"}
        />
        <Row label="Paid" value={`$${sub.totalPaidUsd.toFixed(2)}`} />
        {(sub.renewals ?? 0) > 0 && (
          <Row label="Renewals" value={String(sub.renewals)} />
        )}
        <Row label="Product" value={sub.productId ?? "—"} mono />
        {sub.cancelReason && <Row label="Cancel reason" value={sub.cancelReason} />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {sub.store === "STRIPE" && (
          <>
            <LockedAction lock={locks.stripe_cancel_at_period_end}>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || locks.stripe_cancel_at_period_end.disabled}
                onClick={() => startStripeCancel(true)}
              >
                Cancel at period end
              </Button>
            </LockedAction>
            <LockedAction lock={locks.stripe_cancel_now}>
              <Button
                size="sm"
                variant="danger"
                disabled={busy || locks.stripe_cancel_now.disabled}
                onClick={() => startStripeCancel(false)}
              >
                Cancel now
              </Button>
            </LockedAction>
            <LockedAction lock={locks.stripe_refund}>
              <Button
                size="sm"
                variant="danger"
                disabled={busy || locks.stripe_refund.disabled}
                onClick={startStripeRefund}
              >
                Refund latest charge
              </Button>
            </LockedAction>
          </>
        )}
        {sub.store === "PLAY_STORE" && (
          <>
            <LockedAction lock={locks.rc_play_refund_revoke}>
              <Button
                size="sm"
                variant="danger"
                disabled={
                  busy || !sub.productId || locks.rc_play_refund_revoke.disabled
                }
                onClick={() =>
                  setPending({ kind: "play_refund", productId: sub.productId! })
                }
              >
                Refund &amp; revoke (RevenueCat)
              </Button>
            </LockedAction>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onInsertTemplate(PLAY_CANCEL_TEMPLATE)}
            >
              Insert Play cancel instructions
            </Button>
          </>
        )}
        {sub.store === "APP_STORE" && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onInsertTemplate(APPLE_CANCEL_TEMPLATE)}
            >
              Insert Apple cancel instructions
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onInsertTemplate(APPLE_REFUND_TEMPLATE)}
              title="Refund-only reply pointing at reportaproblem.apple.com"
            >
              Insert Apple refund steps
            </Button>
          </>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={
            pending.kind === "stripe_cancel"
              ? pending.atPeriodEnd
                ? "Cancel at period end?"
                : "Cancel immediately?"
              : pending.kind === "stripe_refund"
                ? "Refund latest charge?"
                : "Refund & revoke Google Play?"
          }
          destructive
          message={<PendingSummary pending={pending} email={thread.user_context?.email} />}
          confirmLabel={
            pending.kind === "play_refund" ? "Refund & revoke" : "Confirm"
          }
          busy={busy}
          busyLabel="Working…"
          onConfirm={execute}
          onCancel={() => setPending(null)}
        />
      )}
    </Card>
  );
}

function PendingSummary({
  pending,
  email,
}: {
  pending: PendingAction;
  email: string | null | undefined;
}) {
  if (pending.kind === "play_refund") {
    return (
      <div>
        Refunds the user&apos;s latest Google Play charge AND revokes access
        immediately, via RevenueCat. Product:{" "}
        <code style={{ fontSize: 11 }}>{pending.productId}</code>
        {email ? <> · {email}</> : null}
      </div>
    );
  }
  const sub = pending.lookup.subscription;
  const charge = pending.lookup.latestCharge;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div>
        Subscription <code style={{ fontSize: 11 }}>{sub.id}</code> · status{" "}
        <strong>{sub.status}</strong>
        {sub.cancel_at_period_end ? " · already set to cancel" : ""}
      </div>
      <div>
        Current period ends{" "}
        {new Date(sub.current_period_end * 1000).toLocaleDateString()}
      </div>
      {pending.kind === "stripe_refund" && charge && (
        <div>
          Refund amount:{" "}
          <strong>
            {(charge.amount / 100).toFixed(2)} {charge.currency.toUpperCase()}
          </strong>{" "}
          (charged {new Date(charge.created * 1000).toLocaleDateString()})
        </div>
      )}
      {email && <div>User: {email}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Card({
  title,
  glyph = "CardOutline",
  glyphFamily = "neutral",
  children,
}: {
  title: React.ReactNode;
  glyph?: IconName;
  glyphFamily?: Family;
  children: React.ReactNode;
}) {
  const f = fam(glyphFamily);
  const IconComp = Icons[glyph];
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "16px 18px",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: f.soft,
            color: f.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <IconComp size={12} strokeWidth={2} />
        </span>
        <span
          style={{
            font: "650 13px var(--font-ui)",
            color: "var(--ink)",
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            minWidth: 0,
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      {mono ? (
        <span
          className="mono"
          style={{
            font: "500 11.5px var(--font-mono)",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            color: "var(--ink-2)",
            padding: "2px 7px",
            borderRadius: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 170,
          }}
          title={value}
        >
          {value}
        </span>
      ) : (
        <span
          style={{
            color: "var(--ink)",
            fontWeight: /^\$/.test(value) ? 650 : 400,
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 170,
          }}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}
