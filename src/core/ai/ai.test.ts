import { describe, expect, it } from "vitest";
import {
  createAnthropicProvider,
  createGoogleProvider,
  estimateCostUsd,
  type MessagesClient,
} from "./index";

const fakeClient = (over: Record<string, unknown> = {}): MessagesClient => ({
  messages: {
    create: async () =>
      ({
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1000, output_tokens: 500 },
        ...over,
      }) as never,
  },
});

describe("estimateCostUsd", () => {
  it("prices tokens per million", () => {
    expect(
      estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(12);
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 1000, outputTokens: 500 })).toBe(
      0.014,
    );
  });
  it("is 0 for an unknown model", () => {
    expect(estimateCostUsd("custom", { inputTokens: 10, outputTokens: 10 })).toBe(0);
  });
});

describe("anthropic provider", () => {
  it("returns text, tokens and cost", async () => {
    const p = createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      client: fakeClient(),
    });
    expect(await p.complete({ prompt: "hi" })).toEqual({
      text: "ok",
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 1000, outputTokens: 500 },
      costUsd: 0.007,
    });
  });

  it("maps a refusal to an AiError", async () => {
    const p = createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      client: fakeClient({ stop_reason: "refusal" }),
    });
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ code: "REFUSED" });
  });

  it("wraps transport errors", async () => {
    const client: MessagesClient = {
      messages: {
        create: async () => {
          throw new Error("boom");
        },
      },
    };
    const p = createAnthropicProvider({ apiKey: "k", model: "claude-sonnet-5-5", client });
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("google provider", () => {
  const ok = {
    candidates: [{ content: { parts: [{ text: "o" }, { text: "k" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
    modelVersion: "gemini-3.8-flash",
  };
  const fetchOf = (status: number, body: unknown) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;

  it("sends the key in a header and reads text, tokens (thinking counts as output) and cost", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchMock = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json(ok);
    }) as unknown as typeof fetch;
    const p = createGoogleProvider({
      apiKey: "AIza-secret",
      model: "gemini-3.8-flash",
      fetch: fetchMock,
    });
    const r = await p.complete({ system: "be brief", prompt: "hi", maxTokens: 500 });
    expect(r).toEqual({
      text: "ok",
      model: "gemini-3.8-flash",
      usage: { inputTokens: 1000, outputTokens: 500 },
      costUsd: 0.00525,
    });
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(s.url).not.toContain("AIza");
    expect((s.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-secret");
    const body = JSON.parse(s.init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("be brief");
    expect(body.generationConfig.maxOutputTokens).toBe(500);
  });

  it("maps failures to typed errors without leaking the key", async () => {
    const make = (status: number, error: object) =>
      createGoogleProvider({
        apiKey: "AIza-secret",
        model: "m",
        fetch: fetchOf(status, { error }),
      });
    await expect(
      make(400, {
        status: "INVALID_ARGUMENT",
        message: "API key not valid. Please pass a valid API key.",
      }).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ code: "AUTH", message: "The API key was rejected" });
    await expect(
      make(403, { status: "PERMISSION_DENIED", message: "no" }).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ code: "AUTH" });
    await expect(
      make(429, { status: "RESOURCE_EXHAUSTED", message: "quota" }).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
    await expect(
      make(404, { message: "model not found" }).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "model not found" });
    await expect(make(503, { message: "busy" }).complete({ prompt: "x" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("treats blocked prompts and filtered answers as refusals", async () => {
    const blocked = createGoogleProvider({
      apiKey: "k",
      model: "m",
      fetch: fetchOf(200, { promptFeedback: { blockReason: "SAFETY" } }),
    });
    await expect(blocked.complete({ prompt: "x" })).rejects.toMatchObject({ code: "REFUSED" });
    const filtered = createGoogleProvider({
      apiKey: "k",
      model: "m",
      fetch: fetchOf(200, { candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }),
    });
    await expect(filtered.complete({ prompt: "x" })).rejects.toMatchObject({ code: "REFUSED" });
  });

  it("reports an unreachable network", async () => {
    const p = createGoogleProvider({
      apiKey: "k",
      model: "m",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Could not reach Google AI",
    });
  });
});
