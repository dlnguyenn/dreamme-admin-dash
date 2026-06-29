// SKAdNetwork postback signature verification.
//
// Apple signs the winning install-validation postback with ECDSA (P-256) over a
// SHA-256 hash of a version-specific concatenation of fields, joined by the
// invisible-separator character U+2063. We rebuild that exact string and verify
// the base64 `attribution-signature` against Apple's published public key.
//
// Field order + the P-256 key are reproduced from Apple's spec
// (https://developer.apple.com/documentation/storekit/skadnetwork/verifying_an_install-validation_postback)
// and cross-checked against the whisk/skadnetwork reference validator.
//
// IMPORTANT: getting the field list / separator wrong makes EVERY signature
// fail, so the per-version lists below are deliberately verbatim. Absent fields
// are skipped (Apple omits them from the signed string, not blanked).

import crypto from "node:crypto";

// Apple's NIST P-256 public key, used for SKAdNetwork versions 2.1, 2.2, 3.0, 4.0.
// (Versions 1.0/2.0 used a P-192 key that modern crypto stacks reject; those
// versions are effectively dead, so we treat them as unsupported.)
const APPLE_P256_SPKI_B64 =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdp8GPcGqmhgzEFj9Z2nSpQVddayaPe4FMzqM9wib1+aHaaIzoHoLN9zW4K8y4SPykE3YVK3sVqW6Af0lfx3gg==";

const SEPARATOR = "⁣"; // invisible separator — Apple's field delimiter

function applePublicKeyPem(): string {
  const wrapped = APPLE_P256_SPKI_B64.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

// Ordered field names that compose the signed string, per postback version.
// `source-app-id` / `source-domain` are mutually exclusive in 4.0 — whichever is
// present is included at that position.
function signableFieldNames(version: string): string[] | null {
  switch (version) {
    case "4.0":
      return [
        "version",
        "ad-network-id",
        "source-identifier",
        "app-id",
        "transaction-id",
        "redownload",
        "source-app-id",
        "source-domain",
        "fidelity-type",
        "did-win",
        "postback-sequence-index",
      ];
    case "3.0":
      return [
        "version",
        "ad-network-id",
        "campaign-id",
        "app-id",
        "transaction-id",
        "redownload",
        "source-app-id",
        "fidelity-type",
        "did-win",
      ];
    case "2.2":
      return [
        "version",
        "ad-network-id",
        "campaign-id",
        "app-id",
        "transaction-id",
        "redownload",
        "source-app-id",
        "fidelity-type",
      ];
    case "2.1":
      return [
        "version",
        "ad-network-id",
        "campaign-id",
        "app-id",
        "transaction-id",
        "redownload",
        "source-app-id",
      ];
    default:
      return null; // 1.0 / 2.0 / unknown -> unsupported
  }
}

function formatPart(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(Math.trunc(value));
  return String(value);
}

/** Rebuild the exact string Apple signed for this postback version. */
export function signableString(
  params: Record<string, unknown>,
  version: string,
): string | null {
  const names = signableFieldNames(version);
  if (!names) return null;
  const parts: string[] = [];
  for (const name of names) {
    if (!(name in params) || params[name] == null) continue; // skip absent
    parts.push(formatPart(params[name]));
  }
  return parts.join(SEPARATOR);
}

export type SignatureStatus =
  | "valid"
  | "invalid"
  | "unsupported_version"
  | "error";

/**
 * Verify a SKAdNetwork postback's `attribution-signature`. Returns a status
 * rather than throwing so the collector can store-and-flag every postback.
 */
export function verifySkanSignature(
  params: Record<string, unknown>,
): SignatureStatus {
  try {
    const version = String(params["version"] ?? "");
    const message = signableString(params, version);
    if (message == null) return "unsupported_version";

    const sigB64 = params["attribution-signature"];
    if (typeof sigB64 !== "string" || sigB64.length === 0) return "invalid";
    const signature = Buffer.from(sigB64, "base64");

    const ok = crypto.verify(
      "sha256",
      Buffer.from(message, "utf8"),
      { key: applePublicKeyPem(), dsaEncoding: "der" },
      signature,
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "error";
  }
}
