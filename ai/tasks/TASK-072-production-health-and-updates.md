# TASK-072 — Production Health Check and Outstanding Updates

Version: DRAFT-3 (2026-11-03). Addresses architect rounds 1–2; see "Changes" at the end.
**No implementation until Connor approves this draft and answers the questions marked as gates.**

**Found at handoff (2026-11-03), unresolved, for DRAFT-4:**
- Phase 4 is likely moot: `npm run lint` already exits 0, because commit `e3fe613` added an ESLint ignore for
  `.claude/` (the approach Phase 4 forbade). Drop Phase 4, or replace the ignore with the Phase 4 blocks.
- TASK-071 is already in progress (Green committed in `11d8417`; next is its dependency bump), so "TASK-072 →
  TASK-071" order and the Phase 5 baseline handoff no longer hold as written. Re-order around TASK-071's state.

## Goal

Make sure Kitchen Keeper works in production, then clear the outstanding non-breaking updates and open
items from CURRENT_STATE.md, one ordered phase at a time. The breaking dependency upgrades are **not** in
this task; they live in TASK-071 (see Dependency Chain).

---

## 0. Investigation findings (read-only, 2026-11-03 ~19:00 UTC)

Production is up and serving `9e243da` (client bundle release + Sentry server release). `/api/health` → 200
(it touches no DB/Clerk/OpenAI); `/api/pantry` without a session → 401 `{"error":"Authentication required"}`.
Sentry, 30 d: client 0 unresolved issues; server 1, KITCHEN-KEEPER-SERVER-2 (`Authentication required`,
`server/middleware/clerkAuth.js:7`, 504 events, 0 users, since 2026-08-17); its only 14-day events were this
investigation's `curl` probes. 4 clean `app-boot` → `auth-settled` sessions in 14 d. `www.` is NXDOMAIN (no
repo references).

**Root cause of KITCHEN-KEEPER-SERVER-2** (`server/app.js:73-83`): the error handler calls
`captureExceptionSafely(err)` and `await flush(2000)` for **every** error, so each 401 creates a Sentry
error event and delays the response by up to 2 s.

**Not verified:** authenticated flows (no production credentials used); Vercel deployments, logs and the
`/api/push/cron` run (`vercel` CLI token invalid); Neon quota/suspend state (no console access); whether
other Sentry projects/environments exist. Phase 1 covers these.

---

## Phases (strict order)

| Phase | What | Kind | Gate to start |
|---|---|---|---|
| 1 | Production smoke test (limited, intentional writes) | manual (Connor) | none |
| 2 | Stop reporting 4xx errors to Sentry (closes KITCHEN-KEEPER-SERVER-2) | code (TDD) | Phase 1 passed; **Q1 answered** |
| 3 | Rotate the Neon `neondb_owner` password and update Vercel env vars | manual (Connor) | Phase 1 passed; Phase 2 promoted to `main` (or explicitly paused by Connor); no deploy in progress; **Q3 answered**; Phase 3 stop/go gates G1–G3 pass |
| 4 | Lint config: clear the 30 pre-existing `.claude/hooks/tdd/*.mjs` errors | config (lint run is the test) | Phase 3 complete |
| 5 | Non-breaking minor/patch dependency bumps | `package*.json` only (TDD-exempt) | Phases 2 and 4 complete; **Q5 answered** |
| 6 | Remove legacy Fly.io/Docker files from the repo | file deletion | Phase 5 complete; **Q6 answered** |

Phases run one at a time; no phase starts while an earlier phase is unfinished or a deploy is in flight.
Each phase ends **COMPLETE** (its criteria pass) or **PAUSED** (Connor says so in conversation, recorded in its
Results with the phase(s) it unblocks). A PAUSED phase unblocks only the phase Connor names; it does not count
as complete for any later gate. Only Connor can pause a phase or relax the order; an agent may not. Phases 2, 4, 5 and 6 are each
their own commit. Each goes to `staging` first and is promoted to `main` (fast-forward) only after its
staging check passes. Phase 3 does not change the repo except to record results in this file.

**Every phase:** the only repo file an agent may edit besides the phase's own allowed files is this TASK
file, and within it only that phase's **Results** block. Never record credentials, connection strings or
tokens in this file.

---

## Phase 1 — Production smoke test (Connor, limited intentional writes)

Production looks healthy (§0), so this phase confirms the parts §0 could not check. Steps 3–5 **write to
production** (a chat turn, an AI usage count, a test pantry item, a Blob object). That is intended.

