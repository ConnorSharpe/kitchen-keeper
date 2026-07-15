# Task
TASK-033 — Servings-Per-Purchase-Unit Tracking. **Implemented and live smoke-tested this session — PASS on every acceptance criterion.** Production migration was user-approved and hand-applied before verification began. Background: TASK-029.5 through TASK-032 (previous sessions) are all implemented and live smoke-tested — clean pass, considered done.

# Current Status

**TASK-033 — PASS.** Fully approved spec (architect round 2, 9.7/10), implemented per its Decisions with no deviations. Required a production Neon schema migration (`servings_per_purchase_unit real`, nullable) — flagged to the user before implementation per the spec's own explicit requirement and this project's established practice (TASK-031 precedent); user confirmed "Statement executed successfully" before any live verification was attempted.

Implemented:
- **New column** `servings_per_purchase_unit` (`real`, nullable, never auto-set) on `pantry_items`.
- **`computeSplitQuantityFromServings(splitServings, servingsPerPurchaseUnit)`** — new named helper in `pantryService.js`, rounds `splitServings / servingsPerPurchaseUnit` to 6 decimal places (spec's precision policy), extracted for future reuse (consume-by-servings, recipe-servings math) rather than inlined.
- **`splitItem()` extended** — accepts an optional `splitServings` alongside the existing `splitQuantity`. When supplied, does one extra read (to fetch the item's own `servingsPerPurchaseUnit` for conversion — not itself race-prone, doesn't participate in the atomic-UPDATE race-safety mechanism, which is unchanged from TASK-032) then converts via the helper before falling into the existing atomic-conditional-UPDATE path unchanged. Returns a new `no_servings_configured` status (→ 400) when `splitServings` is requested on an item with `servingsPerPurchaseUnit` null.
- **`POST /:id/split` schema** — Zod `.refine()` enforcing exactly one of `splitQuantity`/`splitServings` (not an implicit truthy check, per Constraint 6); `splitServings` deliberately not `z.coerce`'d, matching `splitQuantity`'s existing NaN/Infinity-rejection behavior.
- **`createSchema`/`updateSchema`** — `servingsPerPurchaseUnit: z.coerce.number().min(0.1).max(1000).nullable().optional()`, exactly as specified.
- **`AddItemModal.jsx`** — new optional "Servings per unit" field, used for both add and edit via the existing `isEdit` branching (no new edit surface needed, confirmed rather than assumed).
- **`PantryTable.jsx`** — small annotation under the quantity cell (e.g. "2 servings/pouch") when set.
- **`SplitItemModal.jsx`** — mutually-exclusive Units/Servings toggle, shown only when `item.servingsPerPurchaseUnit != null`; only one input rendered/active at a time (UI-level guarantee, not just relying on the API's XOR check); servings-mode input's `max` is computed as `item.quantity * item.servingsPerPurchaseUnit` (total available servings, a different unit than the quantity-mode max).

All other files match the spec's Allowed Files list exactly; nothing in Forbidden Files was touched (`server/services/aiService.js`/`server/routes/ai.js` untouched — no AI path sets this field; `client/src/components/shopping/*` untouched — shopping remains purchase-unit-only).

# Files Modified
- `server/db/schema.js` — new `servingsPerPurchaseUnit` column.
- `server/db/migrations/0015_pantry_servings.sql` (new) — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, same hand-applied-then-safely-re-attempted pattern as TASK-031's `0014_pantry_storage.sql`.
- `server/db/migrations/meta/_journal.json` — new `idx: 15` entry for the above.
- `server/services/pantryService.js` — new `computeSplitQuantityFromServings()`; `splitItem()` accepts `splitServings`, converts via the helper, returns `no_servings_configured` status when applicable.
- `server/routes/pantry.js` — `createSchema`/`updateSchema` gain `servingsPerPurchaseUnit`; `splitSchema` gains `splitServings` + XOR `.refine()`; split route handles the new `no_servings_configured` → 400 case.
- `client/src/components/pantry/AddItemModal.jsx` — servings-per-unit field (form state, submit body, new input).
- `client/src/components/pantry/PantryTable.jsx` — display annotation under quantity.
- `client/src/components/pantry/SplitItemModal.jsx` — Units/Servings toggle, dual input modes, conditional max.

# Files Required Next
- None for TASK-033's own scope — done.
- **Still open, carried forward from TASK-032's session, now higher-priority than ever**: `shoppingService.buildFromRecipes()`'s `db.transaction()` call is confirmed broken on this driver (`neon-http` has zero transaction support — throws unconditionally) and is the likely real cause of the long-standing `POST /api/shopping/build` 500. Not touched this session either (out of TASK-033's Allowed Files — `shoppingService.js` isn't referenced by this task at all). Worth a dedicated session.
- A repo-wide grep for other `db.transaction(` call sites was recommended after TASK-032's session and still hasn't been done.

# Files Already Reviewed
- `server/services/pantryService.js`, `server/routes/pantry.js`, `server/db/schema.js`, `server/db/migrations/0014_pantry_storage.sql` (pattern reference), `server/db/migrations/meta/_journal.json`, `server/middleware/validate.js` (confirmed `.refine()`-based Zod schemas work with the existing `safeParse` middleware unchanged) — full reads, this session.
- `client/src/components/pantry/AddItemModal.jsx`, `SplitItemModal.jsx`, `PantryTable.jsx`, `PantryPage.jsx`, `client/src/hooks/usePantry.js` (confirmed generic pass-through, no change needed) — full reads, this session.
- `ai/tasks/TASK-033-spec.md` (full spec, this session).

# Dependency Chain

Editing:
- (none — TASK-033 complete, code + live verification + production migration all done)

Requires:
- n/a

Irrelevant:
- `server/services/aiService.js`, `server/routes/ai.js`, `client/src/components/shopping/*` — untouched, per TASK-033's Forbidden Files.

# Architecture Notes
- **`splitItem()`'s race-safety mechanism is unchanged from TASK-032** — the atomic conditional `UPDATE ... WHERE quantity >= splitQuantity` is still the entire mechanism. The new servings-conversion read that precedes it for `splitServings` requests is not itself part of that mechanism and doesn't need to be — by the time the atomic UPDATE runs, it's operating on a plain numeric `quantity` exactly as before, regardless of whether that number originated from a direct `splitQuantity` or a servings conversion.
- **Precision policy is real and load-bearing, not just a paper decision**: live-tested `4 servings / 2 per-pouch = 2.0` exactly (no rounding artifact triggered in this test, but the `Math.round(x * 1e6) / 1e6` policy is in place for cases that would produce floating-point noise, e.g. non-integer `servingsPerPurchaseUnit` values).
- `db.transaction()` is still completely unusable on this driver (`drizzle-orm@0.29.5` + `neon-http`) — see TASK-032's session notes, unchanged, not revisited this session since TASK-033 doesn't touch any transactional code path.
- This repo has a **single Neon database** shared by local dev and production (`DATABASE_URL` in `server/db/client.js`, no dev/prod split) — confirmed again this session. This is why the migration had to be applied before any live verification could run at all, unlike a repo with isolated dev/prod databases.
- **Dev-environment gotcha, carried from every prior session**: the shared backend dev process on port 3001 runs via plain `nohup` (not nodemon) — starting an independent instance (port 53981 this session) and temporarily repointing `client/vite.config.js`'s proxy was needed again. Fully reverted after testing (confirmed via `git diff --stat -- client/vite.config.js` showing zero diff).

# Decisions Made
- Implemented TASK-033-spec.md's Decisions as written — no deviations required (unlike TASK-032, which needed one due to the transaction-support finding; that finding doesn't affect this task since `splitItem()`'s core mechanics are untouched).
- The extra read in `splitItem()` for servings-based requests happens *before* the atomic UPDATE, fetching only `servingsPerPurchaseUnit` off the existing row. Considered folding this into the existing not-found/insufficient-quantity fallback read instead, but that fallback only fires *after* the atomic UPDATE fails — the conversion has to happen *before* the UPDATE can even be attempted, so a dedicated upfront read is the only ordering that works. Not a performance concern (one extra indexed-PK read on an already low-throughput per-request path).
- Implemented directly on `main`, no worktree — matching the established pattern from TASK-029.5 through TASK-032.

# Remaining Work
1. **TASK-033 — done.** Code implemented, live smoke-tested (PASS on every criterion), production migration applied and verified. No follow-up needed for this task's own scope.
2. **Carried forward, higher priority**: fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call — concrete, verified diagnosis exists from TASK-032's session (see that session's Current Status), just needs a dedicated session to implement + verify.
3. **Carried forward, low priority**: repo-wide grep for other `db.transaction(` call sites before anything else relies on the same broken assumption.
4. **Carried forward, low priority**: the migration-boot landmine (TASK-031's session) — `0001`–`0013` still lack `--> statement-breakpoint` markers; `0014` and `0015` both have them and are safe.
5. No TASK-034 spec exists yet — next feature work needs a fresh spec drafted and run through the architect-review workflow before implementation.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.
- One real household item (`BNLS/SL BRST`, id 19) still has `storageLocation: 'pantry'` from TASK-031's session testing — cosmetic, user can correct via Edit if desired.

# Known Risks
- **`db.transaction()` is unusable on this driver** — unchanged from TASK-032's finding; TASK-033 doesn't touch any code path that would hit this, but any future feature assuming multi-statement atomicity will.
- **Crash-window data-loss risk in `splitItem()`** (from TASK-032, unchanged) — a process crash between the decrement and the follow-up insert/conversion would lose the split-off quantity. TASK-033's added conversion step happens entirely *before* this window (it only computes a number), so it doesn't widen the existing risk.
- No `purchaseGroupId`/origin-linking — deferred per TASK-032's spec; still applies to servings-based splits identically to quantity-based ones.
- No automated test suite anywhere in this repo — all verification here is manual smoke testing, one run each.
- The `/api/shopping/build` 500 error remains unfixed as of this session.

# Verification Results
- `node --check` on every touched server file — PASS (syntax only).
- `npx vite build` (client) — PASS, no compile/type errors, 415 modules transformed.

## Live smoke test — method
Same method as every prior session: production Neon migration applied first (user-approved, hand-applied in Neon's SQL Editor — confirmed via "Statement executed successfully"), then drove the real logged-in browser session against an independent backend instance (port 53981 — port 3001 was taken by another session's long-running `nohup` process) with `vite.config.js`'s proxy temporarily repointed, reverted after (confirmed via `git diff --stat -- client/vite.config.js` showing zero diff). Synthetic test item (`ZZTEST Servings Pouches`, 6 pouches, 2 servings/pouch) created via the real UI. Edge-case/validation tests used injected `fetch()` calls from within the authenticated page (real Clerk bearer token via `window.Clerk.session.getToken()`), same as TASK-032's session, since XOR/bounds/PATCH-omission testing isn't fully expressible through the modals' own client-side validation. All test rows deleted afterward via the real DELETE endpoint; pantry confirmed back to its original 8 items.

## Results, by acceptance criterion
- **Manual add: optional servings-per-purchase-unit field, defaults to unset/null — PASS.** Confirmed via the real Add Item form; field left blank on other items shows no annotation.
- **Same field editable on an existing item via AddItemModal's edit mode — PASS.** Confirmed via PATCH (fractional-value test doubled as this check — value round-tripped correctly).
- **Values outside 0.1–1000, or non-positive, rejected (400) — PASS.** Tested 0.05 (too low), 1500 (too high), -1 (negative), 0 (zero) — all 400 with the expected Zod bounds message.
- **Fractional values (e.g. 2.5) accepted for both fields — PASS.** `servingsPerPurchaseUnit: 2.5` accepted and persisted; `splitServings: 4` against `servingsPerPurchaseUnit: 2` (both effectively fractional-capable) converted exactly.
- **Splitting by splitServings matches manual splitQuantity computation, rounded per policy — PASS.** `4 servings / 2 per pouch = 2.0` exactly; original (6 pouches) decremented to 4, new fridge row created with quantity 2.
- **Conversion-layer regression guard (servings-split then quantity-split totals match quantity-only) — PASS.** After the servings split (6→4 pantry / 2 fridge), a plain `splitQuantity: 1` split on the pantry remainder produced 3 pantry / 1 freezer / 2 fridge — total 6, conserved, matching what quantity-only splitting throughout would produce.
- **Both splitQuantity and splitServings in one request rejected (400) — PASS.**
- **Neither provided rejected (400) — PASS.**
- **splitServings on an item with no servingsPerPurchaseUnit rejected (400), not silently treated as a unit split — PASS.** Tested against a real item (STEELHEAD); confirmed zero mutation via a follow-up GET.
- **Split modal shows only one active input at a time via toggle — PASS.** Confirmed via `read_page`: toggling to "Servings" replaced the quantity input entirely (placeholder changed from "up to 6" to "up to 12" = `quantity × servingsPerPurchaseUnit`), never both simultaneously present.
- **Omitting servingsPerPurchaseUnit from PATCH leaves it unchanged; explicit null clears it — PASS.** A PATCH touching only `notes` left `servingsPerPurchaseUnit: 2.5` in place; a subsequent PATCH with `servingsPerPurchaseUnit: null` cleared it to `null`.
- **Changing servingsPerPurchaseUnit does not alter stored quantity — PASS.** `quantity: 3` before and after a `servingsPerPurchaseUnit` edit (2 → 2.5).
- **Once set, servingsPerPurchaseUnit visibly displayed on the pantry table row — PASS.** Confirmed via `get_page_text`: "2 servings/pouch" annotation shown under the quantity cell on both the original and split-off rows.
- **Regression: TASK-032's plain splitQuantity path unaffected — PASS, including on an item that itself has servingsPerPurchaseUnit set** (a stronger check than the AC strictly required): plain `splitQuantity: 1` split succeeded normally on the ZZTEST item, cloning `servingsPerPurchaseUnit: 2` onto the new row unchanged, confirming the two code paths don't interfere with each other.

# Recommended Next Action
TASK-033 is done — live-verified against production data, migration applied, zero residue left behind. Next candidates, in priority order (unchanged from TASK-032's session, since neither was addressed): (1) fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call — well-diagnosed, likely resolves the long-standing `/api/shopping/build` 500 in one session, (2) grep the rest of the codebase for other `db.transaction(` call sites before anything else relies on the same broken assumption, (3) draft a new TASK-034 spec for whatever feature comes next and run it through the architect-review workflow.

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next. For TASK-033 specifically (now complete): `server/services/aiService.js`/`server/routes/ai.js`, `client/src/components/shopping/*`, TASK-031/032's core storage/split logic beyond the one conversion step.

# Context Notes
- branch: main
- worktree: none
- context pressure: medium

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session. Nothing has been committed yet.

```powershell
git add server/db/schema.js server/db/migrations/0015_pantry_servings.sql server/db/migrations/meta/_journal.json server/services/pantryService.js server/routes/pantry.js client/src/components/pantry/AddItemModal.jsx client/src/components/pantry/PantryTable.jsx client/src/components/pantry/SplitItemModal.jsx ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-033: servings-per-purchase-unit tracking; production migration applied, live-verified"
```
