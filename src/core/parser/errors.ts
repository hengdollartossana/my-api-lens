export type ParseErrorCode =
  | "FETCH_FAILED"
  | "FETCH_TIMEOUT"
  | "TOO_LARGE"
  | "INVALID_SPEC"
  | "UNSUPPORTED_VERSION";

export class ParseSpecError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ParseSpecError";
  }
}
