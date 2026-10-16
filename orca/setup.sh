# Orca → Worktree Hooks → Setup Script (paste this in; keep it local, not in orca.yaml)
# Gives every worktree its own .env, ports and database so agents can run in parallel.
set -e
cd "$ORCA_WORKTREE_PATH"

NAME=$(printf '%s' "$ORCA_WORKSPACE_NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '_')
N=$(( $(printf '%s' "$ORCA_WORKSPACE_NAME" | cksum | cut -d' ' -f1) % 90 ))
APP_PORT=$((3100 + N))
MOCK_PORT=$((4100 + N))
DB="apilens_${NAME}"
COMPOSE="docker compose -f $ORCA_ROOT_PATH/docker-compose.yml"

# .env: copy from the main checkout, then override DB + ports
: > .env
if [ -f "$ORCA_ROOT_PATH/.env" ]; then
  grep -v -E '^(DATABASE_URL|APP_PORT|PORT|MOCK_API_PORT)=' "$ORCA_ROOT_PATH/.env" >> .env || true
  ROOT_DB_URL=$(grep -E '^DATABASE_URL=' "$ORCA_ROOT_PATH/.env" | cut -d= -f2- || true)
  if [ -n "$ROOT_DB_URL" ]; then
    echo "DATABASE_URL=$(printf '%s' "$ROOT_DB_URL" | sed -E 's#/[^/?]*(\?|$)#/'"$DB"'\1#')" >> .env
  fi
fi
echo "APP_PORT=$APP_PORT" >> .env
echo "MOCK_API_PORT=$MOCK_PORT" >> .env

# Dependencies (skipped until T-01 exists)
if [ -f package.json ]; then
  pnpm install --frozen-lockfile --prefer-offline
fi

# Own database + migrations (skipped until T-02/T-03 exist and Postgres is running)
if [ -f "$ORCA_ROOT_PATH/docker-compose.yml" ] && $COMPOSE ps --status running --services 2>/dev/null | grep -q '^postgres$'; then
  $COMPOSE exec -T postgres createdb -U postgres "$DB" 2>/dev/null || true
  if grep -q '"db:migrate"' package.json 2>/dev/null; then pnpm db:migrate; fi
fi

echo "Worktree ready: app :$APP_PORT, mock :$MOCK_PORT, db $DB"
