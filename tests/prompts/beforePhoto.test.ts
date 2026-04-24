import { describe, it, expect } from "vitest";
import {
  SCENARIOS,
  SCENARIO_LABELS,
  buildBeforePhotoPrompt,
  pickTwoScenarios,
  pickNScenarios,
  type BeforeScenario,
} from "@/lib/prompts/beforePhoto";

describe("beforePhoto prompt module", () => {
  it("SCENARIOS has exactly 5 entries and excludes candid_unaware", () => {
    expect(SCENARIOS.length).toBe(5);
    // candid_unaware was explicitly dropped from the brief per user direction.
    expect((SCENARIOS as readonly string[]).includes("candid_unaware")).toBe(
      false,
    );
    expect(new Set(SCENARIOS).size).toBe(5); // all distinct
  });

  it("every scenario id has a UI label", () => {
    for (const id of SCENARIOS) {
      expect(SCENARIO_LABELS[id]).toBeTruthy();
      expect(typeof SCENARIO_LABELS[id]).toBe("string");
    }
  });

  it("buildBeforePhotoPrompt includes master-template opener, weight, and scenario block", () => {
    const prompt = buildBeforePhotoPrompt("bathroom_mirror", 195);
    // Master-template opener
    expect(prompt).toContain("candid amateur photograph");
    expect(prompt).toContain("personal camera roll");
    // Weight target woven into the avatar description
    expect(prompt).toContain("195 pounds");
    // Scenario-specific distinctive phrases
    expect(prompt).toContain("cluttered home bathroom");
    expect(prompt).toContain("phone is visible in her hand");
    // Master-template closer
    expect(prompt).toContain("unedited iPhone snapshot");
    expect(prompt).toContain("deep depth of field");
  });

  it("buildBeforePhotoPrompt swaps scenario blocks correctly", () => {
    const bathroom = buildBeforePhotoPrompt("bathroom_mirror", 190);
    const outdoor = buildBeforePhotoPrompt("outdoor_event", 190);
    expect(bathroom).toContain("cluttered home bathroom");
    expect(bathroom).not.toContain("outdoor event");
    expect(outdoor).toContain("outdoor event");
    expect(outdoor).not.toContain("cluttered home bathroom");
  });

  it("buildBeforePhotoPrompt does NOT include forbidden list-style negatives", () => {
    // The brief warns against terminal lists like "no bokeh, no professional
    // lighting, no skin smoothing". The previous prompt had:
    // "No filters, no beauty retouching, no professional lighting."
    // Verify we stripped that pattern.
    const prompt = buildBeforePhotoPrompt("family_photo", 200);
    expect(prompt).not.toMatch(/No filters, no beauty retouching/i);
    expect(prompt).not.toMatch(/no bokeh, no professional/i);
  });

  it("pickTwoScenarios always returns two distinct scenarios", () => {
    for (let i = 0; i < 100; i++) {
      const [a, b] = pickTwoScenarios();
      expect(a).not.toBe(b);
      expect(SCENARIOS).toContain(a);
      expect(SCENARIOS).toContain(b);
    }
  });

  it("pickTwoScenarios distribution covers all 5 scenarios over many draws", () => {
    const seen = new Set<BeforeScenario>();
    for (let i = 0; i < 500; i++) {
      const [a, b] = pickTwoScenarios();
      seen.add(a);
      seen.add(b);
      if (seen.size === SCENARIOS.length) break;
    }
    expect(seen.size).toBe(SCENARIOS.length);
  });

  it("pickNScenarios returns the requested count and only valid ids", () => {
    const picks = pickNScenarios(7);
    expect(picks.length).toBe(7);
    for (const p of picks) {
      expect(SCENARIOS).toContain(p);
    }
  });
});
