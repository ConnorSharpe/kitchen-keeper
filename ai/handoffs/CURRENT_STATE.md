# Task
TASK-035 — Production Smoke-Test Fixes: Shopping List Outage, Sibling `db.transaction()` Sites, Recipe-Suggestion Targeting Gap. **Implemented and live-verified this session**, against the DRAFT-3 spec approved in the prior session (architect round 2, 9.6/10). All parts (A, B, C) shipped in one session, following the spec's own Allowed Files/Dependency Chain. Part D required no fix (investigated in the spec itself, confirmed no defect).

# Current Status
All of [ai/tasks/TASK-035-spec.md](../tasks/TASK-035-spec.md) is implemented and live-verified against the shared Neon database. No acceptance criteria failed.

What shipped:
- **Part A1 — Shopping List outage fixed**: `shoppingService.buildFromRecipes()`'s `db.transaction()` (unconditionally throwing on `drizzle-orm/neon-http`) replaced with: list insert → bulk multi-row items insert (single atomic statement) → compensating list-delete on failure, wrapped in its own try/catch with a structured `orphaned_list_id=...` log line if the compensating delete itself fails. `server/routes/shopping.js`'s `/build` route gained a `result.status === 'error'` branch returning a clean 500. **Live-verified end-to-end**: built a real shopping list from a saved recipe (`Lobster Pasta with Cream Sauce`) via the UI — `POST /api/shopping/build` returned `201` with 13 populated items (previously a 500 on every call). Also directly verified both edge cases via an isolated one-off script (deleted after use): (a) zero-items-needed path returns `items: []` without attempting an empty-array insert; (b) a real DB-level NOT-NULL violation on the items insert correctly triggers the compensating list-delete, confirmed zero orphaned list rows via a follow-up query. Test shopping list was deleted after verification (`DELETE /api/shopping/3` → 204).
- **Part A2 — `push.js` `/subscribe` fixed**: `db.transaction()` replaced with sequential delete-then-upsert (no wrapper), per the spec's firm decision to accept the narrow same-endpoint/different-household race rather than introduce raw SQL. **Live-verified**: called `POST /api/push/subscribe` directly (synthetic-but-validly-shaped endpoint/keys, via authenticated `fetch()` in the browser console) — got `201`; re-subscribed the same endpoint (upsert path) — got `201` again; cleaned up via `POST /api/push/unsubscribe` → `200`.
- **Part A3 — `householdService.joinByCode()` fixed**: reordered from delete-then-insert to insert-before-delete, so a failure between the two statements leaves the user with their old (safe, empty) household rather than "homeless." **Live-verified in isolation** (not against the real household — this reorder needs two households and the user has only one real one): a one-off script created two throwaway households under a synthetic `clerkUserId`, called `joinByCode()` directly, confirmed exactly one `householdMembers` row resulted (targeting the correct household) and the old household was deleted — then deleted all test rows. Script removed after use.
- **Part B1 — Recipe-suggestion query dilution fixed**: `recipeSearchService.findByPantry()` now queries using *only* `targetIngredients` (deduplicated, capped at 5) when non-empty, instead of padding with pantry-anchor ingredients. **Live-verified**: re-ran "What should I make with garlic?" — all 3 returned candidates now genuinely contain garlic (`matchedIngredients` includes `"Garlic"` in every candidate; previously 0/3). Re-ran "What should I make with onions?" — all 3 candidates now genuinely contain onions (previously 1/3 clean, one literal-onion-dish miss).
- **Part B2 — `foodsMatch()` plural handling fixed**: `tokenize()` now strips a trailing regular-plural "s" (guarded against `ss`-ending words like "glass"). Additionally — **required beyond the spec's literal prose to satisfy its own acceptance criteria** — the shared-token threshold in `foodsMatch()` was changed from a fixed `>= 2` to `>= Math.min(2, tokensA.size)`, so a single-token query (e.g. "onion") only needs 1 shared token against a multi-word candidate, while multi-word queries keep the original `>=2` rule (this is what preserves the TASK-011 "red bean" / "bean sprouts" invariant — a single fixed threshold-of-2 makes single-word queries structurally unable to match any multi-word candidate, plural-stripping alone does not fix this). Added 4 new unit tests. **Live-verified**: `foodsMatch('onion','onions')` → `true`, `foodsMatch('onion','caramelized onions')` → `true`, `foodsMatch('red bean','bean sprouts')` still `false`. Documented-limitation cases checked and recorded: `foodsMatch('glass','glasses')` → `false` (guard prevents corruption, doesn't claim a match), `foodsMatch('citrus','citruses')` → `false` (irregular plural, out of scope per D-B2). All 42 existing + new unit tests pass (`node --test server/utils/foodNormalization.test.js`).
- **Part B3 — System prompt hardened**: added an explicit instruction to `aiService.js`'s `suggest_recipes` guidance — never state or imply an ingredient is present unless it's actually in that recipe's tool-result `ingredients` array.
- **Part C1 — README fixed**: Live Demo link updated from the stale `kitchen-keeper-connorsharpes-projects.vercel.app` (now SSO-gated) to `https://kitchenkeeper.vercel.app`.
- **Repo-wide grep confirms zero remaining `db.transaction(` call sites** (the only two hits are comments: my own explanatory comment in `shoppingService.js`, and TASK-032's pre-existing historical comment in `pantryService.js` — not code).

# Files Modified
Server:
- `server/services/shoppingService.js` — `buildFromRecipes()`: no more `db.transaction()`; list insert, bulk items insert, compensating delete + structured orphan-log on failure
- `server/routes/shopping.js` — `/build` route: new `result.status === 'error'` → 500 branch
- `server/routes/push.js` — `/subscribe`: sequential delete-then-upsert, no transaction
- `server/services/householdService.js` — `joinByCode()`: insert-before-delete reorder
- `server/services/recipeSearchService.js` — `findByPantry()`: target-only query when `targetIngredients` non-empty (no pantry padding); doc comment updated
- `server/utils/foodNormalization.js` — `tokenize()` gains plural-stripping (`stripTrailingPlural`, `ss`-guarded); `foodsMatch()` threshold changed to `Math.min(2, tokensA.size)` with a `tokensA.size === 0` guard
- `server/utils/foodNormalization.test.js` — 4 new tests for the B2 acceptance criteria
- `server/services/aiService.js` — one new line in `suggest_recipes` system-prompt guidance (anti-hallucination instruction)

Docs:
- `README.md` — Live Demo link updated to `https://kitchenkeeper.vercel.app`

No client files touched (spec's Forbidden Files list — correctly, no client changes were needed).

# Files Already Reviewed
Full reads this session, before editing: `server/services/shoppingService.js`, `server/routes/push.js`, `server/services/householdService.js`, `server/services/recipeSearchService.js`, `server/utils/foodNormalization.js`, `server/services/aiService.js` (system-prompt section), `README.md`, `server/routes/shopping.js`, `server/db/schema.js` (households/householdMembers/shoppingListItems), `client/vite.config.js`.

# Dependency Chain
Editing: all files listed above under "Files Modified" — matches the spec's own Dependency Chain, plus `server/routes/shopping.js` (not in the spec's Allowed Files list, but required — see Decisions Made).

Irrelevant (untouched, per spec's Forbidden Files): `server/db/schema.js`/`server/db/migrations/` (zero schema changes, confirmed), `client/src/**`, `server/services/pantryService.js`, `server/services/recipeBlocklistService.js`, `server/utils/recipeScorer.js`.

# Architecture Notes
- **`db.transaction()` is now fully eliminated from this codebase** — the driver-level blocker (`drizzle-orm/neon-http` has zero interactive-transaction support) that was flagged four sessions running (TASK-032→035) is resolved at all three call sites.
- **`foodsMatch()`'s threshold change is broader than the spec's Part B2 prose describes** — the spec only mentions "trailing-s stripping," but tracing through the acceptance criteria (`foodsMatch('onion','caramelized onions')` must return `true`) proves plural-stripping alone is insufficient: a single-token query can structurally never reach a fixed `>=2` shared-token threshold against a multi-word candidate, regardless of stemming. The `Math.min(2, tokensA.size)` change was necessary to make the spec's own acceptance criteria pass, verified against all existing tests (including the TASK-011 invariant) plus 4 new ones — all 42 pass. Flagging this clearly since it's a slightly larger behavior change than the spec's text alone implies.
- **Verification method used this session**: a second local backend + client instance were started via `preview_start` with `autoPort` (another session's dev server occupied the default ports 3001/5183). `client/vite.config.js`'s proxy was temporarily repointed at the new backend port, then reverted — confirmed via `git diff client/vite.config.js` showing no residual change before ending the session.
- **A2 and A3 were verified differently from A1**: A1 (shopping list) was tested through the real UI against the real household's real saved recipe (low risk, easily reversed — list deleted after). A2 (push subscribe) was tested via a direct authenticated `fetch()` call with a synthetic-but-valid subscription body (no real push hardware needed to exercise the DB write path) — cleaned up via unsubscribe. A3 (join-household) was **not** tested against the real household at all — the real household is the user's only one and isn't disposable, so `joinByCode`'s own Guard C would reject any real attempt regardless of this fix. Instead, a one-off script created two throwaway households under a synthetic `clerkUserId`, called `joinByCode()` directly, and deleted everything it created. This was a deliberate choice to avoid any risk to the user's real production household data.
- Single shared Neon database for local dev and production, unchanged.

# Decisions Made
- **Route-level addition beyond the spec's Allowed Files**: the spec listed `server/services/shoppingService.js` as the only shopping-related Allowed File, but `buildFromRecipes()` returning a new `{ status: 'error' }` shape required a corresponding branch in `server/routes/shopping.js` (previously only handled `invalid_recipes`) — without it, an items-insert failure would silently 201 with `items: undefined`. This is a minimal, necessary consequence of the spec's own A1 fix approach, not scope creep — noted explicitly since it's a file the spec didn't list.
- **`foodsMatch()` threshold change** (see Architecture Notes) — a implementation-time judgment call required to satisfy the spec's own literal acceptance criteria, not a deviation from spec intent.
- No other spec-level decisions were revisited — implementation followed TASK-035-spec.md's Decisions (D-A1 through D-A4, D-B1 through D-B3) as written.

# Remaining Work
1. **C2, filed as a backlog item per the spec (not fixed, not forgotten)**: Clerk is running in Development mode on production (`winning-swift-74.accounts.dev` auth domain, dev-mode badge visible on the production sign-in page). This is a Vercel environment-variable / Clerk-dashboard configuration question (which key pair is set in Vercel's production env), not a code change. Recommend a short separate investigation comparing the Clerk key prefix in Vercel's production env vars against Clerk's dashboard.
2. Nothing else outstanding from this spec — all of Parts A, B, C are complete and live-verified; Part D required no fix (already resolved as "no defect found" in the spec itself).

## Backlog (carried forward, unchanged from prior sessions)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.
- One real household item (`BNLS/SL BRST`, id 19) still has `storageLocation: 'pantry'` from TASK-031's session testing — cosmetic.
- `POST /api/ai/eat-this-now` doesn't honor the recipe blocklist (TASK-034 Out of Scope, confirmed unchanged) — candidate for a follow-up task if it proves to matter in practice.
- **New this session**: C2 — Clerk Development-mode config on production (see Remaining Work #1).

# Known Risks
- Part A2's accepted residual risk (narrow same-endpoint/different-household push-subscribe race) is unchanged from the spec — a firm, documented tradeoff, not a bug.
- Part A3's reordering reduces but doesn't eliminate all risk — a crash between insert and delete leaves a harmless stale empty household row (acceptable, matches the driver's no-transactions ceiling already accepted project-wide).
- Part B1's fix changes recipe-suggestion behavior for every targeted query in production immediately upon deploy — no feature flag, consistent with this project's stated preference, but it's a behavior change to a recently-shipped feature (TASK-034).
- **Still open — Part B2's threshold change (`Math.min(2, tokensA.size)`) is a slightly bigger behavior change than the spec's prose describes** (see Architecture Notes) — verified safe against all 42 existing + new tests, but it changes `foodsMatch()`'s behavior for every single-token query across every feature that calls it (targeting, `recipeScorer.js`'s fuzzy fallback), not just the two ingredients tested live. No regression found, but still worth a follow-up look at `recipeScorer.js`'s general "what should I eat" fuzzy-match path specifically — this session only exercised the targeted-ingredient path.
- **Investigated and closed, not actionable — a transient 401 seen once during A1's live UI test.** During this session's browser-based shopping-list verification, the first `POST /api/shopping/build` attempt returned 401; an immediate retry succeeded with 201, no code changes in between. Follow-up: attempted a clean reproduction in a separate isolated test — single server+client instance (no dual-instance/proxy-switch mid-session this time), confirmed the cached Clerk token's actual `exp` claim (60s TTL), waited ~75s of genuine idle time past that expiry with zero intervening requests, then fired a real authenticated request (a chat message) through the actual UI. It succeeded cleanly (`200`, no 401). This matches `client/src/api/index.js` calling `window.Clerk.session.getToken()` fresh on every request, which per Clerk's documented behavior transparently mints a new token if the cached one expired — so plain idle time doesn't produce a stale-token 401 at request time, consistent with what this reproduction attempt showed. Could not identify a reliable trigger. **Conclusion: treated as a one-off, not a demonstrated systemic bug — no code change made, not tracked as backlog.** If it recurs, the useful diagnostic next time is capturing the token's `exp` vs. the request timestamp at the moment of the 401, to confirm or rule out an actual expired-token cause.
- No automated test suite anywhere in this repo beyond the one `foodNormalization.test.js` file — this session's other verifications were live/manual (browser + one-off scripts), matching every prior session's methodology.

# Verification Results
- **Shopping list build (A1)**: PASS — `POST /api/shopping/build` returned `201` with 13 populated items via the real UI (previously 500 on every call). Zero-items-needed path and items-insert-failure-triggers-compensating-delete both confirmed via isolated script, zero orphaned rows. Test list deleted after.
- **Push subscribe (A2)**: PASS — `201` on first subscribe, `201` on same-endpoint re-subscribe (upsert path exercised), cleaned up via unsubscribe (`200`).
- **Join household (A3)**: PASS — verified in isolation against two throwaway households (not the real one); exactly one `householdMembers` row resulted, old household deleted, new household intact. All test rows removed after.
- **Recipe targeting (B1)**: PASS — "What should I make with garlic?" → 3/3 candidates contain garlic (previously 0/3). "What should I make with onions?" → 3/3 candidates contain onions (previously 1/3 clean + 1 literal miss).
- **Plural matching (B2)**: PASS — all 42 unit tests pass, including 4 new ones covering the spec's exact acceptance-criteria pairs (`onion`/`onions`, `onion`/`caramelized onions`, `red bean`/`bean sprouts` invariant, `glass`/`glasses` guard, `citrus`/`citruses` documented limitation).
- **Prompt hardening (B3)**: code-reviewed only (prompt-only change, consistent with this project's established pattern for this class of fix per TASK-028/029) — not independently re-tested for hallucination absence this session, since the live garlic/onion re-tests happened to return genuinely-matching results (nothing to hallucinate about in either response).
- **README (C1)**: confirmed via file read — link now points to `https://kitchenkeeper.vercel.app`.
- `db.transaction(` repo-wide grep: zero remaining call sites (2 comment-only hits, not code).
- `node --check` passes on all 7 modified server files.

# Recommended Next Action
TASK-035 is done. No new spec is queued. Suggested next steps, in order: (1) the Clerk Development-mode production config question (C2, Remaining Work #1) — quick investigation, not a code task; (2) optionally, a quick look at `recipeScorer.js`'s general fuzzy-match path against the B2 threshold change (see Known Risks — still open, low urgency); (3) ask the user what feature work is next, since the backlog of carried-forward "known bugs" is otherwise empty for the first time in several sessions. The transient-401 lead (see Known Risks) was investigated this session and closed as non-reproducible — no further action queued on it.

# Forbidden Exploration
No longer applicable — TASK-035 is complete and no fresh spec is queued yet.

# Context Notes
- branch: main
- worktree: none
- context pressure: medium — full spec implementation + live verification across 3 subsystems in one session

# PowerShell Merge Block
Application code (server + client docs) for TASK-035, plus this handoff. No schema/migration changes, no database writes left behind (all test data — 1 shopping list, 1 push subscription, 2 throwaway households — created and deleted during verification).

```powershell
git add server/services/shoppingService.js server/routes/shopping.js server/routes/push.js server/services/householdService.js server/services/recipeSearchService.js server/utils/foodNormalization.js server/utils/foodNormalization.test.js server/services/aiService.js README.md ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-035: production smoke-test fixes - shopping list outage, db.transaction sibling sites, recipe-targeting query dilution + plural matching (implemented, live-verified)"
git push
```
