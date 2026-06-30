# TASK-024 — Recipe Photo Upload: Add Camera Trigger + User Review Step

Version: DRAFT-3 (post-architect review, round 2 — APPROVED WITH MINOR REVISIONS)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.5/10 — not approved | Greenfield spec; proposed reusing RecipeModal (wrong — it's view-only); no Zod awareness; no existing route awareness |
| DRAFT-2 | 9.3/10 — approved with minor revisions | Added codebase reality check; found existing route + Zod schema; added fraction coercion, EXIF, AbortController; RecipeReviewModal justified; 3 open questions left unresolved |
| DRAFT-3 | — | Resolved all 3 open questions; justified RecipeReviewModal with code evidence; confirmed single caller; made Blob timing decision |

---

## Codebase Reality Check

**This feature already partially exists.** Before listing changes, here is the current state:

| What exists | File | Notes |
|---|---|---|
| Upload UI | `client/src/components/recipes/RecipeUpload.jsx` | Drag-drop + file picker; calls `/api/ai/parse-recipe-image` |
| Server route | `server/routes/ai.js:157` | `POST /api/ai/parse-recipe-image`; multer + Zod + Vercel Blob |
| Zod schema | `server/routes/ai.js:140` | `parsedRecipeSchema` — validates all recipe fields |
| AI extraction | `server/services/aiService.js:336` | `parseRecipeImage()` — uses `gpt-4o-mini` + base64 |
| Image storage | Vercel Blob | Image permanently uploaded; `imageUrl` set on saved recipe |
| Food normalization | `server/utils/foodNormalization.js` | `normalizeFood`, `normalizeUnit`, `stripIngredientPrefix` |

**What the current implementation does NOT do:**
- No user confirmation — route saves the recipe immediately after extraction
- No camera trigger — `<input>` uses `accept="image/*"` but no `capture` attribute
- No client-side image resize — raw camera file sent to server
- No fraction parsing — `quantity: z.number()` will produce `null` or fail on `"1/2"` from model output
- No duplicate-submission guard — button not disabled during upload
- No request timeout
- No cancellation on modal close

**TASK-024 scope:** fix all of the above. Do NOT rewrite the extraction logic or migrate the AI provider.

---

## Goal

Upgrade the existing recipe photo upload feature so that:
1. The camera opens directly on mobile (not just a file picker)
2. The image is resized client-side before upload
3. The extracted recipe is shown in a **review modal** for user editing before any save occurs
4. Fractions in ingredient quantities are converted to decimals
5. The upload is guarded against duplicate submissions and has a timeout

---

## Resolved Decisions (formerly Open Questions)

### RecipeReviewModal vs RecipeModal `mode="review"`

**Decision: new `RecipeReviewModal` component is justified.**

`RecipeModal` was read in full (175 lines). It is statically rendered — every field is a plain `{recipe.name}`, `{recipe.ingredients.map(...)}`, etc. It requires `recipe.id` for delete and favorite-toggle callbacks. There are zero input elements and no form state. Adding a `mode="review"` prop would require conditionally rendering controlled inputs for every field, add/remove-row handlers for ingredients and steps, and bypassing the `id` / `onDelete` / `onToggleFavorite` contract. That is effectively a rewrite of a component that works well as-is. `RecipeReviewModal` is a pre-save form; `RecipeModal` is a post-save viewer — different purposes, different contracts, correct to keep separate.

### Route response contract change

**Decision: safe. Single caller confirmed.**

`grep -r "parse-recipe-image" client/` returns exactly one result: `RecipeUpload.jsx`. No other client file, no external integration. The response shape change (`{ recipe: saved }` → `{ recipe: extracted }`) only affects `RecipeUpload.jsx`, which is in scope for this task.

### Blob upload timing

**Decision: Option B — upload at save time. v1 ships without `imageUrl`.**

Keeping the Vercel Blob upload inside `parse-recipe-image` creates orphaned blobs on every cancel. Moving it to `POST /api/recipes` would require recipes.js to accept multipart. The cleanest v1 path: remove the Blob upload from `parse-recipe-image` entirely. Recipes saved via photo upload have `imageUrl: null`. Image storage for uploaded recipes is a follow-up task (Vercel Blob upload at save time via a separate endpoint or as multipart to recipes.js). No orphaned blobs, no scope creep in this task.

---

## What Does NOT Change

- `POST /api/ai/parse-recipe-image` route path, auth, multer setup
- `parsedRecipeSchema` Zod schema in `ai.js` — extended only (fraction coercion + tag whitelist)
- `aiService.parseRecipeImage()` — provider, model, prompt, and return shape all untouched
- `RecipeModal.jsx` — view-only, no changes
- `recipeService.create()` — unchanged
- **Vercel Blob upload is REMOVED from this route** (see Blob timing decision above)

---

## Allowed Files

- `client/src/components/recipes/RecipeUpload.jsx` — add camera trigger, resize, review flow, duplicate guard
- `client/src/components/recipes/RecipeReviewModal.jsx` — NEW: editable pre-save review form
- `server/routes/ai.js` — patch `parsedRecipeSchema` (fraction coercion) + add timeout + expand error codes

## Forbidden Files

- `server/services/aiService.js` — extraction logic unchanged
- `server/services/recipeService.js` — CRUD unchanged
- `client/src/components/recipes/RecipeModal.jsx` — view-only, no edit mode added here
- `server/db/migrations/` — no schema changes
- `client/src/hooks/useSpeechInput.js` — unrelated

---

## Constraints

1. **No save without user confirmation** — `POST /api/recipes` is called only after user clicks Save in `RecipeReviewModal`.
2. **Client-side resize** — canvas resize to ≤ 1568px longest edge, JPEG 85%, before `FormData` POST. Never upscale. Maintain aspect ratio.
3. **EXIF orientation** — use `createImageBitmap()` (honors EXIF on iOS 16.4+ and Android); fall back to `Image`+`canvas` which does NOT honor EXIF. For the fallback path, read EXIF orientation tag from the ArrayBuffer and apply canvas rotation before drawing.
4. **Fraction coercion in Zod** — `z.union([z.number(), z.string()])` with `.transform()` converting `"1/2"` → `0.5`, `"1 1/2"` → `1.5`, `"¾"` → `0.75` before the existing numeric validation.
5. **Duplicate submission guard** — disable the file input and show "Extracting…" state during upload. The AbortController is owned by `RecipeUpload` and cancelled on unmount or modal close.
6. **Timeouts** — 45-second `AbortSignal.timeout(45_000)` on the client fetch. The server should also guard against hung AI calls: wrap `aiService.parseRecipeImage()` in a `Promise.race` against a 40-second timeout that rejects with a 504. Client timeout fires first (45 s) so the user sees a message before the server drops the connection.
7. **No new OpenAI client** — `aiService.parseRecipeImage()` already creates its own client; do not instantiate another.
8. **Tag whitelist** — Claude currently infers free-form tags. Clamp output tags in the Zod schema to a known enum (see below) and drop unknown values rather than rejecting.

---

## Changes in Detail

### 1. `RecipeUpload.jsx` — Camera + Resize + Review Flow

**Camera trigger:**
```html
<!-- before -->
<input type="file" accept="image/*" ... />

<!-- after -->
<input type="file" accept="image/*" capture="environment" ... />
```
`capture="environment"` opens rear camera directly on iOS PWA and Android Chrome. Desktop browsers ignore the attribute and fall back to file picker.

**Client-side resize (canvas):**
```js
async function resizeImage(file, maxPx = 1568, quality = 0.85) {
  // 1. createImageBitmap() — honors EXIF orientation on modern iOS/Android
  // 2. Fallback: Image + canvas + manual EXIF rotation
  // 3. Draw to canvas at target dimensions (never upscale)
  // 4. canvas.toBlob('image/jpeg', quality)
  // Returns: Blob
}
```

**Flow change:**
```
before: uploadFile(file) → POST /api/ai/parse-recipe-image → save immediately → done
after:  uploadFile(file) → resize → POST /api/ai/parse-recipe-image → open RecipeReviewModal(extracted) → user saves → POST /api/recipes → done
```

`RecipeUpload` no longer calls `recipeService.create` or `onRecipeAdded` directly. After a successful extraction, it calls `onExtracted(recipe)` and the parent (`RecipesPage`) opens `RecipeReviewModal`.

**Duplicate submission guard:**
```js
const [uploading, setUploading] = useState(false);
const abortRef = useRef(null);

// Disable input while uploading
// Cancel on unmount: useEffect(() => () => abortRef.current?.abort(), [])
```

**Updated phases:** `'idle' | 'resizing' | 'uploading' | 'done' | 'error'`

---

### 2. `RecipeReviewModal.jsx` — NEW

A controlled form modal pre-filled with extracted data. User can edit all fields before saving.

**Props:**
```js
RecipeReviewModal({ recipe, onSave, onClose })
// recipe: extracted recipe object (not yet in DB)
// onSave(recipe): called with final data → parent calls POST /api/recipes
// onClose(): cancels without saving
```

**Fields shown (matching createSchema):**
- Name (text input, required)
- Description (textarea, optional)
- Ingredients (editable list: name, quantity, unit per row — add/remove rows)
- Steps (editable ordered list — add/remove/reorder)
- Servings, Prep Mins, Cook Mins (number inputs)
- Tags (multi-select chips or comma-separated input)
- Source: hardcoded to `'upload'` (not shown to user)

**UX:**
- Opens immediately after extraction succeeds
- Shows "AI extracted this — please review before saving" banner
- Save button calls `onSave(formState)` → parent calls `POST /api/recipes`
- Dismiss/close cancels without saving (no data lost in parent state)

---

### 3. `server/routes/ai.js` — Schema patches + error codes

**Fraction coercion transform** (added to `parsedRecipeSchema`):
```js
const fractionalQuantity = z.union([
  z.number(),
  z.string().transform((s) => {
    // Unicode fractions: ½ ⅓ ¼ ¾ ⅔ ¼ ⅛ etc.
    const unicodeMap = { '½':0.5, '⅓':0.333, '¼':0.25, '¾':0.75, '⅔':0.667, '⅛':0.125, '⅜':0.375, '⅝':0.625, '⅞':0.875 };
    if (unicodeMap[s.trim()]) return unicodeMap[s.trim()];
    // Mixed number: "1 1/2"
    const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    // Simple fraction: "1/2"
    const simple = s.match(/^(\d+)\/(\d+)$/);
    if (simple) return Number(simple[1]) / Number(simple[2]);
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
    // Anything else (e.g. "2 to 3", "about 2", "½–1", "1-1/2") → null consistently.
    // Never throw. Never produce NaN or partial values.
  }),
  z.null(),
  z.undefined(),
]).transform((v) => (typeof v === 'number' && isFinite(v) ? v : null));
```

**Tag whitelist** (drop unknown, don't reject):
```js
const TAG_ALLOWED = z.enum([
  'breakfast','lunch','dinner','snack','dessert','drink',
  'italian','mexican','asian','american','mediterranean','indian','french','thai','japanese','greek','chinese',
  'vegetarian','vegan','gluten-free','dairy-free','low-carb','keto','paleo',
  'quick','easy','slow-cooker','one-pot','meal-prep','freezer-friendly',
]);
tags: z.array(z.string()).default([]).transform(arr =>
  arr.map(t => t.toLowerCase().trim()).filter(t => TAG_ALLOWED.options.includes(t))
)
```

**Expanded HTTP error codes:**
```
400 — no file, or file rejected by multer (too large, wrong type)
413 — Content-Length > 10 MB (multer limit)
415 — unsupported MIME type
422 — Zod validation failed (unreadable recipe structure)
502 — aiService returned null (model failure / empty response)
504 — timeout (if future server-side timeout is added)
```

**Prompt addition (in aiService — READ ONLY, do not edit; note for future):**
The current prompt already says `"quantity": number|null`. The fraction coercion in Zod handles whatever the model returns. No prompt change needed for this task.

**Noise-suppression note (future):** Adding the following lines to the prompt improves accuracy on handwritten recipes but is OUT OF SCOPE for this task:
> Ignore stains, notebook lines, decorations, page numbers, cookbook headers, and footers.

---

## Dependency Chain

Editing:
- `client/src/components/recipes/RecipeUpload.jsx`
- `server/routes/ai.js` (schema only)

New:
- `client/src/components/recipes/RecipeReviewModal.jsx`

Reads (pattern reference only, do not modify):
- `server/services/aiService.js` — parseRecipeImage() signature
- `client/src/components/recipes/RecipeModal.jsx` — confirmed view-only; RecipeReviewModal is separate
- `server/utils/foodNormalization.js` — normalizeUnit available for use in RecipeReviewModal if needed

Irrelevant:
- `server/db/migrations/`
- `server/services/recipeService.js`
- `client/src/hooks/useSpeechInput.js`
- `server/data/foodkeeper.json`

---

## Rate Limiting

No rate limiting exists on any AI endpoint in this project. Adding one is out of scope for TASK-024 but noted as a follow-up. The existing household API-key check (403 for no key) provides a soft guard.

---

## Acceptance Criteria

- [ ] On iOS PWA, tapping the upload trigger opens the rear camera directly
- [ ] On Android Chrome, tapping the upload trigger opens the rear camera directly
- [ ] On desktop, file picker opens (capture attribute ignored — correct behavior)
- [ ] Image is resized to ≤ 1568px longest edge before upload (verify via Network tab: payload < raw file size)
- [ ] Canvas resize never upscales a small image
- [ ] EXIF-rotated photo (portrait taken on iOS) renders correctly in RecipeReviewModal
- [ ] Fraction quantities (`"1/2"`, `"1 1/2"`, `"¾"`) are converted to decimals (`0.5`, `1.5`, `0.75`)
- [ ] RecipeReviewModal opens after extraction; recipe is NOT saved yet at this point
- [ ] User can edit name, ingredients, steps, and all other fields before saving
- [ ] Clicking Save in RecipeReviewModal calls `POST /api/recipes` and recipe appears in list
- [ ] Closing RecipeReviewModal without saving does not create a recipe
- [ ] File input is disabled during upload (cannot trigger a second upload)
- [ ] Closing RecipeUpload modal while uploading aborts the in-flight request
- [ ] Tags outside the whitelist are silently dropped, not rejected
- [ ] HEIC files (iOS camera) are accepted (browser delivers as JPEG to web layer; verify on device)
- [ ] Files > 10 MB return 400 with a user-readable error toast
- [ ] Unsupported MIME types return 415

---

## Known Risks / Implementation Notes

1. **`createImageBitmap` EXIF support**: Honors EXIF in Chrome 84+ and Safari 15+. Older iOS (< 15) requires the manual EXIF-read + canvas-rotate fallback (~30 lines). The implementer should use `createImageBitmap` as the primary path and fall back when it's absent or returns an unrotated result.

2. **HEIC from clipboard or share sheet**: `accept="image/*"` with `<input type="file">` on iOS Safari converts HEIC → JPEG before JS sees it. However, files arriving via drag-and-drop, clipboard paste, or share sheet extensions may carry raw `image/heic` MIME. Detect and reject with a user-friendly message ("Please take a new photo or select a JPEG/PNG").

3. **`capture="environment"` on iOS PWA**: Respected in mobile Safari; standalone PWA behavior varies by iOS version. File-picker fallback is acceptable if camera doesn't open directly — do not block on this.

4. **`parse-recipe-image` response shape is a breaking change**: Route currently returns `{ recipe: savedDbRecord }`. After this task it returns `{ recipe: extractedJson }` (no `id`, no `imageUrl`). `RecipeUpload.jsx` is the only caller (confirmed by grep). Both files must be updated atomically in the same commit.

5. **Tag whitelist completeness**: Verify the proposed whitelist against existing tag values in the DB (`SELECT DISTINCT tags FROM recipes`) before implementing. Add any missing common tags; do not silently drop values that already exist in production.

6. **`RecipeReviewModal` ingredient UX**: Keep it simple — inline text inputs per row, plus "Add ingredient" and "Remove" (×) buttons. No drag-to-reorder in v1.

---

## Out of Scope (v1)

- `imageUrl` on saved recipe — Vercel Blob upload removed from parse route; image storage is a follow-up task
- Migrating `parseRecipeImage()` from OpenAI to Claude / household AI config
- Noise-suppression prompt additions (`"ignore stains, notebook lines..."`)
- Server-side rate limiting on AI endpoints
- PDF recipe import
- Batch photo upload
- Crop/rotate UI before extraction
