import { describe, expect, it } from "vitest";
import { fmtViews, problemState, stateSummary } from "@/lib/batchDisplay";

/**
 * The tile grid shows nothing per-post except a view count, so the only two
 * pieces of logic behind it are: which posts get flagged as broken, and how a
 * missing measurement is distinguished from a real zero.
 */

const TODAY = "2026-08-06";
const YESTERDAY = "2026-08-05";

describe("problemState", () => {
  it("leaves a healthy posted slide unmarked", () => {
    expect(
      problemState(
        { post_status: "posted", public_post_url: "https://tiktok.com/x" },
        YESTERDAY,
        TODAY,
      ),
    ).toBe(null);
  });

  it("flags draft and failed regardless of batch age", () => {
    for (const date of [TODAY, YESTERDAY]) {
      expect(problemState({ post_status: "draft", public_post_url: null }, date, TODAY))
        .toBe("NOT POSTED");
      expect(problemState({ post_status: "failed", public_post_url: null }, date, TODAY))
        .toBe("FAILED");
      expect(problemState({ post_status: "error", public_post_url: null }, date, TODAY))
        .toBe("FAILED");
    }
  });

  it("does NOT flag today's queued posts — Doublespeed hasn't drained yet", () => {
    expect(
      problemState({ post_status: "scheduled", public_post_url: null }, TODAY, TODAY),
    ).toBe(null);
  });

  it("flags a queued post once its batch date has passed", () => {
    expect(
      problemState({ post_status: "scheduled", public_post_url: null }, YESTERDAY, TODAY),
    ).toBe("STUCK");
  });

  it("does NOT flag no-reach on today's batch — the URL lands after publish", () => {
    // Without this guard every morning's batch flashes a false alarm.
    expect(
      problemState({ post_status: "posted", public_post_url: null }, TODAY, TODAY),
    ).toBe(null);
  });

  it("flags posted-but-no-public-url once the batch date has passed", () => {
    // "posted" reads like success, which is exactly why this is the pipeline's
    // most dangerous silent failure.
    expect(
      problemState({ post_status: "posted", public_post_url: null }, YESTERDAY, TODAY),
    ).toBe("NO REACH");
  });

  it("prefers the more serious label when a post could match two", () => {
    // Precedence must mirror stateSummary so a tile can never contradict the
    // batch pill above it.
    expect(
      problemState({ post_status: "failed", public_post_url: null }, YESTERDAY, TODAY),
    ).toBe("FAILED");
  });

  it("treats an unverified post as not-a-problem rather than guessing", () => {
    expect(problemState({ post_status: null, public_post_url: null }, YESTERDAY, TODAY))
      .toBe(null);
  });
});

describe("fmtViews", () => {
  it("renders an unmeasured post as em dash, never as zero", () => {
    // 10 of 72 posts have no social_posts row. Showing 0 would claim nobody
    // watched them, which is a different and much worse statement than
    // "we haven't measured this one".
    expect(fmtViews(null)).toBe("—");
    expect(fmtViews(undefined)).toBe("—");
  });

  it("renders a genuine zero as zero", () => {
    expect(fmtViews(0)).toBe("0");
  });

  it("compacts thousands and millions", () => {
    expect(fmtViews(556)).toBe("556");
    expect(fmtViews(1_630)).toBe("1.6K");
    expect(fmtViews(11_300)).toBe("11K");
    expect(fmtViews(1_200_000)).toBe("1.2M");
  });
});

describe("problemState agrees with the batch pill", () => {
  // The tile marker and the batch summary are separate functions reading the
  // same fields. If they disagree the UI contradicts itself: a pill saying
  // POSTED above a tile flagged NO REACH, or vice versa.
  const ok = { post_status: "posted", public_post_url: "https://t.co/x" };

  it("marks exactly one tile when the batch reports one bad post", () => {
    const posts = [ok, ok, { post_status: "draft", public_post_url: null }];
    expect(stateSummary(posts, YESTERDAY, TODAY)?.label).toBe("1 NOT POSTED");
    expect(posts.filter((p) => problemState(p, YESTERDAY, TODAY)).length).toBe(1);
  });

  it("marks no tiles when the batch reports a clean POSTED", () => {
    const posts = [ok, ok, ok];
    expect(stateSummary(posts, YESTERDAY, TODAY)?.label).toBe("POSTED");
    expect(posts.filter((p) => problemState(p, YESTERDAY, TODAY)).length).toBe(0);
  });

  it("marks no tiles on today's all-queued batch, matching the QUEUED pill", () => {
    const posts = [
      { post_status: "scheduled", public_post_url: null },
      { post_status: "scheduled", public_post_url: null },
    ];
    expect(stateSummary(posts, TODAY, TODAY)?.label).toBe("QUEUED");
    expect(posts.filter((p) => problemState(p, TODAY, TODAY)).length).toBe(0);
  });

  it("marks the no-reach tile when the batch reports NO REACH", () => {
    const posts = [ok, { post_status: "posted", public_post_url: null }];
    expect(stateSummary(posts, YESTERDAY, TODAY)?.label).toBe("1 NO REACH");
    const flagged = posts.filter((p) => problemState(p, YESTERDAY, TODAY));
    expect(flagged.length).toBe(1);
    expect(problemState(flagged[0], YESTERDAY, TODAY)).toBe("NO REACH");
  });
});
