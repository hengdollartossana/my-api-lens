# API Lens — Task Plan

Rules: see `AGENTS.md`. Web app only. Each task is one GitHub issue / one branch / one PR.
This file is the **spec**. Live status lives in GitHub Issues — do not tick anything here.
`scripts/github/bootstrap.mjs` creates one issue per `### T-XX` section below, using its `Agent`, `Mode` and `Depends on` lines. Keep that line format.

Milestones
- M0 Foundation (T-01 → T-07)
- M1 Import & group (T-08 → T-12)
- M2 Run (T-13 → T-19)
- M3 Diff (T-20 → T-22)
- M4 Approve & context pack (T-23 → T-25)
- M5 Codegen — Flutter (T-26 → T-28)
- M6 AI add-on, optional (T-29 → T-31)
- M7 Hardening (T-32 → T-34)
- Later: SwiftUI codegen, drift monitoring, CLI

Mode: `manual` = owner opens the worktree and supervises the agent. `auto` = picked up by the lane's scheduled Orca automation.

---

## M0 — Foundation

### T-01 Scaffold Next.js app
Agent: claude · Mode: manual · Milestone: M0
Depends on: —
- Create Next.js (App Router, TS strict, `src/` dir) with pnpm. Tailwind v4, shadcn/ui init (dark theme, green primary).
- Install the **entire** runtime + dev dependency allowlist from AGENTS.md now (except the "Later" ones), so no later task touches `package.json`'s dependencies.
- Biome config (replace ESLint), Vitest config (node env for `src/core`), `tsconfig` path alias `@/*`.
- Create the folders from AGENTS.md with `index.ts` stubs in each `src/core/*`.
- Scripts: dev, build, start, test, lint, typecheck, check.
- `.env.example`: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/apilens`, `APP_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_PORT=3000`, `MOCK_API_PORT=4010`.

Acceptance
- `pnpm dev -p 3000` serves a placeholder page; `pnpm check` passes with one sample Vitest test.
- No ESLint/Prettier present; all allowlisted deps installed.

### T-02 Postgres + Drizzle setup
Agent: claude · Mode: manual · Milestone: M0
Depends on: T-01
- `docker-compose.yml` with top-level `name: apilens`, service named `postgres` (Postgres 16, user/password `postgres`, named volume, port 5432). Scripts `db:up`, `db:down`.
- `drizzle.config.ts` loads `.env` via dotenv; `src/db/client.ts` singleton pg Pool, safe for Next dev hot reload.
- Scripts `db:generate`, `db:migrate`, `db:studio`.
- Works with any database name in `DATABASE_URL` (each worktree uses its own `apilens_<workspace>` DB created by the Orca setup hook).

Acceptance
- `pnpm db:up && pnpm db:migrate` runs cleanly on an empty DB, including a non-default database name.
- `src/db/client.ts` exports a typed `db`.

### T-03 Database schema
Agent: claude · Mode: manual · Milestone: M0
Depends on: T-02
Tables (uuid PKs, `created_at`/`updated_at`):
- `projects`: name, spec_source (`url`|`file`), spec_url, spec_raw (jsonb), spec_hash, last_imported_at
- `environments`: project_id, name, base_url, is_prod, default_headers (jsonb)
- `secrets`: project_id (nullable), kind (`api_token`|`password`|`ai_key`|`other`), ciphertext, iv, auth_tag, last4
- `auth_recipes`: project_id, environment_id (nullable = all envs), type (`none`|`static_bearer`|`api_key`|`login_flow`), config (jsonb), secret_id
- `modules`: project_id, name, via (`tag`|`path`|`operation_id`|`auth`|`ai`|`manual`|`ungrouped`), status (`draft`|`needs_review`|`approved`), approved_at, approved_hash
- `endpoints`: project_id, module_id, stable_key, method, path, operation_id, summary, tags (text[]), parameters, request_body_schema, response_schemas (keyed by status), security, is_destructive, removed_at
- `module_overrides`: project_id, stable_key, module_name (survives re-import)
- `runs`: project_id, environment_id, module_id (nullable), status (`running`|`done`|`failed`|`cancelled`), started_at, finished_at
- `run_results`: run_id, endpoint_id, request (redacted), status_code, duration_ms, response_headers, response_body (truncated), diff, severity (`ok`|`info`|`warn`|`error`)
- `settings`: key (pk), value (jsonb)
- Indexes: unique (project_id, stable_key) on endpoints; unique (project_id, name) on modules and environments.

Acceptance
- Migration generated and applies cleanly; smoke test inserts and reads a project.

### T-04 Encryption helper
Agent: opencode · Mode: manual · Milestone: M0
Depends on: T-01
- `src/lib/crypto.ts`: AES-256-GCM `encrypt`, `decrypt`, `mask` ("••••last4"). Key from `ENCRYPTION_KEY` (32 bytes base64); clear error if missing or wrong length.
- `src/db/secrets.ts`: `saveSecret`, `readSecret` (server-only), `listSecretsMasked` (may land after T-03; stub types if T-03 is not merged yet and note it).

Acceptance
- Unit tests: roundtrip, tampered ciphertext fails, wrong key fails, mask output.

### T-05 Single-user auth
Agent: antigravity · Mode: manual · Milestone: M0
Depends on: T-01
- Login page (password only). Compare with `APP_PASSWORD` using `crypto.timingSafeEqual` on SHA-256 digests.
- Session: JWT (jose, HS256, `SESSION_SECRET`) in httpOnly, sameSite=lax cookie, 7-day expiry. Logout action.
- `GET /api/health` → `{ ok: true }` (public; used by reviewers and smoke tests).
- `middleware.ts` protects everything except `/login`, `/api/health`, static assets. API → 401 JSON, pages → redirect.
- Login rate limit (in-memory, 5 tries / 5 min).

Acceptance
- Unauthenticated page redirects to /login; unauthenticated API returns 401 JSON; `/api/health` returns 200 without login.
- Unit tests for token sign/verify and password compare.

### T-06 App shell UI
Agent: antigravity · Mode: manual · Milestone: M0
Depends on: T-05
- Layout: left sidebar (Projects, Runs, Settings), top bar with project + environment switchers (placeholder data), main content.
- Placeholder routes: `/projects`, `/projects/[id]`, `/projects/[id]/modules/[moduleId]`, `/projects/[id]/endpoints/[endpointId]`, `/projects/[id]/diff`, `/projects/[id]/pack`, `/projects/[id]/codegen`, `/runs`, `/settings`.
- Shared components: `StatusBadge`, `MethodBadge`, `ViaBadge`, `EmptyState`, `JsonViewer` (CodeMirror read-only).

Acceptance
- All routes render in the shell; dark default with light toggle; works at 1280px and 768px.

### T-07 Test fixtures
Agent: opencode · Mode: manual · Milestone: M0
Depends on: T-01
- `fixtures/specs/`: `petstore-v2.json`, `petstore-v3.yaml`, `messy-v3.json` (no tags, `/api/v1` prefix, `{tenant}` segment, controller-style operationIds, auth group with login/refresh/me, `$ref`-heavy schema, one endpoint returning an undocumented 409).
- `fixtures/mock-api/server.ts` (node:http, run with tsx) listening on `MOCK_API_PORT` (default 4010), implementing `messy-v3.json` with deliberate mismatches: missing required field, extra field, wrong type, unexpected null, undocumented status. Login returns a token; protected routes require Bearer.
- Script `mock:api`. Document each mismatch in `fixtures/mock-api/README.md`.
- Export a helper for tests to get the mock base URL from env.

Acceptance
- `MOCK_API_PORT=4123 pnpm mock:api` serves all endpoints on 4123; README lists each mismatch with its endpoint.

---

## M1 — Import & group

### T-08 core/parser
Agent: claude · Mode: auto · Milestone: M1
Depends on: T-07
- `parseSpec({ url } | { text, filename })` → `{ title, version, openapi, servers, securitySchemes, endpoints, specHash }`.
- swagger-parser validate + dereference; convert v2 into the same normalized form.
- `stableKey(method, path)`; `isDestructive` = not GET/HEAD/OPTIONS.
- URL fetch via undici, 10s timeout, 10 MB limit; YAML and JSON.

Acceptance
- All fixture specs parse with asserted endpoint counts; v2/v3 petstore normalize equivalently; invalid spec returns a typed error.

### T-09 core/grouper
Agent: claude · Mode: auto · Milestone: M1
Depends on: T-08
- Chain: manual override → first meaningful tag (ignore `default`, `api`) → first path segment after stripping `/api`, `/v\d+`, `{tenant}`-like params (nested stays with parent) → operationId prefix → auth heuristic (login, register, token, refresh, otp, password, me, no security) → `ungrouped`.
- Normalize: singular, Title Case, strip Controller/Api/Service.

Acceptance
- Table-driven tests for every rule and its priority using `messy-v3.json`; no endpoint left without a module.

### T-10 Import flow (API + UI)
Agent: claude · Mode: auto · Milestone: M1
Depends on: T-03, T-06, T-09
- `POST /api/projects/import` (URL or file, max 10 MB) → parse, group, persist in one transaction.
- `/projects`: list + "New project" dialog; inline parse errors. Show endpoint count, module count, last imported.

Acceptance
- Each fixture spec imports with expected modules; a broken spec shows an error and creates nothing.

### T-11 Module overview + manual regroup
Agent: antigravity · Mode: auto · Milestone: M1
Depends on: T-10
- `/projects/[id]`: module cards (name, ViaBadge, count, status); module detail lists endpoints.
- Move endpoint to another/new module → `module_overrides`, via=`manual`. Rename module. Filter by method, search by path.

Acceptance
- Overrides persist and survive re-import (verified in T-12).

### T-12 Re-import with change detection
Agent: claude · Mode: auto · Milestone: M1
Depends on: T-11
- Re-parse and compare by stable_key → new / removed (`removed_at`) / changed (schema hash) / moved.
- Approved module with any change → `needs_review`. Change summary dialog.

Acceptance
- Import, approve, re-import modified copy → correct counts, `needs_review`, overrides preserved.

---

## M2 — Run

### T-13 Environments + safety settings
Agent: antigravity · Mode: auto · Milestone: M2
Depends on: T-10
- CRUD environments (name, base_url, is_prod, default headers), prefilled from spec `servers`. Real env switcher.

Acceptance
- Invalid URL rejected; prod envs show a red badge everywhere.

### T-14 SSRF guard
Agent: opencode · Mode: manual · Milestone: M2
Depends on: T-01
- `assertAllowedTarget(url, envBaseUrl)`: http/https only; same origin as env base URL; always block cloud metadata IPs (169.254.169.254, fd00:ec2::254); block the app's own host/port. Private/localhost allowed behind `allowPrivateTargets` (default true).

Acceptance
- Unit tests for each rule including DNS names resolving to the metadata IP.

### T-15 core/executor
Agent: claude · Mode: auto · Milestone: M2
Depends on: T-08, T-14
- `buildRequest(endpoint, env, input, auth)`; sample body generated from schema when none given.
- `execute()`: 15s timeout, 5 MB cap; captures status, headers, timing, JSON or text.
- Redact `Authorization`, `Cookie`, `X-Api-Key` in stored request.

Acceptance
- Tests against the mock API (port from env): path + query params, POST with generated body, timeout, truncation.

### T-16 Auth recipes
Agent: claude · Mode: manual · Milestone: M2
Depends on: T-04, T-15
- Types: `none`, `static_bearer`, `api_key`, `login_flow` (login endpoint, credentials as secret, JSON path to token, header template, optional refresh).
- In-memory token cache per project+env; on 401 re-login once, retry once.
- Settings UI; "Test auth" never shows the token.

Acceptance
- login_flow gets a token and protected GET succeeds; expired token triggers one re-login.

### T-17 Run API with streaming
Agent: claude · Mode: manual · Milestone: M2
Depends on: T-15, T-16, T-03
- `POST /api/runs` `{ projectId, environmentId, moduleId?, endpointIds?, confirmDestructive?, confirmEnvName? }`.
- GET/HEAD by default; destructive only with confirmation; prod requires `confirmEnvName`.
- Sequential (concurrency configurable to 4); persist runs + results.
- `GET /api/runs/[id]/stream` SSE (`result`, `progress`, `done`, `error`); `POST /api/runs/[id]/cancel`.

Acceptance
- Module run streams one event per endpoint; unconfirmed destructive endpoints reported as `skipped`.

### T-18 Endpoint detail screen
Agent: antigravity · Mode: auto · Milestone: M2
Depends on: T-17
- Request tab (params, headers, body prefilled with sample) and Response tab (status, time, headers, body). Documented schema beside response.
- Send via `/api/runs`; confirm dialog for destructive; typed env name for prod.

Acceptance
- Every mock endpoint can be sent from the UI; dialogs appear as specified.

### T-19 Run module UI + runs history
Agent: antigravity · Mode: auto · Milestone: M2
Depends on: T-17
- "Run module" with live progress (TanStack Query + SSE), per-endpoint status and severity.
- `/runs` list and detail.

Acceptance
- Live updates without refresh; history shows completed and cancelled runs.

---

## M3 — Diff

### T-20 core/diff
Agent: opencode · Mode: auto · Milestone: M3
Depends on: T-08
- `diffResponse(responseSchemas, actual)` → items: `undocumented_status`, `missing_required`, `extra_field`, `type_mismatch`, `unexpected_null`, `enum_violation`, `format_violation`, with JSON path.
- Ajv (allErrors, ajv-formats) + custom walk for extra fields (unless `additionalProperties: true`).
- Severity: error = missing_required, type_mismatch, undocumented_status; warn = null/enum/format; info = extra_field.

Acceptance
- Every documented fixture mismatch detected with correct kind and path; matching responses give zero items.

### T-21 Diff in runs + diff screen
Agent: claude · Mode: auto · Milestone: M3
Depends on: T-19, T-20
- Compute and store diff per run result. `/projects/[id]/diff`: per module, grouped by endpoint, severity filter, link to response.

Acceptance
- After running the messy module, all deliberate mismatches are listed.

### T-22 Shareable diff report
Agent: opencode · Mode: auto · Milestone: M3
Depends on: T-21
- Export as Markdown and self-contained HTML: summary counts, each mismatch with path, expected vs actual (truncated, no secrets).

Acceptance
- Files open offline; test asserts no auth headers or tokens.

---

## M4 — Approve & context pack

### T-23 Approval flow
Agent: claude · Mode: auto · Milestone: M4
Depends on: T-21, T-12
- Approve (no `error` severity, or "approve with known issues"), Revoke. Store `approved_hash`; changes → `needs_review`.

Acceptance
- Approve blocked with errors unless overridden; re-import change flips to `needs_review`.

### T-24 core/pack
Agent: opencode · Mode: auto · Milestone: M4
Depends on: T-08
- `buildContextPack(modules, options)` → Markdown: base URL placeholder, auth summary, deduplicated TS interfaces, one-line signatures, known diff notes. Option to prefer observed reality.
- `estimateTokens` (chars/4).

Acceptance
- Snapshot tests; 20-endpoint module pack under ~2,000 tokens.

### T-25 Context pack screen + export
Agent: antigravity · Mode: auto · Milestone: M4
Depends on: T-23, T-24
- `/projects/[id]/pack`: choose modules, preview, token estimate, Copy, Download `.md`. Optional write to an allowlisted local folder.

Acceptance
- Unapproved modules selectable only with a warning; copy and download identical.

---

## M5 — Codegen (Flutter)

### T-26 core/codegen — Flutter models + client
Agent: opencode · Mode: auto · Milestone: M5
Depends on: T-24
- Eta templates: freezed + json_serializable models, Dio client per module, repository per module, `api_exception.dart`, barrels.
- snake_case files, PascalCase classes, camelCase fields with `@JsonKey(name:)`; nullable per schema or observed reality.

Acceptance
- Golden-file tests; passes `dart format --set-exit-if-changed` when dart is installed (skip with notice otherwise).

### T-27 Flutter contract tests generation
Agent: opencode · Mode: auto · Milestone: M5
Depends on: T-26, T-21
- `test/api/<module>_contract_test.dart` with `http_mock_adapter` and recorded responses. README snippet of required dev_dependencies.

Acceptance
- Golden tests; only recorded data, no secrets.

### T-28 Codegen screen
Agent: antigravity · Mode: auto · Milestone: M5
Depends on: T-26, T-27
- Target select (Flutter; SwiftUI "coming soon"), module select, options, file tree preview, zip download (jszip).

Acceptance
- Zip matches preview and folder layout.

---

## M6 — AI add-on (optional; owner signs off on @anthropic-ai/sdk first)

### T-29 AI provider + BYOK settings
Agent: claude · Mode: manual · Milestone: M6
Depends on: T-04
- Provider interface, Anthropic implementation, token + cost per call. Settings: encrypted key, test, model, soft monthly budget. AI actions disabled without a key.

Acceptance
- App works fully with no key; key never reaches the client.

### T-30 AI grouping for leftovers
Agent: claude · Mode: manual · Milestone: M6
Depends on: T-29, T-11
- On `Ungrouped`: send one-liners only, show proposals for approval (via=`ai`), show cost.

Acceptance
- Proposals never auto-applied.

### T-31 AI diff summary
Agent: claude · Mode: manual · Milestone: M6
Depends on: T-29, T-21
- Plain-English module summary, cached per run; sends diff items only.

Acceptance
- Cached summary re-shown without another call.

---

## M7 — Hardening

### T-32 E2E happy path
Agent: antigravity · Mode: manual · Milestone: M7
Depends on: T-28
- Owner signs off on @playwright/test first.
- Login → import → env + login_flow → run → diff → approve with known issues → export pack → download Flutter zip.

Acceptance
- Passes headless against the mock API.

### T-33 Error handling + empty states
Agent: antigravity · Mode: auto · Milestone: M7
Depends on: T-28
- Consistent errors, toasts, empty states, loading skeletons.

Acceptance
- Manual checklist per screen in the PR.

### T-34 Local run guide
Agent: opencode · Mode: auto · Milestone: M7
Depends on: T-32
- README: secret generation, DB, mock API, `pnpm build && pnpm start` on the Mac mini, DB volume backup, Orca worktree hooks.

Acceptance
- A fresh clone reaches the login page using only the README.

---

## Later (not scheduled)
- SwiftUI codegen (async/await + Codable + XCTest)
- Drift monitoring: scheduled re-runs + alerts (adds a worker process)
- CLI `apilens check` for CI, reusing `src/core`
- Hosted AI credits / paid plan
