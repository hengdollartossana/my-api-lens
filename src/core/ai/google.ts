import { estimateCostUsd } from "./pricing";
import { AiError, type AiProvider, type AiRequest, type AiResult } from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const TIMEOUT_MS = 90_000;

export interface GoogleProviderOptions {
  apiKey: string;
  model: string;
  /** For tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

/** Finish reasons where the model declined or was filtered, rather than finished. */
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

function httpError(status: number, body: unknown): AiError {
  const err = (body as { error?: { status?: string; message?: string } } | null)?.error;
  const message = err?.message ?? `Google AI request failed (HTTP ${status})`;
  const code = err?.status ?? "";
  if (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
    /api key/i.test(message)
  )
    return new AiError("AUTH", "The API key was rejected");
  if (status === 429)
    return new AiError("RATE_LIMIT", "Rate limited or quota used up, try again later");
  if (status === 400 || status === 404) return new AiError("BAD_REQUEST", message);
  return new AiError("UNAVAILABLE", message);
}

/** Google AI Studio (Gemini API) over plain REST: no SDK, the key goes in a header, never in the URL. */
export function createGoogleProvider(opts: GoogleProviderOptions): AiProvider {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  return {
    name: "google",
    model: opts.model,
    async complete(req: AiRequest): Promise<AiResult> {
      let res: Response;
      try {
        res = await doFetch(
          `${base}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
            body: JSON.stringify({
              ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
              contents: [{ role: "user", parts: [{ text: req.prompt }] }],
              generationConfig: { maxOutputTokens: req.maxTokens ?? 4096 },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch (e) {
        const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
        throw new AiError(
          "UNAVAILABLE",
          timedOut ? "Google AI did not answer in time" : "Could not reach Google AI",
        );
      }
      const body = (await res.json().catch(() => null)) as GeminiResponse | null;
      if (!res.ok) throw httpError(res.status, body);

      const candidate = body?.candidates?.[0];
      if (
        body?.promptFeedback?.blockReason ||
        (candidate?.finishReason && BLOCKED.has(candidate.finishReason))
      )
        throw new AiError("REFUSED", "The model declined this request");

      const text = (candidate?.content?.parts ?? [])
        .flatMap((p) => (p.thought || typeof p.text !== "string" ? [] : [p.text]))
        .join("");
      const u = body?.usageMetadata;
      // Thinking tokens are billed as output.
      const usage = {
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
      };
      return {
        text,
        model: body?.modelVersion ?? opts.model,
        usage,
        costUsd: estimateCostUsd(opts.model, usage),
      };
    },
  };
}
