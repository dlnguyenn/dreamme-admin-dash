import { describe, expect, it } from "vitest";
import {
  inFeatureRequestFolder,
  isFeatureRequest,
  needsAttention,
  shouldAutoClose,
  type SupportThreadRow,
  type TriageResult,
} from "@/lib/support/types";

const NOW = new Date("2026-10-14T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const thread = (
  fields: Partial<SupportThreadRow> = {},
): Parameters<typeof needsAttention>[0] => ({
  status: "drafts_ready",
  last_inbound_at: hoursAgo(25),
  created_at: hoursAgo(25),
  snoozed_until: null,
  triage: null,
  ...fields,
});

describe("needsAttention", () => {
  it("flags an open thread whose customer has waited more than 24h", () => {
    expect(needsAttention(thread(), NOW)).toBe(true);
    expect(needsAttention(thread({ status: "new" }), NOW)).toBe(true);
  });

  it("does not flag inside the 24h window", () => {
    expect(needsAttention(thread({ last_inbound_at: hoursAgo(23) }), NOW)).toBe(false);
  });

  it("does not flag replied, closed or ignored threads", () => {
    for (const status of ["waiting_user", "closed", "ignored"] as const) {
      expect(needsAttention(thread({ status }), NOW)).toBe(false);
    }
  });

  it("does not flag a thread snoozed into the future, but does once the snooze ends", () => {
    expect(needsAttention(thread({ snoozed_until: hoursAgo(-5) }), NOW)).toBe(false);
    expect(needsAttention(thread({ snoozed_until: hoursAgo(1) }), NOW)).toBe(true);
  });

  it("does not flag internal test threads", () => {
    const triage = {
      is_spam: false,
      classification: "other",
      urgency: "low",
      summary: "",
      internal: true,
    } as const;
    expect(needsAttention(thread({ triage }), NOW)).toBe(false);
  });

  it("falls back to created_at when last_inbound_at is missing", () => {
    expect(
      needsAttention(thread({ last_inbound_at: null, created_at: hoursAgo(30) }), NOW),
    ).toBe(true);
    expect(
      needsAttention(thread({ last_inbound_at: null, created_at: hoursAgo(2) }), NOW),
    ).toBe(false);
  });
});

describe("shouldAutoClose", () => {
  const waiting = (fields: Partial<SupportThreadRow> = {}) => ({
    status: "waiting_user" as const,
    last_message_at: hoursAgo(25),
    snoozed_until: null,
    ...fields,
  });

  it("closes a thread that has waited on the customer for more than 24h", () => {
    expect(shouldAutoClose(waiting(), NOW)).toBe(true);
  });

  it("leaves it alone inside the 24h window", () => {
    expect(shouldAutoClose(waiting({ last_message_at: hoursAgo(23) }), NOW)).toBe(false);
  });

  it("only touches Waiting threads", () => {
    for (const status of ["new", "drafts_ready", "closed", "ignored"] as const) {
      expect(shouldAutoClose(waiting({ status }), NOW)).toBe(false);
    }
  });

  it("respects an active snooze", () => {
    expect(shouldAutoClose(waiting({ snoozed_until: hoursAgo(-5) }), NOW)).toBe(false);
  });
});

describe("isFeatureRequest", () => {
  const triage = (fields: Partial<TriageResult> = {}): TriageResult => ({
    is_spam: false,
    classification: "feedback",
    urgency: "normal",
    summary: "",
    ...fields,
  });

  it("follows the triage flag", () => {
    const t = { source: "email" as const, subject: "Shot day" };
    expect(isFeatureRequest({ ...t, triage: triage({ feature_request: true }) })).toBe(true);
    expect(isFeatureRequest({ ...t, triage: triage({ feature_request: false }) })).toBe(false);
    expect(isFeatureRequest({ ...t, triage: null })).toBe(false);
  });

  it("counts in-app feedback filed as feature_request even without the flag", () => {
    expect(
      isFeatureRequest({
        source: "feedback",
        subject: "In-app feedback: feature_request",
        triage: triage(),
      }),
    ).toBe(true);
    expect(
      isFeatureRequest({ source: "feedback", subject: "In-app feedback: bug", triage: triage() }),
    ).toBe(false);
  });

  it("never tags spam", () => {
    expect(
      isFeatureRequest({
        source: "feedback",
        subject: "In-app feedback: feature_request",
        triage: triage({ is_spam: true, feature_request: true }),
      }),
    ).toBe(false);
  });
});

describe("inFeatureRequestFolder", () => {
  const fr = (fields: Partial<SupportThreadRow> = {}) => ({
    status: "drafts_ready" as SupportThreadRow["status"],
    source: "feedback" as const,
    subject: "In-app feedback: feature_request",
    triage: null,
    last_inbound_at: hoursAgo(25),
    created_at: hoursAgo(25),
    ...fields,
  });

  it("moves a feature request once the customer's last message is over 24h old", () => {
    expect(inFeatureRequestFolder(fr(), NOW)).toBe(true);
    expect(inFeatureRequestFolder(fr({ last_inbound_at: hoursAgo(23) }), NOW)).toBe(false);
  });

  it("brings it back to the inbox when the customer writes again", () => {
    expect(inFeatureRequestFolder(fr({ status: "new", last_inbound_at: hoursAgo(1) }), NOW)).toBe(
      false,
    );
  });

  it("keeps closed and waiting feature requests in the folder, but not ignored ones", () => {
    expect(inFeatureRequestFolder(fr({ status: "closed" }), NOW)).toBe(true);
    expect(inFeatureRequestFolder(fr({ status: "waiting_user" }), NOW)).toBe(true);
    expect(inFeatureRequestFolder(fr({ status: "ignored" }), NOW)).toBe(false);
  });

  it("leaves threads without the tag alone", () => {
    expect(inFeatureRequestFolder(fr({ subject: "In-app feedback: bug" }), NOW)).toBe(false);
  });

  it("falls back to created_at when last_inbound_at is missing", () => {
    expect(inFeatureRequestFolder(fr({ last_inbound_at: null, created_at: hoursAgo(30) }), NOW)).toBe(
      true,
    );
  });

  describe("manual move", () => {
    const email = (fields: Partial<SupportThreadRow> = {}) =>
      fr({ source: "email", subject: "Idea", last_inbound_at: hoursAgo(2), ...fields });

    it("moves an untagged, fresh thread straight away and tags it", () => {
      expect(inFeatureRequestFolder(email(), NOW)).toBe(false);
      const moved = email({ feature_request_moved_at: hoursAgo(1) });
      expect(inFeatureRequestFolder(moved, NOW)).toBe(true);
      expect(isFeatureRequest(moved)).toBe(true);
    });

    it("returns to the inbox when the customer writes after the move", () => {
      expect(
        inFeatureRequestFolder(
          email({ feature_request_moved_at: hoursAgo(3), last_inbound_at: hoursAgo(1) }),
          NOW,
        ),
      ).toBe(false);
    });

    it("then refolders after 24h like any tagged thread", () => {
      expect(
        inFeatureRequestFolder(
          email({ feature_request_moved_at: hoursAgo(40), last_inbound_at: hoursAgo(30) }),
          NOW,
        ),
      ).toBe(true);
    });

    it("still never pulls a thread out of Ignored", () => {
      expect(
        inFeatureRequestFolder(email({ status: "ignored", feature_request_moved_at: hoursAgo(1) }), NOW),
      ).toBe(false);
    });
  });
});
