import { describe, expect, it } from "vitest";
import { createAnthropicProvider, estimateCostUsd, type MessagesClient } from "./index";

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
