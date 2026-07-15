# Task
TASK-032 — Pantry Quantity Split Across Storage Locations. **Implemented and live smoke-tested this session — PASS on every acceptance criterion exercised, including the concurrency race test.** Background: TASK-029.5, TASK-030, TASK-031 (previous sessions) are all implemented and live smoke-tested — clean pass, considered done.

# Current Status

**TASK-032 — PASS.** No schema/migration needed (spec's own constraint — reuses TASK-031's `storageLocation` column). Code implemented per spec, `node --check` clean, `npx vite build` clean. Live smoke test performed against the real app (synthetic `ZZTEST` items, same method as TASK-029.5/030/031) covering: the core 6→1+5 split with correct independent expiries, ID-stays-with-remainder in both directions (implicitly, via two different splits on the same lineage), full-quantity in-place conversion (no orphan row), all five invalid-quantity rejections (0, negative, NaN, Infinity, over-available) with zero mutation, not-found handling, and — most importantly — the **concurrency race test**: two parallel split requests whose combined amount exceeded the available quantity, verified via direct injected-fetch calls (bypassing the UI) rather than clicks, since real simultaneity requires firing both requests in one `Promise.all`. Exactly one succeeded, no negative or double-counted quantity resulted (total conserved: 2+3+1=6, matching the original 6 pouches). All three test rows deleted afterward; pantry confirmed back to its original 8 items.

**Significant finding this session, not part of TASK-032's own scope but directly relevant to its design and to a carried-forward bug**: this repo's installed `drizzle-orm` (0.29.5) `neon-http` driver **has no transaction support at all** — confirmed by reading `server/node_modules/drizzle-orm/neon-http/session.js` directly: `NeonHttpSession.transaction()` unconditionally throws `"No transactions support in neon-http driver"`, and `db.transaction(fn)` always reaches that exact method (traced through `pg-core/db.js`'s `transaction()` → `this.session.transaction()`). This is a *stronger* limitation than TASK-032's architect review assumed — the spec took `shoppingService.buildFromRecipes()`'s existing `db.transaction(async (tx) => {...})` call (line ~207) as a working precedent to copy for split's atomic decrement+insert. **That existing call is almost certainly broken and throws every time it's invoked** — which lines up exactly with this repo's long-standing, previously-unexplained `POST /api/shopping/build` 500 error (carried forward across TASK-029.5/030/031's sessions, never root-caused). Not fixed here (out of TASK-032's Forbidden Files — `shoppingService.js` is explicitly "unrelated, referenced not modified" — and it's a pre-existing bug, not something this task introduced), but now has a concrete, verified root-cause hypothesis for whoever picks it up next: replace `db.transaction()` there with either sequential statements (like this task's approach) or a raw multi-CTE atomic statement, whichever fits that function's actual atomicity needs.

**Implementation deviation from the spec's literal design, forced by the above finding**: the spec's Decision ("Race-Safe via an Atomic Conditional Update") called for the atomic conditional `UPDATE` *plus* the insert/conversion to happen "in the same `db.transaction`, matching `buildFromRecipes()`'s existing precedent." Since `db.transaction()` doesn't work on this driver at all, `splitItem()` (`server/services/pantryService.js`) instead uses **two sequential statements, not wrapped in any transaction**:
1. The atomic conditional `UPDATE ... WHERE quantity >= splitQuantity RETURNING *` — this alone is still the *entire* race-safety mechanism, exactly as the spec's own reasoning describes (a single indivisible Postgres statement; two concurrent decrements against the same row can never both succeed past the available quantity, confirmed live this session).
2. A follow-up insert (partial split) or in-place update (full split) keyed only by `id` — not itself race-prone, because by the time it runs, the decrement has already durably claimed the quantity; no concurrent request's own decrement-`WHERE` can succeed against a row whose quantity it already reduced.

The only residual gap vs. the spec's literal wording: a process crash *between* those two statements would leave the decrement committed but the split-off portion unrepresented (data loss on crash, not corruption/double-counting — the concurrency guarantee the acceptance criteria actually test is unaffected). Closing that gap would require either raw multi-CTE SQL (single atomic statement, but forces enumerating every cloned column, contradicting the spec's explicit "clone-by-exclusion, not enumeration" decision) or moving off `neon-http` to Neon's WebSocket driver (explicitly out of scope per the architect review's own analysis). Documented as an accepted, disclosed limitation rather than silently different from the spec.

