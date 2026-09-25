import { describe, expect, it } from "vitest";
import {
  FORMULA_MAX,
  attachEvidence,
  criterionScore,
  deriveScores,
  frameTimes,
  hookBand,
  holdBand,
  milestoneTimes,
  pacingFromCuts,
  parseInsights,
  retentionCurve,
  type PreflightResult,
} from "../src/lib/ad-breakdown/rubric";

// Danielle Kent (Android), last 14 days as of 2026-09-25: the numbers the
// local skill printed, so the port must reproduce them.
const DANIELLE = {
  impressions: "46236",
  spend: "1673.66",
  ctr: "2.92",
  inline_link_clicks: "1401",
  actions: [
    { action_type: "video_view", value: "18213" },
    { action_type: "omni_app_install", value: "588" },
  ],
  conversions: [{ action_type: "start_trial_total", value: "127" }],
  video_play_actions: [{ action_type: "video_view", value: "43144" }],
  video_15_sec_watched_actions: [{ action_type: "video_view", value: "9080" }],
  video_30_sec_watched_actions: [{ action_type: "video_view", value: "4192" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "9124" }],
  video_p25_watched_actions: [{ action_type: "video_view", value: "12793" }],
  video_p50_watched_actions: [{ action_type: "video_view", value: "6789" }],
  video_p75_watched_actions: [{ action_type: "video_view", value: "4454" }],
  video_p95_watched_actions: [{ action_type: "video_view", value: "2848" }],
  video_p100_watched_actions: [{ action_type: "video_view", value: "2587" }],
  video_avg_time_watched_actions: [{ action_type: "video_view", value: "9" }],
};

describe("parseInsights", () => {
  it("reads 3-second plays from actions[video_view] and trials from conversions", () => {
    const m = parseInsights(DANIELLE);
    expect(m.views_3s).toBe(18213);
    expect(m.hook_rate).toBeCloseTo(0.394, 3);
    expect(m.hold_rate).toBeCloseTo(0.501, 3);
    expect(m.trials).toBe(127);
    expect(m.cpt).toBeCloseTo(13.18, 2);
    expect(m.installs).toBe(588);
  });

  it("survives an empty row", () => {
    const m = parseInsights({});
    expect(m.hook_rate).toBe(0);
    expect(m.cpt).toBeNull();
  });
});

describe("bands", () => {
  it("uses Motion's hook and hold thresholds", () => {
    expect(hookBand(0.24)).toBe("needs work");
    expect(hookBand(0.3)).toBe("solid");
    expect(hookBand(0.394)).toBe("strong");
    expect(holdBand(0.29)).toBe("weak");
    expect(holdBand(0.501)).toBe("average");
    expect(holdBand(0.61)).toBe("strong");
  });
});

describe("retentionCurve", () => {
  it("builds the nine-point curve and finds the biggest drop before 3 s", () => {
    const { curve, intervals } = retentionCurve(parseInsights(DANIELLE), 38);
    expect(curve.map((p) => p.label)).toEqual(["impression", "3s", "25%", "15s", "50%", "75%", "30s", "95%", "100%"]);
    const biggest = intervals.reduce((a, b) => (b.lost > a.lost ? b : a));
    expect(biggest.from).toBe("impression");
    expect(biggest.to).toBe("3s");
    expect(biggest.share_of_total_loss).toBeGreaterThan(0.6);
    expect(intervals.every((iv) => iv.lost >= 0)).toBe(true);
  });

  it("drops the 25% point when it collides with 3 s on a short ad", () => {
    const { curve } = retentionCurve(parseInsights(DANIELLE), 12);
    expect(curve.filter((p) => Math.abs(p.t - 3) < 0.5)).toHaveLength(1);
  });

  it("returns nothing without impressions", () => {
    expect(retentionCurve(parseInsights({}), 30).intervals).toEqual([]);
  });
});

describe("milestones and frames", () => {
  it("adds 15 s and 30 s only when the ad is long enough", () => {
    expect(Object.keys(milestoneTimes(12))).not.toContain("15s");
    expect(Object.keys(milestoneTimes(38))).toEqual(expect.arrayContaining(["15s", "30s", "25%", "100%"]));
  });

  it("samples 3 fps over the hook, one frame per cut, and a midpoint in empty intervals", () => {
    const f = frameTimes(38, [12.47, 14.83, 17.27, 19.1, 25.57, 26.6, 28.07, 29.13]);
    expect(f.filter((x) => x.kind === "hook")).toHaveLength(9);
    expect(f.filter((x) => x.kind === "scene")).toHaveLength(8);
    expect(f.some((x) => x.kind === "mid" && x.t > 3 && x.t < 9.5)).toBe(true);
    expect(f.every((x, i) => i === 0 || x.t >= f[i - 1].t)).toBe(true);
  });

  it("thins a cut-heavy ad to 20 body frames", () => {
    const cuts = Array.from({ length: 60 }, (_, i) => 3 + i * 0.5);
    expect(frameTimes(40, cuts).filter((x) => x.kind === "scene")).toHaveLength(20);
  });
});

