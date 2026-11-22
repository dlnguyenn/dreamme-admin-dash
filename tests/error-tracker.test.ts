import { describe, expect, it, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";
import { GenMapping, addMapping, setSourceContent, toEncodedMap } from "@jridgewell/gen-mapping";
import { TraceMap } from "@jridgewell/trace-mapping";
import { decodeBody, parseEnvelope, publicKeyFrom, RATE_LIMIT_HEADER } from "@/lib/errors/envelope";
import { normalizeMessage, scrubEvent, summarize } from "@/lib/errors/event";
import { symbolicateExceptions } from "@/lib/errors/symbolicate";
import { buildIssueViews, connectionState, errorUrgents, isSpiking, type IssueLike } from "@/lib/errors/view";

const { ingest } = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/lib/errors/store", () => ({ ingestEvent: (...a: unknown[]) => ingest(...a) }));

// Fixtures use made-up ids only. Never paste a real event here: the repo is public.
const FAKE_USER = "00000000-0000-4000-8000-000000000001";

function jsEvent(over: Record<string, unknown> = {}) {
  return {
    event_id: "a".repeat(32),
    timestamp: 1795000000.5,
    platform: "javascript",
    level: "error",
    release: "com.dreamme.app@1.5.9+1.0.95",
    dist: "1.0.95",
    environment: "production",
    exception: {
      values: [
        {
          type: "Error",
          value: "Failed to read storage file /var/mobile/Containers/Data/Application/11111111-2222-4333-8444-555555555555/manifest.json",
          mechanism: { type: "onunhandledrejection", handled: true },
          stacktrace: {
            frames: [
              { function: "a", filename: "app:///main.jsbundle", abs_path: "app:///main.jsbundle", lineno: 1, colno: 101, in_app: true },
              { function: "b", filename: "app:///main.jsbundle", abs_path: "app:///main.jsbundle", lineno: 1, colno: 205, in_app: true },
            ],
          },
        },
      ],
    },
    user: { id: FAKE_USER, email: "someone@example.com", ip_address: "10.0.0.1" },
    request: { cookies: "session=secret" },
    extra: { weight: 182 },
    breadcrumbs: {
      values: [
        { timestamp: 1795000000, category: "http", type: "http", data: { url: "https://api.example.com/v1/x?token=abc", method: "GET", status_code: 500 } },
        { timestamp: 1795000000, category: "console", message: "mail person@example.com failed" },
      ],
    },
    contexts: {
      os: { name: "iOS", version: "26.1" },
      device: { model: "iPhone15,4", family: "iOS", free_memory: 100 },
      app: { app_version: "1.5.9", device_app_hash: "fakehash", in_foreground: false },
    },
    debug_meta: { images: [{ type: "sourcemap", code_file: "app:///main.jsbundle", debug_id: "0123456789abcdef0123456789abcdef" }] },
    tags: { "os.name": "iOS", user: "id:x" },
    ...over,
  };
}

function envelopeOf(items: { header: Record<string, unknown>; body: Buffer | string }[], header: Record<string, unknown> = {}) {
  const parts: Buffer[] = [Buffer.from(JSON.stringify(header) + "\n")];
  for (const it of items) {
    parts.push(Buffer.from(JSON.stringify(it.header) + "\n"));
    parts.push(typeof it.body === "string" ? Buffer.from(it.body) : it.body);
    parts.push(Buffer.from("\n"));
  }
  return Buffer.concat(parts);
}

describe("envelope parsing", () => {
  it("reads newline-delimited and length-prefixed items, including binary attachments with newlines", () => {
    const evt = JSON.stringify(jsEvent());
    const binary = Buffer.from([0x00, 0x0a, 0xff, 0x0a, 0x41]);
    const buf = envelopeOf(
      [
        { header: { type: "event" }, body: evt },
        { header: { type: "attachment", length: binary.length, filename: "screenshot.png" }, body: binary },
        { header: { type: "session", length: Buffer.byteLength('{"sid":"x"}') }, body: '{"sid":"x"}' },
      ],
      { event_id: "a".repeat(32), dsn: "https://pubkey@dad.example/1" },
    );
    const env = parseEnvelope(buf);
    expect(env.items.map((i) => i.type)).toEqual(["event", "attachment", "session"]);
    expect(JSON.parse(env.items[0].payload.toString()).event_id).toBe("a".repeat(32));
    expect(env.items[1].payload.equals(binary)).toBe(true);
  });

  it("decodes gzip whether or not Content-Encoding says so", () => {
    const raw = envelopeOf([{ header: { type: "event" }, body: "{}" }]);
    const gz = gzipSync(raw);
    expect(decodeBody(gz, "gzip").equals(raw)).toBe(true);
    expect(decodeBody(gz, null).equals(raw)).toBe(true);
    expect(decodeBody(raw, null).equals(raw)).toBe(true);
  });

  it("finds the public key in the query, the X-Sentry-Auth header, or the envelope dsn", () => {
    expect(publicKeyFrom(new URL("https://h/api/1/envelope/?sentry_key=k1&sentry_version=7"), null)).toBe("k1");
    expect(publicKeyFrom(new URL("https://h/api/1/envelope/"), "Sentry sentry_version=7, sentry_client=sentry.cocoa/8.0, sentry_key=k2")).toBe("k2");
    expect(publicKeyFrom(new URL("https://h/api/1/envelope/"), null, { dsn: "https://k3@h/1" })).toBe("k3");
    expect(publicKeyFrom(new URL("https://h/api/1/envelope/"), null)).toBeNull();
  });

  it("tells the SDK to stop sending what we drop", () => {
    expect(RATE_LIMIT_HEADER).toMatch(/^86400:/);
    for (const c of ["transaction", "replay", "profile", "session", "span"]) expect(RATE_LIMIT_HEADER.split(":")[1].split(";")).toContain(c);
    expect(RATE_LIMIT_HEADER.split(":")[1].split(";")).not.toContain("error");
  });
});

describe("grouping", () => {
  it("normalizes ids, paths, hex and numbers", () => {
    expect(normalizeMessage("at 0xdeadbeef in /var/mobile/x/y.json for 3c7c1d9c-0000-4000-8000-000000000000 after 2000 ms")).toBe(
      "at <hex> in <path> for <uuid> after <n> ms",
    );
  });

  it("puts the same JS error from different phones in one issue, and keeps different errors apart", () => {
    const a = summarize(jsEvent());
    const b = summarize(
      jsEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: "Failed to read storage file /var/mobile/Containers/Data/Application/99999999-2222-4333-8444-555555555555/manifest.json",
              mechanism: { type: "onunhandledrejection", handled: true },
              stacktrace: { frames: [{ function: "zz", filename: "app:///main.jsbundle", lineno: 1, colno: 999 }] },
            },
          ],
        },
      }),
    );
    const c = summarize(jsEvent({ exception: { values: [{ type: "TypeError", value: "undefined is not a function" }] } }));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(a.title).toMatch(/^Error: Failed to read storage file/);
  });

  it("splits native app hangs by their top frame", () => {
    const hang = (fn: string) =>
      summarize({
        event_id: "b".repeat(32),
        platform: "cocoa",
        exception: {
          values: [
            {
              type: "App Hanging",
              value: "App hanging for at least 2000 ms.",
              mechanism: { type: "AppHang", handled: true },
              stacktrace: { frames: [{ function: "main", package: "/x/DreamMe.app/DreamMe", in_app: true }, { function: fn, package: "/x/React.framework/React" }] },
            },
          ],
        },
      });
    expect(hang("-[RCTTextInputComponentView didMoveToWindow]").fingerprint).not.toBe(hang("-[RCTViewComponentView mountChildComponentView:index:]").fingerprint);
    expect(hang("x").fingerprint).toBe(hang("x").fingerprint);
  });

  it("honours an SDK fingerprint but not the default placeholder", () => {
    expect(summarize(jsEvent({ fingerprint: ["custom-group"] })).fingerprint).toBe(summarize(jsEvent({ fingerprint: ["custom-group"], message: "other" })).fingerprint);
    expect(summarize(jsEvent({ fingerprint: ["{{ default }}"] })).fingerprint).toBe(summarize(jsEvent()).fingerprint);
  });

  it("counts users by a hash, never the raw id", () => {
    const s = summarize(jsEvent());
    expect(s.user_key).toMatch(/^[0-9a-f]{32}$/);
    expect(s.user_key).not.toContain(FAKE_USER.slice(0, 8));
    expect(s.user_id).toBe(FAKE_USER);
    expect(summarize(jsEvent({ user: undefined })).user_key).toMatch(/^[0-9a-f]{32}$/); // device hash
  });

  it("clamps future timestamps to now", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    expect(summarize(jsEvent({ timestamp: 9999999999 }), now).occurred_at).toBe(now.toISOString());
  });
});

