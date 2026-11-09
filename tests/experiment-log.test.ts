import { describe, expect, it } from "vitest";
import {
  dateRangeError,
  rcSyncPatch,
  dateRangeLabel,
  daysRunning,
  sortEntries,
  statusLabel,
  type ExperimentEntry,
} from "@/lib/experiment-log";
import { CreateEntry, PatchEntry, cleanEntry } from "@/lib/experiment-log-schema";

function entry(over: Partial<ExperimentEntry>): ExperimentEntry {
  return {
    id: over.title ?? "x",
    title: "x",
    kind: "experiment",
    area: "other",
    status: "planned",
    hypothesis: "",
    what_changed: "",
    has_control: true,
    start_date: null,
    end_date: null,
    primary_metric: "",
    result: "",
    decision: "",
    rc_experiment_id: null,
    vault_page: null,
    links: "",
    handoff_id: null,
    owner: null,
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
    ...over,
  };
}

describe("sortEntries", () => {
  it("puts undated entries first, then newest start date, running before planned on ties", () => {
    const out = sortEntries([
      entry({ title: "old", start_date: "2026-06-29", status: "decided" }),
      entry({ title: "planned", status: "planned" }),
      entry({ title: "draft", status: "draft" }),
      entry({ title: "new", start_date: "2026-11-07", status: "running" }),
      entry({ title: "undated live change", kind: "change", status: "running" }),
    ]);
    expect(out.map((e) => e.title)).toEqual(["draft", "planned", "new", "old", "undated live change"]);
  });
});

describe("labels", () => {
  it("reads a running change as live and a stopped one as ended", () => {
    expect(statusLabel("change", "running")).toBe("Live");
    expect(statusLabel("change", "stopped")).toBe("Ended");
    expect(statusLabel("experiment", "running")).toBe("Running");
  });

  it("formats date ranges and day counts", () => {
    expect(dateRangeLabel("2026-10-14", "2026-10-15")).toBe("Oct 14 – Oct 15, 2026");
    expect(dateRangeLabel("2026-09-30", null)).toBe("Since Sep 30, 2026");
    expect(dateRangeLabel(null, null)).toBe("No dates yet");
    expect(daysRunning("2026-10-14", "2026-10-15", "2026-11-09")).toBe(2);
    expect(daysRunning("2026-11-07", null, "2026-11-09")).toBe(3);
    expect(daysRunning(null, null, "2026-11-09")).toBeNull();
  });

  it("refuses an end date before the start", () => {
    expect(dateRangeError("2026-10-15", "2026-10-14")).toMatch(/before/);
    expect(dateRangeError("2026-10-14", null)).toBeNull();
  });
});

describe("request schema", () => {
  it("needs a title and accepts a minimal session POST", () => {
    expect(CreateEntry.safeParse({ kind: "change" }).success).toBe(false);
    const ok = CreateEntry.safeParse({ title: "Android Meta budget cut", kind: "change", area: "ads", start_date: "2026-11-07" });
    expect(ok.success).toBe(true);
  });

  it("rejects unknown kinds, areas and bad dates", () => {
    expect(CreateEntry.safeParse({ title: "x", kind: "test" }).success).toBe(false);
    expect(CreateEntry.safeParse({ title: "x", area: "growth" }).success).toBe(false);
    expect(CreateEntry.safeParse({ title: "x", start_date: "Nov 7" }).success).toBe(false);
  });

  it("refuses an empty patch and blanks optional ids to null", () => {
    expect(PatchEntry.safeParse({}).success).toBe(false);
    expect(cleanEntry({ rc_experiment_id: " ", owner: "", title: "t" })).toEqual({
      rc_experiment_id: null,
      owner: null,
      title: "t",
    });
  });
});

describe("rcSyncPatch", () => {
  const rc = (status: string, started_at: string | null = null, stopped_at: string | null = null) => ({
    id: "exp1",
    status,
    started_at,
    stopped_at,
    enrollment_percentage: 100,
  });

  it("starts a draft entry when RC starts, filling the start date", () => {
    expect(rcSyncPatch({ status: "draft", start_date: null, end_date: null }, rc("running", "2026-11-20T15:00:00Z"))).toEqual({
      status: "running",
      start_date: "2026-11-20",
    });
  });

  it("stops a running entry when RC stops, keeping a hand-entered start", () => {
    expect(
      rcSyncPatch({ status: "running", start_date: "2026-11-19", end_date: null }, rc("stopped", "2026-11-20T15:00:00Z", "2026-12-20T09:00:00Z")),
    ).toEqual({ status: "stopped", end_date: "2026-12-20" });
  });

  it("leaves decided entries, matching entries and drafts alone", () => {
    expect(rcSyncPatch({ status: "decided", start_date: null, end_date: null }, rc("stopped", "2026-11-20T00:00:00Z"))).toBeNull();
    expect(rcSyncPatch({ status: "running", start_date: "2026-11-20", end_date: null }, rc("running", "2026-11-20T00:00:00Z"))).toBeNull();
    expect(rcSyncPatch({ status: "draft", start_date: null, end_date: null }, rc("draft"))).toBeNull();
  });

  it("doesn't change status while RC is paused, but fills a missing start", () => {
    expect(rcSyncPatch({ status: "running", start_date: null, end_date: null }, rc("paused", "2026-11-20T00:00:00Z"))).toEqual({
      start_date: "2026-11-20",
    });
  });
});
