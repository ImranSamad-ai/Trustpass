// Prints a new Ed25519 signing key for PASSPORT_SIGNING_KEY. Run: node keygen.mjs
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
console.log(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"));
console.error("\nSet the line above as PASSPORT_SIGNING_KEY on your host. Keep it secret; never commit it.");
