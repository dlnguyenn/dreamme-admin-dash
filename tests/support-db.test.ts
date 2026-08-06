/**
 * saveCursor must survive schema drift.
 *
 * 2026-08-06: the alerted_at column shipped in code while its migration died
 * in a GitHub Actions outage. PostgREST rejected every cursor upsert with
 * PGRST204 ("Could not find the 'alerted_at' column"), freezing the Gmail
 * cursor — ingestion's one non-negotiable invariant. saveCursor now strips
 * the unknown column and retries; these tests pin that behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const PGRST204 = (col: string) =>
  JSON.stringify({
    code: "PGRST204",
    message: `Could not find the '${col}' column of 'support_cursors' in the schema cache`,
  });

function res(ok: boolean, status: number, body: string) {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body || "[]"),
  } as Response;
}

async function loadDb() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://internal.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  return import("@/lib/support/db");
}

const CURSOR = {
  id: "gmail-api-inbox",
  uidvalidity: null,
  last_uid: null,
  history_id: "259894",
  last_seen_at: "2026-08-06T17:48:39.917Z",
  alerted_at: null,
};

describe("saveCursor schema-drift retry", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips only the unknown column and retries", async () => {
    const db = await loadDb();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body))[0]);
      return bodies.length === 1
        ? res(false, 400, PGRST204("alerted_at"))
        : res(true, 201, "[]");
    });
    vi.stubGlobal("fetch", fetchMock);

    await db.saveCursor(CURSOR);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toHaveProperty("alerted_at");
    expect(bodies[1]).not.toHaveProperty("alerted_at");
    // Everything else — the cursor itself — survives the retry untouched.
    expect(bodies[1]).toMatchObject({
      id: "gmail-api-inbox",
      history_id: "259894",
    });
    expect(bodies[1]).toHaveProperty("updated_at");
  });

  it("strips multiple missing columns, one per retry", async () => {
    const db = await loadDb();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return res(false, 400, PGRST204("alerted_at"));
      if (call === 2) return res(false, 400, PGRST204("history_id"));
      return res(true, 201, "[]");
    });
    vi.stubGlobal("fetch", fetchMock);

    await db.saveCursor(CURSOR);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows when the missing column is not in the payload (no infinite loop)", async () => {
    const db = await loadDb();
    const fetchMock = vi.fn(async () => res(false, 400, PGRST204("phantom")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(db.saveCursor(CURSOR)).rejects.toThrow(/phantom/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never strips the id column", async () => {
    const db = await loadDb();
    const fetchMock = vi.fn(async () => res(false, 400, PGRST204("id")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(db.saveCursor(CURSOR)).rejects.toThrow(/id/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-drift errors untouched", async () => {
    const db = await loadDb();
    const fetchMock = vi.fn(async () =>
      res(false, 500, "internal server error"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(db.saveCursor(CURSOR)).rejects.toThrow(/Supabase 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
