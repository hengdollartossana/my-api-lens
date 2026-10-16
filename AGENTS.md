# API Lens — Agent Guide

One rulebook for all agents (Claude Code, OpenCode, Antigravity). `CLAUDE.md` contains only `@AGENTS.md`.
Mirror of the Notion page "API Lens — Agent Guide (AGENTS.md)". This file is the source of truth; update both when rules change.

Personal developer tool: Swagger/OpenAPI → run + verify APIs by module → diff spec vs reality → approve → low-token context pack + generated code and tests.

Web app only — single full-stack Next.js app, no mobile app. Runs locally (Mac mini) against dev/staging APIs. AI is an optional add-on; the core flow works with no AI key.

Task list: `TASKS.md` / the Notion "API Lens — Task Plan" page. Live status lives in GitHub Issues (one issue per task). Work on exactly one issue at a time, and only issues labeled with your agent and `ready`.

## Stack
- Next.js (App Router) + TypeScript strict, pnpm
- Tailwind + shadcn/ui, CodeMirror 6 (JSON), TanStack Query (live run status only)
- Route Handlers (`src/app/api/*`) for anything a future CLI needs; Server Actions only for UI-only forms
- Postgres (Docker Compose) + Drizzle ORM, Zod everywhere
- Core: @apidevtools/swagger-parser, ajv + ajv-formats, undici, eta
- Auth: single user, password from env, signed session cookie (jose)
- Tests: Vitest (unit), Playwright (e2e, M7). Lint/format: Biome

## Structure
```
src/
  app/                 pages + api/ route handlers
  core/                PURE TS — no next/*, react, or db imports
    parser/ grouper/ executor/ diff/ pack/ codegen/ ai/
  db/                  drizzle schema, queries, migrations
  lib/                 crypto, auth, ssrf, utils
  components/          UI (shadcn in components/ui)
fixtures/
  specs/               sample OpenAPI files
  mock-api/            local mock server with deliberate spec mismatches
templates/             eta codegen templates (flutter/, swift/)
```
`src/core` must stay framework-free so it can later move to a CLI package unchanged.

## Commands
```
pnpm dev            # next dev
pnpm db:up          # docker compose up -d postgres
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate     # drizzle-kit migrate
pnpm mock:api       # start fixtures/mock-api on :4010
pnpm test           # vitest run
pnpm lint           # biome check
pnpm typecheck      # tsc --noEmit
pnpm check          # lint + typecheck + test  (must pass before every commit)
```

## Workflow per task
1. Read the GitHub issue (task text) and every issue it depends on. Start only if it has your `agent:*` label and `ready`.
2. Branch: `task/T-XX-short-slug` from `main`.
3. Write a short plan as a comment in the PR/commit body, then implement.
4. Add or update tests; core modules require unit tests.
5. `pnpm check` must pass.
6. Do NOT edit `TASKS.md`. Put assumptions in the PR description under `Notes`. Open the PR with `Closes #N`.
7. Commit: `T-XX: <imperative summary>`. One task = one branch = one PR. Do not merge.

## Multi-agent ownership
- **Claude Code** owns `package.json`, the lockfile, `src/db/schema.ts` and migrations. All allowlisted deps are installed in T-01.
- **Antigravity** owns `src/components/`. Others may use components but must ask before changing them.
- **OpenCode** owns `fixtures/` and `templates/`.
- Need a change in a file you don't own? Comment on the issue and stop; do not edit it.
- Rebase on `main` before starting each new issue.
- Reviews are cross-agent: Claude reviews OpenCode and Antigravity PRs; OpenCode reviews Claude PRs. The reviewer posts PASS/FAIL against the acceptance criteria. Only the owner (Dollar) merges.
- Quota limit hit: stop, leave the branch as is, resume the same issue after reset. Do not pick up another agent's half-done branch.

## Hard rules (stop and ask the owner instead)
- Install ONLY dependencies in the allowlist below. Anything else, or any version major upgrade → ask first.
- Never deploy, publish, bump release versions, or push to `main`.
- Never write real secrets into the repo. Only `.env.example` with placeholders.
- Never change a migration that is already committed; add a new one.
- Never send requests to a non-local host in tests; use `fixtures/mock-api`.
- If a task is ambiguous or contradicts this file, stop and ask.

## Dependency allowlist
- **Runtime:** next, react, react-dom, tailwindcss, @tailwindcss/postcss, shadcn/ui and what its CLI adds (radix-ui packages, lucide-react, class-variance-authority, clsx, tailwind-merge), @tanstack/react-query, @uiw/react-codemirror, @codemirror/lang-json, drizzle-orm, pg, zod, @apidevtools/swagger-parser, openapi-types, ajv, ajv-formats, undici, eta, jose, jszip
- **Dev:** typescript, @types/node, @types/react, @types/pg, drizzle-kit, dotenv, tsx, vitest, @biomejs/biome
- **Later (only when that task starts):** @playwright/test (M7), @anthropic-ai/sdk (M6)

## Conventions
- Stable endpoint key: `METHOD /path/{}` (path params normalized to `{}`), uppercase method. Used everywhere for identity across re-imports.
- All target-API calls go through `src/core/executor` via a route handler; never from the browser.
- Secrets (API tokens, AI keys) are stored encrypted (`src/lib/crypto`) and never returned to the client — only masked (`••••last4`).
- Destructive methods (POST/PUT/PATCH/DELETE) never run without explicit confirmation; prod environments need typed confirmation of the env name.
- Response bodies stored in DB are truncated at 256 KB; request logs redact auth headers.
- Errors: return `{ error: { code, message } }` from route handlers with correct HTTP status.
- UI: dark default, primary green `#22C55E` (dark) / `#16A34A` (light), dense dev-tool layout.

## Definition of done
Acceptance criteria in the task are all met, `pnpm check` passes, no new lint warnings, no unlisted dependency, PR opened with `Closes #N` and a Notes section, reviewer posted PASS.
