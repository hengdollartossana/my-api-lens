export interface AiRequest {
  system?: string;
  prompt: string;
  /** Upper bound on generated tokens. Default 4096. */
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResult {
  text: string;
  model: string;
  usage: AiUsage;
  /** Estimated from the model's list price; 0 for models without a known price. */
  costUsd: number;
}

export type AiErrorCode = "AUTH" | "RATE_LIMIT" | "BAD_REQUEST" | "REFUSED" | "UNAVAILABLE";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** What the rest of the app depends on; Anthropic is one implementation. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(req: AiRequest): Promise<AiResult>;
}
