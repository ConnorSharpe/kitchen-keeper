# TASK-071 — Dependency Security Update (Phase B: breaking upgrades)

Version: DRAFT-5 (2026-11-03). Spec only; nothing implemented. For architect re-review (round 5).

Phase A is TASK-070 (non-breaking `npm audit` fixes). Every production advisory still open needs a major
upgrade. This file recommends the split (§2) and fully specifies **TASK-071 = drizzle-orm 0.29.5 → 0.45.4**
(§3–§9). The other tasks are scoped in `ai/plans/dependency-phase-b-followons.md`.

## Architect Review History

**Round 1 (DRAFT-1 → DRAFT-2): request changes. All findings accepted.**

| # | Fix in DRAFT-2 |
|---|---|
| B1 G3 ordered before the bump | §9 splits pre-bump and post-bump gates under one numbered order |
| B2 count/max ≠ ledger identity | AC6 and staging/prod compare the full ordered ledger + md5 fingerprint |
| B3 retry not tested | AC3b–d drive `create()`/`getOrCreate()` through a forced collision (mocked `randomBytes`, real DB) |
| B4 "never throws" not guaranteed | §7 fixes the walk order, try/catch, and depth (err + ≤5 causes); AC2 i–l |
| N1 Q1 zod first | §2: interim TASK-075 `.max()` bounds recommended; **owner decision open** |
| N2 G2 too narrow | G2 is an 8-point decision checklist; STOP only on unexplained semantic differences |
| N3 server suite implicit | AC4 lists `npm test --prefix server` explicitly |
| N4 file limit ambiguous | §6: ≤5 production source files; tests/manifests/lockfile/docs excluded |
| N5 G4 decision record | §9 G4 per-consumer decision table |

**Round 2 (DRAFT-2 → DRAFT-3): request changes, close to approval.**

| # | Assessment | Fix in DRAFT-3 |
|---|---|---|
| B1 incident recovery | Accepted. "Ledger row" meant MIGRATION_LEDGER.md, not `__drizzle_migrations`, so the two sentences didn't literally conflict. But the real point stands: a code revert doesn't undo SQL that already ran, so it can't be the default recovery | §9 Migration/deploy: a 6-step incident procedure; no revert without a reviewed plan once the ledger changed |
| B2 "step 7 doesn't exist" | Partly accepted. Step 7 (the bump) exists in the source, but `1. G1 · 2. G2 · …` on one line made markdown renumber the list so it showed 6 items | §9 Order: one step per line; gates now name the step ("Order step 7, the dependency bump") |
| N1 Q1 status | Accepted | §2 and §12 state the deferral/exposure/acceptance status separately |
| N2 fingerprint | Accepted | `COALESCE` for an empty ledger; the listing is authoritative and the fingerprint is a comparison aid |
| N3 cleanup | Accepted. Checked: `create()` writes only `households`; `getOrCreate()` writes `households` + an onboarding flow row (`onboardingService.upsertFlow`) | AC3 cleanup contract with identifiers and a post-cleanup zero-row check |

**Round 3 (DRAFT-3 → DRAFT-4): request changes, one blocker.**

| # | Assessment | Fix in DRAFT-4 |
|---|---|---|
| B1 cleanup can delete pre-existing rows | Accepted. `join_code` is unique, so if a chosen C1 already existed the seed insert would fail and the by-join-code cleanup would delete a household the test never created | AC3 isolation contract: per-run codes verified absent, cleanup only by captured PKs (+ the verified-absent synthetic `clerkUserId`), and a check that pre-existing rows are untouched |
| (author) shared C2 | Found while revising: 3b and 3c both ended on one C2, so 3c would collide on C2 if 3b's row still existed and fail for the wrong reason | Each sub-test gets its own fresh C2 |
| (author) uncaptured id | Found while revising: if `getOrCreate`'s insert succeeds and `upsertFlow` then throws, the household id is never returned | The synthetic `clerkUserId` (unique, verified absent) is an allowed cleanup selector |

**Round 4 (DRAFT-4 → DRAFT-5): request changes, one blocker.**

