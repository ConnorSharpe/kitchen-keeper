# Task
TASK-008: Fix suggestRecipes for No-Expiry Pantry Items (SPEC APPROVED — ready to implement)

# Current Status
TASK-008 SPEC APPROVED (DRAFT-2). Implementation-ready. No migration required.
See `ai/tasks/TASK-008.md` for full spec.

TASK-007 COMPLETE. All 6 changes implemented. Build passes (348 modules, no errors).
Migration `0003_onboarding_complete.sql` ready — must be run in Neon SQL Editor before deploying.

# What TASK-005 Shipped (complete — archived to ai/tasks/archive/TASK-005.md)
- client/src/utils/openFoodFacts.js: NEW — fetchProductByBarcode(), mapProduct(), mapCategory()
- client/src/components/pantry/BarcodeScanner.jsx: NEW — camera overlay, EAN-13/UPC-A only,
  stoppedRef double-stop guard, onDetected/onClose/onError callbacks
- client/src/components/pantry/AddItemModal.jsx: additive prefill prop, buildInitialState(item, prefill)
- client/src/pages/PantryPage.jsx: lazy BarcodeScanner import, showBarcodeScanner + barcodePrefill
  state, fetchAbortRef, handleBarcodeDetected, handleScannerError, "Scan barcode" button,
  Suspense wrapper, updated AddItemModal render (prefill + onClose clears barcodePrefill)
- client package: html5-qrcode installed

# Architecture Notes
- BarcodeScanner lazy-loaded (React.lazy) — emits separate 335 KB chunk, not in initial bundle
- aiService.js / all server files: untouched (pure client change)
- fetchAbortRef aborts in-flight OFF fetch on page unmount; AbortError caught silently
- modalItem sentinel contract preserved: undefined=closed, null=add, object=edit
- barcodePrefill cleared on every modal close — no stale prefill on subsequent "+ Add item" taps
- mapCategory default: "Pantry" (known product, no tag match); unknown barcode → prefill=null → "Other"

# TASK-005 Smoke Test Checklist
Requires camera + HTTPS (Vercel preview deploy or ngrok for mobile).

- [ ] "Scan barcode" button visible on PantryPage
- [ ] Clicking button lazy-loads BarcodeScanner chunk (DevTools Network tab)
- [ ] Scan EAN-13 barcode → scanner closes → OFF fetch visible → AddItemModal pre-filled
- [ ] "+ Add item" → modal opens with blank name, category "Other" (no prefill contamination)
- [ ] "Scan receipt" → ReceiptUpload unaffected
- [ ] Edit existing item → modal opens in edit mode (prefill=undefined, ignored)
- [ ] Camera denied → toast "Camera access denied…" → no modal opens
- [ ] Unknown barcode → toast "Product not found…" → modal opens blank (category "Other")
- [ ] Network error → toast "Could not look up product…" → modal opens blank

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- JOIN_CODE_CONSTRAINT constant uses Drizzle-derived name — confirm against live DB if
  uniqueness retry error surfaces

# Verification Results
- TASK-007: `npm run build` → ✓ 348 modules, no errors, BarcodeScanner lazy chunk preserved
- Smoke test: pending (requires migration run in Neon + Vercel preview deploy)

# Files Modified (TASK-007)
- `server/db/migrations/0003_onboarding_complete.sql` — NEW (must run in Neon SQL Editor)
- `server/db/schema.js` — `onboardingComplete` boolean column added to `usersTable`
- `server/routes/auth.js` — `safeUser` includes `onboardingComplete`; registration INSERT sets `false`; `/me` made DB-backed; `POST /auth/onboarding-complete` added
- `client/src/context/AuthContext.jsx` — `completeOnboarding()` added; exposed on Provider
- `client/src/components/onboarding/StaplesChecklist.jsx` — NEW; chip-toggle UI, handleAdd/handleSkip, error state machine, Dismiss for now
- `client/src/pages/PantryPage.jsx` — `useAuth` import; `onboardingDismissed` state + useEffect reset; `isEligible`/`showOnboarding` derivations; `handleOnboardingComplete`/`handleOnboardingDismiss`; `<StaplesChecklist>` mounted; `loading` renamed to `pantryLoading`

# Recommended Next Action
1. Implement TASK-008 per `ai/tasks/TASK-008.md` — 2 files, ~15 lines, no migration.
   - `server/routes/ai.js`: pass `allItems` as first arg to `suggestRecipes()`
   - `server/services/aiService.js`: new signature, defensive guard, `itemsData` shape, prompt text
2. Run TASK-007 migration in Neon SQL Editor (copy from `server/db/migrations/0003_onboarding_complete.sql`) if not yet done.
3. Deploy to Vercel preview and smoke test both TASK-007 and TASK-008.

# Forbidden Exploration
- server/middleware/auth.js (identity-only, unchanged)
- server/routes/pantry.js (bulk endpoint unchanged)
- server/routes/household.js (unrelated)
- client/src/components/pantry/* (unchanged)

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- Completed tasks archived to: ai/tasks/archive/

# Future Specs (priority order)

## TASK-005 — Barcode Scanner + Open Food Facts (COMPLETE — archived)

## TASK-006 — readyDate / Ripening State (SPEC APPROVED — ready to implement)
Adds a "not yet ready" state for items that need time before use. Single nullable
column `ready_date` on `pantry_items`. Purple row tint + "Ready in Xd" status label.
Requires schema migration (manual Neon SQL). 5 files edited, 1 migration created.
Approved after 3 architect review rounds. See ai/tasks/TASK-006.md for full spec.

## TASK-006 — readyDate / Ripening State
Adds a "not yet ready" state for items that need time. Requires schema migration.

## TASK-007 — Staples Checklist (First-Login Onboarding)
SPEC APPROVED (DRAFT-9) — implementation-ready. One-time screen after registration for
common pantry staples. 9 architect review rounds. See ai/tasks/TASK-007.md.

## TASK-008 — Fix suggestRecipes for No-Expiry Pantry Items
SPEC APPROVED (DRAFT-2) — implementation-ready. Pass all pantry items to AI, not just
expiring ones. 2 files, ~15 lines, no migration. See ai/tasks/TASK-008.md.

## TASK-009 — PWA Push Notifications
Largest scope task. Depends on TASK-006 for full value.

## TASK-010 — Gemini Substitution Suggestions in Recipe Flow
Extend expandSuggestion() to include missing ingredients + substitutes.

# PowerShell Merge Block
N/A — working directly on main.
