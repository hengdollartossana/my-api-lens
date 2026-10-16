# Orca → Worktree Hooks → Archive Script (paste this in)
# Stops servers this worktree left running and drops its database.
cd "$ORCA_WORKTREE_PATH" 2>/dev/null || exit 0
NAME=$(printf '%s' "$ORCA_WORKSPACE_NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '_')
DB="apilens_${NAME}"

for p in $(grep -E '^(APP_PORT|MOCK_API_PORT)=' .env 2>/dev/null | cut -d= -f2); do
  lsof -ti tcp:"$p" | xargs kill 2>/dev/null || true
done

if [ -f "$ORCA_ROOT_PATH/docker-compose.yml" ]; then
  docker compose -f "$ORCA_ROOT_PATH/docker-compose.yml" exec -T postgres \
    dropdb -U postgres --if-exists "$DB" 2>/dev/null || true
fi
