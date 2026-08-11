/**
 * Guardrails on the "queue all drafts" button.
 *
 * Everything here decides what gets PUBLISHED to live accounts. The failure
 * mode is not cosmetic, so these tests are deliberately paranoid — in
 * particular the blocklist test, because 14 drafts currently exist whose
 * caption IS a do-not-publish notice.
 */
import { describe, expect, it } from "vitest";
import type { LivePost } from "../src/lib/batchState";
import {
  BLOCKLIST,
  QUEUE_ACCOUNTS,
  selectQueueTargets,
  selectUnqueueTargets,
} from "../src/lib/morningQueue";

const TODAY = "2026-08-11";

function post(over: Partial<LivePost>): LivePost {
  return {
    id: "p1",
    derived: "draft",
    username: "hannahhglp1",
    accountType: "facebook",
    title: "My GLP-1 shot day is a whole routine now",
    postTime: "2026-08-11T14:00:00Z", // 10:00 ET, safely inside the day
    succeededAt: null,
    publicPostUrl: null,
    deleteRequested: false,
    ...over,
  };
}
const ids = (s: { targets: { id: string }[] }) => s.targets.map((t) => t.id);

describe("roster scope", () => {
  it("queues drafts on every roster account, including YouTube", () => {
    const posts = QUEUE_ACCOUNTS.map((a, i) =>
      post({ id: `id${i}`, username: a.username, accountType: a.platform }),
    );
    const { targets } = selectQueueTargets(posts, TODAY);
    expect(targets).toHaveLength(QUEUE_ACCOUNTS.length);
    // The display panel is FB/IG only; the button must not leave YT behind.
    expect(targets.some((t) => t.platform === "youtube")).toBe(true);
  });

  it("ignores accounts that are not on the roster", () => {
    const s = selectQueueTargets([post({ username: "some_other_account" })], TODAY);
    expect(s.targets).toHaveLength(0);
    expect(s.skipped).toHaveLength(0); // out of scope, not a skip worth reporting
  });

  it("only ever considers drafts", () => {
    for (const st of ["scheduled", "posted"] as const) {
      expect(selectQueueTargets([post({ derived: st })], TODAY).targets).toHaveLength(0);
    }
  });
});

describe("guardrails", () => {
  it("NEVER queues a post whose caption is a do-not-publish marker", () => {
    const dangerous = [
      "DO NOT PUBLISH - sound geo-restricted (Unbothered). Replacement draft…",
      "MUSICTEST 3 Sweet Sunset - delete me",
      "SOUNDTEST Anxiety Doechii - do not publish",
      "MUSIC ATTACHMENT TEST - do not publish. Verifying music_link",
    ];
    const posts = dangerous.map((t, i) => post({ id: `bad${i}`, title: t }));
    const s = selectQueueTargets(posts, TODAY);
    expect(s.targets).toHaveLength(0);
    expect(s.skipped).toHaveLength(dangerous.length);
    // Belt and braces: no blocklisted string can appear in the queue list.
    for (const t of s.targets) expect(BLOCKLIST.test(t.title)).toBe(false);
  });

  it("skips a post with deletion requested", () => {
    const s = selectQueueTargets([post({ deleteRequested: true })], TODAY);
    expect(s.targets).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/deletion/i);
  });

  it("skips drafts from any day but today", () => {
    // 03:30Z on the 11th is 23:30 ET on the 10th.
    const s = selectQueueTargets([post({ postTime: "2026-08-11T03:30:00Z" })], TODAY);
    expect(s.targets).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/today/i);
  });

  it("skips a caption already live on that same account", () => {
    const caption = "Nobody warned me about the first week on a GLP-1";
    const s = selectQueueTargets(
      [
        post({ id: "live", derived: "posted", title: caption }),
        post({ id: "dupe", derived: "draft", title: caption }),
      ],
      TODAY,
    );
    expect(ids(s)).not.toContain("dupe");
    expect(s.skipped[0].reason).toMatch(/already live/i);
  });

  it("does NOT treat the same caption on a different account as a duplicate", () => {
    const caption = "Nobody warned me about the first week on a GLP-1";
    const s = selectQueueTargets(
      [
        post({ id: "live", derived: "posted", title: caption, username: "hannahhglp1", accountType: "facebook" }),
        post({ id: "ig", derived: "draft", title: caption, username: "hannahglp1", accountType: "instagram" }),
      ],
      TODAY,
    );
    // A trio posts the same creative to FB and IG by design.
    expect(ids(s)).toContain("ig");
  });

  it("lets a clean draft through", () => {
    const s = selectQueueTargets([post({ id: "good" })], TODAY);
    expect(ids(s)).toEqual(["good"]);
    expect(s.targets[0].setKey).toBe("hannah");
  });

  it("a realistic mixed morning queues only the clean ones", () => {
    const posts = [
      post({ id: "ok1", username: "hannahhglp1", accountType: "facebook" }),
      post({ id: "ok2", username: "hannahglp1", accountType: "instagram" }),
      post({ id: "ok3", username: "hannahglp1", accountType: "youtube" }),
      post({ id: "dead", title: "DO NOT PUBLISH - sound geo-restricted" }),
      post({ id: "old", postTime: "2026-08-04T18:00:00Z" }),
      post({ id: "gone", deleteRequested: true }),
      // Distinct caption on purpose: sharing the default would make this a
      // legitimate duplicate of ok1 and mask what the test is checking.
      post({ id: "posted", derived: "posted", title: "An entirely different caption" }),
    ];
    const s = selectQueueTargets(posts, TODAY);
    expect(ids(s).sort()).toEqual(["ok1", "ok2", "ok3"]);
  });
});

describe("undo", () => {
  it("only un-queues ids that are actually scheduled today on the roster", () => {
    const posts = [
      post({ id: "a", derived: "scheduled" }),
      post({ id: "b", derived: "posted" }), // already out, cannot be pulled back
      post({ id: "c", derived: "scheduled", username: "stranger" }),
      post({ id: "d", derived: "scheduled", postTime: "2026-08-04T18:00:00Z" }),
    ];
    const got = selectUnqueueTargets(posts, ["a", "b", "c", "d"], TODAY);
    expect(got.map((t) => t.id)).toEqual(["a"]);
  });

  it("ignores ids the caller made up", () => {
    const got = selectUnqueueTargets([post({ id: "a", derived: "scheduled" })], ["nope"], TODAY);
    expect(got).toHaveLength(0);
  });
});
