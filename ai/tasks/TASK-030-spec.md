# TASK-030 — Recipe Image Extraction Accuracy + Mid-List Step Insertion

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 7.5/10 — required changes before implementation | Praised: disciplined two-concern scope (extraction + step insertion, nothing broader), correctly identifying this as a low-volume/latency-tolerant/accuracy-sensitive endpoint where spending more per inference is justified, the minimal insert-between (not drag-and-drop) solution, no unnecessary schema change. Core critique: the spec jumped to "swap to `gpt-4o`" without first ruling out the image pipeline (resize/compression/detail level) as the actual bottleneck — correct critique, and investigating it turned up a concrete, previously-missed finding (see Decision below): `parseRecipeImage()` never sets OpenAI's `detail` parameter on the image, which defaults to `'auto'` and can silently downgrade to a fixed 512×512 low-detail thumbnail regardless of how carefully the image was resized client-side. Also requested: a stronger transcription-style prompt (identify sections, then transcribe independently, no inference, preserve visible text verbatim when uncertain) rather than the softer "enumerate every step" framing; an explicit reading-order instruction for multi-column layouts; softened language around prompt-effectiveness claims ("documented mitigation" overstated the evidence); acceptance criteria covering multiple recipe layouts, not just a retest of one known-bad image; a corrected token-headroom framing (verify no truncation on worst-case output, rather than presuming 3000 is likely insufficient — recipe outputs are typically small). Recommended (non-blocking): a single retry on parse failure; `crypto.randomUUID()` instead of `Date.now()` for new step keys; an optional per-step confidence field for future extensibility. All required items and most recommended items incorporated in DRAFT-2; the confidence-field idea was accepted-but-deferred per the architect's own "not required for this task" framing. |
| DRAFT-2 | 9.3/10 — implementation-ready with minor refinements | Praised: the reordered root-cause investigation (detail param → prompt → model, not model-first), the transcription-vs-extraction prompt reframe, the reading-order addition, the softened effectiveness language, the broadened multi-layout acceptance criteria, and the honestly-scoped retry (malformed JSON/transport only, not content accuracy). Requested: fix an internal inconsistency where "Allowed Files" still said "model name + prompt string only" while Constraints by then also covered the `detail` param and retry logic; replace a "verify via temporary log" acceptance criterion with implementation-neutral network/debugger inspection; add a timeout-budget check so the internal retry can't silently exceed the existing 40s client-facing timeout in `ai.js` for no benefit; soften one sentence's phrasing; add lightweight structured logging around extraction (detail level, retry occurrence, parse-failure rate) so this task's real-world impact is measurable later rather than anecdotal. All incorporated below. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Extraction call | `server/services/aiService.js:336-370` `parseRecipeImage()` | `gpt-4o-mini`, single bare-instruction prompt: *"Extract the recipe from this image. Return JSON: {...}. Return ONLY a raw JSON object. No markdown, no explanation."* No guidance on completeness, no instruction against paraphrasing/consolidating, no exact-quantity instruction. |
| User-reported failure | This session | Last uploaded recipe: ingredient quantities came back wrong and instructions were missing entirely (not malformed — just absent from the output). |
| Prior known issue | `ai/handoffs/CURRENT_STATE.md` Remaining Work #4 | Same class of bug already observed during TASK-024 iOS smoke testing (2026-07-14): *"ingredient quantities/values came back wrong and some steps were skipped."* Logged as backlog, unscoped, until now. |
| Review/correction UI | `client/src/components/recipes/RecipeReviewModal.jsx` | Editable pre-save form — the existing safety net (same "AI proposes, human disposes" pattern as the receipt/pantry flow). **Steps can only be appended at the end** (`addStep()`, [RecipeReviewModal.jsx:40-42](../../client/src/components/recipes/RecipeReviewModal.jsx)) — no way to insert a step at a specific position. If step 3 of 7 is missing, fixing it today means appending at the bottom and manually retyping/reordering the rest. |
| Response validation | `server/routes/ai.js:139-219` | `parsedRecipeSchema` (Zod) already handles fraction coercion or unicode fraction quantities and a tag whitelist. Schema shape is not the problem — the model's actual read of the image is. |

---

## Goal

Two related fixes to the recipe-image-upload flow:
1. Reduce extraction errors (wrong quantities, dropped steps) in `parseRecipeImage()`.
2. Let a user insert a missing step at the correct position in `RecipeReviewModal.jsx`, not just append at the end.

---

## Decision: Three Independent Levers — Image Detail Level First, Then Prompt, Then Model

Per architect review round 1, the DRAFT-1 spec jumped to "swap the model" without first ruling out the image pipeline as the actual bottleneck. Investigating that turned up a concrete, previously-missed bug candidate — reordering the levers accordingly, most fundamental first:

