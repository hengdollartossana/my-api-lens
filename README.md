# API Lens

Personal developer tool: import a Swagger/OpenAPI spec, run and verify the APIs module by module, find where the docs are wrong, then export a low-token context pack or generated code.

Web app only (single full-stack Next.js app). Runs locally against dev/staging APIs. "API Lens" is a working name.

## Features

- **Import** Swagger/OpenAPI v2 and v3 by URL or file (JSON or YAML)
- **Auto-group into modules** by tag, path, operationId prefix and auth heuristic, with manual regroup that survives re-import
- **Run requests** through a server-side proxy with an SSRF guard, so there are no CORS problems and secrets stay on the server
- **Auth recipes:** none, static bearer, API key, or login flow with token capture and one automatic re-login
- **Environments** with a prod lock: destructive methods need confirmation, and prod needs a typed env name
- **Spec vs reality diff:** missing required fields, extra fields, type mismatches, unexpected nulls, undocumented statuses, enum and format violations
- **Re-import change detection:** new, removed, changed and moved endpoints; approved modules flip to "needs review"
- **Approve** modules and export a **context pack**: Markdown with TS interfaces and one-line endpoint signatures, with a token estimate
- **Codegen:** Flutter models, Dio client, repositories and contract tests (SwiftUI later)
- **Shareable diff reports** as Markdown or offline HTML
- **Optional AI add-on (BYOK, Claude first):** leftover grouping and diff summaries. The core flow needs no AI key.
- **Secrets** encrypted at rest (AES-256-GCM) and never returned to the client

## Stack

Next.js (App Router, TS strict, pnpm), Tailwind + shadcn/ui, CodeMirror 6, TanStack Query, Postgres + Drizzle, Zod, swagger-parser, Ajv, undici, Eta, Vitest, Biome.

## Run it locally

You need **Node 24** (the HTTP client needs zstd support, which older Node lacks), **pnpm** via Corepack, and **Docker** (for Postgres).

```sh
git clone <repo-url> my-api-lens && cd my-api-lens
corepack enable            # pnpm is pinned in package.json
pnpm install --frozen-lockfile
```

If `pnpm` fails with a Corepack error such as `Cannot find module '.../pnpm.cjs'`, update Corepack (`npm install -g corepack@latest`) and try again.

### 1. Create `.env` with fresh secrets

`.env` is not committed. This writes one with generated secrets (works on macOS and Linux):

```sh
{
  grep -v -E '^(APP_PASSWORD|SESSION_SECRET|ENCRYPTION_KEY)=' .env.example
  echo "APP_PASSWORD=$(openssl rand -base64 18)"
  echo "SESSION_SECRET=$(openssl rand -base64 48)"
  echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
} > .env
grep APP_PASSWORD .env     # the password you will log in with
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection. The default matches `docker-compose.yml`. |
| `APP_PASSWORD` | The one login password for the app. |
| `SESSION_SECRET` | Signs the 7-day login cookie. Changing it logs everyone out. |
| `ENCRYPTION_KEY` | Base64 of 32 bytes (AES-256-GCM). Encrypts stored API tokens and AI keys. **If you lose or change it, stored secrets cannot be read.** Keep a copy next to your database backups. |
| `APP_PORT` / `MOCK_API_PORT` | App port (default 3000) and mock API port (default 4010). |

### 2. Database

```sh
pnpm db:up        # starts Postgres 16 in Docker (project "apilens", volume "apilens_pgdata")
pnpm db:migrate   # applies the schema
```

### 3. Start the app

```sh
set -a; . ./.env; set +a      # load the ports into your shell
pnpm dev -p $APP_PORT
```

Open <http://localhost:3000> and log in with the `APP_PASSWORD` from your `.env`. Five wrong passwords lock the login for five minutes (restart the server to clear it).

### 4. Try it against the mock API (optional)

`fixtures/mock-api` serves `fixtures/specs/messy-v3.json` with deliberate spec mismatches, so runs and diffs have something to find.

```sh
pnpm mock:api                 # in a second terminal; listens on $MOCK_API_PORT
```

In the app: **New project** → **Upload file** → `fixtures/specs/messy-v3.json`. In the project's **Settings** add an environment with base URL `http://localhost:4010`. The mock accepts `demo` / `demo` at `POST /api/v1/auth/login` (see `fixtures/mock-api/README.md`).

