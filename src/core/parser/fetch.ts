import { request } from "undici";
import { ParseSpecError } from "./errors";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_SPEC_BYTES = 10 * 1024 * 1024;

// Destroying an unread body emits an abort error; swallow it.
function drop(body: { on(e: string, f: () => void): unknown; destroy(): unknown }) {
  body.on("error", () => {});
  body.destroy();
}

export async function fetchSpecText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_SPEC_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await request(url, { method: "GET", signal });
    if (res.statusCode >= 400) {
      drop(res.body);
      throw new ParseSpecError("FETCH_FAILED", `Fetching spec failed with HTTP ${res.statusCode}`);
    }
    const declared = Number(res.headers["content-length"]);
    if (declared > maxBytes) {
      drop(res.body);
      throw new ParseSpecError("TOO_LARGE", `Spec is larger than ${maxBytes} bytes`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        drop(res.body);
        throw new ParseSpecError("TOO_LARGE", `Spec is larger than ${maxBytes} bytes`);
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (err) {
    if (err instanceof ParseSpecError) throw err;
    if (signal.aborted) {
      throw new ParseSpecError("FETCH_TIMEOUT", `Fetching spec timed out after ${timeoutMs} ms`);
    }
    throw new ParseSpecError("FETCH_FAILED", `Fetching spec failed: ${(err as Error).message}`);
  }
}
