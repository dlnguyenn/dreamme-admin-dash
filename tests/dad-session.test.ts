import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  accountFromSession,
  checkGoogleIdClaims,
  hashClaudeKey,
  looksLikeClaudeKey,
  newClaudeKey,
  newClaudeSession,
  newGoogleSession,
  parseEmailList,
  readCookie,
  roleForEmail,
  safeNext,
  serializeCookie,
  sessionSecret,
  signToken,
  verifyToken,
  devBypassActive,
  type SessionPayload,
} from "@/lib/dad-session";
import { checkAdminAuth, checkIngestAuth, requestAccount } from "@/lib/auth-ingest";

const SECRET = "test-secret";
const ENV = {
  DAD_SESSION_SECRET: SECRET,
  DAD_ADMIN_EMAILS: "Admin@Example.test, second@example.test",
  DAD_VIEWER_EMAILS: "viewer@example.test",
};

function reqWith(opts: { cookie?: string; headers?: Record<string, string>; url?: string } = {}) {
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new Request(opts.url ?? "https://dash.example.test/api/thing", { headers });
}

function cookieFor(p: SessionPayload, secret = SECRET) {
  return `${SESSION_COOKIE}=${encodeURIComponent(signToken(p, secret))}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signed tokens", () => {
  it("round-trips and rejects tampering, wrong secret, wrong type and expiry", () => {
    const p = newGoogleSession("a@example.test", 1000);
    const t = signToken(p, SECRET);
    expect(verifyToken(t, SECRET, "session", 1001)).toMatchObject({ email: "a@example.test" });
    expect(verifyToken(t, "other", "session", 1001)).toBeNull();
    expect(verifyToken(t, SECRET, "ticket", 1001)).toBeNull();
    expect(verifyToken(t, SECRET, "session", p.exp)).toBeNull();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...p, email: "evil@example.test" })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, SECRET, "session", 1001)).toBeNull();
    expect(verifyToken(`${body}.`, SECRET, "session", 1001)).toBeNull();
    expect(verifyToken("", SECRET, "session")).toBeNull();
    expect(verifyToken(t, "", "session", 1001)).toBeNull();
  });

  it("derives a secret from the service role when none is set, else fails closed", () => {
    expect(sessionSecret({ SUPABASE_SERVICE_ROLE_KEY: "sr" })).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionSecret({ SUPABASE_SERVICE_ROLE_KEY: "sr" })).not.toBe("sr");
    expect(sessionSecret({})).toBe("");
    expect(sessionSecret({ DAD_SESSION_SECRET: "x", SUPABASE_SERVICE_ROLE_KEY: "sr" })).toBe("x");
  });
});

describe("who may sign in", () => {
  it("reads the allowlists case-insensitively; admin wins", () => {
    expect(parseEmailList(" a@x.test ,b@x.test;nope ")).toEqual(["a@x.test", "b@x.test"]);
    expect(roleForEmail("admin@example.test", ENV)).toBe("admin");
    expect(roleForEmail("SECOND@example.test", ENV)).toBe("admin");
    expect(roleForEmail("viewer@example.test", ENV)).toBe("user");
    expect(roleForEmail("stranger@example.test", ENV)).toBeNull();
    expect(roleForEmail("", ENV)).toBeNull();
    expect(roleForEmail("viewer@example.test", { ...ENV, DAD_ADMIN_EMAILS: "viewer@example.test" })).toBe("admin");
  });

  it("re-checks the allowlist on every request, so removing an email locks it out", () => {
    const p = newGoogleSession("viewer@example.test");
    expect(accountFromSession(p, ENV)?.role).toBe("user");
    expect(accountFromSession(p, { ...ENV, DAD_VIEWER_EMAILS: "" })).toBeNull();
  });

  it("gives Claude sessions admin unless DAD_CLAUDE_ROLE=user", () => {
    const p = newClaudeSession("00000000-0000-0000-0000-000000000000", "Dan PC");
    expect(accountFromSession(p, ENV)).toMatchObject({ kind: "claude", role: "admin", name: "Dan PC" });
    expect(accountFromSession(p, { ...ENV, DAD_CLAUDE_ROLE: "user" })?.role).toBe("user");
  });
});

describe("API gate (checkIngestAuth / checkAdminAuth)", () => {
  function stub() {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubEnv("INGEST_TOKEN", "ingest-tok");
    vi.stubEnv("CRON_SECRET", "cron-tok");
  }

  it("refuses a faked Origin header (the Nov 6 audit hole)", () => {
    stub();
    const req = reqWith({
      headers: { host: "dash.example.test", origin: "https://dash.example.test", referer: "https://dash.example.test/" },
    });
    expect(checkIngestAuth(req)).toBe(false);
  });

  it("keeps the ingest token and cron secret working", () => {
    stub();
    expect(checkIngestAuth(reqWith({ headers: { "x-dreamme-secret": "ingest-tok" } }))).toBe(true);
    expect(checkIngestAuth(reqWith({ headers: { authorization: "Bearer cron-tok" } }))).toBe(true);
    expect(checkAdminAuth(reqWith({ headers: { "x-dreamme-secret": "ingest-tok" } }))).toBe(true);
    expect(checkIngestAuth(reqWith({ headers: { "x-dreamme-secret": "wrong" } }))).toBe(false);
  });

  it("accepts signed-in people; viewers are refused by the admin check", () => {
    stub();
    const admin = reqWith({ cookie: cookieFor(newGoogleSession("admin@example.test")) });
    const viewer = reqWith({ cookie: cookieFor(newGoogleSession("viewer@example.test")) });
    const stranger = reqWith({ cookie: cookieFor(newGoogleSession("stranger@example.test")) });
    const forged = reqWith({ cookie: cookieFor(newGoogleSession("admin@example.test"), "not-the-secret") });
    expect(checkIngestAuth(admin)).toBe(true);
    expect(checkAdminAuth(admin)).toBe(true);
    expect(checkIngestAuth(viewer)).toBe(true);
    expect(checkAdminAuth(viewer)).toBe(false);
    expect(checkIngestAuth(stranger)).toBe(false);
    expect(checkIngestAuth(forged)).toBe(false);
    expect(requestAccount(viewer)).toMatchObject({ kind: "google", role: "user" });
  });

  it("only bypasses sign-in in next dev on a loopback host", () => {
    stub();
    const local = reqWith({ url: "http://localhost:3000/api/x", headers: { host: "localhost:3000" } });
    expect(devBypassActive(local)).toBe(false); // NODE_ENV is "test"
    vi.stubEnv("NODE_ENV", "development");
    expect(devBypassActive(local)).toBe(true);
    expect(devBypassActive(reqWith({ url: "http://localhost:3000/api/x", headers: { host: "evil.test" } }))).toBe(false);
    expect(devBypassActive(reqWith({ url: "https://dash.example.test/api/x" }))).toBe(false);
    vi.stubEnv("DAD_DEV_AUTH", "real");
    expect(devBypassActive(local)).toBe(false);
  });
});

describe("Google ID token claims", () => {
  const good = {
    iss: "https://accounts.google.com",
    aud: "client-1",
    exp: 2000,
    nonce: "n1",
    email: "Admin@Example.test",
    email_verified: true,
  };
  const o = { clientId: "client-1", nonce: "n1", now: 1000 };
  it("accepts a matching token and lower-cases the email", () => {
    expect(checkGoogleIdClaims(good, o)).toEqual({ email: "admin@example.test" });
  });
  it.each([
    ["issuer", { iss: "https://evil.test" }],
    ["audience", { aud: "someone-else" }],
    ["expiry", { exp: 999 }],
    ["nonce", { nonce: "other" }],
    ["unverified email", { email_verified: false }],
    ["missing email", { email: undefined }],
  ])("rejects a bad %s", (_n, patch) => {
    expect(checkGoogleIdClaims({ ...good, ...patch }, o)).toHaveProperty("error");
  });
  it("rejects nothing at all", () => {
    expect(checkGoogleIdClaims(null, o)).toHaveProperty("error");
  });
});

describe("helpers", () => {
  it("keeps sign-in redirects on this site", () => {
    expect(safeNext("/?tab=experiments")).toBe("/?tab=experiments");
    expect(safeNext("//evil.test")).toBe("/");
    expect(safeNext("/\\evil.test")).toBe("/");
    expect(safeNext("https://evil.test")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("/x\ny")).toBe("/");
  });

  it("writes HttpOnly, SameSite=Lax cookies and reads them back", () => {
    const c = serializeCookie("a", "b c", { maxAge: 60, secure: true });
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).toContain("Max-Age=60");
    expect(readCookie(reqWith({ cookie: "x=1; a=b%20c" }), "a")).toBe("b c");
    expect(readCookie(reqWith({ cookie: "x=1" }), "a")).toBeNull();
  });

  it("makes Claude keys that hash stably and look like keys", () => {
    const k = newClaudeKey();
    expect(looksLikeClaudeKey(k)).toBe(true);
    expect(looksLikeClaudeKey("dadck_short")).toBe(false);
    expect(looksLikeClaudeKey(null)).toBe(false);
    expect(hashClaudeKey(k)).toBe(hashClaudeKey(` ${k} `));
    expect(hashClaudeKey(k)).not.toBe(hashClaudeKey(newClaudeKey()));
  });
});
