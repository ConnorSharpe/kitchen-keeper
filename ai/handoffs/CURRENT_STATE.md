# Task
TASK-029.5 — Receipt Name-Expansion Prompt Reposition. **Implemented and live smoke-tested this session — PASS, 3/3 scored criteria, gate exceeded. Considered done.** Background: TASK-030 (Recipe Image Extraction + Insert-Step) was implemented and live smoke-tested previously — clean pass, considered done. TASK-029 (Receipt Name Normalization) was smoke-tested and found MIXED (classification works, name expansion doesn't) — TASK-029.5 was the follow-up fixing that gap by repositioning the naming-rules block.

# Current Status

**TASK-029.5 — implemented and live smoke-tested, PASS.** Relocated the existing TASK-029 naming-rules bullet block in `parseReceipt()`'s prompt (`server/services/aiService.js`) from its prior mid-prompt position (right after the JSON-schema description) to immediately before the final `"Return ONLY a raw JSON array..."` line — now right after the classification block. Pure cut-and-paste, zero wording changes to any bullet, no model change, no schema change, per spec. Live smoke test (same synthetic-receipt method as TASK-029's baseline) re-run against the spec's Acceptance Criteria this session: **all 3 scored criteria passed** (baseline was 0/3), both regression checks held. This confirms the "lost in the middle" position-bias hypothesis was the primary cause — no need to escalate to few-shot examples or the two-pass architecture (both remain explicitly out of scope, not needed).

**Important caveat surfaced this session, relevant to future work**: the backend dev server on port 3001 is a long-running process from another session, started via plain `nohup node server/index.js` — **not nodemon**, so it does not hot-reload on file edits despite `server/package.json`'s `dev` script using `nodemon index.js`. An initial smoke-test attempt against that shared process produced results identical to the stale pre-fix baseline (0/3, silently wrong — the code change was real but not live). This was caught by checking the process's actual command line (`Get-CimInstance Win32_Process`) rather than assuming nodemon reload, per this repo's Local Smoke Testing Protocol §4 ("don't guess from symptoms alone"). Worked around by starting a second, independent backend instance via `preview_start` (autoPort assigned port 53869, since 3001 was taken) and temporarily repointing `client/vite.config.js`'s dev proxy target from `localhost:3001` to `localhost:53869` for the duration of the test — client dev server was restarted (vite config changes require a full restart, not HMR) to pick up the new proxy target. Both the temporary proxy edit and the temporary backend instance were fully reverted/stopped after the test; `git diff --stat` confirmed only `server/services/aiService.js` remained changed. **Flag for next session**: if the shared port-3001 process is still running `nohup`-style (not nodemon) in a future session, any smoke test of server-side prompt/logic changes against it will silently test stale code — check the process command line first, don't assume reload.

TASK-030 (previous session, for background) is **implemented and live smoke-tested — clean pass, considered done**. Both halves of that spec:
1. `parseRecipeImage()` (`server/services/aiService.js`) — all three levers applied in the spec's priority order: (a) `detail: 'high'` added to the `image_url` content block (previously unset, defaulting to `'auto'`); (b) prompt rewritten from a bare "extract the recipe" instruction to a structured transcription prompt (identify sections → transcribe ingredients/instructions independently in printed order → no inference/merging/normalizing → preserve illegible text as-is → column-aware top-to-bottom reading order → exact quantity transcription including fractions); (c) model swapped `gpt-4o-mini` → `gpt-4o`, scoped to this function only. Also added: a single internal retry (via a `PARSE_FAILED` sentinel passed to `safeParseJSON`, distinguishing genuine parse failure from a legitimate JSON `null` response) gated on an 18s elapsed-time budget so it can't blow past `ai.js`'s existing 40s outer timeout; and an extended structured log line (`detail=high retried=<bool> parse_failed=<bool>`) per spec Constraint 8. `max_tokens: 3000` left unchanged (Constraint 4 asked to verify headroom, not presume it's insufficient — not empirically verified against a worst-case recipe this session, see Known Risks). Ingredient `quantity` JSON-schema hint in the prompt widened from `number|null` to `number|string|null` per Constraint 3, matching `ai.js`'s pre-existing `fractionalQuantity` Zod union (confirmed by reading `ai.js:146-161` — already accepts numbers, unicode fractions, and mixed-number strings; no schema change made or needed).
2. `RecipeReviewModal.jsx` — added `insertStepAfter(index)`, which splices a new `{ text: '', _key: crypto.randomUUID() }` into the `steps` array at `index + 1`. A small "+ insert step" button renders between each pair of existing step rows (not after the last one, since "+ Add step" already covers appending). Existing `addStep()`/`removeStep()`/`updateStep()` and their `Date.now()`-keyed behavior are untouched, per Constraint 6. Save payload shape (`handleSave()`) is unchanged, per Constraint 7.

