/**
 * Discovery: recognising this morning's posts on the live API without a
 * manifest. The account map, the Eastern-day re-check, the mutually exclusive
 * thumbnail forms, and the drop-don't-guess rules.
 */
import { describe, expect, it } from "vitest";
import type { LivePost } from "../src/lib/batchState";
import {
  discoverMorningRows,
  easternDayOf,
} from "../src/lib/morningDiscovery";
import {
  EXPECTED_MORNING,
  MORNING_ACCOUNTS,
} from "../src/lib/morningPosts";

const DATE = "2026-08-08";

function post(over: Partial<LivePost>): LivePost {
  return {
    id: "p1",
    derived: "posted",
    username: "glp1hacks",
    accountType: "instagram",
    title: "caption",
    postTime: "2026-08-08T14:00:00Z", // 10:00 ET, safely inside the day
    succeededAt: null,
    publicPostUrl: null,
    deleteRequested: false,
    ...over,
  };
}

const run = (posts: LivePost[], today = DATE) =>
  discoverMorningRows(posts, MORNING_ACCOUNTS, EXPECTED_MORNING, today);

describe("easternDayOf", () => {
  it("converts to the Eastern calendar day, not UTC", () => {
    // 03:30Z on the 8th is 23:30 ET on the 7th.
    expect(easternDayOf("2026-08-08T03:30:00Z")).toBe("2026-08-07");
    expect(easternDayOf("2026-08-08T14:00:00Z")).toBe("2026-08-08");
    expect(easternDayOf(null)).toBeNull();
    expect(easternDayOf("not a date")).toBeNull();
  });
});

describe("account mapping", () => {
  it("resolves all 14 known (username, platform) pairs", () => {
    for (const a of MORNING_ACCOUNTS) {
      const rows = run([
        post({ username: a.username, accountType: a.platform }),
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].set_key).toBe(a.setKey);
      expect(rows[0].platform).toBe(a.platform);
    }
  });

  it("keys on the PAIR — the FB handles differ from the IG ones", () => {
    // glp1tipss is the Facebook side of the glp1_tips set; on Instagram that
    // username does not exist and must not be guessed into the set.
    expect(run([post({ username: "glp1tipss", accountType: "facebook" })]))
      .toHaveLength(1);
    expect(run([post({ username: "glp1tipss", accountType: "instagram" })]))
      .toHaveLength(0);
  });

  it("drops unrecognised accounts rather than guessing", () => {
    expect(run([post({ username: "some_random_account" })])).toHaveLength(0);
    expect(run([post({ username: null })])).toHaveLength(0);
  });

  it("drops platforms the panel does not show", () => {
    expect(run([post({ accountType: "youtube" })])).toHaveLength(0);
    expect(run([post({ accountType: "tiktok" })])).toHaveLength(0);
  });
});

describe("filtering", () => {
  it("excludes a post Dan deleted", () => {
    // It still comes back in the `all` filter; resurrecting it as QUEUED
    // would be worse than showing nothing.
    expect(run([post({ deleteRequested: true })])).toHaveLength(0);
  });

  it("excludes posts from another Eastern day", () => {
    expect(run([post({ postTime: "2026-08-08T03:30:00Z" })])).toHaveLength(0);
  });

  it("prefers succeededAt over postTime for the day check", () => {
    const rows = run([
      post({ postTime: "2026-08-07T14:00:00Z", succeededAt: "2026-08-08T14:00:00Z" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].posted_at).toBe("2026-08-08T14:00:00Z");
  });
});

describe("thumbnail derivation — the load-bearing split", () => {
  it("a carousel set gets an image thumb and no video", () => {
    // renders/<id>/1 is image/jpeg; renders/<id> 400s for a slideshow.
    const [r] = run([post({ id: "abc", username: "glp1hacks", accountType: "instagram" })]);
    expect(r.post_kind).toBe("carousel");
    expect(r.thumb_url).toBe(
      "https://auth.doublespeed.ai/storage/v1/object/public/renders/abc/1",
    );
    expect(r.video_url).toBeNull();
  });

  it("a video set gets a video url and NO thumb", () => {
    // renders/<id> is video/mp4. Putting that in an <img> renders broken, so
    // discovery must leave thumb_url null and let the manifest supply one.
    const [r] = run([post({ id: "xyz", username: "hannahglp1", accountType: "instagram" })]);
    expect(r.post_kind).toBe("video");
    expect(r.video_url).toBe(
      "https://auth.doublespeed.ai/storage/v1/object/public/renders/xyz",
    );
    expect(r.thumb_url).toBeNull();
  });

  it("no thumb_url anywhere ever points at a bare post id", () => {
    const rows = run(
      MORNING_ACCOUNTS.map((a, i) =>
        post({ id: `id${i}`, username: a.username, accountType: a.platform }),
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.thumb_url) expect(r.thumb_url.endsWith("/1")).toBe(true);
    }
  });
});

describe("more than one post per set and platform", () => {
  it("worst state wins, and the extras are counted", () => {
    const rows = run([
      post({ id: "a", derived: "posted", postTime: "2026-08-08T14:00:00Z" }),
      post({ id: "b", derived: "draft", postTime: "2026-08-08T12:00:00Z" }),
    ]);
    expect(rows).toHaveLength(1);
    // The draft is older but it is the one that needs a person.
    expect(rows[0].post_status).toBe("draft");
    expect(rows[0].doublespeed_post_id).toBe("b");
    expect(rows[0].extra_posts).toBe(1);
  });

  it("ties break to the most recent", () => {
    const rows = run([
      post({ id: "old", derived: "posted", postTime: "2026-08-08T12:00:00Z" }),
      post({ id: "new", derived: "posted", postTime: "2026-08-08T16:00:00Z" }),
    ]);
    expect(rows[0].doublespeed_post_id).toBe("new");
    expect(rows[0].extra_posts).toBe(1);
  });
});

describe("emitted row shape", () => {
  it("carries live state and marks itself discovered", () => {
    const [r] = run([post({ derived: "scheduled", title: "hello" })]);
    expect(r.discovered).toBe(true);
    expect(r.post_status).toBe("scheduled");
    expect(r.caption).toBe("hello");
    // No REST field for sound — absent, and the UI distinguishes that.
    expect(r.sound).toBeNull();
    // post_status carries the truth, so toMorningState never falls through.
    expect(r.created_status).toBe("");
  });
});
