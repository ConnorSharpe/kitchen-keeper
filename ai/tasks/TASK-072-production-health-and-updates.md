# TASK-072 — Production Health Check and Outstanding Updates

Version: DRAFT-1 (2026-11-03). Not yet reviewed.

## Goal

Make sure Kitchen Keeper works in production, then clear the outstanding non-breaking updates and open
items from CURRENT_STATE.md, one ordered phase at a time. The breaking dependency upgrades are **not** in
this task; they live in TASK-071 (see Dependency Chain).

---

## 0. Investigation findings (read-only, 2026-11-03 ~18:54–19:05 UTC)

**Verdict: production is up and serving `9e243da`. No production errors from real users in the last 14 days.**
The only production error issue is KITCHEN-KEEPER-SERVER-2, and it is noise: expected 401s from
unauthenticated requests are reported to Sentry as errors.

| Check | Evidence |
|---|---|
| `GET https://kitchenkeeper.kitchen/` | 200, served by Vercel (`X-Vercel-Id: pdx1::…`) |
| `GET /api/health` | 200 `{"status":"ok"}`; 3.4 s cold, 0.35 s warm. This route does not touch the DB, Clerk or OpenAI |
| `GET /api/pantry` (no session) | 401 `{"error":"Authentication required"}` (correct) |
| Deployed commit | Production client bundle `/assets/index-Dd7UtryX.js` embeds release `9e243dac39e7…`. A Sentry server event at 18:58:31 UTC has release `9e243da`; one at 18:54:58 still had `bd5c5f4`. So the `9e243da` push (origin/main updated 18:53 UTC) went live between those times. Staging bundle `/assets/index-Bi1Ene9W.js` is also `9e243da` |
| Sentry issues, `kitchen-keeper-server`, unresolved, 30 d | 1: KITCHEN-KEEPER-SERVER-2 (`Error: Authentication required`, `GET /api/pantry`, `server/middleware/clerkAuth.js:7`). 504 events in total, 0 users, first seen 2026-08-17, last seen 2026-11-03 18:58. The last 3 events were this investigation's own `curl` probes (browser tag `curl 8.12.1`) |
| Sentry issues, `kitchen-keeper-client`, unresolved, 30 d | 0 |
| Sentry error events, all projects, 14 d | 3, all KITCHEN-KEEPER-SERVER-2, all from this investigation |
| Sentry logs, 14 d | 8 `info` logs in production: 4 `app-boot` → `auth-settled` pairs (2026-10-23, 10-25, 11-02 ×2). Real sessions booted and signed in without errors |
| `www.kitchenkeeper.kitchen` | DNS NXDOMAIN. Nothing in the repo references it (observation, not a regression) |

**Root cause of KITCHEN-KEEPER-SERVER-2** (`server/app.js:73-83`): the global error handler calls
`captureExceptionSafely(err)` and `await flush(2000)` for **every** error, including 4xx such as the
401 thrown by `clerkAuth`. Every unauthenticated or expired-session API call therefore creates a Sentry
error event and waits up to 2 s for a flush before it responds.

**Not verified** (and why):
- Authenticated flows (pantry/recipes/chat/OpenAI, Blob uploads, DB reads through a real session): no
  production credentials were used, and the investigation was read-only. The 4 clean `auth-settled`
  sessions are indirect evidence only.
- Vercel deployment state, function logs, and the daily `/api/push/cron` run: the `vercel` CLI token is
  invalid (`The specified token is not valid. Use vercel login`), so this was skipped as instructed.
- Neon compute quota / suspend state: no Neon console access. The app answers, and recent sessions
  authenticated, so the DB is not hard-stopped as of 2026-11-02, but this is inferred, not observed.
- Whether a 2nd production Sentry environment or project exists beyond the two listed: not checked.

---

## Phases (in order)