**1. `detail` parameter is never set — confirmed via direct code read, not assumed.** `parseRecipeImage()`'s `image_url` object is `{ url: ... }` only ([aiService.js:346](../../server/services/aiService.js)) — no `detail` key. Per OpenAI's documented behavior, an unset `detail` defaults to `'auto'`, where **the model itself decides** whether to process the image at a fixed 512×512 low-detail thumbnail or full high-detail tiled resolution, based on image size/content. For a dense recipe card with small printed text, if `'auto'` ever resolves to low-detail, the client's careful ≤1568px resize (TASK-024) is irrelevant — improvements to prompt wording or model capability cannot recover text that was omitted because the image itself was processed at insufficient resolution. **Fix: explicitly set `detail: 'high'`** on the image content block. This is the most foundational of the three levers — the other two are moot if the model never actually saw the text at readable resolution.

**2. Prompt: transcription framing, not extraction framing.** Per architect review round 1, "enumerate every step" is a softer ask than the prompt actually needs. Reframe the instruction as a transcription task with an explicit structure: (a) first identify the recipe's sections (title, ingredients, instructions — and any sidebars/notes/tips boxes, which should be ignored unless clearly part of the numbered instructions); (b) then transcribe the ingredients and instructions sections independently and in their printed order; (c) never infer, summarize, merge adjacent instructions, or normalize wording; (d) if part of the image is genuinely illegible, preserve the visible text as-is rather than guessing at the missing portion; (e) for multi-column layouts, read top-to-bottom within a column before moving to the next column, not left-to-right across columns (prevents interleaving unrelated steps from adjacent columns). Quantities are transcribed exactly as printed (including fractions), not estimated.

**3. Model: `gpt-4o` instead of `gpt-4o-mini`, as a complementary improvement — not the primary fix.** GPT-4o-family vision models are not purpose-built OCR engines regardless of tier (confirmed via research this session) — they read layout and meaning, which is part of why steps get paraphrased/dropped. `gpt-4o-mini` is used here for cost reasons inherited from the chat/receipt endpoints; recipe-image parsing is a low-volume, user-triggered, latency-tolerant, accuracy-sensitive action (exactly the profile where spending more per inference is justified, per architect review round 1) — the cost delta of `gpt-4o` at this app's scale is immaterial. This lever is retained, but now correctly ordered behind fixing the `detail` parameter and strengthening the prompt, rather than presented as the central fix.

**On the strength of the prompt-effectiveness claim (softened per architect review round 1):** enumeration/transcription-style prompts have been observed to reduce content omission by encouraging exhaustive, structured extraction — this is not a guarantee. LLM vision extraction remains probabilistic; the `RecipeReviewModal` insert-step fix (below) exists precisely because this task cannot promise zero omissions, only a meaningfully lower rate.

## Decision: Insert-Before/-After, Not Drag-and-Drop Reorder

**Recommendation: add a small "insert step here" control between existing step rows, rather than full drag-and-drop reordering.**

The actual problem is narrower than general reordering — it's specifically "the AI skipped one step in the middle." A lightweight insert-at-position (e.g. a thin "+ insert step" button that appears between two step rows on hover, or a persistent small "+" between each pair) solves exactly that without the complexity (and mobile-unfriendliness) of drag-and-drop. Full reordering is not something this session's reported problem calls for.

---

## Allowed Files

- `server/services/aiService.js` — `parseRecipeImage()` implementation only: model selection, image request options (`detail` parameter), prompt string, localized retry logic, and its structured log line. (Corrected per architect review round 2 — DRAFT-2 undersold this as "model name + prompt string only," which no longer matched the `detail` param and retry additions already in Constraints.)
- `client/src/components/recipes/RecipeReviewModal.jsx` — step list: add an insert-at-position control alongside the existing append/remove

## Forbidden Files

- `server/routes/ai.js` — `parsedRecipeSchema` validation is unaffected; output shape is unchanged, only content quality improves
- `client/src/components/recipes/RecipeUpload.jsx` — capture/resize/upload flow is unrelated to extraction accuracy or step editing
- Ingredient list UI in `RecipeReviewModal.jsx` — only the **steps** section changes; ingredients keep their existing append-only `addIngredient()`/`removeIngredient()` (not reported as broken in the same way — quantities were wrong, but insertion-position was not the reported problem for ingredients, only for steps)

---

## Constraints

