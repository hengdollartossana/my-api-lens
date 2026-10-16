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

## Docs

- [AGENTS.md](AGENTS.md): project rules, structure, commands, conventions
- Task plan: Notion "API Lens — Task Plan" (T-01 to T-34, milestones M0–M7)