| Phase | What | Kind | Gate to start |
|---|---|---|---|
| 1 | Production health verification checklist | manual (Connor) + read-only | none |
| 2 | Stop reporting 4xx errors to Sentry (closes KITCHEN-KEEPER-SERVER-2) | code (TDD) | Phase 1 done |
| 3 | Rotate the Neon `neondb_owner` password and update Vercel env vars | manual (Connor) | Phase 1 done; nothing else mid-deploy |
| 4 | Lint config: clear the 30 pre-existing `.claude/hooks/tdd/*.mjs` errors | config (lint run is the test) | none |
| 5 | Non-breaking minor/patch dependency bumps | `package*.json` only (TDD-exempt) | Phase 2 shipped; before TASK-071 |
| 6 | Remove legacy Fly.io/Docker files and stale local SQLite files | file deletion | none |

Phases 2, 4, 5 and 6 can each be their own commit. Each goes to `staging` first and is promoted to `main`
(fast-forward) only after its staging check passes. Phase 3 does not change the repo.

---

## Phase 1 — Production health verification (checklist)

Production looks healthy (§0), so this phase confirms the parts §0 could not check.

**Allowed files:** none (read-only). **Forbidden:** everything.

**Acceptance criteria**
1. `curl -s -o /dev/null -w '%{http_code}' https://kitchenkeeper.kitchen/api/health` → `200`.
2. Connor signs in at `https://kitchenkeeper.kitchen` and the pantry list loads (proves Clerk + Neon `main`).
3. One chat message gets an AI reply (proves OpenAI key + rate limit + `search_documents`).
4. One photo upload (any Blob-backed upload flow) succeeds (proves `BLOB_READ_WRITE_TOKEN`).
5. Vercel dashboard: the current Production deployment is `9e243da`, status Ready. The latest
   `/api/push/cron` invocation (daily 08:00 UTC) is not an error.
6. Neon console: project not suspended for quota; record compute-hours used vs. the plan limit this month.
7. Sentry: no new unresolved issue in either project after steps 2–4.

**Verification:** Connor records pass/fail for each item in this file. Any failure stops the task:
debug that failure first (load the `smoke-testing` skill) and re-scope before going on.

---

## Phase 2 — Don't report expected 4xx to Sentry

**Allowed files:** `server/instrument.js`, `server/instrument.test.js`, `server/app.js`, this TASK file.
**Forbidden files:** `server/middleware/clerkAuth.js` (the 401 itself is correct), the client, all other
server files, `package*.json`.

**Constraints:** TDD applies (`server/**` is a sensitive path). No new dependencies. The response
status and body for every error must stay exactly as they are now.

**Interface contract**
- New export in `server/instrument.js`: `shouldReportError(err) → boolean`.
  - Returns `true` when `(err?.status ?? err?.statusCode ?? 500) >= 500`, and `false` otherwise.
  - Never throws. With `undefined`/`null`/a non-object, it returns `true` (the status defaults to 500).
- In `server/app.js`, the error handler calls `captureExceptionSafely(err)` **and** `await flush(2000)` only
  when `shouldReportError(err)` is `true`. `console.error(err.stack)` and the response logic stay unchanged.

**Acceptance criteria**
1. `shouldReportError({ status: 401 })` → `false`; `{ status: 400 }`, `{ status: 404 }`, `{ status: 429 }` → `false`.
2. `shouldReportError({ status: 500 })`, `{ status: 503 }`, `new Error('x')` (no status) → `true`.
3. `shouldReportError({ statusCode: 403 })` → `false` (body-parser and multer errors set `statusCode`).
4. `shouldReportError(undefined)` / `(null)` / `('str')` → `true`, and none of these throw.
5. On staging, after deploy: one unauthenticated `curl` to `/api/pantry` → 401 with the same body as now,
   and **no** new KITCHEN-KEEPER-SERVER-2 event with the staging release SHA in Sentry within 5 minutes.
6. After promotion to production: the same probe → 401, and no new event for release = the promoted SHA.
   Connor then resolves KITCHEN-KEEPER-SERVER-2 in Sentry (manual).

Open question Q1 applies: confirm that 4xx should not be reported at all, rather than sampled or
reported as a warning.

