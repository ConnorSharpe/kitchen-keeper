# Task
TASK-029.5 — Receipt Name-Expansion Prompt Reposition. **Spec is written and architect-approved (DRAFT-2, round 1, 9.7/10) — ready for implementation, not yet implemented.** This is the immediate next action. Background: TASK-030 (Recipe Image Extraction + Insert-Step) was implemented and live smoke-tested last session — clean pass, considered done. TASK-029 (Receipt Name Normalization, two sessions ago) was smoke-tested in the same pass and found MIXED (classification works, name expansion doesn't) — TASK-029.5 is the follow-up spec addressing that gap.

# Current Status

**TASK-029.5 — not yet implemented, spec is ready.** `ai/tasks/TASK-029.5-spec.md` is DRAFT-2, approved for implementation after one architect-review round (9.7/10). Scope: relocate the existing TASK-029 naming-rules bullet block in `parseReceipt()`'s prompt (`server/services/aiService.js`) from its current mid-prompt position (right after the JSON-schema description) to immediately before the final `"Return ONLY a raw JSON array..."` line — i.e. right after the classification block, which already occupies that position and already works. **Zero wording changes** to any bullet, no model change, no schema change — this is a pure cut-and-paste reposition, testing a "lost in the middle" position-bias hypothesis in isolation before reaching for heavier fixes (few-shot examples, or a two-pass chained architecture — both explicitly deferred in the spec's Decision section). Read `ai/tasks/TASK-029.5-spec.md` in full before starting — it has the exact target position, the quantitative success gate (≥2/3 on 3 scored criteria, see below), and how to interpret a partial result. After implementing, re-run this repo's Local Smoke Testing Protocol (synthetic receipt, same method as last session) against the spec's Acceptance Criteria, then update this file.

TASK-030 (previous session, for background) is **implemented and live smoke-tested — clean pass, considered done**. Both halves of that spec:
1. `parseRecipeImage()` (`server/services/aiService.js`) — all three levers applied in the spec's priority order: (a) `detail: 'high'` added to the `image_url` content block (previously unset, defaulting to `'auto'`); (b) prompt rewritten from a bare "extract the recipe" instruction to a structured transcription prompt (identify sections → transcribe ingredients/instructions independently in printed order → no inference/merging/normalizing → preserve illegible text as-is → column-aware top-to-bottom reading order → exact quantity transcription including fractions); (c) model swapped `gpt-4o-mini` → `gpt-4o`, scoped to this function only. Also added: a single internal retry (via a `PARSE_FAILED` sentinel passed to `safeParseJSON`, distinguishing genuine parse failure from a legitimate JSON `null` response) gated on an 18s elapsed-time budget so it can't blow past `ai.js`'s existing 40s outer timeout; and an extended structured log line (`detail=high retried=<bool> parse_failed=<bool>`) per spec Constraint 8. `max_tokens: 3000` left unchanged (Constraint 4 asked to verify headroom, not presume it's insufficient — not empirically verified against a worst-case recipe this session, see Known Risks). Ingredient `quantity` JSON-schema hint in the prompt widened from `number|null` to `number|string|null` per Constraint 3, matching `ai.js`'s pre-existing `fractionalQuantity` Zod union (confirmed by reading `ai.js:146-161` — already accepts numbers, unicode fractions, and mixed-number strings; no schema change made or needed).
2. `RecipeReviewModal.jsx` — added `insertStepAfter(index)`, which splices a new `{ text: '', _key: crypto.randomUUID() }` into the `steps` array at `index + 1`. A small "+ insert step" button renders between each pair of existing step rows (not after the last one, since "+ Add step" already covers appending). Existing `addStep()`/`removeStep()`/`updateStep()` and their `Date.now()`-keyed behavior are untouched, per Constraint 6. Save payload shape (`handleSave()`) is unchanged, per Constraint 7.

# Files Modified
- `server/services/aiService.js` — `parseRecipeImage()` only: model, `detail` param, prompt, retry logic, log line. No other function touched.
- `client/src/components/recipes/RecipeReviewModal.jsx` — steps section only: added `insertStepAfter()` and its button. Ingredients section and everything else untouched.
- `.claude/launch.json` — incidental, not part of the spec: added `autoPort: true` to both configs and pinned the client dev server to port 5183 (was 5173) with `--strictPort`, to fix a port-collision issue discovered while verifying this session (a concurrently running dev server from another session silently caused Vite to fall back to a port the preview harness couldn't reach). Low-risk, reversible, dev-tooling-only.

# Files Required Next
- For live verification of TASK-030: a real recipe image (ideally the one that originally produced wrong quantities/dropped steps, or a comparably dense one) run through `POST /api/ai/parse-recipe-image`, then through `RecipeReviewModal.jsx`'s new insert-step control. See Known Risks — this was not run this session; it spends OpenAI credits on a `gpt-4o` + `detail: 'high'` call, which is more expensive than the `gpt-4o-mini` calls used elsewhere, so deferring to the user's own test or an explicit go-ahead rather than spending credits unprompted.
- TASK-029's own live smoke test (receipt name expansion) is also still outstanding — carried forward unchanged from last session, not addressed this session (out of TASK-030's scope).
- For TASK-031: not yet read this session — next task per CURRENT_STATE ordering, but **requires explicit user approval before running its migration**.

# Files Already Reviewed
- `server/services/aiService.js` (`parseRecipeImage()` and surrounding context, `safeParseJSON`, `wrapAIError`).
- `server/routes/ai.js` (`parsedRecipeSchema`, `fractionalQuantity`, the 40s `Promise.race` timeout wrapper around `parseRecipeImage()`) — read-only, per spec's Forbidden Files.
- `client/src/components/recipes/RecipeReviewModal.jsx` (full file).
- `ai/tasks/TASK-030-spec.md` (full spec, this session).