| # | Assessment | Fix in DRAFT-5 |
|---|---|---|
| B1 `clerkUserId` selector scope | Accepted; option 1 (narrow). Checked: `create()` writes only `households`; `getOrCreate()` writes `households` and, via `onboardingService.upsertFlow`, only `user_onboarding`; `server/db/migrations` defines no triggers | Selector (iii) is limited to those two tables, which are exactly the tables checked for absence |
| Mock sequencing (non-blocking) | Accepted | One module instance and one armed/disarmed dispatcher, reset per sub-test; disarmed calls go to the real `randomBytes` and aren't counted |

## 0. Baseline (2026-11-03, `npm audit --omit=dev`, after TASK-070)

Open production advisories: drizzle-orm (GHSA-gpj5, high, fix ≥0.45.2, no real exposure: one constant
`.as('trigger')` and no `sql.identifier`); zod/openai (GHSA-mrhx, high, **real exposure**); @vercel/blob via
undici 5/@fastify/busboy (high, low exposure); react-router client (moderate, none). The full table is in
`ai/plans/dependency-phase-b-followons.md`.

**Prerequisite:** TASK-070's lockfile changes are still uncommitted. Every Phase B task starts only after
TASK-070 is committed and on `staging`.

## 1. Investigation

### 1.1 drizzle-orm (+ drizzle-kit 0.21.4 → 0.31.11)

**Surface:** 21 files. `drizzle()` and `migrate()` (neon-http); pg-core tables, `customType` (vector, tsvector),
`timestamp({mode:'string'})` (only on `search_documents`), `jsonb`; operators; `.returning()`,
`onConflictDoUpdate/DoNothing`; `db.execute(sql…)` (indexer ×12, searchService ×3, backfill ×1); `sql.raw`
(constant). There are no `db.query.*`, transactions or `index()` definitions.

| Upstream change | Impact |
|---|---|
| 0.30.0 pg timestamp mapping aligned across drivers | `db.execute` rows may switch Date↔string. `searchService.toIso` accepts both. Indexer → **G4** |
| 0.31.0 index API, native `vector` | None (no `index()`). Do not adopt native vector here |
| **0.44.0 `DrizzleQueryError` wraps all driver errors** | **`householdService.js:180,:294` check `err.code==='23505' && err.constraint===…`**. If those props move to `err.cause`, the join-code collision retry silently stops. `app.js:82` stops echoing PG codes to clients (accepted) |
| 0.45 peer `@neondatabase/serverless >=0.10.0` | 0.10.4 is installed; no bump |
| neon-http still has no interactive transactions | No change |
| Migrator: no documented 0.x change (the `__drizzle_migrations` changes found are v1-only) | **Highest-consequence unknown.** A semantic change could re-run `0000`…`0021_drop_byok` at prod boot → **G2** |
| `db.execute` return shape 0.30–0.45 unconfirmed | indexer/search use tolerant `rowsOf()`. **`backfillSearchDocuments.js:84` uses `.rows ?? []`**: if the shape became an array, the backfill silently selects zero households → **G4** |

**drizzle-kit:** a devDependency, run only by root `db:generate`/`db:studio`. `migrations/meta/` holds only
`_journal.json` (hand-written migrations). 0.31.11 no longer depends on zod. Folder-format changes are v1-only.

**Correction to Phase A notes:** there is a real-DB suite. It is opt-in: `RUN_DB_TESTS=1 npm run test:db
--prefix server`, local Neon branch only, and it already runs with `--experimental-test-module-mocks`. It covers
`bootCompat` (imports `app.js`, a typed query, and **"`migrate.js` is a no-op on a second boot"**), `tenancy`,
`reconcile`, `snapshotGuard`, `fingerprint` (drizzle `db.execute`) and `backfill`. This is TASK-071's main
safety net.

**Retry seam (for B3):** both retry loops (`createHousehold` behind `getOrCreate`, and `create`) take their code
from the module-private `generateJoinCode()` = `randomBytes(4).toString('hex').toUpperCase()`, where
`randomBytes` comes from `'crypto'`. No existing test mocks `crypto` or covers either retry.