**Verification:** Red (criteria 1–4 fail, because the export is missing) → Green → `npm test` (root, which
runs the server tests) and `npm run lint` show no new failures → push `staging` → criterion 5 → fast-forward
`main` → criterion 6.

---

## Phase 3 — Rotate the Neon `neondb_owner` password (manual, Connor)

The staging and production connection strings were pasted into chat during TASK-069.
**Allowed files:** this TASK file (record the outcome only, never credentials). **Forbidden:** committing
any connection string anywhere.

**Facts the order depends on**
- The only Postgres variable the code reads is `DATABASE_URL` (`server/db/client.js`, `drizzle.config.js`).
  Vercel scopes: Production → Neon `main`; Preview → Neon `staging` (CONVENTIONS.md "Known gap"). The
  Neon-integration variables (`DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`; the full list of names is in the
  gitignored `server/.env.vercel`) point at production in **all** scopes. No code reads them, but they hold the old password.
- A running Vercel deployment keeps the env values it was built with. Changing a variable has no effect until
  a **redeploy**. So production breaks from the moment its password is reset until a redeploy with the new
  `DATABASE_URL` is Ready.
- **Unverified:** whether a Neon role password is per-branch (so resetting it on `main` leaves `staging` and
  `local` alone) or shared. Check this in the Neon console before step 1. If it is shared, staging and
  production must be done in one window and `server/.env.local` must be updated too.
- **Unverified:** whether the Neon-Vercel integration rewrites these variables itself after a reset. If it
  does, it can overwrite the per-scope `DATABASE_URL` mapping. Check after each step.

**Order**
1. Staging (rehearsal): reset `neondb_owner` on Neon branch `staging` → copy the new pooled connection
   string → Vercel Preview scope (branch `staging`) `DATABASE_URL` = new string → Redeploy the latest
   `staging` deployment → sign in on the staging URL and load the pantry.
2. Production, in one sitting: reset on Neon branch `main` → Vercel Production `DATABASE_URL` = new string,
   plus the integration variables above (same new password and host values) → Redeploy the current Production
   deployment (do not push new code in the same step) → sign in on `kitchenkeeper.kitchen` and load the pantry.
   Expected outage: from the reset until the redeploy is Ready (a few minutes). Do it at a quiet time.
3. Local copies: replace or delete the stale copies in the gitignored `server/.env.vercel` (pulled 2026-07-14)
   and the root `.env`, if they hold `staging`/`main` strings. `server/.env.local` (Neon `local`) needs a change
   only if the password turns out to be shared across branches.

**Acceptance criteria**
1. Neon console shows a password reset on `neondb_owner` for `staging` and `main`, dated in this task.
2. Staging and production each: sign-in + pantry load succeed after the redeploy, and there is no new
   `NeonDbError`/`password authentication failed` issue in Sentry within 15 minutes.
