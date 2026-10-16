import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption helpers for secrets at rest.
 *
 * SERVER ONLY: the plaintext values handled here must never reach the client;
 * use `mask`/`last4` for anything shown in the UI.
 */

/** Encrypted payload; every field is base64. Maps 1:1 to a `secrets` row. */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const MASK = "\u2022\u2022\u2022\u2022"; // ••••

/** Reads ENCRYPTION_KEY (base64, must decode to exactly 32 bytes) with clear errors. */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be base64 that decodes to exactly ${KEY_BYTES} bytes, got ${key.length}. ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

/** Encrypts UTF-8 text with AES-256-GCM and a fresh random IV. */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypts an EncryptedPayload back to UTF-8 text.
 * Throws when the key is wrong or the payload was tampered with (GCM auth failure).
 */
export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(), // verifies the auth tag
  ]);
  return plaintext.toString("utf8");
}

/** Last 4 characters of a value; "" when too short to safely expose anything. */
export function last4(value: string): string {
  return value.length > 4 ? value.slice(-4) : "";
}

/** Masked form for the UI: "••••last4". Values of 4 chars or fewer are fully masked. */
export function mask(value: string): string {
  return `${MASK}${last4(value)}`;
}
