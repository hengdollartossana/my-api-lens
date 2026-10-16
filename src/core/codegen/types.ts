export interface CodegenParameter {
  name: string;
  in: string;
  required: boolean;
  schema?: unknown;
}

export interface CodegenEndpoint {
  method: string;
  path: string;
  summary?: string | null;
  operationId?: string | null;
  parameters: CodegenParameter[];
  requestBodySchema: unknown | null;
  /** Keyed by HTTP status (or "2XX" / "default"). */
  responseSchemas: Record<string, unknown | null>;
  /** A real response seen in a run, used instead of the spec when `preferObserved` is set. */
  observed?: { status: number; body: unknown };
}

export interface CodegenModule {
  name: string;
  endpoints: CodegenEndpoint[];
}

export interface FlutterOptions {
  /** Prefer observed responses (nullability and extra fields) over the spec. */
  preferObserved?: boolean;
  /** Also generate `test/api/*_contract_test.dart` (http_mock_adapter) from recorded responses. */
  contractTests?: boolean;
  /** Dart package name used in the generated test imports. Default: `app`. */
  packageName?: string;
  /** Directory holding the .eta templates. Default: `<cwd>/templates/flutter`. */
  templatesDir?: string;
}

export interface GeneratedFile {
  /** Path relative to the Flutter package root, e.g. `lib/api/models/user.dart`. */
  path: string;
  content: string;
}
