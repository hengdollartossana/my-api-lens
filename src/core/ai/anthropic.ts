import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd } from "./pricing";
import { AiError, type AiProvider, type AiRequest, type AiResult } from "./types";

/** The slice of the SDK client we use, so tests can pass a fake. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  client?: MessagesClient;
}

function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AiError("AUTH", "The API key was rejected");
  if (e instanceof Anthropic.RateLimitError)
    return new AiError("RATE_LIMIT", "Rate limited, try again later");
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError)
    return new AiError("BAD_REQUEST", e.message);
  return new AiError("UNAVAILABLE", e instanceof Error ? e.message : "AI request failed");
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): AiProvider {
  const client: MessagesClient =
    opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 });
  return {
    name: "anthropic",
    model: opts.model,
    async complete(req: AiRequest): Promise<AiResult> {
      let res: Anthropic.Message;
      try {
        res = await client.messages.create({
          model: opts.model,
          max_tokens: req.maxTokens ?? 4096,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.prompt }],
        });
      } catch (e) {
        throw toAiError(e);
      }
      if (res.stop_reason === "refusal")
        throw new AiError("REFUSED", "The model declined this request");
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      return {
        text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        model: res.model,
        usage,
        costUsd: estimateCostUsd(opts.model, usage),
      };
    },
  };
}
