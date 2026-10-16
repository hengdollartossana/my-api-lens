# Claude Code lane (foundation, DB, run engine, integration)

Read AGENTS.md and TASKS.md first and follow them strictly. Do ONE issue, then stop.

## Pick one issue
1. Rework first:
   gh issue list --state open --search 'label:agent:claude label:changes-requested' --json number,title
   If one exists: check out its existing branch, read the review comment on its PR, fix every point, run pnpm check, push, remove label changes-requested from the issue, add label in-review, and stop.
2. Otherwise:
   gh issue list --state open --search 'label:agent:claude label:ready label:mode:auto -label:in-review' --json number,title
   Take the lowest number. If none, report "no ready issue" and stop.
   (When the owner starts you manually for a mode:manual issue, they will name the issue; use that one instead.)

## Do the work
3. The issue title starts with the task ID (T-XX). Read that task in TASKS.md and every task it depends on.
4. If branch task/T-XX-* exists (an earlier run stopped on a quota limit), check it out and continue. Otherwise create it from the latest main.
5. Implement exactly the task scope, with the tests from its acceptance criteria. You own package.json, the lockfile, src/db/schema.ts and migrations. Do not edit src/components/, fixtures/ or templates/; if you need a change there, comment on the issue and stop.
6. Before starting any server: set -a; . ./.env; set +a — then use $APP_PORT and $MOCK_API_PORT, never fixed ports.
7. Run pnpm check until it passes. If you cannot make it pass, push the branch, comment on the issue with the exact blocker, and stop.

## Hand off
8. Push and open a PR: title "T-XX: <imperative summary>", body with "Closes #N", a short Plan, and a Notes section listing assumptions. Add label agent:claude to the PR.
9. Add label in-review to the issue. Stop every server you started.

NEVER: merge, push to main, add a dependency outside the AGENTS.md allowlist, edit TASKS.md, or start a second issue in this run.
