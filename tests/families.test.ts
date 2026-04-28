import { describe, expect, it } from "vitest";
import {
  attachOrCreate,
  computeFatigue,
  updateCentroidMean,
  type FamilyRow,
  type FamilyStore,
  type FatigueInputRow,
  type FatiguePatch,
} from "@/lib/families";

function makeStubStore(): {
  store: FamilyStore;
  inserts: Array<{ embedding: number[]; exemplar_text: string }>;
  updates: Array<{ id: string; centroid: number[]; member_count: number }>;
  patches: FatiguePatch[];
  fatigueRows: FatigueInputRow[];
} {
  const inserts: Array<{ embedding: number[]; exemplar_text: string }> = [];
  const updates: Array<{
    id: string;
    centroid: number[];
    member_count: number;
  }> = [];
  const patches: FatiguePatch[] = [];
  const fatigueRows: FatigueInputRow[] = [];
  let nextId = 1;
  const store: FamilyStore = {
    async fetchAll() {
      return [];
    },
    async insert(input) {
      inserts.push({
        embedding: input.embedding,
        exemplar_text: input.exemplar_text,
      });
      return `f-${nextId++}`;
    },
    async updateCentroid(input) {
      updates.push(input);
    },
    async fetchFatigueInputs() {
      return fatigueRows;
    },
    async bulkUpdateFatigue(p) {
      patches.push(...p);
    },
    async listForPersona() {
      return [];
    },
  };
  return { store, inserts, updates, patches, fatigueRows };
}

describe("families.updateCentroidMean", () => {
  it("running-mean of 1 + 1 yields the average", () => {
    const next = updateCentroidMean([1, 0], 1, [3, 0]);
    expect(next).toEqual([2, 0]);
  });

  it("preserves dimensionality", () => {
    const next = updateCentroidMean([1, 2, 3, 4], 4, [5, 5, 5, 5]);
    expect(next).toHaveLength(4);
  });
});

describe("families.attachOrCreate", () => {
  it("creates a new family when no existing centroid clears the threshold", async () => {
    const { store, inserts } = makeStubStore();
    const families: FamilyRow[] = [];
    const r = await attachOrCreate(store, families, {
      embedding: [1, 0, 0],
      exemplar_text: "first hook",
      category: "listicle",
    });
    expect(r.isNew).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(families).toHaveLength(1);
    expect(families[0].member_count).toBe(1);
  });

  it("attaches when nearest centroid clears the threshold and updates centroid", async () => {
    const { store, inserts, updates } = makeStubStore();
    const families: FamilyRow[] = [
      {
        id: "f-existing",
        centroid: [1, 0, 0],
        exemplar_text: "anchor",
        category: "listicle",
        member_count: 4,
      },
    ];
    const r = await attachOrCreate(store, families, {
      embedding: [0.99, 0.01, 0],
      exemplar_text: "near anchor",
      category: "listicle",
    });
    expect(r.isNew).toBe(false);
    expect(r.familyId).toBe("f-existing");
    expect(r.similarity).toBeGreaterThan(0.99);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].member_count).toBe(5);
    expect(families[0].member_count).toBe(5);
  });

  it("creates a new family when nearest is below threshold", async () => {
    const { store, inserts } = makeStubStore();
    const families: FamilyRow[] = [
      {
        id: "f-anchor",
        centroid: [1, 0, 0],
        exemplar_text: "anchor",
        category: null,
        member_count: 2,
      },
    ];
    const r = await attachOrCreate(store, families, {
      embedding: [0, 1, 0], // orthogonal — cosine = 0
      exemplar_text: "way different",
      category: null,
    });
    expect(r.isNew).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(families).toHaveLength(2);
  });
});

describe("families.computeFatigue", () => {
  const now = new Date("2026-04-28T12:00:00Z");

  it("scores zero when there are no recent uses", () => {
    const f = computeFatigue(
      {
        total_uses_14d: 0,
        recent_flop_count_14d: 0,
        cross_persona_uses_14d: 0,
        last_use_at: null,
      },
      now,
    );
    expect(f.fatigue_score).toBe(0);
    expect(f.cooldown_until).toBeNull();
  });

  it("flop_pressure dominates when most recent uses flopped", () => {
    const f = computeFatigue(
      {
        total_uses_14d: 4,
        recent_flop_count_14d: 4,
        cross_persona_uses_14d: 1,
        last_use_at: new Date("2026-04-27T12:00:00Z").toISOString(), // 1d ago
      },
      now,
    );
    expect(f.flop_pressure).toBe(1);
    expect(f.fatigue_score).toBeGreaterThan(0.6);
    expect(f.cooldown_until).not.toBeNull();
    expect(f.fatigue_reason).toBe("recent_flops");
  });

  it("recency_pressure decays linearly over 7 days", () => {
    const f7 = computeFatigue(
      {
        total_uses_14d: 1,
        recent_flop_count_14d: 0,
        cross_persona_uses_14d: 0,
        last_use_at: new Date("2026-04-21T12:00:00Z").toISOString(), // 7d ago
      },
      now,
    );
    expect(f7.recency_pressure).toBeCloseTo(0, 3);

    const f0 = computeFatigue(
      {
        total_uses_14d: 1,
        recent_flop_count_14d: 0,
        cross_persona_uses_14d: 0,
        last_use_at: now.toISOString(),
      },
      now,
    );
    expect(f0.recency_pressure).toBe(1);
  });

  it("copycat_pressure caps at 1 when crossing 5 personas", () => {
    const f = computeFatigue(
      {
        total_uses_14d: 6,
        recent_flop_count_14d: 0,
        cross_persona_uses_14d: 6,
        last_use_at: new Date("2026-04-15T12:00:00Z").toISOString(), // 13d ago
      },
      now,
    );
    expect(f.copycat_pressure).toBe(1);
  });

  it("does not set cooldown when score is at or below threshold", () => {
    const f = computeFatigue(
      {
        total_uses_14d: 4,
        recent_flop_count_14d: 1,
        cross_persona_uses_14d: 1,
        last_use_at: new Date("2026-04-25T12:00:00Z").toISOString(), // 3d ago
      },
      now,
    );
    expect(f.fatigue_score).toBeLessThanOrEqual(0.6);
    expect(f.cooldown_until).toBeNull();
    expect(f.fatigue_reason).toBeNull();
  });
});
