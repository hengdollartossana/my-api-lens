# Pending work (not complete)

Written when the Google AI Studio provider was committed. `TASKS.md` status is unchanged; live status stays in GitHub Issues.

## Unverified

- **Google AI Studio provider** (`feat/google-ai-studio`): unit tests, lint and typecheck pass (core + lib: 265 tests). Not yet run against Postgres, because Docker was down:
  - `src/app/api/settings/ai/ai.test.ts` (multi-provider settings, legacy shape migration)
  - the Settings screen with the provider select
  - a real call to Google with a real key ("Test key")
- Google model ids and prices in `src/core/ai/pricing.ts` are estimates; check them against the Google docs before relying on the budget numbers.

## Not started: automatic QA pipeline

Product goal: paste a Swagger link, then get a verified document, with no manual request building.

1. AI-filled request inputs per endpoint (summary + parameter schema only; ids chained from earlier responses; keep the destructive and prod confirmation rules).
2. Automatic per-module QA run with pass/fail and a reason (API error vs. bad test input).
3. Module documents.
4. Two export types:
   - AI export: compact Markdown + structured JSON (verified request, status, response shape, mismatches).
   - Human export: readable HTML/Markdown per module, plus a zip of all modules.

Design defaults for the exports have not been confirmed by the owner yet.

## Housekeeping (owner)

- Close stale issues #12 and #22; T-12 and T-22 labels are stale.
- `.DS_Store` files are untracked/modified in several folders; they were left out of the commit and should be added to `.gitignore`.