### Checks and tests

```sh
pnpm check                    # lint + typecheck + unit tests (needs Postgres for the DB tests)
pnpm exec playwright install chromium   # once
pnpm test:e2e                 # the full happy path in a headless browser, against the mock API
```

## Run it on the Mac mini (production build)

Same steps 1 and 2, then build once and start:

```sh
set -a; . ./.env; set +a
pnpm build
pnpm start -p $APP_PORT
```

Keep it running with whatever you use for background processes (`launchd`, `pm2`, a `tmux` session). Docker restarts Postgres by itself (`restart: unless-stopped`).

**Update to a new version:**

```sh
git pull
pnpm install --frozen-lockfile
pnpm db:migrate               # migrations are additive; never edit an applied one
pnpm build
# restart `pnpm start`
```

**Reaching it from another machine:** in production the login cookie is `Secure`, so browsers only keep it over HTTPS or on `localhost`. Plain `http://mac-mini.local:3000` will show the login page but not stay logged in. Use an SSH tunnel (`ssh -L 3000:localhost:3000 mac-mini`, then open `http://localhost:3000`) or put an HTTPS reverse proxy in front.

### Back up and restore the database

All data (projects, runs, encrypted secrets) lives in the Postgres volume. Back it up with a SQL dump, and keep `.env` (especially `ENCRYPTION_KEY`) with it.

```sh
# backup
docker compose exec -T postgres pg_dump -U postgres apilens | gzip > apilens-$(date +%F).sql.gz

# restore into an empty database
docker compose exec -T postgres dropdb -U postgres --if-exists apilens
docker compose exec -T postgres createdb -U postgres apilens
gunzip -c apilens-2026-01-01.sql.gz | docker compose exec -T postgres psql -U postgres apilens
```

`pnpm db:down` stops Postgres and keeps the data. `docker compose down -v` deletes the volume and all data.

## Orca worktrees (parallel agents)

Each Orca worktree gets its own `.env`, ports and database so several agents can run at once. Paste `orca/setup.sh` and `orca/archive.sh` into Orca's worktree hooks (see `orca/AUTOMATIONS.md` for the full automation setup).

- **Setup** copies the main checkout's `.env`, then overrides `APP_PORT` (3100 + N), `MOCK_API_PORT` (4100 + N) and `DATABASE_URL` (database `apilens_<workspace>`), runs `pnpm install --frozen-lockfile`, creates the database and runs `pnpm db:migrate`.
- **Archive** stops anything still listening on the worktree's ports and drops its database.
- It expects the main checkout to have a `.env` and Postgres running (`pnpm db:up` there). Inside a worktree, always `set -a; . ./.env; set +a` before starting a server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED ...:5432` | Postgres is not running: start Docker, then `pnpm db:up`. |
| `DATABASE_URL is not set` from `pnpm db:migrate` | You are not in the repo root, or `.env` is missing. |
| `ENCRYPTION_KEY must be base64 that decodes to exactly 32 bytes` | Regenerate with `openssl rand -base64 32`. |
| Login says "Invalid password" | Use the value of `APP_PASSWORD` in `.env`; after five misses wait five minutes or restart. |
| Login works but you are bounced back to `/login` | Production build over plain HTTP from another machine: see "Reaching it from another machine". |
| `Address already in use` | Another process holds `APP_PORT` or `MOCK_API_PORT`; change them in `.env`. |
| Tests crash with `Cannot read properties of undefined (reading 'bind')` | Node is too old (needs zstd support): use Node 24. |

## Docs

- [AGENTS.md](AGENTS.md): project rules, structure, commands, conventions
- [TASKS.md](TASKS.md): task specs (T-01 to T-34, milestones M0–M7)
- [orca/AUTOMATIONS.md](orca/AUTOMATIONS.md): agent automation setup