3. The old production connection string fails to authenticate (Connor tests it once with `psql` or the
   Neon SQL editor's connection test, then deletes it).
4. MIGRATION_LEDGER.md is unchanged: no schema change happens in this phase.

Alternative if any downtime is unacceptable (Q3): create a 2nd role, point Vercel at it, redeploy, then
drop or rotate `neondb_owner`. That involves more steps and role grants, so it isn't the default.

---

## Phase 4 — Lint: clear the 30 pre-existing errors

`npm run lint` currently fails with 30 errors, all in `.claude/hooks/tdd/`: 29 `no-undef` (`process` ×20,
`console` ×8, `Buffer` ×1) across `approve_test_rewrite.mjs`, `lib_tdd_common.mjs`, `tdd_new_case.mjs`,
`tdd_record_result.mjs` and `tdd_stop_gate.mjs`, plus 1 `no-control-regex` (`lib_tdd_common.mjs`, an
intentional ANSI-escape strip `/\x1b\[[0-9;]*m/g`).

**Allowed files:** `eslint.config.js`. **Forbidden:** `.claude/hooks/**` (these are TDD-kit files; editing
them would make the copy here drift from the kit's source), all other files.

**Change:** add one config block: `files: ['.claude/hooks/**/*.mjs']`, `sourceType: 'module'`,
`globals: { ...globals.node }`, `rules: { 'no-control-regex': 'off' }`. Don't add ignores, don't add
eslint-disable comments.

**Acceptance criteria**
1. Before the change, `npm run lint` exits non-zero with exactly 30 errors (this is Red; already observed).
2. After the change, `npm run lint` exits 0 with 0 errors and no new warnings.
3. `git diff --stat` touches only `eslint.config.js`.

**Kind:** config only. `eslint.config.js` is not in `alwaysExemptPatterns`, so the lint run itself is the
Red/Green check (Q4: confirm this is acceptable, or add the file to the exemptions in STABLE_CONTEXT + tdd-config).

---

## Phase 5 — Non-breaking dependency bumps (in-range minor/patch)

From `npm outdated` (2026-11-03), the packages where "Wanted" is newer than "Current":

| Where | Package | Current → Wanted | Risk note |
|---|---|---|---|
| root (dev) | globals | 17.7.0 → 17.14.0 | lint only |
| root (dev) | prettier | 3.9.5 → 3.9.10 | formatting tool. Do **not** reformat the repo |
| server | @clerk/express | 1.7.81 → 1.7.84 | auth path: staging sign-in required |
| server | resend | 6.12.4 → 6.37.0 | big minor jump: check the household-invite email on staging |
| client | @clerk/clerk-react | 5.61.8 → 5.61.11 | auth path: staging sign-in required |
| client | autoprefixer | 10.5.0 → 10.6.2 | build only |
| client | driver.js | 1.8.0 → 1.10.2 | onboarding tour: check it on staging |
| client | react-hot-toast | 2.6.0 → 2.6.1 | — |

Everything else in `npm outdated` is a major bump, or is held where it is on purpose: Sentry SDKs are pinned
as one compatibility decision (TASK-068), and drizzle-kit 0.21→0.31 belongs to TASK-071. All of these are
**out of scope**. Majors not covered by TASK-071 (express 5, React 19, Vite 8, Tailwind 4, etc.) are listed
under Deferred.

**Allowed files:** `package.json`/`package-lock.json` in root, `server/`, `client/`; this TASK file.
**Forbidden:** all source and test files, and any change to a version range in a manifest unless npm writes it.

**Constraints:** `npm update <pkg>` by name only, staying in the existing ranges. No new direct dependencies.
No `npm audit fix --force`. Use a plain `npm install` afterwards: the TASK-070 gotcha was that `--omit=dev`
prunes vite. TDD-exempt (`**/package*.json`); the existing suite is the regression check.

**Acceptance criteria**
1. `npm outdated` in each directory shows Current == Wanted for the 8 packages above.
2. `npm test` (root, which includes the server tests), `npm test --prefix client` and `npm run build` give the
   same pass counts as the baseline (TASK-070: server/shared 118+225, client 75; build OK). `npm run lint` = 0
   errors if Phase 4 is done, or 30 if it isn't.
3. `npm audit --omit=dev` in `server/` and `client/` reports no advisories beyond TASK-070's remaining list.
4. Staging: sign-in, pantry load, onboarding tour step, and one invite email (if Q5 = yes) all work.
5. `git diff --stat` touches only the allowed lockfiles and manifests.

---

## Phase 6 — Remove legacy deploy files and stale SQLite files

- `fly.toml`, `Dockerfile`, `.dockerignore`: tracked; from the Fly.io/SQLite era (Apr 2026). `git grep` finds
  references only in `docs/` (historical spec / extracted text). No script, CI file, `vercel.json` or `server/` code
  uses them. The `Dockerfile` would run `server/index.js` with SQLite env vars that no longer exist.
- `kitchen-keeper.db`, `-shm`, `-wal` in the repo root: **untracked**, gitignored (`*.db*`), last modified
  2026-04-23/24. These are local-only leftovers, and deleting them does not change the repo.

**Allowed files:** delete `fly.toml`, `Dockerfile`, `.dockerignore`. Delete the three local `.db` files from disk
(Connor or Claude; not a git change). **Forbidden:** `docs/**` (historical record), `.gitignore` (its `*.db`
rules are harmless).

**Acceptance criteria**
1. `git ls-files fly.toml Dockerfile .dockerignore` → empty.
2. `ls kitchen-keeper.db*` → no such file.
3. `npm run build` OK; staging deploy Ready (proves Vercel doesn't use the Dockerfile).
4. `git grep -nE "fly\.toml|Dockerfile"` outside `docs/` and `ai/` → no matches.

**Kind:** deletion, TDD-exempt (no logic). Q6: confirm there is no Fly.io app still running that should be
destroyed first (`fly apps list`; not checked).

---

## Deferred / out of scope

- TASK-071's breaking upgrades (drizzle-orm/drizzle-kit, zod 4 + openai, @vercel/blob 2, react-router 7).
- Other major bumps with no task yet (express 5, React 19, Vite 8, Tailwind 4, Sentry 11, eslint 10, etc.; see
  `npm outdated`). Each one needs its own spec.
- TASK-069 follow-ups: log the agent's search-tool args; agent ignoring correct hits (chickpeas) and missing synonyms.
- Upstreaming the two TDD-kit fixes to the kit's source project (a different repo).
- `www.kitchenkeeper.kitchen` DNS (Q2).
- Pre-existing uncommitted `.claude/settings.local.json` and `ai/tasks/TASK-059-smoke-tests.md`: leave untouched.

## Constraints (whole task)

- No migrations and no schema changes in any phase. If one turns out to be needed, STOP and write a
  MIGRATION_LEDGER plan first.
- No new direct npm dependencies (project convention). This task declares no exceptions.
- Staging before production for every deployable phase (2, 4, 5, 6). Promote with a fast-forward of `staging` → `main`.
  After a push exits 0, report "pushed" and stop. Live checks happen in a separate step that Connor triggers.
- Don't commit credentials or connection strings.

## Open questions for Connor

- Q1: Should 4xx stay out of Sentry completely (proposed), or be reported at `warning` level or sampled?
- Q2: Should `www.kitchenkeeper.kitchen` resolve (redirect to the apex), or is apex-only intended?
- Q3: Is a few minutes of production downtime during the password rotation acceptable, or use the 2nd-role approach?
- Q4: Is the lint run an acceptable Red/Green for the `eslint.config.js` change, or should it get a formal exemption?
- Q5: Can we send one real invite email on staging to check `resend`, or should `resend` be held back?
- Q6: Is any Fly.io app or volume still provisioned?
- Q7: Please re-authenticate the `vercel` CLI (`vercel login`) so future sessions can read deployments and logs.

## Verification Steps

These are listed under each phase. Record results under each phase in this file.

## Dependency Chain

Editing: `server/instrument.js`, `server/instrument.test.js`, `server/app.js` (P2); `eslint.config.js` (P4);
root/`server`/`client` `package*.json` (P5); deleting `fly.toml`, `Dockerfile`, `.dockerignore` (P6).
Requires: Vercel dashboard + Neon console access for Connor (P1, P3); Sentry MCP (P2 verification).
Relation to TASK-071: **not a blocker for production health.** Production is up, with no real-user errors.
The drizzle-orm advisory (GHSA-gpj5-g38j-94v9, identifier escaping) and the react-router open-redirect
advisory are exposure risks that have not been exploited, not outages. Order: TASK-072 Phases 1–3 →
Phases 4–6 → TASK-071. Doing Phase 5 first means TASK-071 starts from a lockfile that is current within
ranges, and the rotated credentials are in place before TASK-071's staging verification. If Connor rates the
drizzle advisory as urgent, TASK-071's drizzle step may run straight after Phase 3, ahead of Phases 4–6.
Irrelevant: database schema, migrations, client source, `vercel.json`, the TASK-071 file.