describe("scrubbing", () => {
  it("keeps an allowlist and strips emails, IPs, cookies, extra and query strings", () => {
    const out = JSON.stringify(scrubEvent(jsEvent()));
    expect(out).not.toMatch(/someone@example\.com|person@example\.com|10\.0\.0\.1|session=secret|token=abc|"weight"/);
    expect(out).toContain("https://api.example.com/v1/x");
    expect(out).toContain(FAKE_USER);
    expect(out).toContain("0123456789abcdef0123456789abcdef");
    const s = scrubEvent(jsEvent()) as { tags: Record<string, string> };
    expect(s.tags.user).toBeUndefined();
  });
});

describe("symbolication", () => {
  it("resolves bundle frames through the event's debug id and reports missing maps", async () => {
    const g = new GenMapping({ file: "main.jsbundle" });
    addMapping(g, { generated: { line: 1, column: 100 }, source: "../../app/(tabs)/index.tsx", original: { line: 12, column: 4 }, name: "loadManifest" });
    addMapping(g, { generated: { line: 1, column: 204 }, source: "../../node_modules/expo-modules-core/src/errors/CodedError.ts", original: { line: 11, column: 4 }, name: "CodedError" });
    setSourceContent(g, "../../app/(tabs)/index.tsx", "line1\n".repeat(11) + "    const m = await readManifest();\n");
    const map = new TraceMap(toEncodedMap(g));
    const payload = scrubEvent(jsEvent()) as { exceptions: never[]; debug_images: Record<string, unknown>[] };
    const ids: (string | null)[] = [];
    const out = await symbolicateExceptions(payload.exceptions, payload.debug_images, async (k) => {
      ids.push(k.debugId);
      return map;
    });
    expect(ids).toEqual(["0123456789abcdef0123456789abcdef"]); // one lookup, cached
    const frames = out!.exceptions[0].frames;
    expect(frames[0]).toMatchObject({ function: "loadManifest", filename: "app/(tabs)/index.tsx", lineno: 12, in_app: true, resolved: true });
    expect(frames[0].context_line).toBe("const m = await readManifest();");
    expect(frames[1]).toMatchObject({ function: "CodedError", in_app: false });
    expect(await symbolicateExceptions(payload.exceptions, payload.debug_images, async () => null)).toBeNull();
  });
});

