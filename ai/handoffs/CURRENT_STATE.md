# Task
TASK-006: readyDate / Ripening State

# Current Status
TASK-006 COMPLETE. All 6 changes implemented. Build passes (347 modules, no errors).
Migration `0002_ready_date.sql` confirmed run in Neon — `ready_date text` column live on pantry_items.

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
- TASK-005: `npm run build` → ✓ 347 modules, no errors, BarcodeScanner lazy chunk confirmed
- Smoke test: pending (camera/HTTPS required)

# Files Modified (TASK-006)
- `server/db/migrations/0002_ready_date.sql` — NEW (run in Neon SQL Editor)
- `server/db/schema.js` — readyDate column added after expiryDate
- `server/routes/pantry.js` — readyDate: dateField added to createSchema (updateSchema derives it)
- `client/src/utils/expiry.js` — getRipeningDays, isRipening, getRipeningState added; ripening cases added to row/badge class switches
- `client/src/components/pantry/AddItemModal.jsx` — readyDate in buildInitialState, handleSubmit, and form UI
- `client/src/components/pantry/PantryTable.jsx` — ExpiryBadge decoupled (status prop); StatusLabel updated; row render uses getRipeningState

# Recommended Next Action
1. ~~Run in Neon SQL Editor~~ DONE
2. Commit and push to main (see PowerShell Merge Block below)
3. Deploy to Vercel preview
4. Manual smoke test per TASK-006 verification steps

# Forbidden Exploration
- server/db/* (no schema changes)
- server/routes/auth.js (unrelated)
- server/routes/household.js (unrelated)
- All client pages except those in scope for active task

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
Low-effort: pass all pantry items to AI, not just expiring ones.

## TASK-009 — PWA Push Notifications
Largest scope task. Depends on TASK-006 for full value.

## TASK-010 — Gemini Substitution Suggestions in Recipe Flow
Extend expandSuggestion() to include missing ingredients + substitutes.

# PowerShell Merge Block
N/A — working directly on main.
