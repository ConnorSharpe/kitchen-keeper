# TASK-025 — Image Storage for Uploaded Recipes (Vercel Blob at Save Time)

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 1)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.3/10 — approved with required revisions | Base64-vs-multipart decision endorsed as-is. Two required fixes: (1) upload orchestration was split between route and service — moved entirely into `recipeService.create()`; (2) accepted-orphaned-blob risk was too lax — added `del()` rollback on DB failure. Plus: non-empty-buffer check after base64 decode, explicit no-retry failure semantics, householdId-namespaced Blob paths, thumbnail preview cut to a follow-up, one added acceptance criterion (concurrent saves). |
| DRAFT-2 | APPROVED FOR IMPLEMENTATION | Both required fixes applied and verified against the codebase (`create()` now the sole owner of upload/insert/rollback; route is a one-line passthrough). All other feedback incorporated except full cross-runtime constants centralization, which was declined with reasoning recorded in Known Risks #4. No open questions remain. |

---

## Codebase Reality Check

This is a direct follow-up to TASK-024, which deliberately shipped `imageUrl: null` for photo-uploaded recipes. TASK-024's spec recorded the decision explicitly:

> **Blob upload timing — Decision: Option B — upload at save time.** ... Image storage for uploaded recipes is a follow-up task (Vercel Blob upload at save time via a separate endpoint or as multipart to recipes.js).

That follow-up is this task.

| What exists | File | Notes |
|---|---|---|
| DB column | `server/db/schema.js:56` | `imageUrl: text('image_url')` — comment already says "full Vercel Blob URL for uploaded images". **No migration needed.** |
| Blob delete-on-remove | `server/services/recipeService.js:80-84` | `remove()` already calls `del(existing.imageUrl)` when `imageUrl.startsWith('http')`. **Cleanup lifecycle already exists** — it's just never been fed a real URL. |
| Blob delete import | `server/services/recipeService.js:1` | `import { del } from '@vercel/blob'` — `put` is not currently imported anywhere in the codebase (removed from `ai.js` in TASK-024). |
| Display | `client/src/components/recipes/RecipeModal.jsx:41-43` | Already renders `recipe.imageUrl` in an `<img>` if present. **No display-layer changes needed.** |
| Resize | `client/src/components/recipes/RecipeUpload.jsx:48-97` | `resizeImage()` already produces a `Blob` (`image/jpeg`, ≤1568px, quality 0.85) — but it's local to `uploadFile()` and discarded after the parse-image POST. |
| Save endpoint | `server/routes/recipes.js:46-49` | `POST /api/recipes` — JSON only, validated by `createSchema` (Zod), calls `recipeService.create()`. Also used by `handleSaveWebSuggestion` (no image) — **must not break that caller**. |
| Client API helper | `client/src/api/index.js` | `request()` always JSON-encodes the body. No multipart/FormData support exists today. |
| Multer middleware | `server/middleware/upload.js` | Generic, memory-storage, MIME allowlist (jpeg/png/webp/heic/heif), 10MB limit. Currently only used by `ai.js`. Not required for the recommended approach (see below) but available if the architect prefers multipart. |
| Prior art | `git show 0c56b07 -- server/routes/ai.js` | Pre-TASK-024 code did exactly this upload (`path.extname` + `uuidv4()` + `put(..., {access:'public'})`) inline in the parse route, before it saved immediately. Useful as a reference for the `put()` call shape, not to be reused verbatim (that code uploaded *before* user review, which is the exact problem this task avoids). |

**Platform constraint (confirmed via Vercel docs, 2026):** this app deploys through `api/index.js` as a Vercel serverless function. Vercel enforces a **4.5MB request body limit on serverless functions**, independent of `express.json({ limit: '10mb' })` in `server/app.js:51`. This caps how much image data can pass through the server in one request, in production, regardless of which technique is chosen.

---

## Goal

When a user saves a photo-uploaded recipe via `RecipeReviewModal`, the image they captured/selected should be persisted to Vercel Blob and `imageUrl` should be set on the saved recipe — **only if they actually click Save**. Canceling the review discards the image with no server-side trace (no orphaned blobs), preserving the exact property TASK-024 was designed around.

---

## Decision: Base64-in-JSON, not Multipart