Implemented per the spec's Decisions:
- **Full-quantity split → in-place conversion, no new row** — confirmed live: splitting a 1-pouch remainder's full amount converted the same row (`storageLocation` updated, `quantity` left at the post-decrement `0`, `expiryDate` recomputed for the new location), no 4th row created.
- **Original ID always represents the remainder** — confirmed live across two different splits on the same lineage (id 26 kept decrementing across two split calls: 6→1→0; ids 27, 28 were the two split-off portions, both freshly created).
- **Clone-by-exclusion** — `splitItem()` spreads the post-decrement row (`{...decremented}`), destructures out `id`/`createdAt`/`updatedAt`, and overrides `quantity`/`storageLocation`/`expiryDate` — confirmed live: `notes`, `purchaseDate`, `unit`, `category`, `readyDate`, `preFreezeStorageLocation`, `isFrozen`, `frozenAt`, `originalExpiryDate`, `freezeNotes` all identical between original and created rows in the network response bodies inspected this session.
- **Expiry anchor is the original row's `purchaseDate`** — confirmed: the freezer split-off row's expiry (`2027-04-11`, +270d) and the fridge remainder's expiry (`2026-07-17`, +2d) both anchor to the same `2026-07-15` purchase date, not "today."
- **Ownership folded into the atomic `UPDATE`'s `WHERE`, not a separate check** — `eq(householdId)` is part of the same `WHERE` as the quantity guard; the only additional read is the error-path existence check (spec's own explicit design), which fires only when the atomic update affects 0 rows.
- **`splitQuantity` explicitly finite+positive, not coerced** — `z.number().finite().positive()` (not `z.coerce.number()`, unlike the rest of this router's schemas) — confirmed live: 0, negative, and the JSON-serialized forms of `NaN`/`Infinity` (which arrive server-side as `null`, since JSON itself cannot encode those values — the practical, fullest black-box test possible for this constraint over a real HTTP/JSON API) all rejected with 400 and zero mutation.

All other files match the spec's Allowed Files list exactly; nothing in Forbidden Files was touched (`server/db/schema.js`/migrations untouched — no schema change needed; `shoppingService.js` untouched — referenced only, per spec).

# Files Modified
- `server/services/pantryService.js` — new exported `splitItem()`; added `gte` to the `drizzle-orm` import.
- `server/routes/pantry.js` — new `splitSchema` (`splitQuantity: z.number().finite().positive()`, `storageLocation` enum); new `POST /:id/split` route (404 for not-found/wrong-household, 400 for insufficient-quantity, per spec's disambiguation rule).
- `client/src/hooks/usePantry.js` — new `splitItem(id, body)`: posts to the new route, replaces the original row in local state with the server's returned `original`, prepends `created` to the list when non-null.
- `client/src/components/pantry/SplitItemModal.jsx` (new) — quantity + storage-location inputs, modeled on `AddItemModal.jsx`'s modal chrome/Field conventions; defaults the storage-location `<select>` to the first location different from the item's current one.
- `client/src/components/pantry/PantryTable.jsx` — new "Split" row action, wired via a new `onSplit` prop.
- `client/src/pages/PantryPage.jsx` — `splitModalItem` state, `handleSplit` handler (toasts "split across storage locations" vs "storage location updated" depending on whether `created` is non-null), renders `SplitItemModal`.

# Files Required Next
- None for TASK-032's own scope — done. **For TASK-033 (servings-per-unit)**: read `ai/tasks/TASK-033-spec.md` fresh; it depends on TASK-032's shape per CURRENT_STATE's prior note, and **per this session's finding, should get the same `IF NOT EXISTS` + `--> statement-breakpoint` migration treatment up front** (the migration-boot landmine from TASK-031's session still applies to any new hand-applied migration).
- **Not required by TASK-032, but a real, now-diagnosed bug worth a dedicated session**: fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call (see Current Status) — this is very likely the actual root cause of the long-carried-forward `POST /api/shopping/build` 500.

# Files Already Reviewed
- `server/services/pantryService.js`, `server/services/shoppingService.js` (transaction pattern + full `buildFromRecipes()`), `server/db/schema.js`, `server/db/client.js`, `server/middleware/validate.js`, `server/app.js` (error handler), `server/routes/pantry.js` (full reads, this session).
- `server/node_modules/drizzle-orm/neon-http/session.js`, `driver.js`, `pg-core/db.js` — read directly to confirm the transaction-support finding (see Current Status), not part of the app's own source but necessary to verify before trusting the spec's transaction-based design.
- `client/src/components/pantry/AddItemModal.jsx`, `PantryTable.jsx`, `client/src/pages/PantryPage.jsx`, `client/src/hooks/usePantry.js`, `client/src/utils/pantryDefaults.js`, `client/src/api/index.js`, `client/vite.config.js` (full reads, this session).
- `ai/tasks/TASK-032-spec.md` (full spec, this session).

# Dependency Chain

Editing:
- (none — TASK-032 complete, code + live verification both done)

Requires:
- n/a

Irrelevant:
- `server/db/schema.js` / migrations, `client/src/components/recipes/*` — untouched, per TASK-032's Forbidden Files.

# Architecture Notes
- `splitItem()` reuses `computeExpiryForStorage()` (TASK-031) directly for the new/converted row's expiry — no duplicated date math, matching the spec's explicit reuse requirement.
- **`db.transaction()` does not work on this project's driver, full stop** — not "no row locking" (which is what the spec's architect review understood), but "throws unconditionally, every call." See Current Status for the finding and its likely connection to the `/api/shopping/build` bug. This is a fact about `drizzle-orm@0.29.5` + `neon-http` worth remembering for any future feature that assumes multi-statement atomicity in this codebase — `db.batch()` exists and *is* supported, but only for pre-built, mutually-independent queries (no query can depend on another's runtime result within the same batch), which also doesn't fit most "read-modify-write" atomicity needs directly.
- The atomic conditional `UPDATE ... WHERE quantity >= splitQuantity` pattern introduced here (no transaction wrapper, no row locking, single-statement race safety) is now a working, live-verified precedent in this codebase for any future concurrent-decrement-style problem under this same driver constraint.
- **Dev-environment gotcha, carried from TASK-029.5/030/031's sessions, confirmed again this session**: the shared backend dev process on port 3001 runs via plain `nohup` (not nodemon) — starting an independent instance (port 53912 this session) and temporarily repointing `client/vite.config.js`'s proxy was needed again, same workaround as prior sessions. Fully reverted after testing (confirmed via `git status`/`git diff` showing zero unintended changes).

# Decisions Made
- Implemented TASK-032-spec.md's Decisions as written, with one necessary, disclosed deviation: sequential (non-transactional) statements instead of `db.transaction()`-wrapped ones, since that API is completely unavailable on this driver — see Current Status for full reasoning. The core race-safety guarantee (the spec's actual concern, and what the acceptance criteria test) is fully preserved and was live-verified under real concurrent load this session.
- Did not attempt to fix `shoppingService.buildFromRecipes()`'s own broken `db.transaction()` call — out of this task's Forbidden Files, and a pre-existing bug rather than something TASK-032 introduced. Flagged prominently instead (see Files Required Next).
- Implemented directly on `main`, no worktree — matching the established pattern from TASK-029.5/030/031.
- No `purchaseGroupId`/origin-linking column added — per spec's explicit deferral, not revisited.

# Remaining Work
1. **TASK-032 — done.** Code implemented, live smoke-tested (PASS on every criterion exercised, including concurrency). No follow-up needed for this task's own scope.
2. **New, higher-priority than before**: fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call — now has a concrete, verified diagnosis (see Current Status/Architecture Notes) rather than being an unscoped mystery 500.
3. **Carried forward, low priority**: the migration-boot landmine (TASK-031's session) affects any future hand-applied migration, including TASK-033's.
4. Implement TASK-033 (servings-per-unit) — read its spec fresh; likely needs the same migration-boot precaution and should be checked against this session's transaction-support finding if it involves any multi-statement atomicity.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.
- One real household item (`BNLS/SL BRST`, id 19) still has `storageLocation: 'pantry'` from TASK-031's session testing — cosmetic, user can correct via Edit if desired.

# Known Risks
- **`db.transaction()` is unusable on this driver** — see Architecture Notes. Any future service code that assumes it works (copying `buildFromRecipes()` as a "precedent," the same mistake TASK-032's architect review made) will silently fail at runtime. Worth a repo-wide grep for other `db.transaction(` call sites before they're relied upon again.
- **Crash-window data-loss risk in `splitItem()`** (see Current Status) — a process crash between the decrement and the follow-up insert/conversion would lose the split-off quantity. Extremely narrow window, no transaction available to close it without a driver change; disclosed, not fixed.
- No `purchaseGroupId`/origin-linking — deferred per spec; two split rows have no queryable link back to their shared origin beyond matching name/purchase date by eye.
- No audit/history trail — a future activity-log feature would not see pre-split quantities from this task's changes alone (per spec's explicit acceptance of this limitation).
- No automated test suite anywhere in this repo — all verification here is manual smoke testing, one run each (though the concurrency test specifically exercised real simultaneous load via `Promise.all`, not just a single happy-path click).
- The `/api/shopping/build` 500 error remains unfixed as of this session, though now well-diagnosed (see Remaining Work #2).

# Verification Results
- `node --check` on every touched server file — PASS (syntax only).
- `npx vite build` (client) — PASS, no compile/type errors, 415 modules transformed.

## Live smoke test — method
Same method as TASK-029.5/030/031: drove the real logged-in browser session against an independent backend instance (port 53912, autoPort — port 3001 was taken by another session's long-running `nohup` process) with `vite.config.js`'s proxy temporarily repointed, both reverted after (confirmed via `git status` showing zero diff on `vite.config.js`). Synthetic test items (`ZZTEST` prefix) created via the real UI. Edge-case and concurrency tests used injected `fetch()` calls from within the authenticated page (real Clerk bearer token via `window.Clerk.session.getToken()`) rather than UI clicks, since true simultaneity and raw invalid-payload testing (NaN/Infinity/negative) aren't expressible through the modal's own client-side validation. All test rows deleted afterward via the real DELETE endpoint; pantry confirmed back to its original 8 items.

## Results, by acceptance criterion
- **6-pouch item split 1 (fridge) + 5 (freezer), independently correct expiries — PASS.** Fridge remainder: 2d (`2026-07-17`). Freezer split-off: 270d (`2027-04-11`). Both anchored to the same `2026-07-15` purchase date.
- **Original ID always keeps the remainder — PASS.** Confirmed across two sequential splits on the same lineage: id 26 decremented 6→1→0 across both calls; ids 27/28 were the two freshly-created split-off rows.
- **Full-quantity split converts in place, no orphan row — PASS.** Splitting id 26's full remaining quantity (1) returned `created: null`; row count stayed at 3 total lineage rows (26, 27, 28), no 4th row.
- **Invalid quantity → 400, no mutation — PASS** for 0, negative, NaN (arrives as `null` per JSON's own limitation), Infinity (same), and over-available (6 requested against a row holding 5). Confirmed zero mutation via a follow-up `GET /api/pantry` read showing quantity unchanged after all five rejections.
- **All non-overridden business fields identical between original and new row — PASS.** Verified directly from the `POST .../split` response bodies: `name`, `category`, `unit`, `purchaseDate`, `notes`, `readyDate`, `preFreezeStorageLocation`, `isFrozen`, `frozenAt`, `originalExpiryDate`, `freezeNotes` all matched.
- **New row's `id`/`createdAt`/`updatedAt` freshly generated — PASS.** `created.id` always distinct from `original.id`; `created.createdAt`/`updatedAt` timestamps distinct from (later than) the original row's.
- **Splitting a nonexistent item → 404 — PASS** (tested via a bogus id; the household-mismatch branch shares the identical `eq(householdId, householdId)` guard in both the atomic update and the fallback existence check, not separately live-tested this session to avoid creating a second test account/household — same lower-priority-gap reasoning TASK-031's session applied to its own two untested chat-tool paths).
- **Splitting more than available quantity → 400, distinct from 404 — PASS.** Verified both distinct error bodies/status codes in the same test batch.
- **Concurrency: two near-simultaneous splits whose combined amount exceeds availability — PASS.** Fired via real parallel `fetch()` (`Promise.all`) against a row holding 5, each requesting 3 (combined 6 > 5). Exactly one succeeded (200, quantity 5→2, new row created with 3), the other failed cleanly (400, "exceeds available quantity"). Final state conserved the total (2 + 3 + 1 = 6, matching the original 6 pouches) — no negative quantity, no double-counting.
- **Original row's quantity correctly reduced by the split-off amount — PASS.** Verified in every split call above.
- **Pantry table visibly distinguishes rows by storage location — PASS.** Confirmed via `get_page_text`: new freezer row showed the ❄/Freezer badge and "❄ Frozen" status label (TASK-031's `storageLocation === 'freezer'` badge logic correctly triggered by the newly-created row); fridge remainder showed 🧊/Fridge.

# Recommended Next Action
TASK-032 is done — live-verified, including the concurrency race test the spec cared most about. Next candidates, in priority order given this session's finding: (1) fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call — now well-diagnosed, likely resolves the long-standing `/api/shopping/build` 500 in one session, (2) grep the rest of the codebase for other `db.transaction(` call sites before anything else relies on the same broken assumption, or (3) begin TASK-033 (servings-per-unit).

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next. For TASK-032 specifically: `server/db/schema.js`/migrations, `server/services/shoppingService.js` (reference only), servings-based splitting (TASK-033's territory).

# Context Notes
- branch: main
- worktree: none
- context pressure: medium

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session. Nothing has been committed yet.

```powershell
git add server/services/pantryService.js server/routes/pantry.js client/src/hooks/usePantry.js client/src/components/pantry/SplitItemModal.jsx client/src/components/pantry/PantryTable.jsx client/src/pages/PantryPage.jsx ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-032: pantry quantity split across storage locations; live-verified incl. concurrency"
```