describe("views and alerts", () => {
  const now = new Date("2026-11-22T15:00:00Z");
  const issue = (over: Partial<IssueLike> = {}): IssueLike => ({
    id: 1,
    title: "Error: boom",
    culprit: null,
    platform: "javascript",
    status: "unresolved",
    regressed_at: null,
    first_seen: "2026-11-01T00:00:00Z",
    last_seen: "2026-11-22T14:00:00Z",
    event_count: 100,
    user_count: 40,
    handled: true,
    mechanism: "onunhandledrejection",
    ...over,
  });

  it("builds a 14-day series ending today", () => {
    const [v] = buildIssueViews([issue()], [{ issue_id: 1, day: "2026-11-22", events: 7 }, { issue_id: 1, day: "2026-11-09", events: 2 }, { issue_id: 1, day: "2026-11-01", events: 99 }], now);
    expect(v.series).toHaveLength(14);
    expect(v.series[0]).toBe(2);
    expect(v.today).toBe(7);
    expect(v.last7).toBe(7);
  });

  it("calls a spike at 20+ events and 5x the prior week", () => {
    expect(isSpiking([...Array(7).fill(2), 30])).toBe(true);
    expect(isSpiking([...Array(7).fill(10), 30])).toBe(false);
    expect(isSpiking([...Array(7).fill(0), 15])).toBe(false);
  });

  it("knows waiting, receiving and gone quiet", () => {
    expect(connectionState([], now).state).toBe("waiting");
    expect(connectionState([issue()], now).state).toBe("receiving");
    expect(connectionState([issue({ last_seen: "2026-11-20T00:00:00Z" })], now)).toMatchObject({ state: "quiet" });
  });

  it("raises new, regressed, spiking and quiet alerts, and skips ignored issues", () => {
    const views = buildIssueViews(
      [
        issue({ id: 1, first_seen: "2026-11-22T10:00:00Z", user_count: 30 }),
        issue({ id: 2, regressed_at: "2026-11-22T09:00:00Z" }),
        issue({ id: 3, status: "ignored", first_seen: "2026-11-22T10:00:00Z" }),
        issue({ id: 4, first_seen: "2026-11-22T10:00:00Z", user_count: 1, event_count: 2 }),
      ],
      [{ issue_id: 2, day: "2026-11-22", events: 40 }],
      now,
    );
    const alerts = errorUrgents(views, connectionState([issue({ last_seen: "2026-11-20T00:00:00Z" })], now), now);
    expect(alerts.map((a) => a.id)).toEqual(["errors:new:1", "errors:regressed:2", "errors:spike:2", "errors:quiet"]);
    expect(alerts[0].level).toBe("critical");
  });
});