### 1.2–1.4 zod + openai, @vercel/blob, react-router

Moved to `ai/plans/dependency-phase-b-followons.md` (unchanged from DRAFT-1). Key facts used here: the zod
exposure is five unbounded arrays (`recipes.js` ingredients/steps/tags, `ai.js` steps, `shopping.js` recipeIds);
blob 2 and RR7 need Node ≥20.

## 2. Recommendation: four tasks, drizzle first, plus an interim zod mitigation

Split them. The upgrades share no source files, and each has a distinct failure mode (DB boot, validation,
uploads, routing) and needs its own smoke. Bundling would make a staging failure ambiguous and a rollback coarse.

0. **(Recommended; deferred by owner, see Q1) TASK-075 interim zod array bounds.** Add `.max()` to the five
   unbounded arrays (`recipes.js` ingredients/steps/tags, `ai.js` steps, `shopping.js` recipeIds) on zod 3,
   with one route test per bound. It shares no files with TASK-071, so it can run before or alongside it.
   It closes the only exposure we can show while the zod 4 + openai 6 upgrade is done carefully.
1. **TASK-071 drizzle**: largest blast radius and best safety net; do it while nothing else moves.
2. **TASK-072 zod + openai** (coupled by the peer range): clears the advisory itself.
3. **TASK-073 @vercel/blob**: one file, mostly audit noise.
4. **TASK-074 react-router**: client-only, nil exposure.

**Q1 (owner decision, open):** accept TASK-075 as above (architect and author both recommend it), or explicitly
accept the zod exposure until TASK-072 lands. Not deciding is not an option: the choice is recorded here.
*2026-11-03, Connor: hold off on TASK-075 for now.* Status:
- TASK-075: **deferred by owner** (not cancelled; it stays on the backlog as open security work).
- zod GHSA-mrhx exposure: **known and unresolved**.
- Risk acceptance: **not granted**. Q1 stays open until TASK-075 runs or Connor explicitly accepts the risk.
- TASK-071: not blocked by Q1. TASK-072 is still what clears the advisory. Finishing TASK-071 does **not** mean
  the production dependency-security backlog is resolved.
**Q2 (resolved, architect agrees):** blob 2 and RR7 need Node ≥20. Record the Vercel project Node version in
CONVENTIONS.md (G6) and do not add `engines`. This must be done before TASK-073/074 start.

## 3. TASK-071 Goal

drizzle-orm 0.29.5 → **0.45.4** (clears GHSA-gpj5) and drizzle-kit 0.21.4 → **0.31.11**. Make only the source
changes the upgrade forces. Behavior stays the same: queries, household scoping, the **identity** of the
existing migration ledger in every environment, and the join-code collision retry.

## 4. Allowed Files

- `server/package.json`, `server/package-lock.json`
- New: `server/db/pgError.js`, `server/db/pgError.test.js`, `server/test/db/joinCodeCollision.dbtest.js`
- `server/services/householdService.js`: only the two `isJoinCodeCollision` expressions (+ the import)
- `server/scripts/backfillSearchDocuments.js:84`: only if G4 shows the shape changed
- `indexer.js` / `searchService.js`: only if G4 shows a change their helpers don't absorb (STOP first)
- Docs: SYSTEM_OVERVIEW "drizzle-orm 0.29" mention, the `schema.js:223` comment, CONVENTIONS.md (Node version,
  G6), this file, CURRENT_STATE.md

## 5. Forbidden Files

`server/db/migrations/**` (no migration, no journal edit, **no schema change**); `schema.js` beyond the
comment; all existing tests (locked); zod/openai/blob code; `client/**`; root `package.json`.

## 6. Constraints

- Stay on drizzle 0.x (no v1 beta/rc). No new direct deps. `@neondatabase/serverless` stays 0.10.4.
- TDD: the manifest/lockfile bump is exempt (`**/package*.json`). `pgError.js` + the householdService change go
  Red first.
