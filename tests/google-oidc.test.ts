/**
 * OIDC verification for the Gmail push endpoint.
 *
 * The signature path is tested for real: generate an RSA keypair, serve its
 * public half as a mock Google JWKS, sign a JWT, verify. That exercises the
 * exact WebCrypto path production uses — a stubbed "verify returned true"
 * would prove nothing about base64url handling or key import.
 */
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimProblem, verifyGoogleOidc } from "@/lib/vendors/google-oidc";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-key" } as {
  kty: string;
  n: string;
  e: string;
  kid: string;
};

const AUDIENCE = "https://dreamme-admin-dash.vercel.app/api/support/gmail-push";
const SA = "gmail-push-invoker@dreamme-479917.iam.gserviceaccount.com";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signToken(
  claims: Record<string, unknown>,
  opts?: { kid?: string; alg?: string },
): string {
  const header = b64url({
    alg: opts?.alg ?? "RS256",
    kid: opts?.kid ?? "test-key",
  });
  const payload = b64url(claims);
  const sig = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" })))
    .toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function goodClaims(): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    email: SA,
    email_verified: true,
  };
}

describe("verifyGoogleOidc", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ keys: [JWK] }),
      })),
    );
  });

  it("accepts a well-signed token with correct claims", async () => {
    const claims = await verifyGoogleOidc(signToken(goodClaims()), {
      audience: AUDIENCE,
      email: SA,
    });
    expect(claims.email).toBe(SA);
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    const token = signToken(goodClaims());
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url({ ...goodClaims(), email: "attacker@evil.example" })}.${s}`;
    await expect(
      verifyGoogleOidc(forged, { audience: AUDIENCE, email: SA }),
    ).rejects.toThrow(/bad signature/);
  });

  it("rejects an unknown signing key even after a JWKS refresh", async () => {
    const token = signToken(goodClaims(), { kid: "rotated-away" });
    await expect(
      verifyGoogleOidc(token, { audience: AUDIENCE, email: SA }),
    ).rejects.toThrow(/no matching Google key/);
  });

  it("rejects non-RS256 algorithms outright", async () => {
    const token = signToken(goodClaims(), { alg: "none" });
    await expect(
      verifyGoogleOidc(token, { audience: AUDIENCE, email: SA }),
    ).rejects.toThrow(/unexpected alg/);
  });
});

describe("claimProblem", () => {
  const expected = { audience: AUDIENCE, email: SA };
  const now = Date.now();

  it("passes valid claims", () => {
    expect(
      claimProblem(goodClaims() as never, expected, now),
    ).toBeNull();
  });

  it.each([
    ["wrong issuer", { iss: "https://evil.example" }, /issuer/],
    ["wrong audience", { aud: "https://other.example/hook" }, /audience/],
    ["expired", { exp: Math.floor(now / 1000) - 3600 }, /expired/],
    ["wrong caller", { email: "someone-else@dreamme-479917.iam.gserviceaccount.com" }, /caller/],
    ["unverified email", { email_verified: false }, /caller/],
  ])("rejects %s", (_name, override, pattern) => {
    const claims = { ...goodClaims(), ...override };
    expect(claimProblem(claims as never, expected, now)).toMatch(pattern);
  });
});