describe("pacing", () => {
  it("scores a fast-cut ad 2 and a single take 0", () => {
    expect(pacingFromCuts([2, 4, 6, 8, 10, 12], 14).score).toBe(2);
    const single = pacingFromCuts([], 30);
    expect(single.score).toBe(0);
    expect(single.longest_static_s).toBe(30);
  });
});

function preflight(overrides: Partial<PreflightResult["scores"]> = {}): PreflightResult {
  const yes = { anchor_2_met: true, anchor_0_met: false, evidence: "0:01" };
  const partial = { anchor_2_met: false, anchor_0_met: false, evidence: "0:05" };
  const no = { anchor_2_met: false, anchor_0_met: true, evidence: "0:09" };
  return {
    hook_tactic_primary: "confession",
    hook_tactic_secondary: "relatability",
    thumbstop_type: "human connection",
    visual_format: "testimonial",
    asset_type: "ugc",
    awareness_stage: "problem-aware",
    persona_pain: "GLP-1 users not eating protein",
    scores: {
      hook_pattern_interrupt: partial,
      hook_sound_off: yes,
      hook_persona_specific: yes,
      product_by_2s: no,
      problem_solution_arc: yes,
      demonstration: yes,
      social_proof: partial,
      emotional_appeal: yes,
      cta_clear: yes,
      cta_tone_match: yes,
      captions_quality: yes,
      authenticity: yes,
      x_factor: yes,
      ...overrides,
    },
    missing_from_formula: [],
    predicted_hook_band: "solid",
    predicted_hold_band: "average",
    predicted_leak: "0:07",
    prediction_reasoning: "",
    hook_alternatives: [],
  };
}

describe("criterionScore + deriveScores", () => {
  it("turns the two anchors into 0/1/2 and x_factor into 0/1", () => {
    expect(criterionScore("demonstration", { anchor_2_met: true, anchor_0_met: false, evidence: "" })).toBe(2);
    expect(criterionScore("demonstration", { anchor_2_met: false, anchor_0_met: false, evidence: "" })).toBe(1);
    expect(criterionScore("demonstration", { anchor_2_met: false, anchor_0_met: true, evidence: "" })).toBe(0);
    expect(criterionScore("demonstration", { anchor_2_met: true, anchor_0_met: true, evidence: "" })).toBe(1);
    expect(criterionScore("x_factor", { anchor_2_met: true, anchor_0_met: false, evidence: "" })).toBe(1);
    expect(criterionScore("x_factor", { anchor_2_met: false, anchor_0_met: false, evidence: "" })).toBe(0);
    expect(criterionScore("demonstration", undefined)).toBe(0);
  });

  it("reproduces Danielle Kent's 23/27, strong hook, average hold", () => {
    const pacing = pacingFromCuts([12.47, 14.83, 17.27, 19.1, 25.57, 26.6, 28.07, 29.13], 38);
    const s = deriveScores(preflight(), pacing);
    expect(s.formula.max).toBe(FORMULA_MAX);
    expect(s.formula.score).toBe(23);
    expect(s.bands.hook_points).toBe(5);
    expect(s.bands.hook).toBe("strong");
    expect(s.bands.hold_points).toBe(9);
    expect(s.bands.hold).toBe("average");
    expect(s.gemini_bands).toEqual({ hook: "solid", hold: "average" });
  });

  it("calls a weak open 'needs work' and a bare body 'weak'", () => {
    const no = { anchor_2_met: false, anchor_0_met: true, evidence: "" };
    const s = deriveScores(
      preflight({ hook_pattern_interrupt: no, hook_sound_off: no, hook_persona_specific: no, problem_solution_arc: no, demonstration: no, social_proof: no, emotional_appeal: no }),
      pacingFromCuts([], 30),
    );
    expect(s.bands.hook).toBe("needs work");
    expect(s.bands.hold).toBe("weak");
  });
});

describe("attachEvidence", () => {
  it("collects the words, scenes and frames inside each interval", () => {
    const { intervals } = retentionCurve(parseInsights(DANIELLE), 38);
    const frames = frameTimes(38, [12.47]);
    attachEvidence(
      intervals,
      [
        { start_s: 0, end_s: 4.4, text: "Listen, when I first got on a GLP-1," },
        { start_s: 4.4, end_s: 8, text: "I was not eating my protein." },
      ],
      [{ start_s: 0, end_s: 9.5, visual: "creator in kitchen", on_screen_text: "", audio: "", purpose: "" }],
      frames,
    );
    const hook = intervals[0];
    expect(hook.spoken).toContain("Listen");
    expect(hook.scenes?.[0]).toContain("kitchen");
    expect(hook.frames).toHaveLength(9);
    expect(intervals[1].spoken).toContain("protein");
  });
});
