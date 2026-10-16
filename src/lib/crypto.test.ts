import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { decrypt, type EncryptedPayload, encrypt, last4, mask } from "./crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

function setKey(key: string | undefined) {
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
}

/** Flip one byte of a base64 string's decoded bytes, then re-encode. */
function tamperBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[bytes.length - 1] ^= 0xff;
  return bytes.toString("base64");
}

describe("encrypt/decrypt", () => {
  it("round-trips a secret", () => {
    setKey(KEY_A);
    const value = "sk_live_abcd1234efgh5678";
    const payload = encrypt(value);
    expect(decrypt(payload)).toBe(value);
  });

  it("round-trips unicode values", () => {
    setKey(KEY_A);
    const value = "pässwörd-🔑-tökèn";
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it("produces base64 fields and never embeds the plaintext", () => {
    setKey(KEY_A);
    const value = "super-secret-token";
    const payload = encrypt(value);
    for (const field of ["ciphertext", "iv", "authTag"] as const) {
      expect(Buffer.from(payload[field], "base64").length).toBeGreaterThan(0);
      expect(payload[field]).not.toContain(value);
    }
  });

  it("uses a fresh IV per call", () => {
    setKey(KEY_A);
    const first = encrypt("same-input");
    const second = encrypt("same-input");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails on tampered ciphertext", () => {
    setKey(KEY_A);
    const payload = encrypt("super-secret-token");
    const tampered: EncryptedPayload = {
      ...payload,
      ciphertext: tamperBase64(payload.ciphertext),
    };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("fails on a tampered auth tag", () => {
    setKey(KEY_A);
    const payload = encrypt("super-secret-token");
    const tampered: EncryptedPayload = {
      ...payload,
      authTag: tamperBase64(payload.authTag),
    };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("fails with the wrong key", () => {
    setKey(KEY_A);
    const payload = encrypt("super-secret-token");
    setKey(KEY_B);
    expect(() => decrypt(payload)).toThrow();
  });

  it("throws a clear error when ENCRYPTION_KEY is missing", () => {
    setKey(undefined);
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => decrypt({ ciphertext: "eA", iv: "eA", authTag: "eA" })).toThrow(
      /ENCRYPTION_KEY is not set/,
    );
  });

  it("throws a clear error when ENCRYPTION_KEY decodes to the wrong length", () => {
    // 9 bytes, not 32
    setKey(Buffer.from("too-short", "utf8").toString("base64"));
    expect(() => encrypt("x")).toThrow(/exactly 32 bytes, got 9/);

    // the .env.example placeholder also decodes to the wrong length
    setKey("base64-encoded-32-bytes");
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY must be base64/);
  });
});

describe("mask", () => {
  it("masks everything but the last 4 characters", () => {
    expect(mask("super-secret-token")).toBe("••••oken");
    expect(last4("super-secret-token")).toBe("oken");
  });

  it("fully masks values of 4 characters or fewer", () => {
    expect(mask("abcd")).toBe("••••");
    expect(last4("abcd")).toBe("");
    expect(mask("ab")).toBe("••••");
    expect(last4("ab")).toBe("");
  });
});
