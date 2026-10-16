interface RateLimitEntry {
  attempts: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();

export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const RATE_LIMIT_MAX_ATTEMPTS = 5;

/**
 * Check if the given identifier (e.g. IP address) is allowed to attempt login.
 * Prunes timestamps older than 5 minutes.
 */
export function checkRateLimit(
  identifier: string,
  now = Date.now(),
): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  const entry = rateLimitMap.get(identifier);
  if (!entry) {
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_ATTEMPTS,
      retryAfterSeconds: 0,
    };
  }

  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recentAttempts = entry.attempts.filter((ts) => ts > windowStart);
  entry.attempts = recentAttempts;

  if (recentAttempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = recentAttempts[0];
    const retryAfterMs = Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_ATTEMPTS - recentAttempts.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Record a login attempt for the given identifier.
 */
export function recordRateLimitAttempt(identifier: string, now = Date.now()): void {
  const entry = rateLimitMap.get(identifier) || { attempts: [] };
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  entry.attempts = entry.attempts.filter((ts) => ts > windowStart);
  entry.attempts.push(now);
  rateLimitMap.set(identifier, entry);
}

/**
 * Reset rate limit for an identifier (e.g., after successful login).
 */
export function resetRateLimit(identifier: string): void {
  rateLimitMap.delete(identifier);
}

/**
 * Clear all rate limits (for test isolation).
 */
export function clearRateLimits(): void {
  rateLimitMap.clear();
}
