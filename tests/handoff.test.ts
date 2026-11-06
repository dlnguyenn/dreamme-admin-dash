import { describe, expect, it } from "vitest";
import { looksLikeSecret, requestHandoff, roadmapHandoff } from "@/lib/handoff";
import type { RoadmapItem } from "@/lib/roadmap";
import type { FeatureRequestDetails, FeatureRequestRow } from "@/lib/types";

const ORIGIN = "https://dad.example";

const card = (over: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: "c1",
  title: "Fix the filter",
  notes: "Word list is too strict",
  stage: "now",
  priority: "high",
  area: "Community",
  owner: "David",
  target_date: "2026-11-20",
  position: 0,
  feature_request_id: null,
  brief_url: null,
  done_at: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const details = (over: Partial<FeatureRequestDetails> = {}): FeatureRequestDetails => ({
  brief: {
    kind: "bug",
    area: "Food logging",
    ask: "Barcode scan fails",
    why: "Users can't log meals",
    needs: ["Fix the scanner"],
    openQuestions: ["Android too?"],
    effort: "small",
    model: "m",
    generatedAt: "",
  },
  requester: {
    name: "Pat Private",
    email: "pat@private.example",
    plan: "Paid monthly",
    store: "app_store",
    active: true,
    totalPaidUsd: 123.45,
    memberSince: null,
    journeyStage: "week 3 on semaglutide",
  },
  quote: "my words about my doctor",
  screenshots: ["https://cdn.example/secret-shot.png"],
  source: "email",
  receivedAt: null,
  threadUrl: null,
  trelloUrl: null,
  ...over,
});

const ticket = (over: Partial<FeatureRequestRow> = {}): FeatureRequestRow => ({
  id: "r1",
  title: "Scanner broken",
  description: "Pasted: hi from pat@private.example",
  status: "new",
  epic: null,
  submitter_email: "pat@private.example",
  details: details(),
  created_at: "",
  updated_at: "",
  ...over,
});

describe("roadmapHandoff", () => {
  it("carries the card's fields and a link back", () => {
    const d = roadmapHandoff(card(), ORIGIN);
    expect(d.title).toBe("Fix the filter");
    expect(d.summary).toContain("Stage: Now");
    expect(d.context).toContain("Word list is too strict");
    expect(d.context).toContain("Target date: 2026-11-20");
    expect(d.context).toContain(`${ORIGIN}/?tab=roadmap`);
    expect(d.context).not.toContain("Feature request");
  });

  it("includes the brief and the ticket it came from when they exist", () => {
    const d = roadmapHandoff(card({ brief_url: "https://x.example/b", feature_request_id: "r1" }), ORIGIN);
    expect(d.context).toContain("https://x.example/b");
    expect(d.context).toContain(`${ORIGIN}/?tab=requests&request=r1`);
  });

  it("leaves out empty fields", () => {
    const d = roadmapHandoff(card({ notes: " ", owner: null, area: null, target_date: null }), ORIGIN);
    expect(d.context).not.toContain("## Notes");
    expect(d.context).not.toContain("Owner:");
    expect(d.context).not.toContain("null");
  });
});

describe("requestHandoff", () => {
  it("uses the brief and links back to the ticket", () => {
    const d = requestHandoff(ticket(), ORIGIN);
    expect(d.summary).toContain("Barcode scan fails");
    expect(d.context).toContain("Fix the scanner");
    expect(d.context).toContain("Android too?");
    expect(d.context).toContain(`${ORIGIN}/?tab=requests&request=r1`);
  });

  it("never includes the requester, their words or screenshots", () => {
    const d = requestHandoff(ticket({ title: "Pat Private reports a broken scanner" }), ORIGIN);
    expect(d.title).toBe("Barcode scan fails");
    const all = JSON.stringify(d);
    for (const s of ["Pat Private", "pat@private.example", "123.45", "semaglutide", "my doctor", "secret-shot"]) {
      expect(all).not.toContain(s);
    }
  });

  it("falls back to the description when there's no brief", () => {
    const d = requestHandoff(ticket({ description: "Add dark mode", details: details({ brief: null }) }), ORIGIN);
    expect(d.summary).toContain("Scanner broken");
    expect(d.context).toContain("Add dark mode");
  });

  it("handles a ticket with no details at all", () => {
    const d = requestHandoff(ticket({ description: "Add dark mode", details: null }), ORIGIN);
    expect(d.context).toContain("Add dark mode");
    expect(d.context).not.toContain("undefined");
  });
});

describe("looksLikeSecret", () => {
  it("catches credentials and passes normal text", () => {
    const clean = { title: "t", summary: "s", context: "Branch claude/foo, thread 1436000000000000000" };
    expect(looksLikeSecret(clean)).toBe(false);
    expect(looksLikeSecret({ ...clean, context: "key sk-abcdefghijklmnopqrstuvwxyz" })).toBe(true);
    expect(looksLikeSecret({ ...clean, title: "ghp_abcdefghijklmnopqrstuvwxyz" })).toBe(true);
  });
});
