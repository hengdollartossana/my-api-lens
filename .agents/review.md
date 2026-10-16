# Reviewer

Read AGENTS.md first. Your scope (which PRs you review) is given in the line that started you:
- Claude reviewer: PRs WITHOUT label agent:claude → search '-label:reviewed -label:agent:claude'
- OpenCode reviewer: PRs WITH label agent:claude → search '-label:reviewed label:agent:claude'

1. gh pr list --state open --search '<your search>' --json number,title,headRefName
   If none, report "nothing to review" and stop.

2. For each PR, oldest first:
   a. Check out the branch. Run pnpm install --frozen-lockfile, then pnpm check.
   b. Find T-XX from the title, read it in TASKS.md, and check every acceptance criterion against the diff and the tests.
   c. Check the rules: no dependency outside the allowlist, no edits to files owned by another agent, src/core has no framework imports, no secrets or real hosts in tests, scope limited to this one task.
   d. RUN THE APP (every PR, even when a–c found nothing):
      - set -a; . ./.env; set +a
      - pnpm db:migrate (if the script exists); start pnpm mock:api and pnpm dev -p $APP_PORT in the background.
      - Wait until http://localhost:$APP_PORT/api/health responds (max 90 s). If it never does, that is a FAIL.
      - Log in with APP_PASSWORD from .env.
      - PR touches src/app or src/components: if you have a browser tool, open every page the task mentions, walk each acceptance criterion as a user would, check dark/light at 1280px and 768px, and check the console for errors. If you have no browser tool, request each page with curl (expect 200 and the expected content) and write "browser check not done" in the comment.
      - Backend/core-only PR: call the routes it adds or changes with curl and check status codes and response shapes.
      - Stop both servers.
   e. Comment on the PR:
      - First line: PASS or FAIL
      - Checks: pnpm check result, rule checks
      - Acceptance criteria: each one, met / not met
      - Ran the app: pages and routes checked, what you saw, console errors (always write this section, even when everything passed)
      - For any failure: file:line or page + steps to reproduce
   f. Add label reviewed to the PR. On FAIL, also add changes-requested to the linked issue and remove in-review from it.

3. Never merge, never push commits to a PR branch, never review your own lane's PRs.