1. **Model change is scoped to `parseRecipeImage()` only** — do not change the model used by `chat()`, `parseReceipt()`, `expandSuggestion()`, or `eatThisNow()`. Each of those is a separate cost/accuracy tradeoff already made deliberately elsewhere.
2. **Set `detail: 'high'` explicitly on the image content block** — see Decision above. This is the highest-priority change in this task; verify it lands correctly (`{ type: 'image_url', image_url: { url: ..., detail: 'high' } }`) before evaluating whether the prompt/model changes alone would have looked sufficient.
3. **Prompt must be restructured around transcription, not extraction** — see Decision above (identify sections → transcribe independently → no inference/merging → preserve illegible text as-is → column-aware reading order). Must explicitly instruct exact (not estimated) quantity transcription, including fraction handling — the existing `fractionalQuantity` Zod coercion in `ai.js` already handles unicode fractions and mixed numbers, so the model should be told it's safe to output fractions in either numeric or the already-supported string forms.
4. **`max_tokens: 3000` — verify no truncation on a worst-case recipe, don't presume it's insufficient.** Corrected per architect review round 1: recipe outputs are typically small (title + ~20 ingredients + ~20 steps rarely approaches thousands of output tokens) — the more precise ask is verifying headroom against a genuinely long/dense recipe (e.g. a multi-page cookbook spread), not assuming 3000 needs raising. A truncation failure is at least visible (invalid JSON → `safeParseJSON` returns `null` → 502) rather than silent.
5. **One automatic retry, contained entirely inside `parseRecipeImage()`, scoped narrowly and budget-aware.** If the first OpenAI call's response fails `safeParseJSON` (returns `null`), retry the same call once internally before returning `null` to the route — keeps the retry self-contained in `aiService.js` rather than adding retry logic to `ai.js`'s route handler (which stays untouched, per Forbidden Files). Does not retry on the route's separate Zod-validation failure (`parsedRecipeSchema.parse()`) — that happens downstream in `ai.js` and is out of this function's visibility; a schema-valid-but-wrong-content response is not something a retry inside `parseRecipeImage()` can or should intercept. **Scope honestly**: this only helps the malformed-JSON/timeout failure mode. It does not fix — and should not be presented as fixing — the originally reported bug (valid JSON with wrong quantities/missing steps), since blindly retrying a non-deterministic call has no guarantee of producing better content, only possibly different content.
   **Timeout budget (added per architect review round 2):** `ai.js` already wraps the entire `parseRecipeImage()` call in a 40s `Promise.race` ([ai.js:196-200](../../server/routes/ai.js)) — that outer timeout is unaware of and unaffected by any internal retry. Track elapsed time from the start of `parseRecipeImage()`; only attempt the retry if the first call failed within roughly the first half of that budget (e.g. under ~15-18s) — if the first attempt alone already consumed most of the 40s window, skip the retry and return `null` immediately, since a second full attempt would almost certainly get cut off by the outer timeout anyway and provide no benefit, just a slower failure. This is a plain elapsed-time check (`Date.now()` at function start vs. before deciding to retry), not a second, separate timeout mechanism.
