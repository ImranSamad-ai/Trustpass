/**
 * Signed passports: an Ed25519 signature over a canonical JSON form of the
 * passport claims, so any service holding the public key can verify a passport
 * offline, until it expires.
 *
 * Canonical form: the claims object with keys sorted alphabetically,
 * serialized with JSON.stringify (no whitespace), as UTF-8.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { Evidence, PassportStatus, Tier, TrustPassport } from "./passport.js";

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // Ed25519 SubjectPublicKeyInfo header

export interface PassportClaims {
  v: 1;
  agentId: string;
  score: number;
  tier: Tier;
  status: PassportStatus;
  successfulSpends: number;
  cleanVolumeUsd: number;
  verifiedSpends: number;
  evidence: Evidence;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedPassport {
  passport: PassportClaims;
  signature: string; // base64url, 64 bytes
  alg: "Ed25519";
  kid: string;
}

export function canonicalize(claims: object): string {
  const o = claims as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

export function claimsFor(p: TrustPassport, nowMs: number, ttlHours: number): PassportClaims {
  return {
    v: 1,
    agentId: p.grantId,
    score: p.score,
    tier: p.tier,
    status: p.status,
    successfulSpends: p.successfulSpends,
    cleanVolumeUsd: p.cleanVolumeUsd,
    verifiedSpends: p.verifiedSpends,
    evidence: p.evidence,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlHours * 3_600_000).toISOString(),
  };
}

export class Signer {
  /** True when no key was configured, so the key changes on every restart. */
  readonly ephemeral: boolean;
  readonly publicKey: string; // raw 32-byte key, base64url
  readonly publicKeyPem: string;
  readonly kid: string;
  private priv: KeyObject;

  /** `privateKeyB64`: base64 of a PKCS8 DER Ed25519 private key (see keygen.mjs). */
  constructor(privateKeyB64?: string) {
    if (privateKeyB64) {
      try {
        this.priv = createPrivateKey({ key: Buffer.from(privateKeyB64.trim(), "base64"), format: "der", type: "pkcs8" });
      } catch {
        throw new Error("PASSPORT_SIGNING_KEY must be a base64-encoded PKCS8 Ed25519 private key (run keygen.mjs)");
      }
      this.ephemeral = false;
    } else {
      this.priv = generateKeyPairSync("ed25519").privateKey;
      this.ephemeral = true;
    }
    const pub = createPublicKey(this.priv);
    const raw = (pub.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
    this.publicKey = raw.toString("base64url");
    this.publicKeyPem = pub.export({ format: "pem", type: "spki" }) as string;
    this.kid = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  sign(p: TrustPassport, nowMs: number, ttlHours = 24): SignedPassport {
    const passport = claimsFor(p, nowMs, ttlHours);
    const signature = sign(null, Buffer.from(canonicalize(passport)), this.priv).toString("base64url");
    return { passport, signature, alg: "Ed25519", kid: this.kid };
  }
}

/** Reference verifier: what a third party does with only the public key. */
export function verifySigned(
  doc: { passport: PassportClaims; signature: string },
  publicKeyB64url: string,
  nowMs = Date.now(),
): { signatureValid: boolean; expired: boolean } {
  const raw = Buffer.from(publicKeyB64url, "base64url");
  if (raw.length !== 32) throw new Error("public key must be 32 raw bytes, base64url");
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
  const signatureValid = verify(null, Buffer.from(canonicalize(doc.passport)), key, Buffer.from(doc.signature, "base64url"));
  return { signatureValid, expired: nowMs > Date.parse(doc.passport.expiresAt) };
}