describe("ingest handler", () => {
  beforeEach(() => {
    ingest.mockReset();
    process.env.ERRORS_DSN_PUBLIC_KEY = "pubkey";
    process.env.ERRORS_PROJECT_ID = "1";
  });
  const post = (body: Buffer, headers: Record<string, string> = {}, q = "?sentry_key=pubkey&sentry_version=7") =>
    new Request(`https://dad.example/api/1/envelope/${q}`, { method: "POST", body: new Uint8Array(body), headers });

  it("stores events only, answers with the drop header, and accepts gzip + header auth", async () => {
    const { handleEnvelope } = await import("@/lib/errors/ingest");
    ingest.mockResolvedValue({ status: "ok", issue_id: 1 });
    const body = envelopeOf([
      { header: { type: "event" }, body: JSON.stringify(jsEvent()) },
      { header: { type: "transaction" }, body: "{}" },
      { header: { type: "replay_event" }, body: "{}" },
    ]);
    const res = await handleEnvelope(post(gzipSync(body), { "content-encoding": "gzip", "x-sentry-auth": "Sentry sentry_key=pubkey" }, ""), "1");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sentry-rate-limits")).toBe(RATE_LIMIT_HEADER);
    expect(ingest).toHaveBeenCalledTimes(1);
    const [summary, payload] = ingest.mock.calls[0];
    expect(summary.event_id).toBe("a".repeat(32));
    expect(JSON.stringify(payload)).not.toContain("someone@example.com");
  });

  it("refuses a wrong key or project, and never answers 5xx", async () => {
    const { handleEnvelope } = await import("@/lib/errors/ingest");
    const body = envelopeOf([{ header: { type: "event" }, body: JSON.stringify(jsEvent()) }]);
    expect((await handleEnvelope(post(body, {}, "?sentry_key=nope"), "1")).status).toBe(403);
    expect((await handleEnvelope(post(body), "2")).status).toBe(403);
    ingest.mockRejectedValue(new Error("db down"));
    const down = await handleEnvelope(post(body), "1");
    expect(down.status).toBe(429);
    expect(down.headers.get("retry-after")).toBe("300");
    ingest.mockResolvedValue({ status: "rate_limited" });
    const capped = await handleEnvelope(post(body), "1");
    expect(capped.status).toBe(429);
    expect(capped.headers.get("x-sentry-rate-limits")).toMatch(/^60:error;default:/);
    expect((await handleEnvelope(post(Buffer.alloc(1_100_000, 0x20)), "1")).status).toBe(413);
  });
});
