# TASK-028 — Receipt Non-Food Classification Accuracy

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 1)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | Approve with minor revisions (9/10 on architecture) | Praised: prompt-only fix (correctly diagnosed as a semantic-guidance gap, not a code/architecture problem), preserving the conservative `uncertain`-bias philosophy, no new classification enum values, disciplined out-of-scope boundaries. Requested: frame the prompt around the underlying *principle* ("human pantry item") rather than an ever-growing category list, which will never be complete; make the pet-food wording unambiguous ("edible does not imply human food"); expand acceptance criteria with a concrete mixed warehouse-receipt test table; temporarily log the full `food`/`non_food`/`uncertain` distribution during validation, not just the dropped count; add a one-sentence reminder that warehouse/grocery receipts may contain arbitrary non-food merchandise. Also raised, accepted as noted-but-deferred: restructuring the prompt into formal sections (OCR/normalization/classification/confidence/examples) as more prompt-tuning tasks accumulate — a reasonable long-term observation, but premature to action for a single-function prompt at its current size (this app's stated preference against premature abstraction applies here too). All actionable items incorporated below. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Classification + filter | `server/services/aiService.js:278-329` `parseReceipt()` | Single OpenAI vision call (`gpt-4o-mini`) returns each line item with a `classification` field; `items.filter(i => i.classification !== 'non_food')` drops only items explicitly tagged `non_food` ([aiService.js:314](../../server/services/aiService.js)). |
| Design precedent | `ai/tasks/TASK-015.md:205` | Deliberate: *"Only `non_food` is discarded. `uncertain` items are passed through — a false positive (real food filtered out) is worse than a false negative (a non-food item included)."* Prompt is told to default to `uncertain` rather than `non_food` when unsure ([TASK-015.md:207](../tasks/TASK-015.md)). |
| Safety net | `client/src/components/pantry/ReceiptUpload.jsx:229-260` | Preview table with per-item checkboxes, all checked by default — the user can deselect anything the model got wrong before it's written to the pantry. This is not being removed or weakened by this task. |
| Real failure reported | User-reported, this session | A Costco receipt (mixed grocery + general-merchandise warehouse) included dog treats and a paddleboard that were **not** filtered — both should have hit `non_food` under the existing rule ("not for human consumption") but didn't. |

---

## Goal

Reduce the miss rate on the existing `non_food` classification without changing its risk posture (still biased toward `uncertain` over `non_food` when genuinely ambiguous). This is a **prompt-only fix** — the filtering code itself (`items.filter(...)`) is already correct and unchanged.

---

## Root Cause Analysis

The current prompt's only guidance is: *"Use `non_food` ONLY for items clearly and unambiguously not for human consumption... Default to `uncertain` when unsure."* Two gaps:

1. **Ambiguous phrasing for pet products.** Dog treats are, literally, food — just not human food. A model reading "not for human consumption" as "not edible by anyone" can plausibly leave pet food/treats as `uncertain` (or even miscategorize them as a food `category`) instead of `non_food`. This is very likely what happened.
2. **No concrete examples.** The prompt lists food classifications (`produce|dairy|meat|packaged|beverage`) explicitly but gives zero concrete examples of what `non_food` actually covers — it relies on the model inferring the boundary itself, which works for obviously-non-grocery items (motor oil, lumber) but is exactly where a general-merchandise warehouse receipt (Costco sells electronics, apparel, furniture, sporting goods, automotive) stresses the boundary hardest.

## Decision: Lead With the Principle, Use Examples Only to Calibrate — Do Not Touch the Passthrough Philosophy

The fix is additive prompt content, not a change in filtering logic or risk tolerance. Per architect review round 1, a category list alone is the wrong shape for this fix — a list of "pet products, sporting goods, electronics..." will always be incomplete (candles, batteries, propane, diapers, gift cards — the list never ends), and worse, a model given only a list may start treating it as implicitly exhaustive (if it's not on the list, is it food?). The prompt instead leads with the underlying rule, then gives a handful of representative examples explicitly framed as non-exhaustive:

- **State the principle first**: classify as `non_food` whenever the item is not intended for human consumption or pantry/kitchen storage, even when purchased at a grocery or warehouse-club store alongside groceries.
- **Disambiguate pet products explicitly and unambiguously**: pet food and pet treats are `non_food` — they are edible, but "edible" does not mean "human food"; the test is whether the item belongs in a human pantry, not whether it's technically food for something.
- **Add a short list of representative (not exhaustive) examples** spanning the categories this session's bug and the architect's review both raised: pet products, sporting/outdoor goods, electronics, apparel, furniture/home goods, automotive, toys, office supplies, household paper goods, cleaning supplies — explicitly labeled in the prompt as illustrative, not a complete list, so the model keeps generalizing from the rule rather than pattern-matching against a fixed set.
- **Add a one-sentence store-context reminder**: warehouse-club and grocery-store receipts may contain arbitrary general merchandise mixed in among food purchases — don't assume every line on a grocery receipt is food just because of where it was purchased.
- Leave the `uncertain`-biased default instruction and the code-level filter untouched — TASK-015's reasoning (a false positive is worse than a false negative) still applies and is not being revisited here.

---

## Allowed Files

- `server/services/aiService.js` — `parseReceipt()`'s prompt string, plus a one-line extension to the existing summary `console.log` call to include `non_food`/`uncertain` counts (Constraint 4) — not a new logging mechanism, just more fields on the line that's already there

## Forbidden Files

- `server/routes/ai.js` — `/parse-receipt` route logic (schema, filtering, response shape) is unrelated; this is a prompt-only change
- `client/src/components/pantry/ReceiptUpload.jsx` — preview/confirm UI unaffected
- Any other `parse*` function in `aiService.js` (`parseRecipeImage`, etc.) — out of scope, see TASK-030

---

## Constraints

1. **Do not change the `classification` enum** (`produce|dairy|meat|packaged|beverage|non_food|uncertain`) — no new categories (e.g. a dedicated `pet` classification is unnecessary; `non_food` already achieves the correct outcome of exclusion).
2. **Do not change the filter code** (`items.filter(i => i.classification !== 'non_food')`) — filtering behavior is unchanged, only the prompt driving `classification` values improves.
3. **Do not relax the `uncertain`-bias instruction** — the existing "default to uncertain when unsure" sentence stays; the principle-first framing and new examples supplement it, they don't replace the conservative default.
4. **Extend (don't replace) the existing summary log line to include the full classification distribution, not just the dropped count.** [aiService.js:324-327](../../server/services/aiService.js) already logs `item_count_extracted`/`item_count_food`; add `non_food` and `uncertain` counts to that same line (e.g. `item_count_non_food=${...} item_count_uncertain=${...}`) so prompt-tuning during manual verification can see the full breakdown, not just what got dropped. This is a one-line log-string extension, not a new logging system — the counts are trivially derivable from the same `items` array already being filtered.
5. **Examples in the prompt must be explicitly labeled as representative, not exhaustive** — per the Decision above, this is the mechanism that keeps the model generalizing from the stated principle instead of pattern-matching a fixed list.

---

## Dependency Chain

Editing:
- `server/services/aiService.js` (prompt string in `parseReceipt` only)

Irrelevant:
- `server/routes/ai.js`
- `client/src/components/pantry/ReceiptUpload.jsx`
- `parseRecipeImage`, `chat`, `suggestRecipes`, `expandSuggestion` (other functions in the same file)

---

## Acceptance Criteria

- [ ] A receipt containing food items + pet treats + a clearly non-food general-merchandise item (re-test against a receipt similar to the one that surfaced this bug) → pet treats and the non-food item both classified `non_food` and dropped; food items still classified correctly and included
- [ ] A representative mixed warehouse-club receipt classifies as follows (construct or simulate one with these items, per architect review round 1):

  | Item | Expected classification |
  |---|---|
  | Chicken | food |
  | Milk | food |
  | Bananas | food |
  | Dog food | non_food |
  | Laundry detergent | non_food |
  | Paper towels | non_food |

- [ ] A normal grocery-only receipt (no edge cases) still extracts and classifies all items correctly — no regression from the added prompt content
- [ ] Ambiguous-but-food items (e.g. protein bars, vitamins, spices) still pass through as `food`/`uncertain`, not newly misclassified as `non_food` — the new examples must not overcorrect
- [ ] The extended summary log line shows accurate `food`/`non_food`/`uncertain` counts on a mixed receipt (Constraint 4) — use this during manual verification to spot overcorrection (an unexpectedly high `non_food` count on a normal grocery receipt is a signal the prompt swung too far)

Verification is manual smoke testing against real photographed receipts (no automated eval harness exists for this prompt), consistent with TASK-015/024/025/026 precedent.

---

## Known Risks

- Prompt tuning against LLM behavior is not deterministic — occasional misses will still occur. The `ReceiptUpload.jsx` preview checkboxes remain the safety net; this task reduces the miss rate, it does not guarantee zero misses.
- No regression eval set exists to systematically test classification prompt changes against a corpus of past receipts — each prompt iteration is verified ad hoc against whatever receipts are on hand.
- **Prompt is growing incrementally across tasks** (this task, TASK-029's name normalization, potential future tuning) — at some point a single-function prompt string may warrant restructuring into clearer sections (extraction/classification/normalization/examples). Not warranted yet at current size/complexity; noted per architect review round 1 as a future consideration, not actioned now.

## Out of Scope

- Barcode or store-website lookups to verify item identity — researched and ruled out this session (no per-item barcodes on receipts studied, Costco item numbers aren't public-database UPCs, GPT-4o vision cannot reliably decode barcodes even if present).
- Receipt item **name** normalization/expansion (e.g. "BNLS/SL BRST" → "Boneless Skinless Chicken Breast") — separate task, see TASK-029.
