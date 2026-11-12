import { describe, expect, it } from "vitest";
import {
  buildExperimentHealth,
  digestSubject,
  digestText,
  headline,
  summarize,
  type HealthInputs,
  type RcReadout,
} from "@/lib/experiment-health";
import { reduceResults } from "@/lib/experiment-results";
import type { ExperimentEntry, RcExperimentState } from "@/lib/experiment-log";

const TODAY = "2026-06-15";

function entry(over: Partial<ExperimentEntry>): ExperimentEntry {
  return {
    id: over.id ?? over.title ?? "x",
    title: "A test",
    kind: "experiment",
    area: "pricing",
    status: "running",
    hypothesis: "",
    what_changed: "",
    has_control: true,
    start_date: "2026-06-10",
    end_date: null,
    primary_metric: "Trial starts",
    result: "",
    decision: "",
    rc_experiment_id: null,
    vault_page: null,
    links: "",
    handoff_id: null,
    owner: "Dan",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...over,
  } as ExperimentEntry;
}

function readout(over: Partial<RcReadout>): RcReadout {
  return {
    customers: { a: 100, b: 100 },
    trialsStarted: { a: 20, b: 25 },
    startRate: { a: 20, b: 25, changePct: 25 },
    ltvPerCustomer: { a: 0, b: 0 },
    chanceToWin: null,
    chanceToWinStatus: "insufficient_data",
    ...over,
  };
}

function rcState(over: Partial<RcExperimentState> = {}): RcExperimentState {
  return { id: "exp1", status: "running", started_at: "2026-06-10T00:00:00Z", stopped_at: null, enrollment_percentage: 100, ...over };
}

/** A readout only ever arrives with live RC state beside it, so default to both. */
function inputs(over: Partial<HealthInputs>): HealthInputs {
  const base = { entries: [], rc: {}, readouts: {}, rcError: null, today: TODAY, ...over };
  if (Object.keys(base.readouts).length && !Object.keys(base.rc).length) {
    base.rc = Object.fromEntries(Object.keys(base.readouts).map((id) => [id, rcState({ id })]));
  }
  return base;
}

describe("what needs a person", () => {
  it("flags a stopped test with nothing written down", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ status: "stopped", end_date: "2026-06-12" })] }));
    expect(h.attention?.level).toBe("critical");
    expect(h.attention?.why).toContain("no result");
    expect(h.state).toBe("needs_decision");
  });

  it("flags a test past its end date even while still marked running", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ end_date: "2026-06-14" })] }));
    expect(h.attention?.level).toBe("critical");
    expect(h.attention?.why).toContain("past its end date");
  });

  it("leaves a stopped test alone once the result is written", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ status: "stopped", end_date: "2026-06-12", result: "B won on trial starts." })] }),
    );
    expect(h.attention).toBeNull();
    expect(h.state).toBe("settled");
  });

  it("does not ask for a result on a shipped change", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ kind: "change", status: "stopped", end_date: "2026-06-12" })] }),
    );
    expect(h.attention).toBeNull();
  });

  it("says to call it once RevenueCat is confident", () => {
    const e = entry({ rc_experiment_id: "exp1" });
    const [h] = buildExperimentHealth(
      inputs({
        entries: [e],
        readouts: { exp1: readout({ chanceToWin: 0.97, chanceToWinStatus: "ok" }) },
      }),
    );
    expect(h.attention?.action).toContain("Call it");
    expect(h.attention?.why).toContain("new version");
    expect(h.state).toBe("needs_decision");
  });

  it("says to call it when the control is the one winning", () => {
    const e = entry({ rc_experiment_id: "exp1" });
    const [h] = buildExperimentHealth(
      inputs({ entries: [e], readouts: { exp1: readout({ chanceToWin: 0.02, chanceToWinStatus: "ok" }) } }),
    );
    expect(h.attention?.why).toContain("current version");
    expect(h.attention?.why).toContain("98%");
  });

  it("stays quiet while the odds are still in the middle", () => {
    const e = entry({ rc_experiment_id: "exp1" });
    const [h] = buildExperimentHealth(
      inputs({ entries: [e], readouts: { exp1: readout({ chanceToWin: 0.7, chanceToWinStatus: "ok" }) } }),
    );
    expect(h.attention).toBeNull();
    expect(h.state).toBe("reading");
  });

  it("flags a test that was due to start and hasn't", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ status: "planned", start_date: "2026-06-01" })] }),
    );
    expect(h.attention?.why).toContain("due to start");
  });

  it("leaves a future start date alone", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ status: "planned", start_date: "2026-07-01" })] }),
    );
    expect(h.attention).toBeNull();
    expect(h.stage).toBe("Starts 2026-07-01");
  });

  it("flags a running test with no metric", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ primary_metric: "  " })] }));
    expect(h.attention?.why).toContain("no primary metric");
  });

  it("flags a test running far too long with no end date", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ start_date: "2026-01-01" })] }));
    expect(h.attention?.why).toContain("no end date");
  });

  it("leaves a long-running shipped change alone, because that is its normal state", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ kind: "change", start_date: "2026-01-01", primary_metric: "" })] }),
    );
    expect(h.attention).toBeNull();
    expect(h.state).toBe("reading");
  });

  it("flags a RevenueCat test that has vanished, but only when RevenueCat answered", () => {
    const e = entry({ rc_experiment_id: "gone" });
    const [flagged] = buildExperimentHealth(inputs({ entries: [e] }));
    expect(flagged.attention?.level).toBe("critical");
    const [quiet] = buildExperimentHealth(inputs({ entries: [e], rcError: "RevenueCat key not configured" }));
    expect(quiet.attention).toBeNull();
  });

  it("flags a draft nobody came back to", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ status: "draft", start_date: null, created_at: "2026-05-01T00:00:00Z" })] }),
    );
    expect(h.attention?.why).toContain("draft for");
  });

  it("never touches a decided entry", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ status: "decided", rc_experiment_id: "gone", end_date: "2026-01-01" })] }),
    );
    expect(h.attention).toBeNull();
    expect(h.state).toBe("settled");
  });
});

