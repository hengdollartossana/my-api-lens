import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const specSourceEnum = pgEnum("spec_source", ["url", "file"]);
export const secretKindEnum = pgEnum("secret_kind", ["api_token", "password", "ai_key", "other"]);
export const authRecipeTypeEnum = pgEnum("auth_recipe_type", [
  "none",
  "static_bearer",
  "api_key",
  "login_flow",
]);
export const moduleViaEnum = pgEnum("module_via", [
  "tag",
  "path",
  "operation_id",
  "auth",
  "ai",
  "manual",
  "ungrouped",
]);
export const moduleStatusEnum = pgEnum("module_status", ["draft", "needs_review", "approved"]);
export const runStatusEnum = pgEnum("run_status", ["running", "done", "failed", "cancelled"]);
export const severityEnum = pgEnum("severity", ["ok", "info", "warn", "error"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const projects = pgTable("projects", {
  id: id(),
  name: text("name").notNull(),
  specSource: specSourceEnum("spec_source").notNull(),
  specUrl: text("spec_url"),
  specRaw: jsonb("spec_raw"),
  specHash: text("spec_hash"),
  lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
  ...timestamps,
});

export const environments = pgTable(
  "environments",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    isProd: boolean("is_prod").notNull().default(false),
    defaultHeaders: jsonb("default_headers").$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("environments_project_name_uq").on(t.projectId, t.name)],
);

export const secrets = pgTable("secrets", {
  id: id(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  kind: secretKindEnum("kind").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  last4: text("last4").notNull(),
  ...timestamps,
});

export const authRecipes = pgTable("auth_recipes", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // null = applies to all environments
  environmentId: uuid("environment_id").references(() => environments.id, { onDelete: "cascade" }),
  type: authRecipeTypeEnum("type").notNull(),
  config: jsonb("config").notNull().default({}),
  secretId: uuid("secret_id").references(() => secrets.id, { onDelete: "set null" }),
  ...timestamps,
});

export const modules = pgTable(
  "modules",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    via: moduleViaEnum("via").notNull(),
    status: moduleStatusEnum("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedHash: text("approved_hash"),
    ...timestamps,
  },
  (t) => [uniqueIndex("modules_project_name_uq").on(t.projectId, t.name)],
);

export const endpoints = pgTable(
  "endpoints",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
    stableKey: text("stable_key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    operationId: text("operation_id"),
    summary: text("summary"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    parameters: jsonb("parameters"),
    requestBodySchema: jsonb("request_body_schema"),
    // keyed by HTTP status
    responseSchemas: jsonb("response_schemas"),
    security: jsonb("security"),
    isDestructive: boolean("is_destructive").notNull().default(false),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("endpoints_project_stable_key_uq").on(t.projectId, t.stableKey),
    index("endpoints_module_idx").on(t.moduleId),
  ],
);

// Manual regrouping that survives re-import.
export const moduleOverrides = pgTable(
  "module_overrides",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    moduleName: text("module_name").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("module_overrides_project_key_uq").on(t.projectId, t.stableKey)],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("runs_project_started_idx").on(t.projectId, t.startedAt)],
);

export const runResults = pgTable(
  "run_results",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    request: jsonb("request"),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    responseHeaders: jsonb("response_headers"),
    responseBody: text("response_body"),
    diff: jsonb("diff"),
    severity: severityEnum("severity").notNull().default("ok"),
    // Set when the endpoint was not called (e.g. destructive without confirmation).
    skipReason: text("skip_reason"),
    // Transport-level failure (timeout, network, blocked); no HTTP status in that case.
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("run_results_run_idx").on(t.runId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});
