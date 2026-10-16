import type { ExecResult } from "./types";

export type Severity = "ok" | "info" | "warn" | "error";

export const SKIP_DESTRUCTIVE = "destructive_unconfirmed";

/** Destructive endpoints (anything but GET/HEAD/OPTIONS) only run when confirmed. */
export function skipReason(
  endpoint: { isDestructive: boolean },
  opts: { confirmDestructive?: boolean },
): string | null {
  return endpoint.isDestructive && !opts.confirmDestructive ? SKIP_DESTRUCTIVE : null;
}

/** Coarse severity from the HTTP outcome alone; diffing (T-20/T-21) refines it later. */
export function severityFor(res: Pick<ExecResult, "status" | "error">): Severity {
  if (res.error || res.status === null) return "error";
  if (res.status >= 500) return "error";
  if (res.status >= 400) return "warn";
  return "ok";
}

export const MAX_CONCURRENCY = 4;

export function clampConcurrency(n: number | undefined): number {
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(n ?? 1)));
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight, starting items in order.
 * Stops starting new items once `signal` aborts; in-flight ones finish.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (!signal.aborted && next < items.length) {
      const i = next++;
      await worker(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: clampConcurrency(concurrency) }, lane));
}
