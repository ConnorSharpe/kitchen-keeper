# TASK-029 — Receipt Item Name Normalization

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 1)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | Approve with minor revisions (9.5/10 on architecture) | Praised: tight scope (prompt-only, one file), correctly declining a `rawName`/`displayName` split with no current consumer, explicit acknowledgment of the TASK-031 downstream dependency, the "don't guess on illegible text" rule, disciplined forbidden-files list. Requested: broaden the abbreviation examples beyond meat (produce/dairy/frozen/bakery too — models overfit to a single example category); specify a capitalization convention explicitly; explicitly forbid embellishment (marketing adjectives like "fresh"/"premium"/"farm fresh" that aren't on the receipt); explicitly forbid inferring package sizes/quantities not printed; clarify brand-name handling (preserve vs. expand vs. strip); expand acceptance criteria into a broader example table; structure the prompt's naming rules as a concise bullet list rather than embedded prose. Also raised, accepted as noted-but-deferred: a future reusable normalization utility once names arrive from multiple sources (receipts, barcode scan, manual entry, recipes) — correctly scoped by the architect themselves as "not now." One recommendation corrected rather than applied as-is: the architect suggested Title Case reasoning "that's already what pantry UIs typically display," but `AddItemModal.jsx`'s actual placeholder (`"e.g. Chicken breast"`) is sentence case, not Title Case — verified against the file, which the architect couldn't access, and used to override that specific suggestion while keeping everything else. All actionable items incorporated below. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Raw extraction | `server/services/aiService.js:278-329` `parseReceipt()` | Prompt asks for `{ name, category, quantity, unit, estimatedExpiryDays, classification }` per line but gives no instruction on how to render `name` — the model currently appears to pass through the receipt's own abbreviated printed text largely verbatim (e.g. "BNLS/SL BRST" for boneless skinless chicken breast, as literally seen by the user this session). |
| Where `name` is shown | `client/src/components/pantry/ReceiptUpload.jsx:244-246` | Preview table renders `item.name` directly as the human-facing label — no separate display-name field exists to fall back on. |
| Where `name` is used downstream | `server/services/pantryService.js:8-16` `enrichWithExpiry()` → `server/services/shelfLifeService.js:27` `lookup()` | `lookup()` does exact/substring matching against a 251-entry FoodKeeper dataset (`server/data/foodkeeper.json`) keyed by normalized food name (e.g. `"chicken breast"`). **This only runs when `expiryDate` is null** — for receipt-imported items, `expiryDate` is already set from the AI's own `estimatedExpiryDays` before reaching this function ([server/routes/ai.js:110-112](../../server/routes/ai.js)), so today `lookup()` is never actually exercised for receipt items. TASK-031 changes this (see Known Risks below) — `name` quality will start to matter for expiry accuracy, not just display, once that lands. |
| Researched and ruled out | This session | No free/general barcode-to-name or store-catalog lookup is viable (no per-item barcodes on receipts studied; Costco item numbers aren't public UPCs; Kroger's public product API is the only free general-purpose option and doesn't cover Costco; GPT-4o vision can't reliably decode barcodes even where present). The fix has to be the same vision model expanding abbreviations from its own language knowledge, in the same call that already reads the receipt. |

---

## Goal

Have `parseReceipt()` output a clean, human-readable item name (e.g. "Boneless Skinless Chicken Breast" instead of "BNLS/SL BRST") using the same vision call already in place — no new API calls, no external lookups.

---

## Decision: Expand In-Place, No Separate `rawName`/`displayName` Split

**Recommendation: instruct the model to output the expanded, human-readable name directly as `name` — do not add a second field.**

A `rawName` + `displayName` split was considered (keeping the literal receipt text for debugging/trust alongside a clean label) but rejected for v1: nothing downstream currently has a use for the raw abbreviation (no audit trail, no "show original" UI exists anywhere in this app), and it would be dead data that only adds prompt/schema surface area. If a future need for the raw string emerges (e.g. a "why did this get named X" debug view), it's a trivial additive field then — not a redesign.

## Constraint: Expanded Name Must Stay Specific, Not Generic

The naive failure mode of "make it human-readable" is over-generalizing — e.g. collapsing "BNLS/SL BRST" to just "Chicken" instead of "Chicken Breast" would read fine to a human but silently degrades any future FoodKeeper matching (TASK-031 depends on `name` specificity for storage-aware expiry lookups; different chicken cuts, for instance, are separate FoodKeeper entries even though this app's current sample happens to show identical day-counts across them). The prompt must explicitly instruct: expand abbreviations to their full, specific meaning (cut of meat, product type) — do not generalize to a broader category than the receipt line actually specifies.

## Constraint: No Embellishment — Expansion, Not Improvement

The opposite failure mode, raised in architect review round 1, is just as real: a model "improving" a plain name by adding attributes the receipt never stated — "MILK" → "Fresh Milk", "EGGS" → "Farm Fresh Eggs", "CHK BRST" → "Premium Boneless Chicken Breast". This is not the same problem as over-generalizing (Constraint above) — it's fabricating detail in the *other* direction. The prompt must explicitly forbid adding marketing/quality/freshness adjectives (fresh, premium, farm-fresh, value, family-pack, etc.) and forbid inferring package size or quantity descriptors (e.g. "1 Gallon", "Large", "Family Pack") unless that exact detail is legible on the receipt line itself. Expansion means spelling out what's already there, not adding what isn't.

## Decision: Brand Names Follow the Same Confidence Rule as Everything Else

Brand abbreviations (e.g. a warehouse club's private-label prefix) are handled under the same "don't guess" bar already established for illegible/uncertain text (see Constraint 4 below): expand a brand abbreviation only if it is unambiguous and confidently recognizable (a globally known house brand is a reasonable example of "confident"), otherwise leave the brand portion as printed rather than guessing. This isn't a separate rule from the illegibility guidance — it's the same rule applied to a specific case worth calling out explicitly, since brand strings are exactly the kind of thing a model might otherwise feel free to guess at.

## Decision: Sentence Case, Not Title Case — Matches Existing Convention

**Corrected from architect review round 1**, which recommended Title Case ("Boneless Skinless Chicken Breast") on the assumption that's the existing display convention. Checked directly against the codebase: `AddItemModal.jsx`'s own placeholder text for the pantry item name field is `"e.g. Chicken breast"` ([AddItemModal.jsx:123](../../client/src/components/pantry/AddItemModal.jsx)) — sentence case (first letter capitalized, rest lowercase except proper nouns/brand names), not Title Case. The receipt-parsing prompt should produce names matching this existing convention (e.g. "Boneless skinless chicken breast", "Organic avocados", "Ground turkey") rather than introducing a second, inconsistent casing style into the same `name` field other creation paths already populate.

---

## Allowed Files

- `server/services/aiService.js` — `parseReceipt()`'s prompt string only

## Forbidden Files

- `server/routes/ai.js` — response schema (`candidateItemSchema`) is unaffected; `name` stays a plain string, no shape change
- `client/src/components/pantry/ReceiptUpload.jsx` — no UI change needed, it already renders whatever `name` it's given
- `server/services/shelfLifeService.js` / `server/services/pantryService.js` — matching logic is TASK-031's concern, not this task's; this task only improves the input string quality

---

## Constraints

1. **No new response fields** — see Decision above. `name` is the only field affected.
2. **Preserve specificity** — see Constraint above. The prompt must give examples of the failure mode to avoid, spanning multiple grocery categories, not just meat (per architect review round 1 — a single-category example risks the model overfitting to that one domain). Include at minimum one example each from meat, produce, and dairy (e.g. "BNLS/SL BRST" → "Boneless skinless chicken breast", "ORG AVO" → "Organic avocados", "GRND TRKY" → "Ground turkey", "WHL MLK" → "Whole milk", "SHRD CHDR" → "Shredded cheddar cheese").
3. **No embellishment or inferred attributes** — see Constraint above. No marketing/freshness/quality adjectives, no inferred package size or quantity descriptors, unless legible on the receipt itself.
4. **Sentence case output** — see Decision above, matching `AddItemModal.jsx`'s existing convention.
5. **Brand names follow the same confidence bar as abbreviation expansion generally** — see Decision above.
6. **Do not touch `estimatedExpiryDays`, `category`, `classification`, `quantity`, or `unit` prompt guidance** — this task is scoped to the `name` field's rendering instruction only. (`estimatedExpiryDays`'s interaction with storage location is TASK-031's concern.)
7. **Ambiguous/illegible line items**: if the model cannot confidently expand an abbreviation (faded print, unfamiliar store-specific code), instruct it to keep the original printed text rather than guessing a plausible-sounding but wrong expansion — a wrong-but-plausible name is a worse failure than an unexpanded-but-honest one, since the user's checkbox-preview review is easier to catch "unexpanded text" (obviously abbreviated) than a confidently wrong full name.
8. **Present the naming rules in the prompt as a concise bullet list, not embedded prose** — per architect review round 1, models follow enumerated imperative rules more reliably than the same guidance embedded in a paragraph. Something in the shape of:
   ```
   For the "name" field:
   - Expand common grocery abbreviations to their full, specific meaning.
   - Keep the same specificity as the original line (do not generalize to a broader category).
   - Use sentence case (e.g. "Organic avocados", not "ORGANIC AVOCADOS" or "Organic Avocados").
   - Preserve brand names when clearly and unambiguously present; do not guess an unfamiliar brand abbreviation.
   - Do not add marketing, freshness, or quality adjectives not present on the receipt.
   - Do not infer package size or quantity descriptors not present on the receipt.
   - If an abbreviation cannot be confidently expanded, return the original printed text unchanged.
   ```

---

## Dependency Chain

Editing:
- `server/services/aiService.js` (prompt string in `parseReceipt` only)

Reads (pattern reference only):
- `server/data/foodkeeper.json` — sample entries reviewed this session to confirm specificity requirement (e.g. `"chicken breast"`, `"chicken thigh"`, `"whole chicken"` are distinct entries)

Irrelevant:
- `server/routes/ai.js`
- `client/src/components/pantry/ReceiptUpload.jsx`
- `server/services/shelfLifeService.js` (this task doesn't call it or change matching)

---

## Acceptance Criteria

- [ ] Re-scanning a receipt containing abbreviated items across multiple categories produces expanded, sentence-case, human-readable names in the preview table, e.g.:

  | Receipt text | Expected `name` |
  |---|---|
  | BNLS/SL BRST | Boneless skinless chicken breast |
  | ORG AVO | Organic avocados |
  | GRND TRKY | Ground turkey |
  | WHL MLK | Whole milk |
  | SHRD CHDR | Shredded cheddar cheese |

- [ ] Expanded names retain the same specificity as the original line (a chicken breast stays "chicken breast," not generalized to "chicken" or "meat")
- [ ] No embellishment: a plain item (e.g. "MILK", "EGGS") does not gain freshness/quality/marketing adjectives ("Fresh Milk", "Farm Fresh Eggs") or an inferred package size ("1 Gallon Milk") not present on the receipt
- [ ] A recognizable, unambiguous brand/house-brand abbreviation is expanded; an unfamiliar or ambiguous one is left as printed rather than guessed
- [ ] An illegible or store-specific coded line the model can't confidently expand is left as the original printed text rather than a fabricated guess
- [ ] Output is consistently sentence case across items, matching `AddItemModal.jsx`'s existing convention (not Title Case, not all-caps)
- [ ] Regression: a normal, already-clear item name (e.g. "Bananas") is unaffected by the new prompt wording
- [ ] `classification`/non-food filtering (TASK-028) continues to work correctly on the same test receipts — confirm no interaction/regression between the two prompt changes if both are implemented close together

---

## Known Risks

- **Cross-task dependency with TASK-031.** Once TASK-031 changes receipt-item expiry to prefer a deterministic FoodKeeper lookup over the AI's flat `estimatedExpiryDays` guess, this task's name-specificity requirement becomes load-bearing for expiry accuracy, not just cosmetic. If TASK-031 ships first, verify this task's prompt change against FoodKeeper match rate, not just readability, before considering it done.
- LLM name expansion is not deterministic — some abbreviations, especially store-specific codes, may still be expanded incorrectly or left unexpanded. The receipt preview screen remains the manual-correction safety net (a user can already edit... actually confirm: **`ReceiptUpload.jsx`'s preview table is currently read-only checkboxes, not editable per-field** — a user cannot fix a wrong name in the preview today, only exclude the whole row. Fixing a bad name currently requires accepting it and correcting it afterward in the Pantry table's existing edit modal (`AddItemModal.jsx`). This is a pre-existing gap, not introduced by this task, but worth flagging since it means this task's failure mode (wrong expansion) isn't as cheaply recoverable in the moment as TASK-028's failure mode (uncheck a box).

## Out of Scope

- Making the receipt preview table's `name` field editable inline — a real gap noted above, but a separate, smaller UI task if the user wants it (mirrors TASK-027's shopping-list edit pattern and could reuse the same approach).
- Barcode/store-website lookups — ruled out, see TASK-028's Out of Scope for the same research findings.
- **A reusable, standalone name-normalization utility/layer** independent of this AI prompt — raised by architect review round 1 as a reasonable future direction once item names arrive from multiple sources (receipts, barcode scan, manual entry, recipe imports, voice) and a canonical form is needed for search/matching. Correctly scoped by the architect themselves as "not now" — keeping normalization inside this one vision prompt is the right amount of architecture for a single source today.
