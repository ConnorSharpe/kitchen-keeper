# TASK-071 — Dependency Security Update (Phase B: breaking upgrades)

Version: DRAFT-1 (2026-11-03). Spec only; nothing implemented. For architect review.

Phase A is TASK-070 (non-breaking `npm audit` fixes). Every production advisory still open needs a major
upgrade. This file records the investigation (§1), recommends a 4-way split (§2), fully specifies the first
part, **TASK-071 = drizzle-orm 0.29.5 → 0.45.4** (§3–§9), and scopes the other three (§10).

## Architect Review History

(none yet)

## 0. Baseline (2026-11-03, `npm audit --omit=dev`, after TASK-070)

| Advisory | Package | Path | Sev | Fix | Real exposure here |
|---|---|---|---|---|---|
| GHSA-gpj5-g38j-94v9 (escaping in `sql.identifier()`/`.as()`) | drizzle-orm 0.29.5 | direct | high | ≥0.45.2 | None: one `.as('trigger')` constant, no `sql.identifier` |
| GHSA-mrhx-c7xc-m3w5 (OOM: array schema issues accumulate) | zod 3.25.76 | direct, + openai 4 peer, + drizzle-kit (dev) | high | ≥4.6.6, **no 3.x fix** | **Yes:** unbounded `z.array` on authed routes, 10mb JSON limit |
| (via zod peer) | openai 4.104.0 | direct | high | openai ≥6 (peer `^3.25 \|\| ^4.0`) | n/a |
| GHSA-x8mw-p69m-v3mx, GHSA-gxm5-99cw-xjw9 + 15 undici | @fastify/busboy 2.1.1, undici 5.29 | @vercel/blob 0.27.3 | high | blob ≥2.0.1 (undici ^6.23) | Low: outbound calls to Vercel API only |
| GHSA-wrjc-x8rr-h8h6 (external redirect, `>=6 <7.18`) | react-router 6.30.6 (client) | direct | mod | ≥7.18.0, **no 6.x fix** | None: every `navigate`/`<Navigate>` uses a constant path |
| GHSA-337j-9hxr-rhxg (SSR hydration) | react-router (client) | direct | mod | ≥7.18.0 | None: Declarative Mode is unaffected (advisory text) |

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
--prefix server`, local Neon branch only. It covers `bootCompat` (imports `app.js`, a typed query, and
**"`migrate.js` is a no-op on a second boot"**), `tenancy`, `reconcile`, `snapshotGuard`, `fingerprint` (drizzle
`db.execute`) and `backfill`. This is TASK-071's main safety net.

### 1.2 zod 4 + openai 6

- zod: 16 server files (10 routes, 6 chat handlers), none in the client. Unbounded arrays: `recipes.js`
  (ingredients, steps, tags), `ai.js` (steps), `shopping.js` (recipeIds).
- v4 effects: **default messages change** ("Required" → "Invalid input: expected …"), and `validate.js` sends
  `issues[].message` in 400 bodies, so this is user-visible. `.default()` short-circuits on undefined (no
  `.optional().default()` combinations found). `.email()/.url()/.datetime()` are deprecated but work (keep them).
  `.refine(fn,'string')` is unconfirmed. `ZodError.message` format changes (it goes to the model only).
  `zod/v3` is no escape (all of 3.x is affected).
- openai: zod 4 needs openai ≥6.0.0 (latest 6.49.0; 7.x requires Node ≥22). No `zodResponseFormat` in use.
  Call sites: `openaiProvider.js`, `aiService.js` (`new OpenAI`), `transcribe.js` (`toFile` from `'openai'`:
  root export in 6.x unconfirmed). Embeddings now default to base64, decoded by the SDK.

### 1.3 @vercel/blob 2.x

One file: `recipeService.js` calls `put(\`recipes/${hh}/${uuid}.${ext}\`, buf, {access:'public', contentType})` and
`del(url)` ×2. 1.0 changes: `addRandomSuffix` defaults to false and overwrite needs `allowOverwrite`. Our paths
are UUID-unique, and old URLs stay deletable. `BLOB_READ_WRITE_TOKEN` still works (OIDC added with fallback).
The first version on undici 6 is **2.0.1**. Node ≥20. No receipt path uses Blob, contrary to
SYSTEM_OVERVIEW; fix that wording in TASK-073.

### 1.4 react-router-dom 7

8 client files, Declarative Mode only, no data router or SSR. `App.jsx:114` already sets `v7_startTransition` and
`v7_relativeSplatPath`; the other flags are data-router only. `react-router-dom@7` still re-exports
`react-router`, so imports stay unchanged. Peer `react >=18` (18.3.1 installed); Node ≥20. v8 drops
`react-router-dom` and needs React 19, so it is out of scope.

## 2. Recommendation: four tasks, drizzle first

Split them. The upgrades share no source files, and each has a distinct failure mode (DB boot, validation,
uploads, routing) and needs its own smoke. Bundling would make a staging failure ambiguous and a rollback coarse.

1. **TASK-071 drizzle**: largest blast radius and best safety net; do it while nothing else moves.
2. **TASK-072 zod + openai** (coupled by the peer range): the only advisory with real exposure.
3. **TASK-073 @vercel/blob**: one file, mostly audit noise.
4. **TASK-074 react-router**: client-only, nil exposure.

**Q1 (review):** zod is the only real exposure. Should TASK-072 go first instead? An interim `.max()` on the
five unbounded arrays would be an alternative mitigation. It is outside every task's current scope; this
spec does not decide it.
**Q2:** blob 2 and RR7 need Node ≥20. The Vercel project Node version is not recorded in the repo (→ G6).
Recommended: record it in CONVENTIONS.md and do not add `engines`.

## 3. TASK-071 Goal

drizzle-orm 0.29.5 → **0.45.4** (clears GHSA-gpj5) and drizzle-kit 0.21.4 → **0.31.11**. Make only the source
changes the upgrade forces. Behavior stays the same: queries, household scoping, migration state in every
environment, and the join-code collision retry.

## 4. Allowed Files

- `server/package.json`, `server/package-lock.json`
- New: `server/db/pgError.js`, `server/db/pgError.test.js`, `server/test/db/joinCodeCollision.dbtest.js`
- `server/services/householdService.js`: only the two `isJoinCodeCollision` expressions
- `server/scripts/backfillSearchDocuments.js:84`: only if G4 shows the shape changed
- `indexer.js` / `searchService.js`: only if G4 shows a type change their helpers don't absorb (STOP first)
- Docs: SYSTEM_OVERVIEW "drizzle-orm 0.29" mention, the `schema.js:223` comment, this file, CURRENT_STATE.md

## 5. Forbidden Files

`server/db/migrations/**` (no migration, no journal edit, **no schema change**); `schema.js` beyond the
comment; all existing tests (locked); zod/openai/blob code; `client/**`; root `package.json`.

## 6. Constraints

- Stay on drizzle 0.x (no v1 beta/rc). No new direct deps. `@neondatabase/serverless` stays 0.10.4.
- TDD: the manifest/lockfile bump is exempt (`**/package*.json`). `pgError.js` + the householdService change go
  Red first.
- **STOP** if G2 finds any migrator semantic change; if any existing unit test or dbtest fails after the bump;
  if G4 needs edits beyond Allowed; if G5 wants to write to `migrations/`; or if more than 5 source files change.
- Lint baseline: 30 pre-existing `no-undef` errors in `.claude/hooks/tdd/*.mjs`. No new errors.

## 7. Interface contract

`server/db/pgError.js`: `export function isUniqueViolation(err, constraintName) // -> boolean`

- `true` iff some object in the chain `err, err.cause, err.cause.cause, …` (max depth 5, stops at non-objects)
  has **both** `code === '23505'` and `constraint === constraintName` on that same object.
- Never throws. Any non-matching input returns `false`.

`householdService.js` replaces both inline checks with `isUniqueViolation(err, JOIN_CODE_CONSTRAINT)`. This works
on 0.29 (unwrapped) and on 0.45 (wrapped), so it lands before the bump.

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
3. `joinCodeCollision.dbtest.js` (opt-in, local branch, cleans up in `finally`): a drizzle
   `db.insert(households)` whose `joinCode` duplicates an existing row rejects with an error satisfying
   `isUniqueViolation(err, 'households_join_code_unique')`. It passes on 0.29.5 before the bump and on 0.45.4
   after (behavior lock across the upgrade).
4. Root `npm test`, `npm test --prefix client`, `npm run lint` and `npm run build` match the pre-change baseline.
5. The full `test:db` suite passes on 0.45.4, including `bootCompat`'s second-boot no-op. A pre-bump baseline
   run is recorded first.
6. Local `drizzle.__drizzle_migrations` `count(*)` and `max(created_at)` are identical before and after a boot
   on 0.45.4 (recorded in §11).
7. `git diff --stat` touches only §4 files.

## 9. Verification

**Gates (record in §11 before Red):**
- **G1:** TASK-070 is on `staging`. Baselines recorded for test, lint, build and test:db.
- **G2 (migrator):** in a scratch dir (not the repo), diff `pg-core` dialect `migrate()` and
  `neon-http/migrator` between 0.29.5 and 0.45.4. Expect the same table `drizzle.__drizzle_migrations`, the
  same `hash`/`created_at` columns, and the same rule "apply journal entries with `when` > last `created_at`".
  Any difference → STOP.
- **G3:** against the local branch, record a 0.45.4 unique violation's `name`, own `code`/`constraint`, and
  `cause.code`/`cause.constraint`.
- **G4:** record `db.execute(sql\`SELECT id, occurred_at FROM search_documents LIMIT 1\`)` on 0.29.5 vs 0.45.4:
  the top-level shape (`.rows` vs array) and the JS type of `occurred_at`. This decides the backfill line.
- **G5:** drizzle-kit 0.31.11 `--version` and `check` (read-only) accept the existing `drizzle.config.js`
  without demanding `up`.
- **G6:** Connor records the Vercel project Node version in CONVENTIONS.md.

**Order:** Red (AC2, AC3) → Green on 0.29.5 → bump → full suites + test:db → G4 fix, if any.

**Staging smoke** (verifier subagent via Claude-in-Chrome, or Connor):
1. Connor runs `SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations` on the staging branch
   before the push and again after the first load of the new Preview. They must be equal. (Staging's 0022 was
   hand-applied, ledger row 7; only before == after matters.)
2. Pantry: add, edit, consume (meal_logs), delete.
3. Recipes: list, create from text, delete. Shopping: generate from a recipe, tick an item.
4. Chat: one `search_recipes_and_meals` turn (`db.execute` + `occurred_at`) and one tool-driven pantry add.
5. Household page shows the join code; dietary profile saves.
6. Sentry staging: no new server issues within 30 minutes.

**Production:** the step 1 count on the prod branch before the merge to `main` and after first load, plus
smoke steps 2 and 4. After a push exits 0 the session stops; live checks are Connor's.

**Migration/deploy:** there is no migration file and no expected ledger row. The deploy is still DB-sensitive,
because `migrate.js` runs the new migrator at boot in every environment, and the count check is the guard.
Before each push, check the ledger for ❌ rows on the target (currently none). An unexpected count change
counts as an incident: revert the drizzle commit on that branch and append a ledger row recording what was
applied. Never hand-edit `__drizzle_migrations` without a reviewed plan. Rollback is a plain revert
(no data depends on the version).

## 10. Follow-on tasks (each gets its own TASK file once this is approved)

**TASK-072: zod 4.6.7 + openai 6.49.x.** Allowed: `server/package*.json`; zod files only where v4 forces
changes; `transcribe.js`, `openaiProvider.js`, `aiService.js`. Gates: `.refine(fn,'string')` in v4; `toFile`
root export in 6.x; embeddings still a length-1536 `number[]`; client reliance on zod message text
(`client/src/api/index.js:104`). Draft ACs: zod and openai are cleared from the audit; the existing route tests
are green; one pinned 400 message per `validate.js` path (custom messages unchanged, default text explicitly
accepted as changed); a 200k-element failing array to `POST /api/recipes` → 400 within a stated heap bound.
Smoke: streaming chat with a tool call, recipe/receipt parse, transcription, semantic search.

**TASK-073: @vercel/blob 2.8.x.** Allowed: `server/package*.json`, `recipeService.js` if needed,
SYSTEM_OVERVIEW. Draft ACs: undici 5 and @fastify/busboy are gone from `npm ls` and the audit; `put` keeps
`{access:'public', contentType}`. Smoke: upload, replace (the old blob is deleted), delete a recipe, delete a
recipe whose image URL predates the upgrade.

**TASK-074: react-router-dom 7.18.5.** Allowed: `client/package*.json`, `App.jsx` (drop the now-default
flags), the 8 router files only if forced. Draft ACs: client audit 0; tests and build green. Smoke: every
`App.jsx` route, the `/chat` → `/` redirect, the join flow, NavLink active state, back/forward, the PWA
offline shell.

## 11. Gate Results / Baseline Records

(empty: filled during implementation)

## 12. Dependency Chain

Editing: server manifests and lockfile; `pgError.js` (+ unit test, + dbtest); 2 lines in `householdService.js`;
maybe 1 line in `backfillSearchDocuments.js`; docs.
Requires: TASK-070 landed; local branch with 0022 (for test:db); Connor for the staging/prod migration counts
and the Node version.
Irrelevant: client; zod/openai/blob paths; migrations; Vercel config.