- **File limit:** at most **5 production source files** change (new or edited, under `server/` and excluding
  tests). Expected: `pgError.js`, `householdService.js`, maybe `backfillSearchDocuments.js` = 2–3. Tests
  (`*.test.js`, `*.dbtest.js`), manifests, the lockfile and docs do not count. A 6th production file → STOP.
- **STOP** if G2 finds an unexplained semantic difference (see G2); if any existing unit test or dbtest fails
  after the bump; if G4 needs edits beyond Allowed; if G5 wants to write to `migrations/`; if the ledger
  fingerprint changes anywhere; or if the file limit is hit.
- Lint baseline: 30 pre-existing `no-undef` errors in `.claude/hooks/tdd/*.mjs`. No new errors.

## 7. Interface contract

`server/db/pgError.js`: `export function isUniqueViolation(err, constraintName) // -> boolean`

- Walk: `cur = err`, depth 0. At each step:
  1. If `cur` is not a non-null object (`typeof cur !== 'object' || cur === null`), return `false`.
  2. If `cur.code === '23505' && cur.constraint === constraintName`, return `true`. (The match is checked on
     this object **before** `cause` is read.)
  3. If depth is 5, return `false`. Otherwise `cur = cur.cause`, depth + 1, repeat.
  So at most 6 objects are inspected: `err` plus up to 5 nested causes. Cycles terminate by the depth bound.
- **Never throws.** The whole walk sits in `try/catch`, and any exception (e.g. a throwing getter on `code`,
  `constraint` or `cause`) returns `false`. Because of the order in step 2, a match found before the throwing
  access still returns `true`.
- Pure: no logging, no mutation of `err`.

`householdService.js` replaces both inline checks with `isUniqueViolation(err, JOIN_CODE_CONSTRAINT)` and changes
nothing else (still 3 attempts, still rethrows non-collision errors and the third collision unchanged). This
works on 0.29 (unwrapped) and on 0.45 (wrapped), so it lands before the bump.

