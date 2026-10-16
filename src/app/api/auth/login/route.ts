import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createSessionToken,
  getSessionCookieOptions,
  recordRateLimitAttempt,
  resetRateLimit,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  // Extract client IP for rate limiting
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : request.headers.get("x-real-ip") || "127.0.0.1";

  // Enforce rate limit (5 tries / 5 min)
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_MANY_REQUESTS",
          message: `Too many login attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON request body" } },
      { status: 400 },
    );
  }

  const password =
    typeof body === "object" && body !== null && "password" in body
      ? String((body as { password: unknown }).password)
      : "";

  if (!password) {
    recordRateLimitAttempt(ip);
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Password is required" } },
      { status: 400 },
    );
  }

  const isValid = verifyPassword(password);
  if (!isValid) {
    recordRateLimitAttempt(ip);
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid password" } },
      { status: 401 },
    );
  }

  // Password is valid: reset rate limit and issue JWT session cookie
  resetRateLimit(ip);
  const token = await createSessionToken({ authenticated: true });
  const cookieOptions = getSessionCookieOptions();

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...cookieOptions,
    value: token,
  });

  return response;
}