6. **Insert control must not disrupt existing step `_key` identity** — `RecipeReviewModal.jsx`'s steps use a stable `_key` (index at load time, or `Date.now()` for newly added ones) for React list identity and for `updateStep`/`removeStep` targeting. Inserting at position N must produce a new step object with its own fresh key, spliced into the array at the correct index — not renumber or reassign existing steps' keys. **New insert-step code should key with `crypto.randomUUID()`** (browser-native, no polyfill needed on the modern Safari/Chrome versions this PWA already targets) rather than `Date.now()`, per architect review round 1 — timestamp collisions are unlikely but avoidable for a control a user might click rapidly. The pre-existing `addStep()`/`addIngredient()` keep their existing `Date.now()` keys unchanged (out of scope — see Forbidden Files; not worth touching working, untouched code for this).
7. **No change to the save payload shape** — `handleSave()`'s `steps: steps.map(s => s.text.trim()).filter(Boolean)` stays the same; insertion only affects how the `steps` state array is built during editing, not what's sent to the server.
8. **Extend the existing per-call log line with detail level, retry occurrence, and parse-failure outcome** (added per architect review round 2) — `parseRecipeImage()` already logs one structured line per call ([aiService.js:366-368](../../server/services/aiService.js)); extend it (matching the same `[kitchen-keeper] key=value` style used throughout `aiService.js`, e.g. TASK-028's classification-count extension) to include whether `detail: 'high'` was sent, whether the internal retry fired, and whether the final result was a parse failure. This is a one-line log extension, not new logging infrastructure — without it, there's no way to tell six months from now whether the `detail` fix mattered, whether retries are actually happening, or whether parse-failure rate improved.

---

## Dependency Chain

Editing:
- `server/services/aiService.js` (`parseRecipeImage` only)
- `client/src/components/recipes/RecipeReviewModal.jsx` (steps section only)

Reads (pattern reference only):
- `server/routes/ai.js:139-219` — confirm `parsedRecipeSchema` needs no shape change
- `ai/handoffs/CURRENT_STATE.md` — prior known-issue note (Remaining Work #4)

Irrelevant:
- `client/src/components/recipes/RecipeUpload.jsx`
- Ingredients section of `RecipeReviewModal.jsx`
- `server/services/recipeService.js` (save path unaffected)

---

## Acceptance Criteria

- [ ] Re-upload a recipe image previously known to produce wrong quantities/dropped steps (or a comparably dense recipe card/photo) — steps present and in the correct order, quantities match the source image
- [ ] Confirm `detail: 'high'` is actually present in the outgoing request (verify via debugger or network inspection, not just by reading the source — implementation-neutral, per architect review round 2, rather than a temporary log that would become stale documentation) — this is the highest-priority fix and worth confirming it isn't silently dropped somewhere in the request construction
- [ ] Per architect review round 1, exercise multiple recipe layouts, not just a single retest — at minimum:
  - a recipe with fractional quantities (e.g. "1½ cups")
  - a handwritten recipe card
  - a recipe with numbered steps
  - a recipe with bulleted (non-numbered) steps
  - a recipe with a two-column layout or a sidebar/tip box adjacent to the main instructions (verify no column interleaving)
- [ ] A recipe with 8+ distinct steps is not truncated (verify against `max_tokens` headroom per Constraint 4)
- [ ] A deliberately malformed/failed extraction triggers exactly one retry before surfacing an error (verify via a temporary forced-failure test, not just code inspection)
- [ ] In the review modal, a user can insert a new blank step between two existing steps (not just append at the end) and type it in without disturbing the other steps' text or order
- [ ] Rapidly inserting multiple steps in succession does not produce duplicate/colliding React keys (verify the `crypto.randomUUID()` change addresses this)
- [ ] Removing a step, editing a step's text, and appending a step at the end all continue to work unchanged after the insert control is added (regression check)
- [ ] Saving a recipe after inserting a mid-list step produces the correct step order in the saved recipe (verify against the recipe detail view post-save)
- [ ] Regression: ingredient editing (add/remove/edit) is unaffected — this task does not touch that section

Verification is manual smoke testing (no automated test suite in this repo, per TASK-024/025/026 precedent) — ideally against the same recipe image(s) that produced the originally reported bad extraction, for a direct before/after comparison, plus the varied-layout set above.

---

## Known Risks

- **None of the three levers (detail param, prompt, model) is a guaranteed fix, even combined.** Vision-language extraction remains probabilistic regardless of tier or prompt quality (confirmed via research this session, softened per architect review round 1 to avoid overstating the evidence). This task should measurably reduce the error rate, not eliminate it. `RecipeReviewModal.jsx` remains the necessary correction step for whatever still gets missed — which is exactly why the insert-step fix matters alongside the extraction changes, not instead of them.
- **No before/after accuracy benchmark exists.** There's no corpus of recipe images with known-correct extractions to regression-test against; verification relies on manual re-testing against whatever images are on hand (now across multiple layouts per the expanded Acceptance Criteria), same limitation noted for TASK-028.
- Cost per recipe-image upload increases with the `gpt-4o` swap and the `detail: 'high'` setting (high-detail images cost more tokens than auto/low). Not expected to matter at this app's usage volume (user-triggered, infrequent), but worth knowing if usage patterns change materially later.
- **A single retry (Constraint 5) adds latency to the failure path**, not the success path — acceptable given this endpoint is already explicitly latency-tolerant (40s client-side timeout already exists in `ai.js`), but worth confirming the retry completes within that existing timeout window rather than stacking a second full request beyond it.

## Out of Scope

- Ingredient-list mid-position insertion (only steps were reported as the problem; ingredients keep append-only editing)
- A dedicated OCR pipeline (e.g. a real OCR engine as a pre-pass before the LLM call) — a heavier architectural change than this session's reported problem calls for; revisit only if the extraction changes here prove insufficient
- Drag-and-drop step reordering — see Decision above
- **Per-step/per-ingredient confidence field** (e.g. `{ text, confidence: 'high'|'low' }`) — raised by architect review round 1 as a reasonable future extensibility point once uncertainty needs to be surfaced in the UI, but explicitly scoped by the architect themselves as "not required for this task." Would require a response-shape change (`parsedRecipeSchema` in `ai.js`) and review-modal UI to surface it — real scope, not a free addition, deferred until there's an actual consumer for the confidence signal.