**Test seam for the retry (AC3b/c):** `mock.module('crypto', { namedExports: { randomBytes } })` (or
`'node:crypto'`, whichever the loader matches; the test-writer confirms which actually intercepts by checking
the mock's call count, and reports if neither does), registered **before** a dynamic `import()` of
`householdService.js`. The real `db` client and real Neon local branch are used: no db mock. `randomBytes(4)`
must return a 4-byte `Buffer`.

## 8. Acceptance Criteria

1. `npm ls --prefix server` shows drizzle-orm 0.45.4 and drizzle-kit 0.31.11. The server audit no longer lists
   drizzle-orm; the only remaining entries are zod, openai, undici, @fastify/busboy and @vercel/blob.
2. `pgError.test.js`, `isUniqueViolation(x, 'households_join_code_unique')`:
   a. `{code:'23505', constraint:'households_join_code_unique'}` → true
   b. `{message:'Failed query: …', cause:{code:'23505', constraint:'households_join_code_unique'}}` → true
   c. the same at `cause.cause` → true
   d. `{code:'23505', constraint:'other'}` → false
   e. `{code:'23503', constraint:'households_join_code_unique'}` → false
   f. `{code:'23505', cause:{constraint:'households_join_code_unique'}}` (split across objects) → false
   g. `null`, `undefined`, `'23505'`, `{}` → false, no throw
   h. self-cycle `e = {code:'X'}; e.cause = e` → false, terminates
   i. `{ get cause() { throw new Error('boom') } }` → false, no throw
   j. `{ get code() { throw new Error('boom') } }` → false, no throw
   k. a match at depth 5 (`err.cause` ×5 is the matching object) → true; the same match at depth 6 → false
   l. `{code:'23505', constraint:'households_join_code_unique', get cause() { throw … }}` → true (match is
      checked before `cause` is read)
3. `joinCodeCollision.dbtest.js` (opt-in, local branch). **Isolation contract:** the test leaves the branch
   exactly as it found it, even when an assertion fails partway.
   - **Identifiers, per run.** C1 and one C2 per sub-test (3b and 3c each get their own) are 8-char uppercase
     hex generated fresh for each run, each from its own 4-byte `Buffer` (the mocked `randomBytes` returns those
     buffers). The codes are generated without the mocked `randomBytes` (e.g. from `Math.random`). No fixed
     literal codes. The synthetic `clerkUserId` is unique per run (e.g. `t071_<random>`).
   - **Verified absent.** Before any insert, the test queries `households` for every generated join code and the
     synthetic `clerkUserId`, and `user_onboarding` for that `clerkUserId`. If any match exists, it
     regenerates that value and checks again (bounded, e.g. 5 tries, then fails with a clear message and writes
     nothing).
   - **Captured keys.** Each row the test inserts directly (the seed, and the 3a insert if it unexpectedly
     succeeds) uses `.returning()` and its primary key is recorded. Every household id a call under test returns
     is recorded the moment it resolves.
   - **Cleanup selectors** (in `finally`, children before parents): only (i) the captured primary keys; (ii) rows
     referencing those household ids (none are expected; the ids are new, so no pre-existing row can reference
     them); and (iii) the synthetic `clerkUserId`, **in exactly two tables: `households` and `user_onboarding`**.
     Those are the only tables the tested flows write (`create` → `households`; `getOrCreate` → `households` +
     `onboardingService.upsertFlow` → `user_onboarding`; no triggers exist), and the same two tables are checked
     for absence. (iii) covers a `getOrCreate` that rejects after its insert. No other table is cleaned by
     `clerkUserId`. Rows are never deleted only because their join code matches a generated code.
   - **Post-cleanup checks.** Zero rows remain for the captured ids and the synthetic `clerkUserId`. Before setup
     the test records `count(*)` of `households` and of `user_onboarding`. After cleanup both counts
     are equal to those values. (Pre-existing rows are untouched; the local branch is single-user.)
   - **Mock control.** `householdService.js` is imported once (one module instance), after the `crypto` mock is
     registered. The test keeps the real `randomBytes` from an import resolved before registration. The mock is
     one dispatcher with `arm(buffers)` / `disarm()` and a call counter:
     - while armed, each call increments the counter and returns the next buffer, and the last buffer repeats
       once the list runs out (3d's every-call C1);
     - while disarmed, calls go to the real `randomBytes` and are not counted.
     Each sub-test calls `arm([...])` (which also resets the counter) immediately before its call under test and
     `disarm()` in its own `finally`. Sub-tests run sequentially. If an armed call comes from anything other
     than `householdService` (e.g. the size isn't 4, or the counts are off for that reason), the test-writer
     reports it and does not loosen the count assertions.
   Setup: insert the seed household with join code C1 (captured).
   a. **Error shape:** a drizzle `db.insert(households)` with `joinCode: C1` rejects with an error satisfying
      `isUniqueViolation(err, 'households_join_code_unique')`.
   b. **Retry via `create(ownerName)`:** with `randomBytes` mocked to return the C1 bytes, then the 3b C2 bytes,
      `create('T071')` resolves to a household whose `joinCode` is the 3b C2. The mock was called exactly 2
      times, and exactly one `households` row has the 3b C2 (the captured one).
   c. **Retry via `getOrCreate(clerkUserId)`:** the mock returns the C1 bytes, then the 3c C2 bytes, and the
      synthetic `clerkUserId` has no household. It resolves to a household whose `joinCode` is the 3c C2 and
      whose `clerkUserId` equals the input. The mock was called 2 times.
   d. **Exhaustion:** with the mock returning the C1 bytes on every call, `create('T071')` rejects with an error
      satisfying `isUniqueViolation`, after exactly 3 calls.
   All of 3a–d pass on 0.29.5 before the bump (with the Green `householdService`) and on 0.45.4 after. On 0.45.4,
   3b–d are what prove the retry still recognises the wrapped `DrizzleQueryError`.
4. These match the pre-change baseline recorded at G1: root `npm test`, **`npm test --prefix server`** (root
   `npm test` also chains it; it is listed separately so it is never implicit), `npm test --prefix client`,
   `npm run lint`, `npm run build`.
5. The full `test:db` suite passes on 0.45.4, including `bootCompat`'s second-boot no-op. A pre-bump baseline
   run is recorded first.
6. **Ledger identity (local):** the full output of the ledger query (§9) and its fingerprint are identical
   before the bump (0.29.5) and after a 0.45.4 boot. The before/after rows and both fingerprints are recorded
   in §11.
7. `git diff --stat` touches only §4 files.

## 9. Verification

**Ledger query** (used locally, on staging and on prod):

```sql
-- full listing (record it)
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
-- fingerprint + quick check (compare)
SELECT count(*) AS n, max(created_at) AS max_created,
       md5(COALESCE(string_agg(id::text || ':' || hash || ':' || created_at::text, ',' ORDER BY id), ''))
         AS fingerprint
FROM drizzle.__drizzle_migrations;
```

The full ordered listing is the **authoritative record**; the fingerprint is a comparison aid (an
accidental-change detector, not a security control). Pass = identical listing before and after; in practice
compare fingerprints first, and any fingerprint difference is a fail. `n` and `max_created` are only a quick
check: they cannot pass on their own. `COALESCE` makes an empty ledger fingerprint deterministic.

**Pre-bump gates (record in §11 before Red):**
- **G1:** TASK-070 is on `staging`. Baselines recorded for every AC4 command and for test:db. The local ledger
  listing and fingerprint recorded (the "before" of AC6).
- **G2 (migrator, scratch dir outside the repo):** install 0.29.5 and 0.45.4 side by side and trace the full
  `migrate()` path for neon-http (`neon-http/migrator`, `migrator.readMigrationFiles`, pg-core dialect
  `migrate()`). Record, for each version, how it handles:
  1. migration discovery: reading `meta/_journal.json`, folder resolution, `migrationsFolder` option;
  2. ordering: journal order vs filename;
  3. hashing: algorithm, and what is hashed (raw file text, statement-breakpoint split);
  4. ledger creation: schema `drizzle`, table `__drizzle_migrations`, columns `id`/`hash`/`created_at`, and
     `migrationsSchema`/`migrationsTable` defaults;
  5. existing-ledger lookup: which row it reads as "last applied" (by `created_at` or by `id`), and the query;
  6. the apply rule: compare `folderMillis`/`when` against the last `created_at`; `>` vs `>=`;
  7. execution: per-statement vs batched, and inside a transaction or not (neon-http);
  8. schema qualification of the ledger table and of the migration SQL.
  Expected: identical decisions on all 8 against our existing ledger. **STOP** on any unexplained semantic
  difference in discovery, ordering, ledger interpretation or execution. A refactor that provably makes the same
  decisions is recorded with its reasoning and does not stop the task.
- **G5:** drizzle-kit 0.31.11 `--version` and `check` (read-only, scratch install) accept the existing
  `drizzle.config.js` without demanding `up`.
- **G6:** Connor records the Vercel project Node version in CONVENTIONS.md.

**Post-bump gates (record in §11 after Order step 7, the dependency bump):**
- **G3:** against the local branch on 0.45.4, record a unique violation's `name`, its own `code`/`constraint`,
  and `cause.code`/`cause.constraint`. This documents the wrapping AC3 depends on. Nothing branches on it,
  because `isUniqueViolation` handles both shapes.
- **G4 (controlled comparison):** run the same query, `db.execute(sql\`SELECT id, occurred_at FROM
  search_documents ORDER BY id LIMIT 1\`)`, on 0.29.5 (value recorded before the bump, Order step 5) and on 0.45.4, and
  record two properties separately: (A) the top-level return shape (`{rows}` vs array) and (B) the JS type of
  `occurred_at`. Then fill in this decision table in §11. Every row needs an explicit outcome ("no change" is
  an outcome):

  | Consumer | (A) return-shape handling | (B) timestamp handling | Outcome |
  |---|---|---|---|
  | `indexer.js` (×12) | `rowsOf()` | existing conversion | |
  | `searchService.js` (×3) | `rowsOf()` | `toIso()` | |
  | `backfillSearchDocuments.js:84` | `.rows ?? []` | existing handling | |

**Order (one sequence):**
1. G1.
2. G2.
3. G5.
4. G6 (Connor; may run in parallel, but must be done before TASK-073/074).
5. Record G4's 0.29.5 half (shape + `occurred_at` type).
6. Red: AC2 and AC3a–d, which fail because `pgError.js` does not exist. On 0.29.5, AC3b–d are behavior locks:
   the inline check already sees unwrapped errors, so they cannot fail for the wrapping reason until the bump.
   Record that in §11. Green on 0.29.5: all of AC2 and AC3 pass.
7. Bump drizzle-orm and drizzle-kit (lockfile regenerated by npm).
8. G3, then G4's 0.45.4 half and the decision table. Apply a G4 fix only if the table requires one.
9. AC3 again on 0.45.4, the full test:db suite (AC5), AC4, the AC6 "after" ledger listing and fingerprint, and AC1.

**Staging smoke** (verifier subagent via Claude-in-Chrome, or Connor):
1. Connor runs the ledger query on the staging branch before the push and again after the first load of the
   new Preview. The fingerprints must be equal. (Staging's 0022 was hand-applied, ledger row 7; only
   before == after matters.)
2. Pantry: add, edit, consume (meal_logs), delete.
3. Recipes: list, create from text, delete. Shopping: generate from a recipe, tick an item.
4. Chat: one `search_recipes_and_meals` turn (`db.execute` + `occurred_at`) and one tool-driven pantry add.
5. Household page shows the join code; dietary profile saves.
6. Sentry staging: no new server issues within 30 minutes.

**Production:** the ledger query on the prod branch before the merge to `main` and after first load (the
fingerprints must be equal), plus smoke steps 2 and 4. After a push exits 0 the session stops; live checks are
Connor's.

**Migration/deploy:** there is no migration file and no expected ledger row. The deploy is still DB-sensitive,
because `migrate.js` runs the new migrator at boot in every environment, and the ledger fingerprint is the
guard. Before each push, check MIGRATION_LEDGER.md for ❌ rows on the target (currently none).

**Ledger-change incident** (any environment where the before/after listing differs):
1. Stop further deployments to that environment. Record a ❌ row in **MIGRATION_LEDGER.md** (the repo doc)
   describing the incident; the existing ❌ rule then blocks deploys there until it is resolved.
2. Preserve the before/after `__drizzle_migrations` listings and fingerprints in §11.
3. Capture the deployment/boot logs and establish exactly which SQL executed.
4. Do not modify `drizzle.__drizzle_migrations` by hand.
5. Do not assume a dependency revert reverses database changes. Reverting to 0.29.5 against a changed ledger
   may itself make the old migrator act differently.
6. Change no application or database state until a separately reviewed recovery plan exists. If production is
   impaired, Connor decides how urgent that review is; this session does not act on its own.

**Rollback** without an incident: a plain revert of the drizzle commit, valid only while the listing is
confirmed unchanged (no data depends on the version).

## 10. Follow-on tasks

Scopes, gates and draft ACs for TASK-072/073/074 (and TASK-075 if Q1 is accepted) are in
`ai/plans/dependency-phase-b-followons.md`. Each gets its own TASK file once this one is approved. TASK-073 and
TASK-074 require G6.

## 11. Gate Results / Baseline Records

(empty: filled during implementation. Required entries: G1 baselines + "before" ledger listing/fingerprint;
G2 8-point table per version; G5; G6; G4 0.29.5 half; G3; G4 0.45.4 half + decision table; "after" ledger
listing/fingerprint; staging and prod before/after fingerprints.)

## 12. Dependency Chain

Editing: server manifests and lockfile; `pgError.js` (+ unit test, + dbtest); 2 expressions + 1 import in
`householdService.js`; maybe 1 line in `backfillSearchDocuments.js`; docs.
Requires: TASK-070 landed; local branch with 0022 (for test:db); Connor for the staging/prod ledger
fingerprints and the Node version. Not required: Q1 (TASK-075 deferred by owner; zod exposure unresolved and
not accepted; TASK-072 still required to clear it).
Irrelevant: client; zod/openai/blob paths; migrations; Vercel config.
