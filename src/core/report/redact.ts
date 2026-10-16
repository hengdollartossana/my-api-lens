/**
 * Reports are meant to be shared, so values that look like credentials never leave the app:
 * anything under a sensitive-looking field name, and anything shaped like a JWT, a Bearer token
 * or a long opaque secret.
 */
export const REDACTED = "[REDACTED]";
export const MAX_VALUE_CHARS = 200;

const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|auth|api[-_]?key|apikey|cookie|session|jwt|credential|private[-_]?key|bearer)/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i;
const LONG_SECRET = /^[A-Za-z0-9+/_=-]{32,}$/;

function looksSecret(text: string): boolean {
  return JWT.test(text) || BEARER.test(text) || LONG_SECRET.test(text);
}

/** Last property name in a JSON path like `$.data.accessToken` or `$[0].items[2]`. */
function lastKey(path: string): string {
  const m = path.match(/\.([^.[\]]+)(?:\[\d+\])*$/);
  return m?.[1] ?? "";
}

function scrub(v: unknown): unknown {
  if (typeof v === "string") return looksSecret(v) ? REDACTED : v;
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : scrub(val)]),
    );
  }
  return v;
}

/** Show a value safely: redact credentials, then cut it to a readable length. */
export function safeValue(path: string, value: unknown): string {
  const redacted = SENSITIVE_KEY.test(lastKey(path)) ? REDACTED : scrub(value);
  const text = typeof redacted === "string" ? redacted : (JSON.stringify(redacted) ?? "");
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

/** A message may quote a value (e.g. an enum), so it is scrubbed too. */
export function safeText(text: string): string {
  const cut = text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
  return cut.replace(JWT, REDACTED).replace(BEARER, REDACTED);
}