**Allowed files:** this TASK file, Phase 1 Results block only. **Forbidden:** all application source,
configuration, manifests, lockfiles, env files and credentials.

**Test-data rules**
- Use clearly marked content: pantry item `TASK-072 smoke test`, chat text starting `TASK-072 smoke:`.
- Upload a non-personal image (e.g. a photo of a generic product or a plain test image). No people, no
  documents, no location-bearing photos.
- After the checks, Connor deletes the test pantry item and the uploaded image through the app. The chat
  turn may stay (it is Connor's own history).
- One chat message only. It counts against Connor's own AI rate limit and OpenAI usage; one message is
  within both (billing risk was accepted 2026-08-11).

**Before step 2: Sentry baseline (N1).** Record in Results: the list of unresolved issue IDs in
`kitchen-keeper-server` and `kitchen-keeper-client`, and the event count of KITCHEN-KEEPER-SERVER-2.

**Acceptance criteria (health matrix)**

| # | Component | Check | Pass |
|---|---|---|---|
| 1 | Vercel routing | `curl -s -o /dev/null -w '%{http_code}' https://kitchenkeeper.kitchen/api/health` | `200` |
| 2 | Clerk + Neon `main` | Connor signs in at `https://kitchenkeeper.kitchen`; the pantry list loads | list renders with real items |
| 3 | Neon write | Add pantry item `TASK-072 smoke test`, reload | item persists |
| 4 | OpenAI + retrieval | Chat: `TASK-072 smoke: what's in my <name of a recipe Connor has saved>?` | reply names that recipe's actual ingredients |
| 5 | Blob | Upload the test image through any Blob-backed upload flow | upload succeeds and the image displays |
| 6 | Vercel deploy | Dashboard: current Production deployment | commit `9e243da` (or later promoted SHA), status Ready |
| 7 | Cron | Dashboard: latest `/api/push/cron` invocation (daily 08:00 UTC) | not an error |
| 8 | Neon quota | Console: project state and compute-hours this month | not suspended; record used vs. limit |
| 9 | Sentry | Compare with the baseline after steps 2–5: list every event since the baseline, in new **and** existing issues | no new issue IDs; every new event classified in Results. The only accepted unexpected-looking events are 401s on KITCHEN-KEEPER-SERVER-2 from this session (the Phase 2 noise); any other event = fail |

Criterion 4 is **indirect** evidence for `search_documents`: the reply can only be right if the agent
retrieved that recipe, but the tool call itself is not logged (logging the search-tool args is a deferred
TASK-069 follow-up). Pick a recipe whose ingredients the model could not guess from its name.

**Verification:** Connor records pass/fail per row in Results. Any failure stops the task: debug that
failure first (load the `smoke-testing` skill) and re-scope before going on.

**Results** (2026-11-03, run by Claude in Chrome as Connor's signed-in session, at Connor's request):

- **N1 baseline (20:59Z):** `kitchen-keeper-server` unresolved = KITCHEN-KEEPER-SERVER-2 only (505 events,
  last 18:58Z); `kitchen-keeper-client` = none. (`NONPROFIT-NETWORK-*` issues are a different project.)
- **Row 1 PASS:** `/api/health` → `200`.
- **Row 2 PASS (adjusted):** signed in; `/api/pantry` and `/api/recipes` → `200`, but both lists were **empty**.
  Connor confirmed empty is expected (chat history shows an earlier "compost all of the items" request
  that cleared the pantry). Pass condition "renders with real items" relaxed to "renders, 200, correct account".
- **Row 3 PASS:** added `TASK-072 smoke test` via the form; persisted after reload.
- **Row 5 PASS:** with no saved recipes, and Blob used only for recipe images (`recipeService.uploadImage`), a
  generated plain-text recipe card (no personal content) went through "Upload Recipe Image" → saved as
  `TASK-072 Smoke Test Recipe`; Blob URL → `200 image/jpeg`, `<img>` rendered.
- **Row 4 PASS:** one message, `TASK-072 smoke: what's in my TASK-072 Smoke Test Recipe?` → reply listed the exact
  ingredients (black garlic paste, lychee juice, saffron threads, yuzu kosho tofu) and steps. Substitute for
  "a recipe Connor has saved", since there were none; the recipe was created minutes earlier (indirect evidence
  for `search_documents`, as before).
- **Cleanup:** recipe deleted (204) and pantry item deleted (200); both lists back to 0; Blob URL → `404`.
  The chat turn remains (Connor's own history).
- **Row 6 PASS:** current Production deployment = `e3fe613` (main), Ready (later than `9e243da`).
- **Row 7 NOT VERIFIED:** cron `/api/push/cron` `0 8 * * *` is Enabled, but Hobby runtime logs only reach back
  ~1 h, so the 08:00Z run isn't visible. "Run" was not pressed (it would send real push notifications).
  Connor: check logs shortly after a 08:00Z run.
- **Row 8 PASS:** project `neon-violet-compass` (3 branches), compute last active minutes earlier, not
  suspended. Usage since 2026-11-01: 0.11 CU-hrs compute, 0.07 GB storage. Plan: Free, subscription managed by
  Vercel; the console shows no numeric compute limit (Billing points to Vercel → Integrations → Neon).
- **Row 9 PASS:** no issue seen in the last hour in either project; SERVER-2 still 505 events (no new events,
  because every request in this run was authenticated).

**Status: COMPLETE** (Connor, 2026-11-03). Rows 1–6, 8 and 9 pass. Row 7 (cron) is a carried-over check for
Connor, not a failure, and it does not block Phase 2.

---

## Phase 2 — Don't report expected 4xx to Sentry

**Gate:** Q1 answered. The contract below assumes the recommended answer (no Sentry exception for any 4xx;
5xx and status-less errors keep being reported; no warning-level or sampled reporting). If Connor picks
warning or sampling instead, this phase is re-specced before Red.

**Allowed files:** `server/instrument.js`, `server/instrument.test.js`, `server/app.js`, this TASK file (Results).
**Forbidden files:** `server/middleware/clerkAuth.js` (the 401 itself is correct), the client, all other
server files, `package*.json`.

**Constraints:** TDD applies (`server/**` is a sensitive path). No new dependencies.

**Interface contract**
- New export in `server/instrument.js`: `shouldReportError(err) → boolean`.
  - It uses **the same status the error handler responds with**: `status = err?.status || 500`
    (`server/app.js` uses `err.status || 500` and ignores `statusCode`). Returns `status >= 500`.
  - Never throws, for any input: the whole status read **and** comparison sit inside one `try`; the `catch`
    returns `true` (if classification fails, report rather than suppress). `undefined`/`null`/non-object/a
    throwing getter/a Symbol status/a throwing Proxy → `true`.
- In `server/app.js`, the error handler calls `captureExceptionSafely(err)` **and** `await flush(2000)` only
  when `shouldReportError(err)` is `true`. Nothing else in the handler changes: `console.error(err.stack)` still
  runs for every error, the status, body (`error`, optional `code`), headers (the handler sets none of its
  own) and control flow (it always responds, never calls `next`) stay as they are.

Why not `statusCode` (DRAFT-1 had `err?.status ?? err?.statusCode`): an error with only `statusCode: 403` gets
a **500** response from the current handler. Skipping Sentry for it would hide a real 500. (body-parser sets
both `status` and `statusCode`, so it is covered by `status`.)

**Acceptance criteria**
1. `shouldReportError({ status: 401 })` → `false`; `{ status: 400 }`, `{ status: 404 }`, `{ status: 429 }` → `false`.
2. `shouldReportError({ status: 500 })`, `{ status: 503 }`, `new Error('x')` (no status) → `true`.
3. `shouldReportError({ statusCode: 403 })` → `true` (the handler answers it with 500).
4. `const e = new Error('x'); e.status = 401;` → `false` (a real `Error` instance, not only a plain object).
5. `shouldReportError(undefined)` / `(null)` / `('str')` / `(42)` → `true`, and none of these throw.
6. An object whose `status` getter throws → `true`, and the call does not throw.
6a. `{ status: Symbol('x') }` → `true` (a bare `>=` on a Symbol throws `TypeError`); a `Proxy` whose `get` trap
    throws → `true`. Neither call throws.
7. On staging, after deploy: one unauthenticated `curl` to `/api/pantry` → 401 with body
   `{"error":"Authentication required"}` (unchanged), and **no** new KITCHEN-KEEPER-SERVER-2 event with the
   staging release SHA in Sentry within 5 minutes.
8. After promotion to production: the same probe → same 401 and body, and no new event for release = the
   promoted SHA. Connor then resolves KITCHEN-KEEPER-SERVER-2 in Sentry (manual).

**Verification:** Red (criteria 1–6a fail, because the export is missing) → Green → `npm test` (root, which
runs the server tests) and `npm run lint` show no new failures → push `staging` → stop ("pushed") →
criterion 7 when Connor triggers it → fast-forward `main` → stop ("pushed") → criterion 8 when Connor triggers it.

**Results** (2026-11-03):
- Q1 answered by Connor ("nevermind, proceed" after first raising warning/sampled) = out completely, as contracted.
- Tests are in a new file, `server/shouldReportError.test.js` (Connor: "New test file"), because
  `server/instrument.test.js` is locked append-only and appending was denied by the hook. Same Sentry mock pattern.
- Red: 8/8 tests (criteria 1–6a) failed with `TypeError: instrument.shouldReportError is not a function`.
- Green: `shouldReportError` exported from `server/instrument.js`; `server/app.js` calls `captureExceptionSafely`
  and `flush(2000)` only when it returns true. Nothing else in the handler changed.
- Root `npm test`: exit 0 (118 + 245 pass, 0 fail, 0 skipped). `npm run lint`: exit 0.
- Criteria 7 and 8: not run; they wait for Connor to trigger them after the staging deploy and the promotion to main.

---

## Phase 3 — Rotate the Neon `neondb_owner` password (Connor)

The staging and production connection strings were pasted into chat during TASK-069.
**Allowed files:** this TASK file (Results only; never credentials). **Forbidden:** committing or writing
any connection string, password or token anywhere in the repo, including this file.

**Facts the order depends on** (verified 2026-11-03 by `grep` of the repo, names only)
- The only Postgres variable the code reads is `DATABASE_URL` (`server/db/client.js`, `drizzle.config.js`).
  No code reads `PG*`, `POSTGRES_*`, `DATABASE_URL_UNPOOLED` or `NEON_*`.
- A running Vercel deployment keeps the env values it was built with. Changing a variable has no effect until
  a **redeploy**. Vercel Instant Rollback to an older deployment brings back the **old** env values, so after
  the reset it is not a recovery path (see Recovery).

**Credential handling (whole phase).** Never put a credential-bearing string on a command line (`psql "<url>"`
exposes it to process listings and shell history). Never print, echo or log a connection string or password;
no shell tracing (`set -x`, `Set-PSDebug -Trace`) while handling them; never paste them into Results, chat,
Sentry notes, error reports or screenshots. Close any shell that held one when the phase ends.

**Connection test** (used in S2, P2 and criterion 4). The Neon SQL editor does **not** test the password (it
runs as the console user), so it is not sufficient. In a fresh PowerShell window:
`$env:PGHOST`, `$env:PGUSER`, `$env:PGDATABASE` = the host/role/database (not secret), `$env:PGSSLMODE='require'`,
`$env:PGPASSWORD = Read-Host -MaskInput` (paste the password), then `psql -c 'select 1'` → `1`. libpq reads
these from the environment, so nothing secret is in the arguments or history. Close the window afterwards.

### Stop/go gates (all must pass before any reset; any mismatch = STOP and re-spec)

**G1 — Branch independence (N3).** In the Neon console, establish whether `neondb_owner`'s password is
per-branch or shared across `main`/`staging`/`local`. Record the finding and how it was established (the
console's own statement or docs, not branch names or connection-string shape). **If it is shared:** STOP.
The staging-first rehearsal below would break production, so the order must be re-specced. (Neon's docs say
roles and password resets are branch-scoped; that is the expected answer, but G1 checks this project's actual state.)

**G2 — Env-var inventory (B4).** Connor fills this table from the Vercel dashboard (Settings → Environment
Variables), **names and targets only, no values**. The names are pre-filled from the gitignored
`server/.env.vercel` (pulled 2026-07-14; may be stale). "Consumer" is from the repo grep above.

**`DATABASE_URL` — one row per effective configuration.** Vercel can hold several values for one name: a
Production value, an all-branches Preview value, branch-specific Preview overrides, and a Development value.
List **every** one shown in the dashboard; do not assume every Preview deployment uses `staging`.

| Scope | Branch restriction | DB target | Managed by | Planned action |
|---|---|---|---|---|
| Production | — | expected `main` | | update in P2 with the new `main` string |
| Preview | `staging` | expected `staging` | | update in S3 with the new `staging` string |
| Preview | all other branches (if a value exists) | | | if `main` or `staging`: update with that branch's new string, in the same step as that branch; if absent, record "none" |
| Development | — | | | if `main` or `staging`: update with that branch's new string, in the same step; if Neon `local` or absent: leave unchanged (G1: `local` is not rotated). Local dev reads `server/.env.local`, not this value |
| _(any other row found)_ | | | | STOP |

**Other variables** (scopes P/Pv/D, each with its branch restriction if any):

| Variable | Scopes present | DB target per scope | Managed by (Neon integration / manual) | Runtime consumer | Planned action |
|---|---|---|---|---|---|
| `DATABASE_URL_UNPOOLED` | | expected: `main` in all | | none | see rule below |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` | | expected: `main` in all | | none | see rule below |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` | | expected: `main` in all | | none | see rule below |
| `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | | n/a (no password) | | none | leave unchanged |

Rule for the no-consumer integration variables: if they are **integration-managed**, leave them to the
integration and observe what it does after the reset (G3). If they are **manual**, update them in step P2
alongside `DATABASE_URL` so no stale password is left in Vercel. Never remove a variable in this phase.
STOP if: the table has a DB-related variable not listed here, a `DATABASE_URL` row's target differs from its
expected/planned value, a `DATABASE_URL` configuration exists that has no row, or any other project/deployment/external tool turns out to consume these variables.

**G3 — Integration behaviour.** From the Neon and Vercel docs or integration settings, establish whether the
Neon–Vercel integration rewrites env vars after a password reset, and whether it would overwrite the
per-scope `DATABASE_URL` mapping. If unknown, the staging rehearsal (S1–S4) is the test: check every row of
the G2 table again right after S1. Any variable that changed without Connor changing it = STOP.

### Order

**Staging rehearsal**
- S1. Reset `neondb_owner` on Neon branch `staging`. Re-check the G2 table (G3).
- S2. Run the connection test with the new staging password → `1`.
- S3. Set every `DATABASE_URL` row planned for `staging` (at least Preview / `staging`) to the new string →
  Redeploy the latest `staging` deployment.
- S4. Sign in on the staging URL and load the pantry.

**Production (one sitting, at a quiet time)**
- P0. Before the reset, record in Results: current Production deployment ID and commit SHA, the time, and
  that the Vercel env-var edit page and the deployment's Redeploy action are open and available. Confirm no
  other deploy is building.
- P1. Reset `neondb_owner` on Neon branch `main`. **The outage starts here.**
- P2. Run the connection test with the new production password → `1`. Then set every `DATABASE_URL` row
  planned for `main` (at least Production), and any manual integration variables per the G2 rule, to the new values.
- P3. Redeploy the deployment recorded in P0 (no new code in the same step).
- P4. Sign in on `kitchenkeeper.kitchen` and load the pantry. **The outage ends here.**

**Local copies (after production passes)**
- L1. Replace or delete the stale copies in the gitignored `server/.env.vercel` and the root `.env`, if they hold
  `staging`/`main` strings. `server/.env.local` (Neon `local`) is untouched (G1 established branch independence).

### Recovery (B5)

There is no "undo": a reset password cannot be restored, and rolling back to an older deployment restores
the old (now invalid) env values. Recovery is always **forward**:
- P2's direct test fails → do not touch Vercel. Re-copy the string from the Neon console and retest; if it
  still fails, reset again and retest. Production stays down; record the state in Results.
- P3's redeploy fails or the deployment errors → check the build log; retry the redeploy once. If it fails
  again, STOP and record in Results: deployment ID, error, which env vars were changed, Neon reset time.
  Any further step (another reset, a second role, a code change) needs Connor's explicit decision.
- P4 fails after a Ready deploy → check Sentry for `password authentication failed` (wrong value in Vercel)
  vs. other errors; fix the value and redeploy. Anything other than a wrong value = STOP, as above.
- An agent assisting with this phase never decides on its own to reset, roll back or create roles.

**Acceptance criteria**
1. G1–G3 results recorded in Results.
2. Neon console shows a password reset on `neondb_owner` for `staging` and `main`, dated in this task.
3. Staging and production each: the direct test returns `1`, sign-in + pantry load succeed after the
   redeploy, and there is no new `NeonDbError`/`password authentication failed` issue in Sentry within 15 minutes.
4. The old production password fails the connection test (run once, then Connor deletes every copy of it).
5. The G2 table re-checked after P4 matches the planned actions (no variable changed unexpectedly).
6. MIGRATION_LEDGER.md is unchanged: no schema change happens in this phase.

Alternative if any downtime is unacceptable (Q3): create a 2nd role, point Vercel at it, redeploy, then
rotate `neondb_owner`. The new role needs exactly the privileges the app uses (table read/write, sequence
usage, and for migrations, ownership or DDL rights on the `public` schema objects). Do not assume a fresh role
can replace `neondb_owner`. Choosing this means re-speccing Phase 3 first.

**Results:** _(empty)_

---

## Phase 4 — Lint: clear the 30 pre-existing errors

`npm run lint` currently fails with 30 errors, all in `.claude/hooks/tdd/`: 29 `no-undef` (`process` ×20,
`console` ×8, `Buffer` ×1) across `approve_test_rewrite.mjs`, `lib_tdd_common.mjs`, `tdd_new_case.mjs`,
`tdd_record_result.mjs` and `tdd_stop_gate.mjs`, plus 1 `no-control-regex` (`lib_tdd_common.mjs`, an
intentional ANSI-escape strip `/\x1b\[[0-9;]*m/g`).

**Allowed files:** `eslint.config.js`, this TASK file (Results). **Forbidden:** `.claude/hooks/**` (these are
TDD-kit files; editing them would make the copy here drift from the kit's source), all other files.

**Change:** add exactly these two blocks, using the existing `languageOptions` shape the file already uses:

```js
{
  files: ['.claude/hooks/**/*.mjs'],
  languageOptions: {
    sourceType: 'module',
    globals: { ...globals.node },
  },
},
{
  // Intentional ANSI-escape strip in the TDD kit (/\x1b\[[0-9;]*m/g); kit files are not edited here.
  files: ['.claude/hooks/tdd/lib_tdd_common.mjs'],
  rules: { 'no-control-regex': 'off' },
},
```

Don't add ignores, don't add eslint-disable comments, don't change other blocks.

**Acceptance criteria**
1. Before the change, `npm run lint` exits non-zero with exactly 30 errors (this is Red; already observed).
2. After the change, `npm run lint` exits 0 with 0 errors and no new warnings.
3. `git diff --stat` touches only `eslint.config.js` (plus this file's Results).

**Kind:** config only. `eslint.config.js` is not in `alwaysExemptPatterns`, so the lint run itself is the
Red/Green check (Q4; recommended: yes, no formal exemption).

**Results:** _(empty)_

---

## Phase 5 — Non-breaking dependency bumps (in-range minor/patch)

From `npm outdated` (2026-11-03), the packages where "Wanted" is newer than "Current":

| Where | Package | Current → Wanted | Risk note |
|---|---|---|---|
| root (dev) | globals | 17.7.0 → 17.14.0 | lint only |
| root (dev) | prettier | 3.9.5 → 3.9.10 | formatting tool. Do **not** reformat the repo |
| server | @clerk/express | 1.7.81 → 1.7.84 | auth path: staging sign-in required |
| server | resend | 6.12.4 → 6.37.0 | big minor jump: **only if Q5 = yes**; otherwise held back and listed as deferred |
| client | @clerk/clerk-react | 5.61.8 → 5.61.11 | auth path: staging sign-in required |
| client | autoprefixer | 10.5.0 → 10.6.2 | build only |
| client | driver.js | 1.8.0 → 1.10.2 | onboarding tour: check it on staging |
| client | react-hot-toast | 2.6.0 → 2.6.1 | — |

Everything else in `npm outdated` is a major bump, or is held where it is on purpose: Sentry SDKs are pinned
as one compatibility decision (TASK-068), and drizzle-kit 0.21→0.31 belongs to TASK-071. All of these are
**out of scope**. Majors not covered by TASK-071 (express 5, React 19, Vite 8, Tailwind 4, etc.) are listed
under Deferred.

**Allowed files:** `package.json`/`package-lock.json` in root, `server/`, `client/`; this TASK file (Results).
**Forbidden:** all source and test files, and any change to a version range in a manifest.

**Procedure (B8)**
1. Baseline, recorded in Results: the current commit SHA, `npm outdated` output for each directory, and the
   baseline test/build/audit numbers (criterion 3–4 figures).
2. Update only the approved packages: `npm update <pkg> [<pkg>…]` by name, in the directory that owns them.
   No `npm audit fix` (forced or not), no new direct dependencies.
3. Run a plain `npm install` in each changed directory (the TASK-070 gotcha: `--omit=dev` prunes vite).
4. Inspect `git diff` of every `package.json`: **no changes at all** to dependency ranges. (npm may not need to
   write a manifest for an in-range update; any manifest change = STOP.)
5. Inspect every lockfile diff. List each package whose resolved version changed. Allowed: the approved
   packages, plus transitive deps pulled **only** by those packages' new versions. Establish this with a tree
   comparison (`npm ls --all` saved before step 2 and after step 3, diffed: every changed node must sit under an
   approved package); use `npm explain <dep>` only for nodes the diff leaves unclear. Any other change (e.g. an unrelated transitive bump, a removed
   package, a changed `resolved` registry) = revert that directory's lockfile and STOP.
6. Run the full regression set (criteria 3–4), then push `staging` and stop ("pushed").

**Acceptance criteria**
1. `npm outdated` in each directory shows Current == Wanted for every approved package (7 if Resend is held back).
2. The lockfile change list from procedure step 5 is recorded in Results and contains only allowed changes; no
   manifest range changed.
3. `npm test` (root, which includes the server tests), `npm test --prefix client` and `npm run build` give the
   same pass counts as the baseline (TASK-070: server/shared 118+225, client 75, plus whatever Phase 2 added;
   build OK). `npm run lint` = 0 errors (Phase 4 is done by the gate).
4. `npm audit --omit=dev` in `server/` and `client/` reports no advisories beyond TASK-070's remaining list.
5. Staging (when Connor triggers it): sign-in, pantry load, the onboarding tour's first step, and, if Resend
   was updated, one real invite email to a Connor-controlled address arrives and its link works.
6. `git diff --stat` touches only the allowed lockfiles and manifests (plus this file's Results).

**TASK-071 baseline handoff (N6).** On promotion to `main`, record in Results: the promoted commit SHA (this is
TASK-071's starting lockfile), the final versions of the approved packages, the test/build/audit results, and
any package held back (e.g. Resend). TASK-071 starts from exactly that SHA.

**Results:** _(empty)_

---

## Phase 6 — Remove legacy deploy files from the repo

- `fly.toml`, `Dockerfile`, `.dockerignore`: tracked; from the Fly.io/SQLite era (Apr 2026). `git grep` finds
  references only in `docs/` (historical spec / extracted text). No script, CI file, `vercel.json` or `server/` code
  uses them. The `Dockerfile` would run `server/index.js` with SQLite env vars that no longer exist.

**Scope is repository cleanup only (N4).** Deleting these files does not touch any Fly.io infrastructure.
Before deleting, Connor inventories Fly.io (`fly apps list`, `fly volumes list` per app, or the Fly dashboard)
and records what exists in Results (Q6). Nothing on Fly.io is destroyed in this task; if anything exists,
decommissioning gets its own task.

**Allowed files:** delete `fly.toml`, `Dockerfile`, `.dockerignore`; this TASK file (Results). **Forbidden:**
`docs/**` (historical record), `.gitignore` (its `*.db` rules are harmless).

**Acceptance criteria**
1. `git ls-files fly.toml Dockerfile .dockerignore` → empty.
2. `npm run build` OK; staging deploy Ready (proves Vercel doesn't use the Dockerfile).
3. `git grep -nE "fly\.toml|Dockerfile"` outside `docs/` and `ai/` → no matches.
4. Fly.io inventory recorded in Results.

**Kind:** deletion, TDD-exempt (no logic).

**Local SQLite files (N5, optional, Connor only).** `kitchen-keeper.db`, `-shm`, `-wal` in the repo root are
untracked and gitignored (`*.db*`), last modified 2026-04-23/24. They are not part of this phase's diff. An agent
does not delete them. If Connor wants them gone: confirm no local process has them open and that the data isn't
wanted (or copy them somewhere outside the repo first), then delete them by hand.

**Results:** _(empty)_

---

## Deferred / out of scope

- TASK-071's breaking upgrades (drizzle-orm/drizzle-kit, zod 4 + openai, @vercel/blob 2, react-router 7).
- Other major bumps with no task yet (express 5, React 19, Vite 8, Tailwind 4, Sentry 11, eslint 10, etc.; see
  `npm outdated`). Each one needs its own spec.
- `resend` 6.37 if Q5 = no.
- TASK-069 follow-ups: log the agent's search-tool args; agent ignoring correct hits (chickpeas) and missing synonyms.
- Upstreaming the two TDD-kit fixes to the kit's source project (a different repo).
- Fly.io decommissioning, if Phase 6's inventory finds anything.
- `www.kitchenkeeper.kitchen` DNS (Q2).
- Pre-existing uncommitted `.claude/settings.local.json` and `ai/tasks/TASK-059-smoke-tests.md`: leave untouched.

## Constraints (whole task)

- No migrations and no schema changes in any phase. If one turns out to be needed, STOP and write a
  MIGRATION_LEDGER plan first.
- No new direct npm dependencies (project convention). This task declares no exceptions.
- Staging before production for every deployable phase (2, 4, 5, 6). Promote with a fast-forward of `staging` → `main`.
  After a push exits 0, report "pushed" and stop. Live checks happen in a separate step that Connor triggers.
- Don't commit or record credentials, connection strings or tokens.
- Any STOP condition in a phase ends the agent's work on the task until Connor re-scopes.

## Open questions for Connor (gates marked)

| Q | Question | Gate for | Recommendation |
|---|---|---|---|
| Q1 | Should 4xx stay out of Sentry completely, or be reported at `warning` level or sampled? | Phase 2 | Out completely (the Phase 2 contract) |
| Q2 | Should `www.kitchenkeeper.kitchen` resolve (redirect to the apex), or is apex-only intended? | nothing | Defer; apex-only |
| Q3 | Is a few minutes of production downtime during the rotation acceptable, or use the 2nd-role approach? | Phase 3 | Accept a short, quiet-time outage |
| Q4 | Is the lint run an acceptable Red/Green for the `eslint.config.js` change? | Phase 4 | Yes, no formal exemption |
| Q5 | Can we send one real invite email on staging to a controlled address to check `resend`? | Phase 5 (Resend only) | Yes; otherwise Resend is held back |
| Q6 | Is any Fly.io app or volume still provisioned? (answered by the Phase 6 inventory) | Phase 6 | Inventory only; decommission separately |
| Q7 | Re-authenticate the `vercel` CLI (`vercel login`) when convenient | nothing | Not a prerequisite |

## Verification Steps

Listed under each phase. Record results in each phase's **Results** block in this file.

## Dependency Chain

Editing: `server/instrument.js`, `server/instrument.test.js`, `server/app.js` (P2); `eslint.config.js` (P4);
root/`server`/`client` `package*.json` (P5); deleting `fly.toml`, `Dockerfile`, `.dockerignore` (P6); this TASK
file's Results blocks (all phases).
Requires: Vercel dashboard + Neon console access for Connor (P1, P3); Sentry MCP (P1 baseline, P2 verification);
Fly.io access for Connor (P6 inventory).
Relation to TASK-071: **not a blocker for production health.** Production is up, with no real-user errors.
The drizzle-orm advisory (GHSA-gpj5-g38j-94v9, identifier escaping) and the react-router open-redirect
advisory are exposure risks that have not been exploited, not outages. Order: TASK-072 Phases 1–6 in sequence →
TASK-071, starting from the SHA recorded in Phase 5's baseline handoff. If Connor rates the drizzle advisory as
urgent, Connor may explicitly move TASK-071's drizzle step to straight after Phase 3; it would then start from the
current `main` SHA, recorded at that point.
Irrelevant: database schema, migrations, client source, `vercel.json`, the TASK-071 file.

---

## Changes

**DRAFT-2 (round 1):** all of B1–B8 and N1–N7 accepted (B3 as a Q1 gate; B5 adjusted to forward-only recovery,
because a reset can't be undone and a Vercel rollback restores the old env). New fix found while addressing N2:
DRAFT-1's `err.statusCode` fallback would have hidden real 500s, since the handler responds with
`err.status || 500` and ignores `statusCode`. Phase 2 criterion 3 is now `true`.

**DRAFT-3 (round 2):** B1 per-configuration `DATABASE_URL` inventory (branch-specific Preview, Development rule).
B2 credential-handling rules; connection test via libpq env vars, not argv. Adjusted: the Neon SQL editor is
**not** accepted as the test, because it doesn't authenticate with the role's password. B3 whole-body `try`,
Symbol/Proxy criterion 6a. Also: COMPLETE/PAUSED phase semantics, Phase 1 Sentry per-event classification,
Phase 5 tree-diff causality.