**Recommendation: reuse the existing JSON + Zod + `api.post()` pipeline. Encode the already-resized image as a base64 data URL and add one optional field to `createSchema`.**

### Why not multipart
Multipart is the more "obvious" technique (it's what `RecipeUpload.jsx` already uses to send the image for parsing) and avoids ~33% base64 size inflation. But it requires:
- A new `api.postForm()` method in `client/src/api/index.js` (FormData, no `Content-Type` header).
- Wiring `upload.single('image')` onto `POST /api/recipes`, which today is JSON-only and shared with `handleSaveWebSuggestion` (no image, no multer).
- A JSON-envelope-in-form-field trick (`formData.append('data', JSON.stringify(payload))`) because multer flattens other fields to strings, breaking nested arrays (`ingredients`, `steps`, `tags`) that Zod expects as real arrays.
- New middleware ordering to re-parse that envelope before `validate(createSchema)` can run.

That's real surface area for a marginal bandwidth saving that doesn't matter here: resize already caps output to ≤1568px JPEG@85%, so real files run well under 1MB. Base64 inflation on a ~800KB image is ~270KB — irrelevant next to the 4.5MB ceiling.

### Why base64-in-JSON is simpler and more robust here
- **Zero changes to `client/src/api/index.js`** — `api.post('/api/recipes', payload)` already works.
- **Zero new server middleware** — no multer on this route, no envelope-parsing step.
- `validate(createSchema)` continues to be the single source of truth for shape validation on this route, unchanged in structure.
- Matches existing precedent: `server/routes/ai.js` already base64-encodes images (`req.file.buffer.toString('base64')`) for the OpenAI call — this isn't a novel pattern for this codebase.
- Rejected the Vercel "client direct upload" pattern (`handleUpload` + short-lived token) as over-engineering: that pattern exists to bypass the 4.5MB body limit for large files, but this app's resize step already guarantees small files. Adding a token-minting endpoint and client SDK usage for a single-household recipe app is unjustified complexity.

**Numbers:** cap raw (pre-base64) image size at **3MB**. Base64 inflates that to ~4MB, plus a few KB of recipe JSON — comfortably under the 4.5MB Vercel ceiling with ~500KB headroom. Enforced both client-side (fail fast, no wasted upload) and server-side (defense in depth — do not trust the client check alone).

---

## What Does NOT Change

- `POST /api/ai/parse-recipe-image` route in `server/routes/ai.js` — stays exactly as TASK-024 left it (returns `{ recipe: extractedJson }`, no save, no Blob upload).
- `RecipeModal.jsx` — already renders `imageUrl`, no edits needed.
- `client/src/api/index.js` — no new methods; `api.post` is reused as-is.
- `server/middleware/upload.js` — untouched; still used only by `ai.js`.
- `recipeService.remove()` — the existing blob-delete-on-remove logic is untouched and now actually gets exercised.
- `handleSaveWebSuggestion` (web-suggested recipes, no image) — sends the same JSON shape it always has; `imageBase64` is optional and simply absent.

---

## Allowed Files

- `client/src/components/recipes/RecipeUpload.jsx` — retain the resized `Blob` instead of discarding it; pass it up via `onExtracted`.
- `client/src/pages/RecipesPage.jsx` — hold the image `Blob` in state alongside `reviewRecipe`; convert to base64 and include in the save payload; clear on save/cancel.
- `server/routes/recipes.js` — add `imageBase64` to `createSchema` (create only, not update). No handler logic changes — see Decision below.
- `server/services/recipeService.js` — `create()` owns the full upload → insert → rollback lifecycle; add a private `uploadImage(dataUrl, householdId)` helper co-located with the existing `del()` import.

## Forbidden Files

- `server/routes/ai.js` — parse route is finished, do not touch.
- `server/services/aiService.js` — extraction logic, unrelated.
- `client/src/components/recipes/RecipeModal.jsx` — view-only, already handles `imageUrl`, no changes needed.
- `server/db/migrations/` — no schema change; `image_url` column already exists.
- `client/src/hooks/useSpeechInput.js` — unrelated.

---

## Constraints

1. **No blob upload without user confirmation.** The image is only base64-encoded and sent when the user clicks Save in `RecipeReviewModal` — never during `parse-recipe-image`, never on cancel. This is the entire point of "at save time."

2. **Reuse the exact resized Blob, not a re-read of the original file.** `RecipeUpload.jsx` already produces a HEIC-safe, EXIF-corrected, size-capped `image/jpeg` Blob for the AI parse call. That same Blob object must be threaded through to save — do not re-resize or re-fetch from the file input. This guarantees the stored image matches what the AI actually saw and avoids re-running HEIC/EXIF logic a second time.

3. **Size cap: 3MB raw, enforced on both sides.**
   - Client (`RecipesPage.jsx`, before encoding): if `reviewImage.size > 3 * 1024 * 1024`, skip the image, show a toast ("Photo too large to save — recipe saved without it"), and save the recipe anyway. **Never block the recipe save over an image problem** — the recipe data is more valuable than the photo.
   - Server (`recipeService.uploadImage`): re-check decoded buffer length against the same 3MB cap and throw a 413 if exceeded (defense in depth against a modified client). This should be effectively unreachable given resize + client-side check, but must not be trusted away.

4. **`imageBase64` must not leak into `updateSchema` / PATCH.** `recipes.js`'s `updateSchema` is currently `createSchema.partial()`. If `imageBase64` is added directly to `createSchema`, it will flow into `updateSchema` too, and `recipeService.update()` would attempt to write a non-existent `image_base64` column via Drizzle, causing a runtime DB error on `PATCH /api/recipes/:id`. Fix: derive `updateSchema` as `createSchema.omit({ imageBase64: true }).partial()`. Replacing an existing recipe's photo is explicitly out of scope for this task (see below).

5. **Data URL format is trusted only from the client's own resize output.** Validate `imageBase64` server-side with a regex anchored to `data:image/(jpeg|png|webp);base64,` — reject anything else with 400. `Buffer.from(str, 'base64')` does not throw on malformed base64; it silently drops invalid characters, which can produce a truncated or empty buffer from garbage input. After decoding, reject a zero-length buffer with 400. Full image-format validation (e.g. actually decoding as JPEG) is out of scope — the regex + size cap + non-empty check is sufficient given this field only ever originates from the client's own `canvas.toBlob()` output, never from an untrusted multipart path.

6. **Upload failures abort recipe creation cleanly — no retry.** If `put()` throws or rejects (network error, Blob service failure), the error propagates via `express-async-errors` to the global error handler exactly like any other thrown error in this codebase. The recipe is not created. The client sees a toast error and the user can just click Save again. No client- or server-side retry loop, no timeout wrapper — `put()` calls are to Vercel's own infrastructure and are not expected to hang the way an external AI API call might (contrast with the `Promise.race` timeout TASK-024 added around `aiService.parseRecipeImage()` — not needed here).

7. **Blob storage and Postgres are two separate systems with no shared transaction.** A successful `put()` followed by a failed `db.insert()` is handled by an explicit compensating action (see `uploadImage`/`create` design below) — not a true transaction, just a best-effort rollback. If the rollback `del()` itself fails (rare), the failure is logged and swallowed; the original DB error is still what propagates to the client. This mirrors the existing fire-and-forget `del()` pattern already in `recipeService.remove()`.

---

## Changes in Detail

### 1. `RecipeUpload.jsx` — retain the resized Blob

```js
// after successful parse:
onExtracted(data.recipe, resized); // resized is the existing Blob from resizeImage()
```
No other changes to this file — resize/HEIC/EXIF/abort logic is untouched.

### 2. `RecipesPage.jsx` — hold image state, encode at save time

```js
const [reviewImage, setReviewImage] = useState(null); // Blob | null

function handleExtracted(recipe, imageBlob) {
  setShowUpload(false);
  setReviewRecipe(recipe);
  setReviewImage(imageBlob ?? null);
}

async function handleReviewSave(recipe) {
  try {
    let payload = recipe;
    if (reviewImage) {
      if (reviewImage.size > 3 * 1024 * 1024) {
        console.warn(`[RecipesPage] Skipping oversized image (${reviewImage.size} bytes) on save`);
        toast.error('Photo too large to save — recipe saved without it');
      } else {
        const imageBase64 = await blobToDataUrl(reviewImage);
        payload = { ...recipe, imageBase64 };
      }
    }
    await api.post('/api/recipes', payload);
    setReviewRecipe(null);
    setReviewImage(null);
    refresh();
    toast.success(`"${recipe.name}" saved to your recipes!`);
  } catch (err) {
    toast.error(err.message || 'Failed to save recipe');
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```
Also clear `reviewImage` on review-modal cancel (wherever `reviewRecipe` is currently reset to `null` on close).

### 3. `server/routes/recipes.js` — schema only; route stays a thin HTTP adapter

Per architect feedback, the route must not orchestrate storage — that split weakens encapsulation. The route's only job is schema validation and delegating to the service; `imageBase64` handling is entirely invisible to it.

```js
const createSchema = z.object({
  // ...existing fields unchanged...
  imageBase64: z.string()
    .regex(/^data:image\/(jpeg|png|webp);base64,/)
    .optional(),
});

const updateSchema = createSchema.omit({ imageBase64: true }).partial();

// POST /api/recipes — UNCHANGED from current code. imageBase64 rides through
// req.body like any other field; recipeService.create() interprets it.
router.post('/', validate(createSchema), async (req, res) => {
  const recipe = await recipeService.create(req.user.householdId, req.body);
  res.status(201).json({ recipe });
});
```

### 4. `server/services/recipeService.js` — `create()` owns upload, insert, and rollback

`uploadImage()` stays a small, focused helper (decode + validate + `put()`). `create()` is the only caller and owns the full lifecycle: upload, then insert, and if insert fails, roll back the blob.

```js
import { put, del } from '@vercel/blob';
import { randomUUID } from 'crypto';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB raw — keeps base64+JSON body under Vercel's 4.5MB function limit
const DATA_URL_RE = /^data:(image\/(jpeg|png|webp));base64,(.+)$/;

// Decodes a data-URL image and uploads it to Vercel Blob. Returns the public URL.
// Path is namespaced by household for easier ops-side cleanup/browsing later.
async function uploadImage(dataUrl, householdId) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    const err = new Error('Invalid image data');
    err.status = 400;
    throw err;
  }
  const [, mimetype, subtype, data] = match;
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) {
    const err = new Error('Invalid image data');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    console.warn(`[recipeService] Image over size cap rejected (household ${householdId}, ${buffer.length} bytes)`);
    const err = new Error('Image too large');
    err.status = 413;
    throw err;
  }
  const ext = subtype === 'jpeg' ? 'jpg' : subtype;
  const { url } = await put(`recipes/${householdId}/${randomUUID()}.${ext}`, buffer, {
    access: 'public',
    contentType: mimetype,
  });
  return url;
}

export async function create(householdId, data) {
  const { imageBase64, ...rest } = data;

  let imageUrl = rest.imageUrl ?? null;
  if (imageBase64) {
    imageUrl = await uploadImage(imageBase64, householdId);
  }

  try {
    const [row] = await db
      .insert(recipes)
      .values({ ...serialize({ ...rest, imageUrl }), householdId })
      .returning();
    return parse(row);
  } catch (err) {
    if (imageBase64) {
      // Best-effort compensating action — Blob and Postgres are not transactional.
      // Failure here is logged, not retried; the original DB error still propagates.
      del(imageUrl).catch((e) =>
        console.error('[recipeService] Blob rollback failed:', e.message)
      );
    }
    throw err;
  }
}
```

This keeps `imageBase64` handling entirely inside the service. The route never sees it, never injects `imageUrl`, and needs zero changes to its handler body beyond the schema. `createOrIgnore()` (used only by the chat-assistant's `save_recipe` tool, which never has a client-side image) and `update()` are intentionally untouched — `imageBase64` never reaches either.

---

## Dependency Chain

Editing:
- `client/src/components/recipes/RecipeUpload.jsx`
- `client/src/pages/RecipesPage.jsx`
- `server/routes/recipes.js`
- `server/services/recipeService.js`

Reads (pattern reference only, do not modify):
- `server/db/schema.js` — confirm `image_url` column shape
- `server/routes/ai.js` — confirm parse route contract is unaffected
- `git show 0c56b07 -- server/routes/ai.js` — pre-TASK-024 `put()` call shape

Irrelevant:
- `server/services/aiService.js`
- `client/src/components/recipes/RecipeModal.jsx`
- `client/src/components/recipes/RecipeReviewModal.jsx` — no changes this round; preview thumbnail is a follow-up
- `server/db/migrations/`
- `server/middleware/upload.js`

---

## Acceptance Criteria

- [ ] Uploading a recipe photo, reviewing it, and clicking Save results in a recipe with a working `imageUrl` (loads in `RecipeModal`)
- [ ] Canceling `RecipeReviewModal` after a photo upload does NOT create a Vercel Blob (verify: no `put()` call happens until Save is clicked)
- [ ] Saving a web-suggested recipe (`handleSaveWebSuggestion`, no image) still works unchanged — regression check
- [ ] Deleting a photo-uploaded recipe deletes its Blob (exercises existing `recipeService.remove()` logic with a real URL for the first time)
- [ ] An image over 3MB (post-resize, unlikely but possible on a very detailed photo) saves the recipe successfully with `imageUrl: null` and shows a toast, rather than failing the whole save
- [ ] `PATCH /api/recipes/:id` with no `imageBase64` field continues to work exactly as before (regression check on the `updateSchema.omit()` change)
- [ ] Malformed `imageBase64` (wrong prefix, garbage data) returns 400, not a 500
- [ ] Saved recipe's `imageUrl` is a real `https://` Vercel Blob URL, publicly loadable
- [ ] Saving two photo-uploaded recipes back-to-back (or from two tabs) produces two distinct Blob URLs, each correctly associated with its own recipe — no collision from `randomUUID()`-based naming
- [ ] If the DB insert is made to fail after a successful upload (e.g. temporarily break a NOT NULL constraint or similar in a local test), the Blob is deleted by the rollback and the client still sees the original error, not a rollback-related one

---

## Known Risks / Implementation Notes

1. **Blob rollback is best-effort, not a guarantee.** If `create()`'s `db.insert()` fails after a successful `uploadImage()`, the code attempts `del(imageUrl)` to clean up. If that `del()` call *also* fails (rare — e.g. a transient Blob-service outage right after a DB outage), the blob is orphaned and only a `console.error` marks it. This residual case is accepted; a fully-guaranteed cleanup would need a background reconciliation job, which is unjustified complexity at this app's scale (single household, near-zero write volume).
2. **3MB cap is a client-resize-dependent assumption.** If TASK-024's resize logic ever changes (larger `maxPx` or higher quality in `RecipeUpload.jsx`), this cap should be revisited. Not a risk today since resize constants are untouched by this task and live in a different file than the byte cap — see the constants note below.
3. **`FileReader.readAsDataURL` is async and blocks Save button interaction briefly** for large-ish images (typically <100ms for sub-1MB files) — no loading state needed given the size, but worth noting if UX feels off during testing.
4. **Constants are not centralized across the client/server boundary.** `RecipeUpload.jsx`'s resize target (`maxPx = 1568`, `quality = 0.85`) and `recipeService.js`'s `MAX_IMAGE_BYTES = 3 * 1024 * 1024` are related but live in separate runtimes (browser bundle vs. Node) with no existing shared-constants module in this project. Introducing one for two numeric values was considered and declined as scope creep for this task — the byte cap alone is named and commented in both `RecipesPage.jsx` and `recipeService.js` (with a comment cross-referencing the other), which is sufficient for a two-file app of this size. Revisit if a shared `common/` package is ever introduced for other reasons.

---

## Out of Scope (v1)

- Replacing/updating the photo on an already-saved recipe (PATCH image support) — explicitly excluded via `updateSchema.omit({ imageBase64: true })`
- Multipart/FormData upload path — base64 chosen instead (see Decision section); revisit only if real-world image sizes turn out to exceed the 3MB assumption
- Vercel client-direct-upload (`handleUpload` token pattern) — unjustified complexity at this app's scale
- Any change to `parse-recipe-image` or `aiService`
- Image compression/format negotiation beyond what TASK-024's resize already does
- **Thumbnail preview of the captured photo in `RecipeReviewModal`** — cut from this spec per architect feedback (a persistence task should have one purpose). Cheap to add later: the image `Blob` is already held in `RecipesPage` state by this task's design, so a follow-up just needs to thread it into `RecipeReviewModal` as a prop and render it via `URL.createObjectURL` with cleanup on unmount.
