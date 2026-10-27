import { describe, expect, it } from "vitest";
import {
  briefMarkdown,
  buildBriefInput,
  parseBrief,
  planLabel,
  quoteFrom,
  requesterSnapshot,
  screenshotUrls,
  threadIdFromText,
  ticketDetails,
  trelloUrlFromText,
} from "@/lib/support/ticket-brief";
import { buildFeatureRequest, buildTrelloCard } from "@/lib/support/trello-card";
import {
  buildFeatureRequestEmail,
  featureRequestUrl,
  notifyRecipients,
} from "@/lib/feature-request-notify";
import type {
  SubscriptionInfo,
  SupportMessageRow,
  SupportThreadRow,
  UserContext,
} from "@/lib/support/types";

const sub = (over: Partial<SubscriptionInfo> = {}): SubscriptionInfo => ({
  store: "APP_STORE",
  productId: "monthly",
  transactionId: null,
  originalTransactionId: null,
  periodType: "NORMAL",
  isTrial: false,
  lastEventType: "RENEWAL",
  lastEventAt: "2026-10-12T00:00:00Z",
  expiresAt: "2026-11-19T00:00:00Z",
  cancelReason: null,
  isActive: true,
  totalPaidUsd: 14.99,
  plan: "monthly",
  startedAt: "2026-10-12T00:00:00Z",
  autoRenew: true,
  renewals: 1,
  ...over,
});

const ctx = (over: Partial<UserContext> = {}): UserContext => ({
  appUserId: "u1",
  email: "t@privaterelay.appleid.com",
  name: "Tiffany",
  journeyStage: "already_on",
  subscriptions: [sub()],
  totalSpentUsd: 14.99,
  noAccount: false,
  sandboxOnly: false,
  accountCreatedAt: "2026-10-12T00:00:00Z",
  ...over,
});

const thread = (over: Partial<SupportThreadRow> = {}): SupportThreadRow => ({
  id: "11111111-2222-3333-4444-555555555555",
  source: "feedback",
  channel: null,
  status: "new",
  snoozed_until: null,
  unread: true,
  subject: "In-app feedback: feature_request",
  counterpart_email: "t@privaterelay.appleid.com",
  counterpart_name: null,
  category: "feedback",
  urgency: "normal",
  resolved_app_user_id: "u1",
  resolved_store: null,
  user_context: ctx(),
  triage: null,
  feedback_id: null,
  last_message_at: "2026-10-24T09:34:00Z",
  last_inbound_at: "2026-10-24T09:34:00Z",
  created_at: "2026-10-24T09:34:00Z",
  updated_at: "2026-10-24T09:34:00Z",
  ...over,
});

const msg = (over: Partial<SupportMessageRow>): SupportMessageRow =>
  ({
    id: "m",
    thread_id: "t",
    direction: "inbound",
    via: "feedback",
    message_id: null,
    in_reply_to: null,
    references_ids: [],
    from_email: null,
    from_name: null,
    to_email: null,
    subject: null,
    body_text: "hi",
    body_html: null,
    attachments: null,
    sent_at: "2026-10-24T09:34:00Z",
    ...over,
  }) as SupportMessageRow;

describe("requesterSnapshot", () => {
  it("freezes who asked: name, plan, store, paid, member since", () => {
    const r = requesterSnapshot(thread());
    expect(r).toMatchObject({
      name: "Tiffany",
      email: "t@privaterelay.appleid.com",
      plan: "Paid monthly",
      store: "APP_STORE",
      active: true,
      totalPaidUsd: 14.99,
      memberSince: "2026-10-12T00:00:00Z",
      journeyStage: "already_on",
    });
  });

  it("prefers the active subscription over a newer lapsed one", () => {
    const r = requesterSnapshot(
      thread({
        user_context: ctx({
          subscriptions: [
            sub({ plan: "yearly", isActive: true, lastEventAt: "2026-01-01T00:00:00Z" }),
            sub({ plan: "monthly", isActive: false, lastEventAt: "2026-10-01T00:00:00Z" }),
          ],
        }),
      }),
    );
    expect(r.plan).toBe("Paid yearly");
  });

  it("leaves plan null when there is no account context at all", () => {
    const r = requesterSnapshot(thread({ user_context: null, counterpart_name: "Jo" }));
    expect(r.name).toBe("Jo");
    expect(r.plan).toBeNull();
    expect(r.totalPaidUsd).toBeNull();
  });
});

describe("planLabel", () => {
  it("labels trials, paid plans and lapsed ones", () => {
    expect(planLabel(null)).toBe("No subscription");
    expect(planLabel(sub({ isTrial: true, plan: "yearly" }))).toBe("Trial (yearly)");
    expect(planLabel(sub({ isActive: false }))).toBe("Paid monthly, lapsed");
  });
});

