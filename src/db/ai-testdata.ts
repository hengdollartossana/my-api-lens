import {
  buildTestDataRequest,
  parseTestDataResponse,
  type TestDataEndpoint,
  type TestDataInput,
} from "@/core/ai";
import { type AiTestDeps, runAi } from "./ai";
import type { endpoints } from "./schema";

/**
 * SERVER ONLY: realistic request values for a run's endpoints. Sends parameter and body schemas
 * only. Any AI failure yields no values, so the run falls back to schema sampling.
 */

export interface TestDataResult {
  inputs: Map<string, TestDataInput>;
  costUsd: number;
  error: string | null;
}

export async function generateTestData(
  rows: (typeof endpoints.$inferSelect)[],
  deps?: AiTestDeps,
): Promise<TestDataResult> {
  const list: TestDataEndpoint[] = rows.map((r) => ({
    stableKey: r.stableKey,
    method: r.method,
    path: r.path,
    summary: r.summary,
    parameters: (r.parameters as TestDataEndpoint["parameters"]) ?? [],
    requestBodySchema: r.requestBodySchema ?? null,
  }));
  try {
    const res = await runAi("test-data", buildTestDataRequest(list), deps);
    return { inputs: parseTestDataResponse(res.text, list), costUsd: res.costUsd, error: null };
  } catch (e) {
    return { inputs: new Map(), costUsd: 0, error: (e as Error).message };
  }
}
