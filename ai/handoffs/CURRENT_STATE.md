# Task

TASK-039 — Isolated Staging Environment (Preview DB + Stable Staging URL). **Implemented this session.**
[ai/tasks/TASK-039-spec.md](../tasks/TASK-039-spec.md) (DRAFT-3, approved) has been executed end to end:
Neon `staging` branch created, Vercel Preview repointed, `staging` git branch created and pushed as the
new default working branch, local dev repointed, and durable conventions documented in
[ai/handoffs/CONVENTIONS.md](CONVENTIONS.md).

# Current Status

All six Decisions Needed (D-1 through D-6) from the spec were resolved this session by direct
inspection, not guessed:

- **D-1 (Clerk)**: confirmed via `clerk apps list` + the `accounts.kitchenkeeper.kitchen` custom domain
  (Clerk custom domains require a Production instance) that Production is already live Clerk. User chose
  Preview/staging to use the existing Development instance (`pk_test_d2lubmluZy1zd2lmdC03NC5jbGVyay5hY2NvdW50cy5kZXYk`),
  already used by local dev — no new Clerk resource created.
- **D-2 (Neon plan)**: confirmed Free plan via `vercel integration resource inspect neon-violet-compass`;
  now 2/10 branches used (`main`, `staging`) — well within the free tier.
- **D-3 (staging data)**: user chose branch-as-is (copy of production), created via the Neon console.
- **D-4 (Vercel Production Branch)**: confirmed `main` via the Vercel dashboard's own deployment page
  ("To update your Production Deployment, push to the `main` branch").
- **D-5 (GitHub default branch)**: confirmed unchanged, still `main` (`gh repo view`).
- **D-6 (non-Postgres secrets)**: audited via `vercel env ls`; left shared between Production/Preview
  per spec's low-severity assessment — no change made.

# Files Modified (this session)

- `server/.env.local` — `DATABASE_URL` repointed from the production Neon branch to the `staging` branch
  (`ep-holy-truth-aktxe3zj-pooler...`). Not tracked by git (gitignored), so no diff.

# Files Created (this session)

- `ai/handoffs/CONVENTIONS.md` — durable conventions: environment table, push workflow, canonical
  migration order (spec Design §5), staging rollback/refresh runbook, and the one known gap (below).

# Infrastructure Changes (this session, not in git diff)

- **Neon**: created branch `staging` (from production, full data copy) in project `jolly-snow-07827339`
  via the Neon console (Vercel SSO link) — done by the user directly in their browser, connection string
  relayed back into this session.
- **Vercel env vars** (Preview environment only): `DATABASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`,
  `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` removed and re-added pointed at `staging`/Clerk Development.
  Verified: no native Neon↔Vercel "map environment to branch" setting exists (checked Neon console →
  Integrations → Vercel; it only offers ephemeral branch-per-preview-deployment, which the spec
  explicitly declined) — manual env-var repoint was the only option, matching the spec's documented
  fallback.
- **Git**: created `staging` branch off `main`, pushed with `git push -u origin staging` — local
  checkout's tracking branch is now `origin/staging`, confirmed via `git rev-parse --abbrev-ref @{u}`.

# Files Required Next

- None to *implement* — remaining items below are verification/documentation follow-ups, not blocked.

# Verification Results (this session)

- **Isolation, query-based** (spec Verification Step 1 & 2): wrote a throwaway marker table+row directly
  to the `staging` Neon branch via `@neondatabase/serverless`, confirmed present on `staging` and
  absent on production (`relation does not exist` when queried against prod) — then dropped the table.
  This is a stronger check than comparing hostnames, per the spec's own caveat about pooled connections.
- **Local dev DB target** (Verification Step 4): same script confirmed against the exact connection
  string now in `server/.env.local` — local dev is on `staging`, not production.
- **Tracking branch** (Verification Step 8): `git rev-parse --abbrev-ref @{u}` → `origin/staging`. Confirmed.
- **Not yet run this session** (needs a real deployment, which the docs commit below will trigger):
  - Step 1/5: confirm a Preview deployment from `staging` actually serves from the `staging` DB, and
    that `kitchen-keeper-git-staging-connorsharpes-projects.vercel.app` appears and is stable.
  - Step 6: confirm the daily cron does not fire on the Preview/staging deployment.
  - Step 7: `vercel env pull` diff between production/preview to confirm the full picture post-repoint.
  - Step 9: push a second trivial commit to `staging`, confirm it deploys to Preview not Production.
  - Step 10: first real `staging` → `main` merge, confirm *that* triggers the Production deploy — left
    for the next actual feature/fix that ships, not forced as an empty merge.

# Known Risks

Carried from the spec (see `ai/tasks/TASK-039-spec.md` Known Risks and `ai/handoffs/CONVENTIONS.md`
Runbook section), plus one new item from this session:

- **Only `DATABASE_URL` was repointed for Preview**, not the other ~10 Postgres-family variables the
  Neon-Vercel integration also manages (`POSTGRES_PRISMA_URL`, `PGHOST_UNPOOLED`, etc.) — this app's
  code only reads `DATABASE_URL` (confirmed via `grep` of `server/`), so there's no live risk today, but
  if future code reads one of the others directly it would silently hit production. Documented in
  `CONVENTIONS.md`'s "Known gap" section so it isn't forgotten.
- No GitHub-enforced guardrail against an accidental direct push to `main` (private repo, free plan).
- Still open from prior sessions (unrelated): OpenAI billing not yet switched to prepaid/auto-recharge-off
  (TASK-037).

# Recommended Next Action

Make a small, real doc/commit on `staging` (this session's `CONVENTIONS.md` + this handoff) to trigger
the first actual Preview deployment, then run the remaining verification steps (1, 5, 6, 7, 9) against
it before considering the task fully closed out.

# Context Notes

- branch: `staging` (tracking `origin/staging` — switched this session per Design §3)
- worktree: none
- No dev servers were started this session (DB-level verification only, via a throwaway Node script —
  not committed).
