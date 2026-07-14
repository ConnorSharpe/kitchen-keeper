# TASK-024 Smoke Tests
## Recipe Photo Upload: Camera Trigger + Review Step

---

## Prerequisites

- App running locally or deployed (iOS PWA or desktop browser)
- At least one recipe photo available (JPEG preferred; also test HEIC from share sheet)

---

## S1 — File Picker (Desktop / Android)

**Steps:**
1. Open Recipes page
2. Click/tap the upload area
3. Select a JPEG recipe photo from the file system

**Expected:**
- Upload spinner appears
- `RecipeReviewModal` opens with extracted name, ingredients, steps, tags, prep/cook times
- Fields are editable
- No recipe is saved yet

---

## S2 — Camera Trigger (iOS PWA / Mobile)

**Steps:**
1. Open app in iOS Safari, add to Home Screen (PWA)
2. Navigate to Recipes page
3. Tap the upload area → expect OS camera chooser or camera opens directly

**Expected:**
- `capture="environment"` attribute causes camera to be offered as the primary option
- After taking photo, extraction runs and `RecipeReviewModal` appears
- Portrait photo renders upright (EXIF rotation applied)

---

## S3 — Review Modal Editing

**Steps:**
1. Complete S1 or S2 so `RecipeReviewModal` is open
2. Edit the recipe name
3. Change an ingredient quantity (use a fraction like `1/2` if model didn't)
4. Add a step; remove a step
5. Toggle a tag

**Expected:**
- All fields update in real time
- Fraction quantities display as decimals (e.g., `0.5`) after extraction — model output fractions should have been coerced by server Zod schema

---

## S4 — Save from Review Modal

**Steps:**
1. Complete S3
2. Click Save (or equivalent confirm button)

**Expected:**
- Modal closes
- New recipe appears in the recipe list immediately
- Recipe `source` is `upload`
- No duplicate recipe created on double-click (button disabled during POST)

---

## S5 — Cancel from Review Modal

**Steps:**
1. Complete S1 or S2 so `RecipeReviewModal` is open
2. Close/dismiss the modal without saving

**Expected:**
- Modal closes
- No recipe is created
- Upload area resets and is ready for another upload

---

## S6 — HEIC from Share Sheet (iOS)

**Steps:**
1. On iOS, share a HEIC photo to the app via the iOS share sheet

**Expected:**
- User sees an error message indicating HEIC is not supported (not a blank crash)
- No extraction is attempted
- Upload area remains functional for a subsequent attempt

---

## S7 — HEIC from File Picker (browser-converted)

**Steps:**
1. On a Mac or iOS device where the browser converts HEIC → JPEG automatically, select a HEIC file via the file picker

**Expected:**
- File passes through as JPEG
- Extraction succeeds
- `RecipeReviewModal` opens normally

---

## S8 — Request Timeout / Slow Network

**Steps:**
1. Throttle network to simulate a slow connection (DevTools → Network → Slow 3G)
2. Upload a photo

**Expected:**
- Spinner visible during extraction (up to ~40s)
- If extraction times out, a clear error message is shown (not a silent hang)
- Upload area resets and is ready for retry

---

## S9 — Abort on Modal Close During Upload

**Steps:**
1. Start an upload (photo selected)
2. While spinner is active, close the upload modal/area

**Expected:**
- In-flight request is cancelled (AbortController)
- No `RecipeReviewModal` appears after close
- No error in console from a resolved promise on an unmounted component

---

## S10 — Image Resize (Large Photo)

**Steps:**
1. Upload a raw camera photo (e.g., 12MP iPhone photo, ~4000px wide)
2. Monitor network tab for the POST payload size

**Expected:**
- Payload is significantly smaller than the raw file
- Longest edge ≤ 1568px
- Image is JPEG (not PNG/HEIC)
- Extraction still succeeds

---

## S11 — Invalid File Type

**Steps:**
1. Attempt to upload a PDF or `.txt` file via the file picker

**Expected:**
- File is rejected client-side (accept filter) or server returns 415
- Clear error message shown to user
- No crash

---

## S12 — Existing Recipes Unaffected

**Steps:**
1. After completing any save test above, open an existing (pre-TASK-024) recipe
2. Open a recipe added manually (not via upload)

**Expected:**
- `RecipeModal` opens normally in view mode
- No regressions in favorite, delete, or display behavior

---

## Results

| Test | Status | Notes |
|------|--------|-------|
| S1 File Picker | ✅ Pass | |
| S2 iOS PWA Camera | ✅ Pass | Camera opened directly from Home Screen PWA, photo upright, review modal appeared, corrections possible |
| S3 Review Modal Editing | ✅ Pass | All fields editable in real time |
| S4 Save | ✅ Pass | Bug found and fixed: missing `/api` prefix on POST |
| S5 Cancel | ✅ Pass | No ghost recipe created |
| S6 HEIC Share Sheet | ⚪ N/A (iOS) | iOS Safari does not support Web Share Target API for PWAs (Android Chrome only); manifest.json has no `share_target`. Kitchen Keeper never appears in iOS share sheet, so this test cannot execute on iOS. Test case premise was incorrect for this platform. |
| S7 HEIC File Picker | ⚪ Blocked (iOS) | `capture="environment"` on the file input (RecipeUpload.jsx:229) forces iOS straight to the camera with no Photo Library/Browse option, so an existing HEIC photo can't be selected to test conversion. Same finding blocks general "upload an existing photo" on iOS PWA. Logged as backlog — see CURRENT_STATE.md. |
| S8 Slow Network | ✅ Pass | Succeeded on Slow 3G with visible spinner |
| S9 Abort | ✅ Pass | No review modal, no console errors |
| S10 Image Resize | ✅ Pass | Large camera photo uploaded and extracted successfully |
| S11 Invalid File | ✅ Pass | OS-level file picker restricts to images |
| S12 Regression | ✅ Pass | Existing recipes unaffected |

## Bug Fixed During Testing

**S4 — 405 on Save Recipe**
- Root cause: `RecipesPage.jsx` line 157 had `api.post('/recipes', recipe)` — missing `/api` prefix. `/recipes` is a React Router route, not a server endpoint.
- Fix: changed to `api.post('/api/recipes', recipe)`
- Commit: `fix: correct missing /api prefix on review-save POST`

## Pass Criteria

All S1–S12 pass with no console errors and no unintended recipe writes.

**Remaining for iOS device:**
1. S2 (iOS PWA camera — highest risk, hardware-gated)
2. S6 (HEIC share-sheet rejection)
3. S7 (HEIC file picker, browser-converted)
