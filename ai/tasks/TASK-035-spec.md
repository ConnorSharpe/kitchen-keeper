# TASK-035 — Production Smoke-Test Fixes: Shopping List Outage, Sibling `db.transaction()` Sites, Recipe-Suggestion Targeting Gap

Version: DRAFT-3 — **APPROVED FOR IMPLEMENTATION** (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 — approve after one revision | Required: (1) make a firm call on A2 instead of leaving it as an open question — resolved below, committing to sequential/non-transactional per the architect's own recommendation; (2) verify database constraints before asserting insert-before-delete is safe for the household-join reorder, rather than assuming — resolved below by tracing the actual schema (`householdMembers.clerkUserId` and `households.clerkUserId` are two separate unique columns, not one shared constraint, and Guard B already guarantees zero pre-existing `householdMembers` row before this code path runs), which confirms the reorder is safe and explains *why*, rather than assuming it; (3) document the failure mode if the shopping-list compensating delete itself fails — added; (4) soften unproven claims about Spoonacular's internal ranking algorithm — reworded from asserted fact to inference from documented API parameters plus observed behavior; (5) add edge-case tests for the plural-matching fix — added, including two cases (`glass`/`glasses`, `citrus`/`citruses`) that the narrow fix is expected to *not* handle, documented as an accepted limitation rather than silently claimed as solved. Also raised, not actioned: README fix (C1) is architecturally unrelated to the production-outage work and would ideally be its own task — acknowledged below; kept in this spec because the user explicitly asked for every smoke-test finding to be consolidated into one document this round, with a note that future specs shouldn't default to this pattern. |
| DRAFT-2 | 9.6/10 — **APPROVED FOR IMPLEMENTATION** | No blocking issues. All five required items from round 1 confirmed resolved. Minor polish incorporated: clarified that B2's `ss`-ending guard prevents *corrupting* `"glass"`, not *normalizing* `"glasses"` — those are distinct claims and the wording now says so explicitly; reworded the garlic acceptance criterion from "the top result" to "at least one Tier-1 result," since this codebase's fix guarantees correct query construction and Tier-1 partitioning, not a third-party API's result ordering over time; added an explicit "no retry loop" instruction to A2 so a future session doesn't reintroduce the accepted race window by independently retrying the delete or upsert; considered adding a `request_id` to the shopping-list orphan-cleanup log line (matching the existing `aiService.js` correlation-id pattern) and explicitly decided not to, since that pattern isn't currently plumbed into `shoppingService.js` and wiring it through for one log line is out of this task's scope — documented as a considered-and-declined choice rather than silently skipped. |

---

## Origin

This spec was written up after a live manual smoke test of production (`https://kitchenkeeper.vercel.app`) covering everything shipped since the last dedicated smoke-test doc ([TASK-024-smoke-tests.md](TASK-024-smoke-tests.md)), i.e. TASK-025 through TASK-034. Most of that surface passed. This spec addresses everything that didn't, prioritized per the user's explicit ask: **the Shopping List outage first**, then the recipe-suggestion targeting gap, then two small documentation/infra items.

Two items surfaced during smoke testing are explicitly **not** included here (see Out of Scope): a single-instance recipe-image-extraction quantity misread (non-deterministic vision-model accuracy, no code defect found), and an initially-suspected "servings-per-unit can't be cleared" bug that did not survive a code-level re-check (see Part D).

---

## Part A — Shopping List Is Completely Unusable in Production (`db.transaction()` Throws Unconditionally on This Driver)

### Problem

`POST /api/shopping/build` — the **only** way to create a shopping list in this app (there is no "create blank list" path; [ShoppingPage.jsx] only offers "Build Shopping List" from saved recipes) — returns a 500 on every call in production. Live-reproduced this session: selected 1 recipe, clicked "Build List", got `{"error":"Internal server error"}`. Because list creation is the sole entry point into the feature, **the entire Shopping List feature is currently unusable end-to-end** — TASK-027's edit/delete UI cannot even be reached, let alone tested.

### Root Cause (confirmed via source inspection, not guessed)

[server/services/shoppingService.js:207](../../server/services/shoppingService.js) wraps the list+items insert in `db.transaction(async (tx) => {...})`. This app's DB client ([server/db/client.js](../../server/db/client.js)) uses `drizzle-orm/neon-http`, which **does not support interactive transactions at all**. This isn't a new finding — TASK-032's own session already confirmed it directly against the installed driver source:

> "this driver (drizzle-orm/neon-http) has no transaction support at all — confirmed in `server/node_modules/drizzle-orm/neon-http/session.js`, `NeonHttpSession.transaction()` throws unconditionally ('No transactions support in neon-http driver')... that call is almost certainly broken too, and is the likely real cause of this repo's long-standing unexplained `POST /api/shopping/build` 500." — [pantryService.js:186-192](../../server/services/pantryService.js), comment left during TASK-032

That comment was written 3 sessions ago (TASK-032) and flagged as Remaining Work in every handoff since (TASK-032, TASK-033, TASK-034) without being fixed. This spec fixes it.

### Additional finding: two sibling call sites, never audited

TASK-032's handoff also carried forward an explicit backlog item: *"repo-wide grep for other `db.transaction(` call sites — still not done."* That grep is now done, as part of writing this spec:

```
server/routes/push.js:38               await db.transaction(async (tx) => {
server/services/householdService.js:193  await db.transaction(async (tx) => {
server/services/shoppingService.js:207   const result = await db.transaction(async (tx) => {
```

Both of the other two call sites throw the identical unconditional error and are **almost certainly also completely broken in production right now** — nobody has hit them yet (or hit them and didn't connect it to this root cause), but the mechanism is identical:

- **`server/routes/push.js:38`** (`POST /api/push/subscribe`) — every attempt to enable push notifications currently 500s. This silently breaks the daily-digest feature described in the README (the `vercel.json` cron at `/api/push/cron` fires on schedule but no household can ever successfully subscribe).
- **`server/services/householdService.js:193`** (join-a-different-household-via-invite-code flow) — every attempt to join another household currently 500s.

Neither was independently live-verified this session (smoke test didn't cover push subscription or multi-household join), but given the identical, unconditionally-throwing call, live-verifying them as part of implementation (not as a separate investigation) is the efficient path — see Verification Steps.

### Fix Approach

The driver constraint is fixed (no transactions, ever, on this connection). TASK-032 already established this codebase's precedent for race-safety without `db.transaction()`: replace it with either (a) a single atomic Postgres statement, or (b) a carefully-ordered sequence of independent statements chosen so that a failure between them leaves the system in the *safer* of the two possible partial states. Applying that same discipline to all three sites:

**A1 — `shoppingService.buildFromRecipes()`** (primary fix, addresses the reported 500):
1. Insert the list row as one statement (unchanged from today, just no longer inside `tx`).
2. If `needed.length === 0` (pantry already covers every ingredient), return `{ status: 'ok', list, items: [] }` immediately — skip the items insert rather than calling `.values([])` with an empty array.
3. Otherwise, insert **all** items in a single bulk `db.insert(shoppingListItems).values([...]).returning()` call. A single multi-row `INSERT` is one Postgres statement — atomic by default, no driver transaction support required. Either all items land or none do.
4. Wrap step 3 in try/catch. On failure, attempt to delete the list row created in step 1 (compensating cleanup, same discipline TASK-025 used for its Blob-upload rollback: "accepted-orphaned-blob risk was too lax — added `del()` rollback on DB failure") and return an error status, so the route responds with a clear 500 rather than the caller silently getting an orphaned empty list.

**Failure-of-the-failure-handler case (raised in review, not originally covered):** the compensating delete in step 4 can itself fail (e.g. the same transient DB issue that broke the items insert also breaks the cleanup delete). This spec does not attempt a second-level retry — this codebase has no retry infrastructure anywhere else, and adding one here for a rare double-failure would be disproportionate. Instead: wrap the cleanup delete in its own try/catch; if it also fails, log a structured error line identifying the orphaned list's id (e.g. `function=shoppingService orphaned_list_id=<id> reason=compensating_delete_failed`) so it's discoverable via Vercel's log search for manual cleanup, then still return the original items-insert error to the caller either way — the request failed regardless of whether cleanup succeeded, and the caller should see that failure, not a cleanup-specific one. This is the same "log clearly, don't over-engineer recovery" posture already implicit in this codebase's existing error handling (e.g. `recipeSearchService.findByPantry`'s catch-all that logs and returns `[]` rather than retrying). Checked whether to also include a `request_id` in this log line, matching the existing `request_id=<short-uuid>` correlation pattern already used in `aiService.js`/`ai.js` (e.g. [aiService.js:339](../../server/services/aiService.js)) — that pattern isn't currently plumbed into `shoppingService.js` or its route, and wiring it through for this one log line would be a small scope expansion beyond this task's fix. Not doing so here; the orphaned-list-id alone is sufficient to find and manually clean up the specific row, which is the log line's only purpose.

Net failure mode: worst case is a normal, clearly-erroring request, with the rare double-failure case surfaced via logs rather than silently lost — never a partially-populated list, and an orphaned empty list is now a logged, findable event rather than an invisible one.

**A2 — `push.js` `/subscribe`**: the existing code comment argues the cross-household delete + upsert must be atomic to prevent a "transient ownership flip" under concurrent requests to the *same push endpoint* from *two different households*. **Decision (firm, not open): drop `db.transaction()` and run the two statements sequentially — delete, then upsert — without a wrapping transaction.** No CTE, no raw SQL. Reasoning: the residual race window (two concurrent subscribe calls for the identical push endpoint from two different households, in the same instant) is extremely narrow for a household-scale app, a single-endpoint-double-subscribe collision is already an edge case bordering on nonsensical (a push subscription endpoint is browser+device+origin-specific), and this matches the project's already-established risk tolerance (TASK-032 accepted an analogous "crash between two statements" residual risk for the same driver limitation). A raw-SQL CTE (`WITH deleted AS (DELETE ... RETURNING 1) INSERT ... ON CONFLICT ... RETURNING *`) would close the window entirely but adds a maintenance burden (drops out of the query builder into hand-written SQL) disproportionate to a risk this narrow — rejected for that reason, not reconsidered as still-open. **No retry loop should be introduced around either statement.** The delete and upsert are not being wrapped in a transaction specifically because the residual race is accepted as-is; independently retrying either statement on failure would widen that same window rather than close it (a retried delete racing a fresh concurrent upsert, or vice versa, is a strictly worse version of the risk already accepted above) and would be a natural but incorrect "improvement" for a future session to reach for — called out explicitly so it isn't reintroduced later.

**A3 — `householdService.js` join-household flow**: current order is delete-old-household-then-insert-new-membership. That ordering is the *riskier* of the two possible sequences: if the delete succeeds but the insert then fails, the user is left with **no household membership row at all** (a "homeless" user, broken session) — worse than today's outright 500. Fix: reverse the order — **insert the new membership first, then delete the old (already-confirmed-disposable/empty) household**. Run both statements sequentially, no `db.transaction()` wrapper.

**Constraint verification (not assumed — traced against the actual schema before committing to this reorder):** the concern with any insert-before-delete reorder is whether the insert could fail on a uniqueness conflict with the very row the delete is about to remove. Checked directly against [schema.js](../../server/db/schema.js):
- `households.clerkUserId` ([schema.js:13](../../server/db/schema.js)) — a unique column that identifies a household's *owner*. A normal solo user's auto-created household has this set to their own `clerkUserId`.
- `householdMembers.clerkUserId` ([schema.js:103](../../server/db/schema.js)) — a **separate** unique column, on a different table, that identifies a *non-owner member's* single household.
- `getOrCreate()` ([householdService.js:100-117](../../server/services/householdService.js)) resolves a user's household in that exact order — check `householdMembers` first (are they a member of someone else's household?), then `households.clerkUserId` (do they own one?), then auto-create. A solo owner therefore has **zero** rows in `householdMembers`.
- `joinByCode()`'s own Guard B ([householdService.js:173-182](../../server/services/householdService.js)) already queries `householdMembers.clerkUserId` and throws 409 *before* reaching the delete/insert if any row exists there. By the time execution reaches the reordered insert, this guard has already proven the user has no existing `householdMembers` row to conflict with — the insert targets a table where, for this user, no row exists yet, regardless of order.

Conclusion: insert-before-delete cannot violate the unique constraint, because the row being deleted (`households`) and the row being inserted (`householdMembers`) are different tables with independent unique columns, and the one column that could theoretically conflict (`householdMembers.clerkUserId`) is already proven empty for this user by an existing guard that runs earlier in the same function. If the insert fails for an unrelated reason (e.g. a transient DB error), the user keeps their old, empty household as a safe fallback rather than becoming homeless; if the delete fails after a successful insert, the only residual is a stale empty household row with no members (harmless, matches the existing "disposable household" concept already checked via `isDisposableHousehold()`).

### Decisions

- **D-A1**: Bulk multi-row `INSERT` (one statement) replaces `db.transaction()` for `buildFromRecipes()`'s items write. Chosen over a raw-SQL CTE approach because the list's `id` is a `serial` PK — it isn't known until after the list insert commits, so a single true cross-table atomic statement would itself need a CTE (`WITH new_list AS (INSERT ... RETURNING id) INSERT INTO shopping_list_items SELECT new_list.id, ... FROM new_list, unnest(...)`). Two simple statements + compensating cleanup was judged the smaller, more maintainable diff for a low-concurrency, single-actor action (nothing here is subject to the kind of concurrent-mutation race TASK-032 had to solve for).
- **D-A2**: Sequential (non-transactional) delete-then-upsert for push subscribe — firm decision, not open (see A2 reasoning above). Accepts the narrow same-endpoint-different-household race as a documented residual risk in exchange for not introducing raw SQL.
- **D-A3**: Reorder join-household to insert-before-delete specifically to fail into the safer state. Not optional — this is a correctness fix regardless of the transaction question, since the *current* order is unsafe independent of whether transactions worked. Verified safe against the actual schema (see Constraint verification above), not assumed.
- **D-A4**: No schema changes required for any of Part A — this is entirely service/route-logic level.

### Acceptance Criteria

- `POST /api/shopping/build` with 1+ valid recipe IDs returns 201 with a populated list + items, live-verified against the shared Neon DB (production).
- `POST /api/shopping/build` with recipe(s) whose ingredients are 100% already covered by pantry returns 201 with `items: []` (not an error, not a skipped-items-insert crash).
- Simulate an items-insert failure (e.g., temporarily pass an invalid column) and confirm the compensating list-delete leaves zero orphaned list rows — verify via a DB query, not just "no error shown."
- `POST /api/push/subscribe` succeeds (201) with a valid subscription body, live-verified.
- Join-household flow (via invite code) succeeds and leaves the user with exactly one household membership, live-verified end-to-end including a case where a fault is deliberately injected after the insert to confirm the old household is *not* prematurely deleted before the insert commits.
- Repo-wide grep for `db.transaction(` after this task shows zero remaining call sites.

---

## Part B — Recipe-Suggestion Ingredient Targeting Is Unreliable (TASK-034 Regression/Gap)

### Problem (live-reproduced, not theoretical)

TASK-034's Part A promised "guaranteed inclusion" of a user-named ingredient in the top suggestions (Tier 1). Live-tested this session with two distinct queries against the same household's real pantry/API keys:

- **"What should I make with garlic?"** → 3 suggestions returned: *Toasted Agnolotti* (ravioli/egg/breadcrumbs), *Dulce De Leche Swirled Amaretto Frozen Yogurt* (vanilla yogurt/amaretto cream/dulce de leche), *Scotch Eggs* (sausage/cornmeal/eggs). **Zero of the three actually contain garlic** — confirmed against the raw tool-result `ingredients` arrays in the API response, not just the rendered cards. `matchedIngredients: []` and `overlapScore: 0` on all three.
- Worse: the model's own (UI-suppressed, but still generated) reply text **fabricated** garlic's presence in all three — e.g. claiming the frozen yogurt recipe has "a hint of garlic for flavor enhancement," which is not in its ingredient list at all.
- **"What should I make with onions?"** (a second, independent query) → better but still inconsistent: 1 of 3 clean matches (`Vegetable Dip`, `matchedIngredients: ["onion"]`), 1 loose match via a related-but-different ingredient (`scallion`), and 1 **miss on a recipe literally named "Caramelized Onion Dip"** — `matchedIngredients: []` despite the dish being built around onions.

### Root Causes (three distinct, independently-fixable issues)

**B1 — Query dilution.** [recipeSearchService.js:209-218](../../server/services/recipeSearchService.js) guarantees `targetIngredients` occupy the first slots of the search query sent to Spoonacular, but still pads the remaining slots (up to 5 total) with pantry-anchor ingredients (`pantryOrdered`, designed for the generic "what should I eat" case) even when the user named a specific ingredient. [recipeSearchService.js:96-101](../../server/services/recipeSearchService.js) sends all 5 as one `findByIngredients?ingredients=a,b,c,d,e&ranking=2` call. Spoonacular's public API docs describe `ranking=2` as "minimize missing ingredients" (as opposed to `ranking=1`, "maximize used ingredients") — both are relevance-across-the-whole-list rankings, and neither is documented as a per-ingredient "must contain X" filter. The exact internal scoring formula isn't published, so the following is an inference from the documented parameter semantics plus this session's observed behavior, not a proven mechanism: a query like `garlic,boneless skinless chicken thigh,bananas,broccoli crowns,onions` is consistent with ranking recipes that match the other 4 well while containing none of the actually-requested ingredient. This inference is also consistent with why the previous session's "milk" test passed (a single clean anchor, nothing to dilute it against) while "garlic" — anchored alongside 4 unrelated pantry items — failed completely, but that comparison is circumstantial corroboration, not confirmation of Spoonacular's internals. Regardless of the precise mechanism, removing the dilution (see Fix Approach) is a safe, low-risk change on its own merits — a query with only the requested ingredient(s) can only make Spoonacular's results *more* relevant to that ingredient, never less, independent of whether this specific theory of the ranking behavior is exactly right.

**B2 — `foodsMatch()` has no plural handling.** [foodNormalization.js:122-136](../../server/utils/foodNormalization.js): `tokenize()` splits on whitespace/punctuation with no stemming, and `foodsMatch()` requires either an exact canonical-name match or ≥2 shared tokens. `foodsMatch("onion", "caramelized onions")` tokenizes to `{"onion"}` vs `["caramelized","onions"]` — zero shared tokens (`"onion"` ≠ `"onions"` as exact strings), so a recipe literally about onions registers as a non-match. This is a narrower, more mechanical bug than B1, independent of it.

**B3 — System-prompt non-compliance (hallucination).** [aiService.js:490](../../server/services/aiService.js) already instructs the model not to describe individual recipes in prose ("the app renders recipe cards... write one brief introductory sentence at most"), and TASK-034 Part C's *structural* suppression in `ChatPage.jsx` means this violation is currently invisible to users regardless. But the model still generated full per-recipe descriptions that outright invent an ingredient's presence. This is a defense-in-depth gap, not a user-visible bug today — but it's latent risk (if the structural-suppression condition is ever bypassed or a future surface reuses `reply` text, the fabrication becomes visible) and it's a correctness problem in its own right.

### Fix Approach

**B1 fix — don't dilute a targeted query.** When `targetIngredients` is non-empty, query the recipe API using *only* the target ingredient(s) (still capped at 5, still deduplicated) — do not pad with `pantryOrdered`. Rotation (`rotationOffset`) naturally becomes a no-op in this branch, which is correct: TASK-034 Part B's rotation exists to vary which *pantry* ingredients anchor the generic-case query; it has nothing to rotate when the user named specific ingredients, and `targetIngredients` already "always keep priority over both" per the existing code comment — this fix makes that priority absolute (100%) instead of partial (first N of 5 slots).

**B2 fix — plural-tolerant tokenization.** Add simple trailing-`s` stripping to `tokenize()` before comparison (e.g., `"onions"` → `"onion"`), applied to both sides, guarded so a token already ending in `ss` (e.g. `"glass"`) is left alone rather than stripped to a mangled `"glas"`. To be precise about what this guard does and doesn't do: it prevents *corrupting* `"glass"` into an invalid `"glas"` stem — it does not attempt to *normalize* `"glasses"` down to match `"glass"` (that would require the "+es after a sibilant" rule called out below as explicitly not attempted). The two are separate concerns: corruption-avoidance for the singular form is in scope; irregular-plural normalization is not. This is a minimal, well-scoped change overall: it doesn't touch the ≥2-shared-token-OR-canonical-match rule that TASK-011 established specifically to prevent cross-variety matches (e.g. "red bean" vs "bean sprouts") — it only normalizes singular/plural token *forms* before that rule runs, so `foodsMatch("onion", "onions")` and `foodsMatch("onion", "caramelized onions")` both correctly resolve to a match without loosening the existing anti-false-positive guard.

**Explicitly not attempted — irregular plurals.** English pluralization beyond "add a trailing s" (words ending in a sibilant that take "+es" — `"glass"`/`"glasses"`, `"citrus"`/`"citruses"`; "o" → "+es" — `"tomato"`/`"tomatoes"`; "y" → "+ies" — `"berry"`/`"berries"`) is a materially bigger problem than the observed bug (`"onion"`/`"onions"`, a plain regular plural) and would require either a small hardcoded exception table or a real stemming library — disproportionate to this narrowly-scoped fix, and this project's stated preference is against introducing dependencies or abstractions beyond what a task requires. These cases are called out explicitly as a known, accepted limitation (see Acceptance Criteria and D-B2) rather than silently left unhandled and untested.

**B3 fix — tighten the system prompt.** Add an explicit line to the `suggest_recipes` guidance in `aiService.js`: the model must never state or imply an ingredient is present in a recipe unless it actually appears in that recipe's tool-result `ingredients` array. This is prompt-only, no code logic change, consistent with this project's established pattern for this class of fix (see TASK-028/029's prompt-only corrections).

### Decisions

- **D-B1**: Target-only query (no pantry padding) when `targetIngredients` is non-empty. Architect: confirm this doesn't conflict with any implicit assumption elsewhere that the query always reflects general pantry state — grep shows `findByPantry`'s only caller passing `targetIngredients` is `aiService.suggestRecipes()` via the chat tool handler, so this is scoped correctly, but flagging for a second look since it changes cache-key composition for the targeted case.
- **D-B2**: Plural-stripping is intentionally naive (trailing `s` only, guarded against `ss`-ending words, no full stemming library) — matches this project's existing preference against introducing new dependencies for a narrowly-scoped fix. Won't catch irregular plurals (e.g. "leaf"/"leaves", "tomato"/"tomatoes", "glass"/"glasses", "citrus"/"citruses"); accepted as a known limitation, not a blocker, and explicitly tested-and-documented rather than silently unhandled (see Acceptance Criteria).
- **D-B3**: Zero Tier-1 matches remains a valid, non-error outcome per TASK-034's original Decision A4 — B1 reduces how often it happens (by removing the dilution that was actively causing it) but does not claim to eliminate it, since an external recipe API can always legitimately have no strong match for an obscure ingredient. This spec does not change that acceptance; it only fixes the identified causes of it happening *more* than the original design intended.

### Acceptance Criteria

- Re-run "What should I make with garlic?" against a pantry containing garlic (or without — targeting shouldn't depend on pantry presence) and confirm **at least one Tier-1 result** (a candidate whose `ingredients` array actually contains a garlic-family entry) is present, live-verified via raw API response inspection (not just card rendering). Deliberately phrased as "at least one Tier-1 result," not "the top result" — this spec's fix guarantees the *query* targets garlic and that Tier-1 partitioning surfaces a genuine match when Spoonacular returns one; it does not and cannot guarantee Spoonacular's own result ordering stays stable over time, and the acceptance criterion should validate this codebase's behavior, not an external API's ranking.
- Re-run "What should I make with onions?" and confirm "Caramelized Onion Dip" (or an equivalent literally-onion-named result) now shows a non-empty `matchedIngredients`.
- Unit-level confirmation (via direct call or a temporary log, then removed) that `foodsMatch("onion", "onions")` and `foodsMatch("onion", "caramelized onions")` both return `true`, and that `foodsMatch("red bean", "bean sprouts")` still returns `false` (TASK-011 invariant unaffected).
- Same confirmation that `foodsMatch("glass", "glasses")` does **not** false-positive-mangle `"glass"` into an invalid stem (guard against the `ss`-ending case) — expected result is that the guard prevents corruption, though the pair may still legitimately not match given the naive approach, which is acceptable per D-B2.
- Same confirmation that `foodsMatch("citrus", "citruses")` is checked and its result (match or no-match) is recorded as a known, documented limitation either way — not required to return `true`, just required to not silently regress into an unexamined state.
- Inspect a fresh `suggest_recipes` raw reply string post-fix and confirm no fabricated ingredient claims for a case where Tier-1 is legitimately empty (i.e., the model correctly says something like "these don't have garlic but are close" rather than inventing garlic's presence) — or, per the brief-intro-only prompt rule, ideally just a one-sentence reply with no per-recipe claims at all.

---

## Part C — Documentation / Infra Hygiene

Two small, independent items surfaced during the smoke test. Both are low-risk, low-effort, and **architecturally unrelated** to Parts A/B — a stale doc link and a Clerk config question have nothing to do with a database-driver bug or a recipe-search ranking issue. Raised in review: this doesn't belong bundled into a production-outage fix task under normal circumstances, and a future spec shouldn't default to folding unrelated documentation cleanup into a bug-fix task just because both surfaced in the same testing session. It's kept here specifically because the user explicitly asked this round for every smoke-test finding to be consolidated into one spec — not because it's the right long-term pattern.

**C1 — Stale production URL in README.** [README.md](../../README.md) links `https://kitchen-keeper-connorsharpes-projects.vercel.app` as the "Live Demo," but that URL now redirects to Vercel's own SSO login (Deployment Protection), not the app — it's no longer the production alias. The current production URL, confirmed live this session, is `https://kitchenkeeper.vercel.app`. Fix: update the README link.

**C2 — Clerk running in Development mode on production** (flagged, not fixed here). The production sign-in page displays Clerk's "Development mode" badge and a generic `winning-swift-74.accounts.dev` auth domain rather than a custom/production Clerk instance. This is a Vercel environment-variable / Clerk-dashboard configuration question (which `CLERK_SECRET_KEY`/publishable key pair is set in Vercel's production environment), not a code change — **out of scope for this spec's implementation**, but recorded here so it isn't lost. Recommend a short separate investigation: compare the Clerk key prefix in Vercel's production env vars against Clerk's dashboard to confirm whether a dev-instance key was used by mistake, or whether this is an intentional choice for a household-scale app.

### Acceptance Criteria

- README's Live Demo link resolves directly to the app (no SSO redirect).
- C2 is filed as a follow-up note (e.g. in `CURRENT_STATE.md`'s backlog), not silently dropped, but requires no code change in this task.

---

## Part D — Investigated, Not Confirmed: Servings-Per-Unit "Can't Be Cleared"

During the smoke test, clearing the "servings per unit" field in `AddItemModal.jsx` and saving appeared to leave the old value in place (PATCH response still showed `servingsPerPurchaseUnit: 2` after an apparent clear-and-save). Re-checking the full path at the code level for this spec — client (`AddItemModal.jsx:86`: `form.servingsPerPurchaseUnit ? Number(...) : null` correctly produces `null` for an empty string), request serialization (`api/index.js`: plain `JSON.stringify`, doesn't drop `null`), the Zod schema (`servingsPerPurchaseUnit: z.coerce.number().min(0.1).max(1000).nullable().optional()` — `.nullable()` short-circuits for an actual `null` value before the coercion/min/max checks run), the `validate` middleware (plain `safeParse`, no stripping), and `pantryService.update()` (spreads `data` directly into `db.update(...).set(...)`, no field-skipping logic) — **found no defect anywhere in this chain**. Every layer that was checked correctly propagates an explicit `null`.

Given that, the most likely explanation is a browser-automation artifact from the smoke-testing session itself (a `triple_click` + `Delete` keypress on a `type="number"` input may not have actually cleared the field before the save was triggered — this wasn't re-screenshotted to confirm before submitting). **Not including a fix in this spec.** Recommend the user manually re-verify by hand (type a value, save, reopen, clear the field by hand, save, reopen) before this is treated as a real bug requiring a follow-up task.

---

## Out of Scope

- **Recipe-image-extraction quantity misread** (½ cup misread as 2 cup on one ingredient out of ~13, during this session's TASK-030 live test). Other fractions on the same image (¼, ½ elsewhere) were extracted correctly, so this reads as an isolated vision-model accuracy miss, not a systemic defect — the existing "AI extracted this — please review before saving" human-review step is the intended safety net for exactly this class of error, and there's no code-level fix for a probabilistic single-item misread. Not actioned here.
- **Clerk Development-mode configuration** (C2) — infra/env var investigation, not a code change; noted above, not implemented in this spec.
- Any other `db.transaction(`-adjacent risk beyond the three call sites identified in Part A's repo-wide grep — none found.

---

## Allowed Files

- `server/services/shoppingService.js`
- `server/routes/push.js`
- `server/services/householdService.js`
- `server/services/recipeSearchService.js`
- `server/utils/foodNormalization.js`
- `server/services/aiService.js` (system-prompt string only, Part B3)
- `README.md`
- `ai/handoffs/CURRENT_STATE.md` (session handoff, plus filing the C2 follow-up note)

## Forbidden Files

- Anything under `server/db/schema.js` / `server/db/migrations/` — this task requires zero schema changes.
- `client/src/**` — every fix in this spec is server-side or documentation; no client behavior changes are needed (the client already sends correct payloads in every case investigated).
- `server/services/pantryService.js`, `server/services/recipeBlocklistService.js`, `server/utils/recipeScorer.js` — unrelated to this spec's findings, not to be touched incidentally.

## Dependency Chain

```
Editing:
- server/services/shoppingService.js (Part A1)
- server/routes/push.js (Part A2)
- server/services/householdService.js (Part A3)
- server/services/recipeSearchService.js (Part B1)
- server/utils/foodNormalization.js (Part B2)
- server/services/aiService.js (Part B3, prompt string only)
- README.md (Part C1)

Requires:
- server/db/client.js (read-only — confirms neon-http has no transaction support; not edited)
- server/db/schema.js (read-only — confirms serial PK types driving Decision D-A1; not edited)

Irrelevant:
- client/src/** (no client changes needed)
- server/db/migrations/** (no schema changes needed)
- server/services/recipeScorer.js, recipeBlocklistService.js (unrelated to findings)
```

## Known Risks

- Part A2's chosen approach (sequential, non-transactional) accepts a narrow same-endpoint/different-household race window as a deliberate tradeoff against introducing raw SQL for a disproportionately rare case — a firm decision (see A2), not an unresolved question, but worth naming as a residual risk regardless.
- Part A3's reordering reduces but does not eliminate all risk — a crash between the insert and the delete leaves a harmless stale empty household row (acceptable, matches this driver's inherent no-transactions ceiling already accepted project-wide since TASK-032).
- Part B1's fix changes recipe-suggestion behavior for every targeted query in production immediately upon deploy — no feature flag, consistent with this project's stated preference against speculative flags, but worth the architect's explicit sign-off since it's a behavior change to a recently-shipped, already-reviewed feature (TASK-034).
- Part B2's naive plural-stripping could theoretically introduce a false-positive match this project hasn't seen yet (e.g. some irregular case where stripping trailing `s` creates an accidental token collision) — no such case was found during this investigation, but it's a genuine (if narrow) behavior change to a matching function used across multiple features (targeting, scoring, allergy annotation is explicitly NOT using this path per `lightNormalizeForAllergy`'s separate, unaffected implementation).

## Verification Steps

1. Live-verify `POST /api/shopping/build` against the shared Neon DB (production), covering both the has-items and zero-items-needed cases.
2. Live-verify `POST /api/push/subscribe` and the join-household flow end-to-end (both were not covered by the original smoke test and are new-to-this-task verifications).
3. Re-run the exact two chat queries from this session's smoke test ("what should I make with garlic?", "what should I make with onions?") against production post-fix and compare `matchedIngredients`/raw `ingredients` arrays to this spec's Problem section.
4. Confirm README's Live Demo link resolves without an SSO redirect.
5. Update `ai/handoffs/CURRENT_STATE.md` per this project's standard session-end checklist, including filing C2 as an explicit backlog item (not fixed, not forgotten).
