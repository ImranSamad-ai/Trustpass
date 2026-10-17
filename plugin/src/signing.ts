import { createPublicKey, verify } from "node:crypto";

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // Ed25519 SubjectPublicKeyInfo header

/** Canonical form signed by the passport service: keys sorted, no whitespace. */
export function canonicalize(claims: object): string {
  const o = claims as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

/** Offline Ed25519 check. `publicKey` is the raw 32-byte key, base64url. */
export function signatureMatches(claims: object, signature: string, publicKey: string): boolean {
  const raw = Buffer.from(publicKey, "base64url");
  if (raw.length !== 32) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonicalize(claims)), key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
