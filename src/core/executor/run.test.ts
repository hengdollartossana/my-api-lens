import { describe, expect, it } from "vitest";
import { clampConcurrency, runPool, severityFor, skipReason } from "./index";

describe("skipReason", () => {
  it("skips destructive endpoints unless confirmed", () => {
    expect(skipReason({ isDestructive: false }, {})).toBeNull();
    expect(skipReason({ isDestructive: true }, {})).toBe("destructive_unconfirmed");
    expect(skipReason({ isDestructive: true }, { confirmDestructive: false })).toBe(
      "destructive_unconfirmed",
    );
    expect(skipReason({ isDestructive: true }, { confirmDestructive: true })).toBeNull();
  });
});

describe("severityFor", () => {
  it.each([
    [{ status: 200 }, "ok"],
    [{ status: 204 }, "ok"],
    [{ status: 404 }, "warn"],
    [{ status: 503 }, "error"],
    [{ status: null }, "error"],
    [{ status: 200, error: { code: "TIMEOUT" as const, message: "x" } }, "error"],
  ])("%j -> %s", (res, expected) => {
    expect(severityFor(res)).toBe(expected);
  });
});

describe("runPool", () => {
  it("clamps concurrency to 1..4", () => {
    expect([undefined, 0, 2.9, 10].map(clampConcurrency)).toEqual([1, 1, 2, 4]);
  });

  it("never exceeds the concurrency limit and visits every item", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, new AbortController().signal, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      active--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("is sequential by default and stops starting items after abort", async () => {
    const ctrl = new AbortController();
    const seen: number[] = [];
    await runPool([1, 2, 3, 4], 1, ctrl.signal, async (n) => {
      seen.push(n);
      if (n === 2) ctrl.abort();
    });
    expect(seen).toEqual([1, 2]);
  });
});