describe("screenshotUrls", () => {
  it("collects inbound attachment urls once, ignoring our own replies", () => {
    const urls = screenshotUrls([
      msg({ attachments: [{ url: "https://x/1.png" }, { filename: "no-url.png" }] }),
      msg({ attachments: [{ url: "https://x/1.png" }, { url: "https://x/2.png" }] }),
      msg({ direction: "outbound", attachments: [{ url: "https://x/ours.png" }] }),
    ]);
    expect(urls).toEqual(["https://x/1.png", "https://x/2.png"]);
  });
});

describe("old-row link parsing", () => {
  const desc =
    "Can paddle boarding be added?\n\nSupport thread: https://dreamme-admin-dash.vercel.app/?tab=support&thread=e3bcac0c-82e7-4627-8168-d3d6daf9bc5b\nTrello: https://trello.com/c/eWxe5MaX";

  it("finds the thread id and card url in a legacy description", () => {
    expect(threadIdFromText(desc)).toBe("e3bcac0c-82e7-4627-8168-d3d6daf9bc5b");
    expect(trelloUrlFromText(desc)).toBe("https://trello.com/c/eWxe5MaX");
  });

  it("returns null for imported rows with no thread link", () => {
    expect(threadIdFromText("Trello #108 https://trello.com/c/z0UfMzVD. Requested by Dan.")).toBeNull();
    expect(threadIdFromText(null)).toBeNull();
  });
});

describe("parseBrief", () => {
  const at = "2026-10-27T00:00:00Z";

  it("keeps a well-formed brief and maps open_questions", () => {
    const b = parseBrief(
      {
        kind: "content",
        area: "Activity",
        ask: "Add paddle boarding and vibration plate to the activity list.",
        why: "She does both and can't log them.",
        needs: ["Add two activity types", "Pick MET values"],
        open_questions: ["Which MET value for vibration plate?"],
        effort: "small",
      },
      at,
    );
    expect(b).toMatchObject({
      kind: "content",
      area: "Activity",
      effort: "small",
      needs: ["Add two activity types", "Pick MET values"],
      openQuestions: ["Which MET value for vibration plate?"],
      generatedAt: at,
    });
  });

  it("falls back on unknown enums instead of storing junk", () => {
    const b = parseBrief({ kind: "epic", area: "Spaceships", ask: "Do it", effort: "huge" }, at);
    expect(b).toMatchObject({ kind: "feature", area: "Other", effort: "medium", needs: [] });
  });

  it("rejects output with no ask", () => {
    expect(parseBrief({ kind: "bug" }, at)).toBeNull();
    expect(parseBrief(null, at)).toBeNull();
    expect(parseBrief("nope", at)).toBeNull();
  });

  it("strips em and en dashes (Dan's no-dash rule)", () => {
    const b = parseBrief({ ask: "Track supplements — for the doctor", needs: ["a – b"] }, at);
    expect(b?.ask).toBe("Track supplements, for the doctor");
    expect(b?.needs[0]).toBe("a, b");
  });

  it("caps list lengths", () => {
    const b = parseBrief({ ask: "x", needs: ["1", "2", "3", "4", "5", "6", "7"], open_questions: ["a", "b", "c", "d"] }, at);
    expect(b?.needs).toHaveLength(5);
    expect(b?.openQuestions).toHaveLength(3);
  });
});

describe("buildBriefInput", () => {
  it("gives the model the title, requester and the user's words", () => {
    const text = buildBriefInput({
      title: "Supplement tracking",
      quote: "track supplements so my dr can see",
      requester: requesterSnapshot(thread()),
    });
    expect(text).toContain("TICKET TITLE: Supplement tracking");
    expect(text).toContain("plan: Paid monthly");
    expect(text).toContain("track supplements so my dr can see");
    expect(text).not.toContain("NOTES ON THE TICKET");
  });
});

describe("ticket content with a brief", () => {
  const brief = parseBrief(
    {
      kind: "bug",
      area: "Community",
      ask: "Stop the chat filter blocking normal messages.",
      why: "Words like class and pass are rejected.",
      needs: ["Whole-word matching"],
      open_questions: [],
      effort: "small",
    },
    "2026-10-27T00:00:00Z",
  );
  const url = "https://dash/?tab=support&thread=11111111-2222-3333-4444-555555555555";

  it("puts the brief on the Trello card above the user's words", () => {
    const { desc } = buildTrelloCard({
      thread: thread(),
      inboundBody: "It keeps saying inappropriate",
      threadUrl: url,
      brief,
    });
    expect(desc).toContain("**Ask:** Stop the chat filter blocking normal messages.");
    expect(desc).toContain("- Whole-word matching");
    expect(desc.indexOf("**Ask:**")).toBeLessThan(desc.indexOf("> It keeps saying"));
  });

  it("seeds the epic from the brief's area and stores the details", () => {
    const details = ticketDetails({
      thread: thread(),
      messages: [msg({ attachments: [{ url: "https://x/s.png" }] })],
      quote: quoteFrom("It keeps saying inappropriate"),
      brief,
      threadUrl: url,
      trelloUrl: "https://trello.com/c/abc",
      receivedAt: "2026-10-24T09:34:00Z",
    });
    const fr = buildFeatureRequest({
      thread: thread(),
      inboundBody: "It keeps saying inappropriate",
      threadUrl: url,
      brief,
      details,
    });
    expect(fr.epic).toBe("Community");
    expect(fr.details?.source).toBe("feedback");
    expect(fr.details?.screenshots).toEqual(["https://x/s.png"]);
    expect(fr.details?.requester?.plan).toBe("Paid monthly");
    expect(fr.details?.trelloUrl).toBe("https://trello.com/c/abc");
  });

  it("files without a brief exactly as before", () => {
    const fr = buildFeatureRequest({ thread: thread(), inboundBody: "hi", threadUrl: url });
    expect(fr.epic).toBeNull();
    expect(fr.details).toBeNull();
    const { desc } = buildTrelloCard({ thread: thread(), inboundBody: "hi", threadUrl: url });
    expect(desc).not.toContain("**Ask:**");
  });

  it("renders a markdown brief with kind, area and effort up top", () => {
    expect(briefMarkdown(brief!).split("\n")[0]).toBe("**Bug** · Community · small effort");
  });
});