# Files Modified
- `server/services/aiService.js` — `parseReceipt()` only, this session: relocated the 7-bullet naming-rules block (TASK-029.5). No wording changes, no other function touched.
- `server/services/aiService.js` — `parseRecipeImage()` (prior session): model, `detail` param, prompt, retry logic, log line. Untouched this session.
- `client/src/components/recipes/RecipeReviewModal.jsx` (prior session): steps section only, `insertStepAfter()` and its button. Untouched this session.
- `.claude/launch.json` (prior session): `autoPort: true`, client pinned to port 5183 with `--strictPort`. Untouched this session.
- `client/vite.config.js` — **temporary only, fully reverted this session**: proxy target briefly repointed from `localhost:3001` to `localhost:53869` to test against a fresh backend instance (see Current Status caveat). Confirmed reverted via `git diff --stat` before ending session.

# Files Required Next
- For live verification of TASK-030 (recipe image extraction): still outstanding, carried forward unchanged — a real recipe image run through the real endpoint. Not part of this session's scope.
- For TASK-031: not yet read — next task per CURRENT_STATE ordering, but **requires explicit user approval before running its migration**.

# Files Already Reviewed
- `server/services/aiService.js` (`parseReceipt()`, `parseRecipeImage()`, `safeParseJSON`, `wrapAIError`).
- `server/routes/ai.js` (read-only, per spec's Forbidden Files) — prior session.
- `client/src/components/recipes/RecipeReviewModal.jsx` (full file) — prior session.
- `ai/tasks/TASK-029.5-spec.md` (full spec, this session).

# Dependency Chain

Editing:
- (none — TASK-029.5 code change complete and verified)

Requires:
- n/a

Irrelevant:
- `server/routes/ai.js`, `client/src/components/pantry/ReceiptUpload.jsx`, `parseRecipeImage()` — untouched, as forbidden/irrelevant per TASK-029.5 spec.

# Architecture Notes
- Naming-rules block now sits immediately after the classification block and immediately before the final `"Return ONLY a raw JSON array..."` line in `parseReceipt()`'s prompt — same relative order as `parseRecipeImage()`'s "critical instructions near the end" pattern isn't formally shared code, but is now a consistent convention across both AI prompts in this file.
- Retry logic in `parseRecipeImage()` (prior session): lives entirely inside the function via a `callOnce()` closure, gated on elapsed time (`Date.now() - startedAt < 18000`). Untouched this session.
- Insert-step control in `RecipeReviewModal.jsx` (prior session): always visible between rows. Untouched this session.
- **New finding this session**: the shared backend dev process on port 3001 runs via plain `nohup node server/index.js`, not nodemon — it will not pick up server-side code edits automatically despite `npm run dev` being nodemon-based. See Current Status caveat for the workaround used (independent backend instance + temporary proxy repoint, both reverted).
- **Still open, carried from earlier sessions**: `POST /api/shopping/build` returns 500 Internal Server Error when building a list from at least one real recipe (`Caribbean Style Curry Cod`) in this household. Still unscoped.

# Decisions Made
- TASK-029.5 implementation followed `TASK-029.5-spec.md` verbatim — pure cut-and-paste reposition, zero wording changes, no deviations.
- When the shared port-3001 backend process was found not to hot-reload, chose to stand up an independent backend instance (via `preview_start`, autoPort → 53869) rather than touching or restarting the process owned by another session — kept the untested workaround fully reversible (temporary `vite.config.js` proxy edit, reverted immediately after the test; temporary backend stopped after use).

# Remaining Work
1. **TASK-029.5 — done.** Naming-rules reposition implemented and live smoke-tested this session: 3/3 scored criteria passed (baseline 0/3), both regression checks held. No follow-up (few-shot / two-pass) needed — see Verification Results below for full detail.
2. **Carried forward, still unscoped**: investigate the `POST /api/shopping/build` 500 error (real recipe → internal server error).
3. Implement TASK-031 — **requires explicit user approval before running its migration**; must precede 032/033.
4. Implement TASK-032 — requires 031 done first.
5. Implement TASK-033 — requires 032 done first; **requires explicit user approval before running its migration**.
6. TASK-030's own remaining untested edge cases (lower priority, that task is otherwise considered done): a genuinely handwritten recipe card, a true two-column body layout, a forced-malformed-response retry trigger, and `detail: 'high'` verified via true wire-level network inspection rather than source read.
7. For live verification of TASK-030 (recipe image extraction, real photo rather than synthetic): still outstanding, deferred to avoid unprompted OpenAI spend on `gpt-4o` + `detail: 'high'`.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Receipt preview table (`ReceiptUpload.jsx`) is read-only checkboxes, not per-field editable. Mirrors TASK-027's shopping-list edit pattern if the user wants it fixed.
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.

# Known Risks
- TASK-030 code changes are still unverified against a live model response using a real (non-synthetic) recipe photo — carried forward, unchanged this session.
- Cost per recipe-image upload increases (per spec's own Known Risks): `gpt-4o` instead of `gpt-4o-mini`, plus `detail: 'high'` instead of `'auto'`. Not expected to matter at this app's usage volume, but real.
- The `/api/shopping/build` 500 error remains a real, currently-reproducible bug blocking recipe-based list building for at least one household.
- Two pending production migrations (TASK-031, TASK-033) — still need explicit user sign-off at implementation time.
- No automated test suite anywhere in this repo.
- **Dev-environment gotcha for future sessions**: the shared port-3001 backend process runs via plain `nohup`, not nodemon, despite the `dev` script implying hot-reload. Any future session testing server-side changes against that shared process should verify via `Get-CimInstance Win32_Process` (or equivalent) that it's actually the nodemon-wrapped process before trusting results, or stand up an independent instance as this session did.
- TASK-029.5's smoke test was one run of one synthetic receipt, same limitation noted in every prior task's spec (no before/after statistical benchmark) — a strong single-run result (3/3, up from 0/3), not a large-sample guarantee.

# Verification Results
- `node --check server/services/aiService.js` — PASS (syntax only).
- `npx vite build` (client) — PASS, no compile/type errors.

## Live smoke test — method
No real recipe/receipt photos were available, and both AI endpoints are Clerk-authenticated (no way to `curl` them without a session). Method used instead:
1. Started this session's own dev server (`.claude/launch.json`, client pinned to port 5183 — see below) and drove the real logged-in browser session (the user's actual household data).
2. Generated synthetic test images **in-page** via `<canvas>` (a recipe card and a grocery receipt, both drawn as plain black-on-white text — not photorealistic, but sufficient to exercise the real OCR/vision + JSON pipeline end to end).
3. Injected the canvas `Blob` into the real hidden `<input type=file>` via `DataTransfer` + a dispatched native `change` event — this runs the actual client code (`RecipeUpload.jsx`'s EXIF/resize logic, the real `fetch`), not a mock.
4. Read results back via `document.querySelector(...).value` on the live form controls (`get_page_text`/innerText does **not** surface `<textarea>`/`<input>` values — this tripped up an early check and is worth documenting).
5. Deleted the test recipe / declined to add the test receipt items afterward, so no synthetic data was left in the user's real household.

**Caveat on `computer.left_click`**: clicking `📸 Upload Recipe Image` via the `computer` tool's simulated pointer click did not visibly open the modal (confirmed via DOM check), but calling `.click()` on the button element directly via `javascript_tool` worked immediately. Cause not root-caused (possibly a coordinate/overlay mismatch in this preview environment). Fell back to `element.click()` throughout after that. Also: React state updates are **not** visible to a DOM read run synchronously right after a `.click()` call in the same script — need a `setTimeout`/microtask yield before re-querying, or reads return stale pre-render DOM (hit this firsthand on the step-insert count).

**Backend visibility gap**: the Node server on port 3001 was a pre-existing process owned by a different session; this session has no log access to it and cannot bind its own server to the same port. To confirm server-side behavior without guessing, a temporary diagnostic (`fs.appendFileSync` of the raw model response, gated in a try/catch) was added to `parseRecipeImage()`, then fully reverted after use — see `git diff` history if needed; the file is clean now. In the end this wasn't needed to reach a conclusion (DOM-level results were sufficient) and the debug write never actually landed (nodemon-restart timing uncertain) — noted here as a dead end, not a working technique.

## TASK-030 (recipe extraction + insert-step) — PASS
Synthetic recipe: "Grandma's Skillet Cornbread", 8 ingredients (mixed-number and simple fractions: `1 1/2`, `1/2`, `1/3`, `1/4`), 9 numbered steps, plus a bordered sidebar "TIP" box adjacent to the instructions.
- All 8 ingredients extracted, correct fraction→decimal conversion (`1 1/2`→1.5, `1/3`→0.33), no schema errors.
- All 9 steps extracted verbatim, in order, **no truncation, no drops** — the sidebar TIP box was correctly excluded rather than merged in as a 10th step or interleaved.
- Insert-step control: inserting after step 3 correctly spliced a new blank step at position 4, shifting the rest down with content/order intact.
- Typed into the new step successfully (verified via controlled-input's native setter + `input` event).
- Rapid-fire 3 inserts in immediate succession produced 3 distinct blanks at the correct positions, **no React key-collision warnings** in the console (`crypto.randomUUID()` holding up).
- Removed the 3 test blanks via the existing `removeStep()` — regression-clean, unaffected by the new control.
- Ingredient add/edit/remove — regression-clean, unaffected.
- Saved the recipe, reopened the detail view: the mid-list-inserted step persisted in the exact correct position, all 10 final steps in order. Full round trip confirmed.
- **Not tested**: a genuinely handwritten recipe card, a true two-column body layout (tested the sidebar-box variant instead, which the acceptance criteria explicitly allow as an alternative), a forced-malformed-response retry trigger, and `detail: 'high'` via true wire-level network inspection (the request goes server→OpenAI directly, not observable from the browser; confirmed by source read instead — this is a real gap against the spec's literal ask for "network/debugger inspection," worth a note for next time).

## TASK-029 (receipt name expansion) — MIXED, needs attention
Synthetic receipt: "FRESH MART", 7 line items — an abbreviated meat (`CHKN THIGH BNLS`), abbreviated produce (`ORG BANANA`), an abbreviated dairy item with a store-brand prefix (`GV 2% MLK GAL`), an already-clear item as a regression check (`BANANAS`), a genuinely ambiguous SKU line (`SKU 44192`), and two non-food items (`PAPER TOWELS 6PK`, `DOG FOOD 15LB`).
- **PASS — TASK-028 classification**: correctly dropped both non-food items; "Found 5 items" (7 minus 2). Categories and expiry-day estimates on the remaining 5 all looked sensible (Meat/2d, Produce/5-8d, Dairy/11d).
- **PASS — ambiguous-line fallback**: `SKU 44192` was correctly left as-is (category "Other", no invented product name) rather than hallucinating a guess — this is exactly the spec's "if not confident, return the original text unchanged" rule working as intended.
- **FAIL/no-op — abbreviation expansion**: none of `CHKN THIGH BNLS`, `ORG BANANA`, `GV 2% MLK GAL` were expanded; all came back with their exact printed abbreviated text.
- **FAIL — sentence case**: `BANANAS` (all-caps, completely unambiguous, not even an abbreviation) stayed `BANANAS` instead of becoming `Bananas`. This is the strongest signal in this test: sentence-casing isn't confidence-gated in the spec at all, so if the naming-rules block were being weighed by the model, this should have been a trivial, guaranteed hit. It wasn't.
- Confirmed via direct source read (`aiService.js:290-310`, this session) that the naming-rules bullet list from TASK-029 **is** present in the live prompt text, correctly formatted, not truncated or overwritten — so this is not a "the code isn't deployed" issue, and not a code-presence bug in this session's work (TASK-029 predates TASK-030). Read the code, did not need to guess.
- **Working theory, not confirmed**: `parseReceipt()` still uses `gpt-4o-mini` (TASK-029 didn't change the model, unlike TASK-030). It's plausible the naming-rules block gets deprioritized by a weaker model on a long compound instruction, especially for synthetic/unfamiliar abbreviations — but that doesn't explain the `BANANAS` case-formatting miss, which needed zero real-world knowledge. This looks like a genuine, reportable gap in TASK-029's effectiveness, not just cautious under-expansion.
- **This was not re-tested with variations** (e.g., only the prompt's own worked examples, or a second synthetic receipt) to rule out one-off model stochasticity — one run is a signal, not a confirmed pattern.

## TASK-029.5 (receipt naming-rules reposition) — PASS, this session (2026-07-14)
Same synthetic "FRESH MART" 7-line receipt as the TASK-029 baseline above, re-run after relocating the naming-rules block to immediately after the classification block. **Tested against an independent backend instance (port 53869) after discovering the shared port-3001 process doesn't hot-reload — see Current Status caveat.**

Scored criteria (gate: ≥2/3, baseline was 0/3):
- [x] **PASS** — `CHKN THIGH BNLS` → `Chicken thigh boneless` (abbreviated meat, correctly expanded)
- [x] **PASS** — `ORG BANANA` → `Organic banana` (abbreviated produce, correctly expanded)
- [x] **PASS** — `BANANAS` → `Bananas` (pure sentence-casing, the strongest diagnostic criterion — now correct)

**3/3 — gate exceeded.** Position bias was confirmed as the (at least primary) cause; no escalation to few-shot examples or the two-pass architecture needed.

Non-scored criterion (recorded, not counted):
- `GV 2% MLK GAL` → `GV 2% milk gallon` — "MLK"/"GAL" expanded, "GV" (unfamiliar store-brand abbreviation) correctly left unguessed. Matches the spec's "either expands confidently or is left unchanged" acceptable-outcome rule — a confident partial expansion with the ambiguous brand token appropriately preserved.

Regression checks (must not fail):
- [x] **PASS** — `SKU 44192` left unexpanded, no hallucination.
- [x] **PASS** — Classification unaffected by the one-position shift: 5 items found (7 minus 2 non-food), same as baseline.

Cleanup: canceled the pending "Add 5 items" action before any write (cancel-before-commit — no data was ever written, nothing to delete). Pantry item count confirmed unchanged (8 items) after cancel. Temporary `vite.config.js` proxy edit and temporary backend instance (port 53869) both reverted/stopped; `git diff --stat` confirmed only the intended `aiService.js` change remained.

# Recommended Next Action
TASK-029.5 is done — gate exceeded (3/3), no follow-up needed. Next candidates, in order: (1) investigate the carried-forward `POST /api/shopping/build` 500 error (unscoped, currently blocking a real household's workflow — likely worth a quick triage before starting a new task), or (2) begin TASK-031 (requires explicit user approval before running its migration; read the spec first, do not run the migration without that approval).

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next.

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session.

```powershell
git add server/services/aiService.js ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-029.5: reposition receipt naming-rules prompt block; live-verified 3/3"
```
