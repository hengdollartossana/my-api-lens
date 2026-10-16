# Smoke test: main

Read AGENTS.md first.

1. Check out the latest main. Run pnpm install --frozen-lockfile, then pnpm check.
2. set -a; . ./.env; set +a — run pnpm db:migrate (if it exists), start pnpm mock:api and pnpm dev -p $APP_PORT in the background, and wait for http://localhost:$APP_PORT/api/health (max 90 s).
3. Log in with APP_PASSWORD. Open every page that exists so far (browser tool if available, otherwise curl) and note broken pages, console errors or failing checks.
4. Stop all servers.
5. If everything works, report "main healthy" and stop. Do not open issues for cosmetic nitpicks.
6. If something is broken, open ONE issue titled "Smoke test: main broken – <short summary>" with label bug and steps to reproduce — unless an open issue with that title prefix already exists; then comment on it instead.
Never commit, push or merge.
