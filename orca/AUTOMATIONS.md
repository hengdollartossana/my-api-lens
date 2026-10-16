# Orca setup for API Lens

## 1. One-time setup (in order)
1. Copy everything in this kit into the repo root (except `orca/`, which is just for you) and commit to `main`.
2. `node scripts/github/bootstrap.mjs --dry-run` → check the list, then `node scripts/github/bootstrap.mjs` (creates labels + 34 issues).
3. `node scripts/github/sync-ready.mjs` → marks the first issues `ready`. After that the GitHub Action keeps it updated on every merge.
4. Orca → Worktree Hooks: paste `orca/setup.sh` and `orca/archive.sh`. **When to run: Run by default. Wait for setup to complete before starting agent: ON.**
5. Full automation: run `node scripts/github/set-mode.mjs sync` once (flips every task to match TASKS.md: all auto except T-29–T-32), then turn on all six automations.

## 2. Automations
All: Host = Local Mac · Project = my-api-lens · Workspace = **New run** from `main` · Session = **Fresh** · Grace = **1 hour**.
Check that each automation runs the right agent CLI.

| Name | Agent | Prompt (one line) | Cron | Timeout |
|---|---|---|---|---|
| API Lens — Claude lane | Claude Code | `Follow .agents/lane-claude.md` | `40 8,13,17,22 * * *` | max |
| API Lens — Antigravity lane | Antigravity | `Follow .agents/lane-antigravity.md` | `50 8,13,17,22 * * *` | max |
| API Lens — OpenCode lane | OpenCode | `Follow .agents/lane-opencode.md` | `0 9,14,18,23 * * *` | max |
| API Lens — Review (Claude) | Claude Code | `Follow .agents/review.md as the Claude reviewer` | `30 7,11,16 * * *` | 45 min+ |
| API Lens — Review (OpenCode) | OpenCode | `Follow .agents/review.md as the OpenCode reviewer` | `40 7,11,16 * * *` | 45 min+ |
| API Lens — Smoke test main | Claude Code | `Follow .agents/smoke-main.md` | `0 7 * * *` | 45 min |

Owner merge windows: 8:00–8:30, 12:00–13:00, after 17:00.

### Prechecks (run the agent only when there is work)
Lane (replace `claude` with `antigravity` / `opencode`):
```
n=$(gh issue list --state open --search 'label:agent:claude (label:changes-requested OR (label:ready label:mode:auto -label:in-review))' --json number -q '.[0].number'); test -n "$n" && echo "$n"
```
Review (Claude):
```
n=$(gh pr list --state open --search '-label:reviewed -label:agent:claude' --json number -q '.[0].number'); test -n "$n" && echo "$n"
```
Review (OpenCode):
```
n=$(gh pr list --state open --search '-label:reviewed label:agent:claude' --json number -q '.[0].number'); test -n "$n" && echo "$n"
```
Smoke test: no precheck.

Test each precheck once in a terminal with no matching work: it must print nothing and exit non-zero. Then confirm Orca skips the run.

## 3. Running a task by hand (manual tasks, or "run now")
1. Orca → new worktree from `main` (setup hook runs).
2. Start the agent and type: `Follow .agents/lane-claude.md. Work on issue #N.` (use that agent's lane file).
3. Review the PR yourself, merge.

Don't start a lane by hand at the same minute its automation fires.

## 4. Manual vs automation
Everything is `mode:auto` except T-01 (done) and the sign-off tasks: T-29–T-31 need owner sign-off on `@anthropic-ai/sdk`, T-32 on `@playwright/test`.
After signing off: `node scripts/github/set-mode.mjs auto T-29 T-30 T-31` (or `T-32`).
Read foundation/security PRs yourself before merging: T-02, T-03, T-04, T-05, T-14, T-16, T-17.
