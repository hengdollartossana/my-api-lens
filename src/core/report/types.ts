export interface ReportItem {
  kind: string;
  severity: "error" | "warn" | "info";
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ReportEndpoint {
  module: string;
  method: string;
  path: string;
  environment: string;
  isProd: boolean;
  /** ISO timestamp of the run the comparison came from. */
  ranAt: string;
  statusCode: number | null;
  items: ReportItem[];
}

export interface ReportInput {
  project: string;
  /** ISO timestamp shown in the header (passed in so output is deterministic). */
  generatedAt: string;
  endpoints: ReportEndpoint[];
}

export interface Report {
  markdown: string;
  html: string;
  summary: ReportSummary;
}

export interface ReportSummary {
  errors: number;
  warnings: number;
  info: number;
  endpointsCompared: number;
  endpointsMatching: number;
}
