/** Browser-side helpers so every screen reads API errors the same way. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Route handlers answer errors as `{ error: { code, message } }`; fall back to a generic text. */
export function errorFromBody(body: unknown, status: number, fallback: string): ApiError {
  const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const message = typeof err?.message === "string" && err.message ? err.message : fallback;
  return new ApiError(message, status, typeof err?.code === "string" ? err.code : null);
}

/**
 * fetch + JSON with one error shape: a failed HTTP call throws an `ApiError` carrying the server's
 * message, and a network failure throws one saying the server could not be reached.
 */
export async function apiJson<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
  fallback = "Request failed",
): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Could not reach the server", 0, "NETWORK");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw errorFromBody(body, res.status, `${fallback} (HTTP ${res.status})`);
  return body as T;
}

/** The message to show a user for any thrown value. */
export const messageOf = (e: unknown, fallback = "Something went wrong") =>
  e instanceof Error && e.message ? e.message : fallback;