describe("the one-line reading", () => {
  it("gives both arms and the size when RevenueCat has numbers", () => {
    const e = entry({ rc_experiment_id: "exp1" });
    const [h] = buildExperimentHealth(inputs({ entries: [e], readouts: { exp1: readout({}) } }));
    expect(h.reading).toContain("trial starts 25.0% against 20.0%");
    expect(h.reading).toContain("200 people");
    expect(h.reading).toContain("Too early to call");
  });

  it("turns a confident chance into plain words", () => {
    const e = entry({ rc_experiment_id: "exp1" });
    const [h] = buildExperimentHealth(
      inputs({ entries: [e], readouts: { exp1: readout({ chanceToWin: 0.91, chanceToWinStatus: "ok" }) } }),
    );
    expect(h.reading).toContain("91% chance the new one wins");
  });

  it("falls back to the metric we said we would watch", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ primary_metric: "Realized LTV. Also plan mix." })] }));
    expect(h.reading).toBe("No read yet. Watching: Realized LTV.");
    expect(h.state).toBe("too_early");
  });

  it("says so when there is no metric at all", () => {
    const [h] = buildExperimentHealth(inputs({ entries: [entry({ primary_metric: "" })] }));
    expect(h.reading).toContain("nothing to read it against");
  });

  it("describes a shipped change by what changed", () => {
    const [h] = buildExperimentHealth(
      inputs({ entries: [entry({ kind: "change", what_changed: "Raised the price. Everyone sees it." })] }),
    );
    expect(h.reading).toBe("Raised the price");
  });
});

describe("the order and the counts", () => {
  it("puts what needs a person first and settled last", () => {
    const hs = buildExperimentHealth(
      inputs({
        entries: [
          entry({ id: "settled", status: "decided" }),
          entry({ id: "running" }),
          entry({ id: "broken", status: "stopped", end_date: "2026-06-01" }),
        ],
      }),
    );
    expect(hs.map((h) => h.id)).toEqual(["broken", "running", "settled"]);
  });

  it("counts tests and changes apart", () => {
    const hs = buildExperimentHealth(
      inputs({
        entries: [
          entry({ id: "a" }),
          entry({ id: "b", kind: "change", status: "running" }),
          entry({ id: "c", status: "planned", start_date: "2026-07-01" }),
          entry({ id: "d", status: "decided" }),
        ],
      }),
    );
    const s = summarize(hs);
    expect(s).toEqual({ running: 1, needsYou: 0, notStarted: 1, changes: 1, settled: 1 });
    expect(headline(s)).toBe("1 test running, nothing waiting on you");
  });

  it("names the count that needs a person", () => {
    const hs = buildExperimentHealth(
      inputs({ entries: [entry({ id: "a", status: "stopped", end_date: "2026-06-01" }), entry({ id: "b" })] }),
    );
    expect(headline(summarize(hs))).toBe("1 test running, 1 needs you");
    expect(digestSubject(hs)).toBe("Experiments: A test needs you");
  });
});

