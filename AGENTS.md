# API Lens — Agent Guide (AGENTS.md)

One rulebook for all agents: Claude Code, OpenCode, Antigravity. `CLAUDE.md` only imports this file.

API Lens is a **web app only** (no mobile app): Swagger/OpenAPI → run + verify APIs by module → diff spec vs reality → approve → low-token context pack + generated code and tests.
Single full-stack Next.js app. Runs locally (Mac mini) against dev/staging APIs. AI is an optional add-on; the core flow works with no AI key.

- Task specs: `TASKS.md`. Live status: **GitHub Issues** (one issue per task). Never edit `TASKS.md` status.
- Work on exactly one issue per session, and only issues labeled with your `agent:*` label.

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
.agents/               lane, review and smoke-test prompts
scripts/github/        issue bootstrap + ready-label sync
```
`src/core` must stay framework-free so it can later move to a CLI package unchanged.

## Environment, ports and database (per worktree)
Every Orca worktree gets its own `.env` from the worktree setup hook, with its own `APP_PORT`, `MOCK_API_PORT` and database (`apilens_<workspace>`). This lets several agents run at once without collisions.
- Before starting any server, load it: `set -a; . ./.env; set +a`
- App: `pnpm dev -p $APP_PORT`. Mock API: `pnpm mock:api` (reads `MOCK_API_PORT`, default 4010).
- Never hardcode ports 3000/4010 in tests; read them from env.
- Stop every server you started before you finish.

## Commands
```
pnpm dev -p $APP_PORT   # next dev on this worktree's port
pnpm db:up              # docker compose up -d postgres (project name: apilens)
pnpm db:generate        # drizzle-kit generate
pnpm db:migrate         # drizzle-kit migrate
pnpm mock:api           # fixtures/mock-api on $MOCK_API_PORT
pnpm test               # vitest run
pnpm lint               # biome check
pnpm typecheck          # tsc --noEmit
pnpm check              # lint + typecheck + test  (must pass before every PR)
```

## Workflow per issue
1. Read the issue, its task in `TASKS.md`, and every task it depends on.
2. Branch `task/T-XX-short-slug` from latest `main` (or resume that branch if it exists).
3. Implement exactly the task scope, with the tests from its acceptance criteria.
4. `pnpm check` must pass.
5. Open a PR: title `T-XX: <imperative summary>`, body with `Closes #N`, a short Plan, and a `Notes` section for assumptions. Add your `agent:*` label to the PR.
6. Add label `in-review` to the issue. Do not merge.

## Labels
| Label | Meaning |
|---|---|
| `agent:claude` / `agent:antigravity` / `agent:opencode` | Owning lane (issue and its PR) |
| `mode:auto` / `mode:manual` | Automations only pick `mode:auto` |
| `ready` | All dependencies closed (set by `scripts/github/sync-ready.mjs`) |
| `in-review` | PR open, waiting for review |
| `changes-requested` | Review failed; the builder fixes this first |
| `reviewed` (PR) | Reviewer has posted PASS/FAIL |
| `M0`…`M7` | Milestone |

## Multi-agent ownership
- **Claude Code** owns `package.json`, the lockfile, `src/db/schema.ts` and migrations. All allowlisted deps are installed in T-01.
- **Antigravity** owns `src/components/`. Others may use components but ask before changing them.
- **OpenCode** owns `fixtures/` and `templates/`.
- Need a change in a file you don't own? Comment on the issue and stop.
- Reviews are cross-agent: Claude reviews OpenCode + Antigravity PRs; OpenCode reviews Claude PRs. Only the owner (Dollar) merges.
- Quota limit hit: stop, leave the branch, resume the same issue later. Never pick up another agent's half-done branch.

## Hard rules (stop and ask the owner instead)
- Install ONLY dependencies in the allowlist below. Anything else, or any major upgrade → ask first.
- Never deploy, publish, bump release versions, merge, or push to `main`.
- Never write real secrets into the repo. Only `.env.example` with placeholders.
- Never change a committed migration; add a new one.
- Never send requests to a non-local host in tests; use `fixtures/mock-api`.
- If a task is ambiguous or contradicts this file, comment on the issue and stop.

## Dependency allowlist
- **Runtime:** next, react, react-dom, tailwindcss, @tailwindcss/postcss, shadcn/ui and what its CLI adds (radix-ui packages, lucide-react, class-variance-authority, clsx, tailwind-merge), @tanstack/react-query, @uiw/react-codemirror, @codemirror/lang-json, drizzle-orm, pg, zod, @apidevtools/swagger-parser, openapi-types, ajv, ajv-formats, undici, eta, jose, jszip
- **Dev:** typescript, @types/node, @types/react, @types/pg, drizzle-kit, dotenv, tsx, vitest, @biomejs/biome
- **Later (only when that task starts, after owner sign-off):** @playwright/test (M7), @anthropic-ai/sdk (M6)

## Conventions
- Stable endpoint key: `METHOD /path/{}` (path params normalized to `{}`), uppercase method.
- All target-API calls go through `src/core/executor` via a route handler; never from the browser.
- Secrets are stored encrypted (`src/lib/crypto`) and never returned to the client — only masked (`••••last4`).
- Destructive methods never run without explicit confirmation; prod environments need typed confirmation of the env name.
- Stored response bodies truncated at 256 KB; request logs redact auth headers.
- Route handler errors: `{ error: { code, message } }` with the correct HTTP status.
- UI: dark default, primary green `#22C55E` (dark) / `#16A34A` (light), dense dev-tool layout.

## Definition of done
All acceptance criteria met, `pnpm check` passes, no new lint warnings, no unlisted dependency, PR opened with `Closes #N` and Notes, reviewer posted PASS, owner merged.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