# Dependency Chain

Editing:
- (none — TASK-030 code changes complete, pending live verification)

Requires:
- n/a

Irrelevant:
- `server/routes/ai.js`, `client/src/components/recipes/RecipeUpload.jsx`, ingredients section of `RecipeReviewModal.jsx`, `server/services/recipeService.js` — untouched, as forbidden/irrelevant per TASK-030 spec.

# Architecture Notes
- Retry logic lives entirely inside `parseRecipeImage()` (a `callOnce()` closure called up to twice), not in `ai.js` — keeps the route handler untouched per Forbidden Files, matches spec Constraint 5.
- Parse-failure detection uses a local `Symbol('parse_failed')` sentinel passed as `safeParseJSON`'s fallback, specifically to distinguish "JSON.parse threw" from "model legitimately returned the JSON literal `null`" — the pre-existing `parseRecipeImage()` couldn't tell these apart (both produced `null`), which would have made "retry only on parse failure" ambiguous.
- Retry is gated on elapsed time since function start (`Date.now() - startedAt < 18000`), a plain one-shot check, not a second timeout mechanism — per Constraint 5's timeout-budget requirement.
- Insert-step control always visible between rows (not hover-only), matching the spec's own suggested "persistent small +" design — deliberately chosen over hover-reveal for mobile-friendliness (no hover state on touch).
- **Still open, carried from earlier sessions, untouched by TASK-030**: `POST /api/shopping/build` returns 500 Internal Server Error when building a list from at least one real recipe (`Caribbean Style Curry Cod`) in this household. Still unscoped, still blocks the normal "build list from recipes" flow.
- **Still open, carried from TASK-029**: live smoke test of receipt name-expansion prompt not yet run.

# Decisions Made
- None new — implementation followed TASK-030-spec.md verbatim (all three levers in the spec's priority order, insert-before design, `crypto.randomUUID()` for new keys, sentinel-based parse-failure detection to support the retry gate); no deviations.

# Remaining Work
1. **Implement TASK-029.5** — spec approved, ready to go, no dependencies, no migration. Relocate the naming-rules block in `parseReceipt()`'s prompt per the spec's exact target position. Small diff (single template-literal reorder in one function).
2. **Live smoke test TASK-029.5** against its Acceptance Criteria (quantitative gate: ≥2/3 of meat-expansion/produce-expansion/sentence-case pass, both regression checks must hold) using this repo's Local Smoke Testing Protocol. Record which of the two Decision-section follow-ups (few-shot examples vs. two-pass architecture) the result points toward if the gate isn't met.
3. **Carried forward, still unscoped**: investigate the `POST /api/shopping/build` 500 error (real recipe → internal server error).
4. Implement TASK-031 — **requires explicit user approval before running its migration**; must precede 032/033.
5. Implement TASK-032 — requires 031 done first.
6. Implement TASK-033 — requires 032 done first; **requires explicit user approval before running its migration**.
7. TASK-030's own remaining untested edge cases (lower priority, that task is otherwise considered done): a genuinely handwritten recipe card, a true two-column body layout, a forced-malformed-response retry trigger, and `detail: 'high'` verified via true wire-level network inspection rather than source read.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Receipt preview table (`ReceiptUpload.jsx`) is read-only checkboxes, not per-field editable. Mirrors TASK-027's shopping-list edit pattern if the user wants it fixed.
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.

# Known Risks
- TASK-030 code changes are unverified against a live model response — non-deterministic prompt/model/detail-param change with no eval harness, so "implemented" is not the same as "confirmed effective" until real recipe images (across the varied layouts in Acceptance Criteria) are run through it.
- `max_tokens: 3000` headroom was not empirically re-verified against a genuinely long/dense recipe this session (Constraint 4 asked for verification, not a presumption) — left unchanged from the prior value; worth checking against an 8+ step recipe during the live smoke test.
- Cost per recipe-image upload increases (per spec's own Known Risks): `gpt-4o` instead of `gpt-4o-mini`, plus `detail: 'high'` instead of `'auto'`. Not expected to matter at this app's usage volume, but real.
- The internal retry only helps the malformed-JSON/timeout failure mode — it does not and cannot fix the originally reported bug class (valid JSON with wrong quantities or silently dropped steps). That's what the insert-step control and the prompt/detail/model changes are for; the retry is a narrower, separate mitigation.
- TASK-029's receipt-name-expansion prompt (previous session) is *also* still unverified against a live model response — two consecutive sessions now have unverified prompt/vision changes stacked up, worth a combined smoke-testing pass rather than deferring indefinitely.
- The `/api/shopping/build` 500 error remains a real, currently-reproducible bug blocking recipe-based list building for at least one household.
- Two pending production migrations (TASK-031, TASK-033) — still need explicit user sign-off at implementation time.
- No automated test suite anywhere in this repo.

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

# Recommended Next Action
Implement TASK-029.5 (spec approved, ready — see `ai/tasks/TASK-029.5-spec.md`), then live smoke-test it the same way TASK-030 was tested last session, then update this file with the result. If the quantitative gate is met, TASK-029/029.5 together can be considered done and the naming-expansion gap closed. If not met, the spec's own Decision section already specifies the next step (few-shot examples first, two-pass architecture only if that also fails) — don't skip ahead to the heavier option without trying the cheaper one, and don't silently proceed to TASK-031 without recording the outcome here either way.

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next.

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session. This session was spec-writing only (no source code changes) — TASK-030's code changes from last session were committed separately if not already done; this commit covers only the new spec and handoff update:

```powershell
git add ai/tasks/TASK-029.5-spec.md ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-029.5: add architect-approved spec for receipt naming-rules prompt reposition"
```