describe("the weekly email", () => {
  const hs = () =>
    buildExperimentHealth(
      inputs({
        entries: [
          entry({ id: "a", title: "Price test", rc_experiment_id: "exp1" }),
          entry({ id: "b", title: "Old test", status: "stopped", end_date: "2026-06-01" }),
          entry({ id: "c", title: "Shipped thing", kind: "change", what_changed: "Did a thing." }),
          entry({ id: "d", title: "Future test", status: "planned", start_date: "2026-07-01" }),
        ],
        readouts: { exp1: readout({}) },
      }),
    );

  it("leads with what needs a person, then what is running", () => {
    const text = digestText(hs(), { checkedAt: "20 minutes ago", rcError: null, dashUrl: "https://dash.example" });
    expect(text.indexOf("NEEDS YOU")).toBeLessThan(text.indexOf("RUNNING"));
    expect(text).toContain("Old test");
    expect(text).toContain("Price test (Day 6)");
    expect(text).toContain("NOT STARTED YET");
    expect(text).toContain("Future test");
  });

  it("keeps shipped changes out of the decision lists", () => {
    const text = digestText(hs(), { checkedAt: "now", rcError: null, dashUrl: "https://dash.example" });
    const running = text.slice(text.indexOf("RUNNING"), text.indexOf("NOT STARTED YET"));
    expect(running).not.toContain("Shipped thing");
    expect(text).toContain("1 shipped change");
  });

  it("promises the data is flowing, and says when it is not", () => {
    const ok = digestText(hs(), { checkedAt: "20 minutes ago", rcError: null, dashUrl: "https://dash.example" });
    expect(ok).toContain("last read 20 minutes ago");
    const bad = digestText(hs(), { checkedAt: "20 minutes ago", rcError: "429 rate limited", dashUrl: "https://dash.example" });
    expect(bad).toContain("could not be read this time");
    expect(bad).toContain("429 rate limited");
  });

  it("says all quiet when nothing is waiting", () => {
    const quiet = buildExperimentHealth(inputs({ entries: [entry({ id: "a" })] }));
    expect(digestSubject(quiet)).toBe("Experiments: 1 running, all quiet");
    expect(digestText(quiet, { checkedAt: "now", rcError: null, dashUrl: "https://d" })).not.toContain("NEEDS YOU");
  });
});

describe("reading RevenueCat's results payload", () => {
  // Shaped exactly like the real response: per-section metric and segment
  // lists, values pointing at them by index. Figures are made up.
  const payload = {
    control_variant: "a",
    sections: [
      {
        section: "Initial conversion",
        metrics: [{ name: "Customers" }, { name: "Trials started" }, { name: "Initial conversion rate" }],
        segments: [{ id: "all", is_total: true }, { id: "prod1", is_total: false }],
        values: [
          { metric: 0, segment: 0, variant: "a", value: 200 },
          { metric: 0, segment: 0, variant: "b", value: 210 },
          { metric: 1, segment: 0, variant: "a", value: 40 },
          { metric: 1, segment: 0, variant: "b", value: 52 },
          { metric: 1, segment: 1, variant: "b", value: 9 },
          { metric: 2, segment: 0, variant: "a", value: 20 },
          { metric: 2, segment: 0, variant: "b", value: 24.76 },
        ],
      },
      {
        section: "Revenue",
        // "Customers" does not exist here; index 0 is a different metric.
        metrics: [{ name: "Realized LTV (revenue)" }, { name: "Realized LTV per customer" }],
        segments: [{ id: "all", is_total: true }],
        values: [
          { metric: 0, segment: 0, variant: "a", value: 900 },
          { metric: 1, segment: 0, variant: "a", value: 4.5 },
          { metric: 1, segment: 0, variant: "b", value: 5.25 },
        ],
      },
    ],
    statistics: [
      {
        metric_name: "initial_conversion_rate",
        variants: [
          { name: "a", chance_to_win: null, chance_to_win_status: "unavailable" },
          { name: "b", chance_to_win: 0.88, chance_to_win_status: "ok" },
        ],
      },
    ],
  };

  it("finds each metric in its own section, by name", () => {
    const r = reduceResults(payload);
    expect(r.customers).toEqual({ a: 200, b: 210 });
    expect(r.trialsStarted).toEqual({ a: 40, b: 52 });
    expect(r.startRate.a).toBe(20);
    expect(r.startRate.b).toBe(24.76);
    expect(r.ltvPerCustomer).toEqual({ a: 4.5, b: 5.25 });
  });

  it("reads the chance to win off the treatment arm", () => {
    const r = reduceResults(payload);
    expect(r.chanceToWin).toBe(0.88);
    expect(r.chanceToWinStatus).toBe("ok");
  });

  it("keeps insufficient data apart from a missing metric", () => {
    const early = {
      ...payload,
      statistics: [
        {
          metric_name: "initial_conversion_rate",
          variants: [{ name: "b", chance_to_win: null, chance_to_win_status: "insufficient_data" }],
        },
      ],
    };
    expect(reduceResults(early).chanceToWinStatus).toBe("insufficient_data");
    expect(reduceResults({ sections: [] }).chanceToWinStatus).toBe("unavailable");
  });

  it("survives an empty or unexpected payload", () => {
    const r = reduceResults({});
    expect(r.customers).toEqual({ a: null, b: null });
    expect(r.startRate.changePct).toBeNull();
  });

  it("honours a control arm that is not called a", () => {
    const flipped = {
      control_variant: "b",
      sections: [
        {
          metrics: [{ name: "Initial conversion rate" }],
          segments: [{ id: "all", is_total: true }],
          values: [
            { metric: 0, segment: 0, variant: "a", value: 30 },
            { metric: 0, segment: 0, variant: "b", value: 20 },
          ],
        },
      ],
    };
    const r = reduceResults(flipped);
    expect(r.startRate.a).toBe(20);
    expect(r.startRate.b).toBe(30);
    expect(r.startRate.changePct).toBe(50);
  });
});
