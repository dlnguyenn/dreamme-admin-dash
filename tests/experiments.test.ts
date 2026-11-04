import { describe, expect, it } from "vitest";
import { EXPERIMENTS, armsFromEvents, rcVariant, readExperiment, type ExperimentDef } from "@/lib/revenue-plan/experiments";
import { buildPnl } from "@/lib/revenue-plan/pnl";
import type { Charge, TrialStart } from "@/lib/revenue-plan/value-per-trial";

const DAY = 86_400_000;
const NOW = new Date("2026-12-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const PRICE: ExperimentDef = {
  ...EXPERIMENTS.find((e) => e.id === "price-plan")!,
  status: "running",
  start: "2026-11-01",
  minTrialsPerArm: 10,
};

/** n trials per arm, 40+ days old; `paid` of them pay `price` at day 7, one refund in arm a. */
function world(armA: { n: number; paid: number; price: number }, armB: { n: number; paid: number; price: number }) {
  const trials: TrialStart[] = [];
  const charges: Charge[] = [];
  const arms = new Map<string, string>();
  for (const [arm, spec] of [["a", armA], ["b", armB]] as const) {
    for (let i = 0; i < spec.n; i++) {
      const id = `${arm}${i}`;
      const at = daysAgo(40 + (i % 5));
      trials.push({ otx: id, userId: id, at, store: "APP_STORE" });
      arms.set(id, arm);
      if (i < spec.paid) {
        charges.push({ userId: id, otx: id, at: new Date(Date.parse(at) + 7.1 * DAY).toISOString(), priceUsd: spec.price, productId: "DreamMeLifeSubscriptionMonthly", periodDays: 30 });
      }
    }
  }
  // A refund inside 30 days cuts arm a's revenue.
  charges.push({ userId: "a0", otx: "a0", at: new Date(Date.parse(trials[0].at) + 12 * DAY).toISOString(), priceUsd: -armA.price, productId: null, periodDays: null });
  return { trials, charges, arms };
}

describe("readExperiment", () => {
  it("drafts are not read", () => {
    const r = readExperiment(EXPERIMENTS.find((e) => e.id === "price-plan")!, [], new Map(), [], NOW);
    expect(r.status).toBe("draft");
  });

  it("scores arms: trial-to-paid, 30-day revenue net of refunds, lift vs control", () => {
    const w = world({ n: 20, paid: 8, price: 15 }, { n: 20, paid: 8, price: 18 });
    const r = readExperiment(PRICE, w.trials, w.arms, w.charges, NOW);
    const [a, b] = r.arms;
    expect(a.trials).toBe(20);
    expect(a.trialToPaid).toBeCloseTo(0.4);
    expect(a.rev30PerTrial).toBeCloseTo((8 * 15 - 15) / 20);
    expect(b.rev30PerTrial).toBeCloseTo((8 * 18) / 20);
    expect(b.revLift).toBeCloseTo(144 / 105 - 1);
    expect(b.paidLiftPp).toBeCloseTo(0);
    expect(r.status).toBe("ready");
    expect(r.bestRevLift).toBeCloseTo(144 / 105 - 1);
  });

  it("stops a test arm trailing by more than 5% on revenue per install", () => {
    // Fewer trials and the same price: revenue per enrolled user falls.
    const w = world({ n: 300, paid: 120, price: 15 }, { n: 240, paid: 96, price: 15 });
    const r = readExperiment({ ...PRICE, minTrialsPerArm: 1000 }, w.trials, w.arms, w.charges, NOW);
    expect(r.arms[1].enrolledLift!).toBeLessThan(-0.05);
    expect(r.status).toBe("stop");
  });

  it("collects until each arm has the minimum mature trials", () => {
    const w = world({ n: 20, paid: 8, price: 15 }, { n: 20, paid: 8, price: 15 });
    expect(readExperiment({ ...PRICE, minTrialsPerArm: 500 }, w.trials, w.arms, w.charges, NOW).status).toBe("collecting");
  });

  it("holdout rule: stop without a 2pp trial-to-paid lift once control is big enough", () => {
    const save: ExperimentDef = { ...EXPERIMENTS.find((e) => e.id === "trial-save")!, status: "running", start: "2026-11-01" };
    const trials: TrialStart[] = [];
    const arms = new Map<string, string>();
    const charges: Charge[] = [];
    for (let i = 0; i < 2000; i++) {
      const id = `u${i}`;
      const hold = i < 1600; // control needs 1,500 trials
      const at = daysAgo(20);
      trials.push({ otx: id, userId: id, at, store: "APP_STORE" });
      arms.set(id, hold ? "holdout" : "emotional_appeal");
      if (i % 3 === 0) charges.push({ userId: id, otx: id, at: new Date(Date.parse(at) + 7.1 * DAY).toISOString(), priceUsd: 15, productId: "DreamMeLifeSubscriptionMonthly", periodDays: 30 });
    }
    const r = readExperiment(save, trials, arms, charges, NOW);
    expect(r.arms[0].payerTrials).toBe(1600);
    expect(r.status).toBe("stop");
  });
});

describe("arm readers", () => {
  it("keeps one value per user and drops users seen with two", () => {
    const m = armsFromEvents([
      { userId: "u1", value: "a" },
      { userId: "u1", value: "a" },
      { userId: "u2", value: "a" },
      { userId: "u2", value: "b" },
      { userId: null, value: "a" },
    ]);
    expect(m.get("u1")).toBe("a");
    expect(m.get("u2")).toBe("");
    expect(m.size).toBe(2);
  });

  it("reads the variant for one RC experiment from the webhook payload", () => {
    const x = [
      { experiment_id: "prexp1", experiment_variant: "b", enrolled_at_ms: 1 },
      { experiment_id: "other", experiment_variant: "a" },
    ];
    expect(rcVariant(x, "prexp1")).toBe("b");
    expect(rcVariant(x, "missing")).toBeNull();
    expect(rcVariant(null, "prexp1")).toBeNull();
  });
});

describe("buildPnl", () => {
  it("nets proceeds at x0.84, takes creators and tools from Chase, keeps Meta from the ad account", () => {
    const rows = buildPnl(
      ["2026-10", "2026-11"],
      "2026-11",
      new Map([
        ["2026-10", 40000],
        ["2026-11", 5000],
      ]),
      new Map([
        ["2026-10", 26000],
        ["2026-11", 2700],
      ]),
      [
        {
          month: "2026-10",
          categories: [
            { category: "Ad spend - Meta", total: 27000 },
            { category: "Creator / UGC payouts", total: 3000 },
            { category: "Contractors / UGC", total: 5100 },
            { category: "AI / LLM APIs", total: 800 },
            { category: "Infra / hosting", total: 400 },
            { category: "Uncategorised", total: 24000 },
          ],
        },
      ],
      new Map([["2026-11", 1900]]),
    );
    const [oct, nov] = rows;
    expect(oct.proceeds).toBeCloseTo(33600);
    expect(oct.creators).toBe(8100);
    expect(oct.tools).toBe(1200);
    expect(oct.other).toBe(24000);
    expect(oct.contribution).toBeCloseTo(33600 - 26000 - 8100 - 1200);
    expect(nov.chaseCovered).toBe(false);
    expect(nov.creatorsBasis).toBe("manual");
    expect(nov.contribution).toBeNull();
    expect(nov.afterMeta).toBeCloseTo(4200 - 2700);
    expect(nov.partial).toBe(true);
  });
});
