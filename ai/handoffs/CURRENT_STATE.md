# Task
TASK-010 COMPLETE. Next: TASK-009 (PWA Push Notifications).

# Current Status
TASK-010 COMPLETE (2026-06-04). `expandSuggestion()` extended with substitute field; RecipeModal renders amber inline annotation.
TASK-008 COMPLETE (2026-06-04). Archived to `ai/tasks/archive/TASK-008.md`.
TASK-007 COMPLETE. Migration `0003_onboarding_complete.sql` must be run in Neon SQL Editor before deploying.
TASK-006 COMPLETE. Archived.
TASK-005 COMPLETE. Archived.

# Files Modified (TASK-010)
- `server/services/aiService.js` — extended `expandSuggestion()` prompt with substitute instructions + `substitute` field in JSON schema
- `client/src/components/recipes/RecipeModal.jsx` — inline `→ pantry sub:` annotation with `typeof` guard

# Verification Results
- TASK-008: `npm run build` → ✓ 348 modules, no errors
- TASK-007: `npm run build` → ✓ 348 modules, no errors
- Smoke test: pending (requires TASK-007 migration run in Neon + Vercel preview deploy)

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- JOIN_CODE_CONSTRAINT constant uses Drizzle-derived name — confirm against live DB if uniqueness retry error surfaces

# Recommended Next Action
1. Run TASK-007 migration in Neon SQL Editor (copy from `server/db/migrations/0003_onboarding_complete.sql`) if not yet done.
2. Start TASK-009 (PWA Push Notifications — largest scope, spec not yet written).

# Forbidden Exploration
- server/middleware/auth.js (identity-only, unchanged)
- server/routes/pantry.js (unchanged)
- server/routes/household.js (unrelated)
- client/src/components/pantry/* (unchanged)

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- Completed tasks archived to: ai/tasks/archive/

# Future Specs (priority order)

## TASK-010 — COMPLETE
Archived to `ai/tasks/archive/TASK-010.md` (pending archive).

## TASK-009 — PWA Push Notifications
Largest scope task. Depends on TASK-006 for full value. Spec not yet written.

# PowerShell Merge Block
N/A — working directly on main.