describe("new feature request email", () => {
  const brief = parseBrief(
    {
      kind: "content",
      area: "Activity",
      ask: "Add paddle boarding to the activity list.",
      why: "She can't log it today.",
      needs: ["Add the activity type"],
      open_questions: ["Which MET value?"],
      effort: "small",
    },
    "2026-10-27T00:00:00Z",
  );
  const details = ticketDetails({
    thread: thread(),
    messages: [],
    quote: "Can paddle boarding be added?",
    brief,
    threadUrl: null,
    trelloUrl: null,
    receivedAt: null,
  });

  it("links straight to the ticket in the dash", () => {
    expect(featureRequestUrl("https://dash.example", "abc-123")).toBe(
      "https://dash.example/?tab=requests&request=abc-123",
    );
    const { bodyText } = buildFeatureRequestEmail({
      id: "abc-123",
      title: "Paddle boarding",
      details,
      origin: "https://dash.example",
    });
    expect(bodyText).toContain("Open the ticket: https://dash.example/?tab=requests&request=abc-123");
  });

  it("carries the brief so it reads without opening the dash", () => {
    const { subject, bodyText } = buildFeatureRequestEmail({
      id: "x",
      title: "Paddle boarding",
      details,
      origin: "https://d",
    });
    expect(subject).toBe("New feature request: Add paddle boarding to the activity list.");
    expect(bodyText).toContain("Content · Activity · small effort");
    expect(bodyText.split("\n")[0]).toBe("Add paddle boarding to the activity list.");
    expect(bodyText).not.toContain("Paddle boarding");
    expect(bodyText).toContain("- Add the activity type");
    expect(bodyText).toContain("- Which MET value?");
  });

  it("leaves out anything that identifies the customer", () => {
    const { bodyText } = buildFeatureRequestEmail({
      id: "x",
      title: "Paddle boarding",
      details,
      origin: "https://d",
    });
    expect(bodyText).not.toContain("t@privaterelay.appleid.com");
    expect(bodyText).not.toContain("Tiffany");
    expect(bodyText).not.toContain("Paid monthly");
    expect(bodyText).not.toContain("Can paddle boarding be added?");
  });

  it("says bug report for bugs, and still sends a link with no brief", () => {
    const bug = buildFeatureRequestEmail({
      id: "x",
      title: "Filter blocks words",
      details: { ...details, brief: { ...brief!, kind: "bug" } },
      origin: "https://d",
    });
    expect(bug.subject).toBe("New bug report: Add paddle boarding to the activity list.");
    const bare = buildFeatureRequestEmail({ id: "y", title: "Dark mode", details: null, origin: "https://d" });
    expect(bare.subject).toBe("New feature request: Dark mode");
    expect(bare.bodyText).toContain("https://d/?tab=requests&request=y");
  });

  it("sends to the dev by default, and the env var overrides or turns it off", () => {
    expect(notifyRecipients(undefined)).toEqual(["dvnguyennn@gmail.com"]);
    expect(notifyRecipients("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
    expect(notifyRecipients("")).toEqual([]);
  });
});

describe("new feature request email headline", () => {
  it("never puts an inbox title (customer name + plan) in the subject when a brief exists", () => {
    const brief = parseBrief({ ask: "Add vibration plate to activities." }, "2026-10-27T00:00:00Z");
    const { subject, bodyText } = buildFeatureRequestEmail({
      id: "x",
      title: "Jamie (about_to_start, paid monthly) requests two new activities",
      details: { brief, requester: null, quote: null, screenshots: [], source: "email", receivedAt: null, threadUrl: null, trelloUrl: null },
      origin: "https://d",
    });
    expect(subject).not.toContain("Jamie");
    expect(bodyText).not.toContain("Jamie");
    expect(bodyText).not.toContain("paid monthly");
  });
});
