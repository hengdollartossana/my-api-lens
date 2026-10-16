import crypto from "node:crypto";

/**
 * Compare password with APP_PASSWORD using crypto.timingSafeEqual on SHA-256 digests.
 * SHA-256 digests are guaranteed to be 32 bytes each, avoiding length-dependent timing attacks
 * or buffer length mismatch exceptions in timingSafeEqual.
 */
export function verifyPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword || !password) {
    return false;
  }

  const expectedDigest = crypto.createHash("sha256").update(appPassword).digest();
  const actualDigest = crypto.createHash("sha256").update(password).digest();

  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}
