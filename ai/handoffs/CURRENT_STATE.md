# Task
TASK-009 spec APPROVED. Next: implement TASK-009 (PWA Push Notifications).

# Current Status
TASK-009 spec: DRAFT-6 APPROVED (2026-06-04). Implementation-ready.
TASK-010 COMPLETE (2026-06-04).
TASK-008 COMPLETE (2026-06-04). Archived.
TASK-007 COMPLETE. Migration `0003_onboarding_complete.sql` must be run in Neon SQL Editor before deploying.
TASK-006 COMPLETE. Archived.

# Files Modified (TASK-009 spec only — no implementation yet)
- `ai/tasks/TASK-009.md` — DRAFT-6 (APPROVED), implementation-ready

# TASK-009 Implementation Scope

## New files to create
- `server/db/migrations/0004_push_subscriptions.sql`
- `server/routes/push.js`
- `server/services/pushService.js`
- `client/public/sw.js`
- `client/src/hooks/usePushNotifications.js`
- `client/src/components/push/PushNotificationBanner.jsx`

## Files to edit
- `server/db/schema.js` — add `pushSubscriptions` table
- `server/app.js` — mount push router; add VAPID vars to required env list
- `vercel.json` — add `crons` block
- `client/src/pages/PantryPage.jsx` — mount `<PushNotificationBanner />`

## Key implementation facts (do not re-research)
- Vercel Cron uses **GET** (not POST). Route: `router.get('/cron', ...)`
- Vercel auto-injects `Authorization: Bearer {CRON_SECRET}` on cron invocations
- Cron also accepts `?secret={CRON_SECRET}` as fallback for manual invocation
- All date columns are `text()` storing ISO timestamps (`'YYYY-MM-DDTHH:mm:ss.sssZ'`)
- Date comparisons: `LEFT(col, 10)::date = CURRENT_DATE + 1` (integer offset, date domain)
- NULL guard required before cast: `col IS NOT NULL AND LEFT(col,10)::date = ...`
- `pantryItems.householdId` confirmed live (schema.js line 23) — items are household-scoped
- `pantryItems.isFrozen` confirmed live (schema.js line 31) — non-null boolean
- Subscribe mutation wraps delete + upsert in a `db.transaction()` (race condition fix)
- Unsubscribe uses `POST /api/push/unsubscribe` (not DELETE — `api.delete()` has no body)
- `web-push` package goes in `server/package.json` (not root)
- Required new env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`

## Pre-implementation checklist
1. Run migration `0004_push_subscriptions.sql` in Neon SQL Editor
2. Generate VAPID keys: `npx web-push generate-vapid-keys`
3. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` in Vercel env vars
4. `npm install web-push --prefix server`

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- TASK-007 migration (`0003_onboarding_complete.sql`) must be run in Neon if not yet done
- TASK-009 ready-date notifications only useful after TASK-006 UI ships (column exists, UI doesn't)

# Forbidden Exploration
- server/middleware/auth.js (identity-only, unchanged)
- server/routes/pantry.js (unchanged)
- server/routes/household.js (unrelated)
- client/src/components/pantry/* (unchanged)
- client/src/api/index.js (not modified — DELETE body limitation resolved by route design)

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- Completed tasks archived to: ai/tasks/archive/

# Future Specs (priority order)

## TASK-009 — PWA Push Notifications
Spec: DRAFT-6 APPROVED. Ready for implementation.
Full spec: `ai/tasks/TASK-009.md`

## TASK-006 — readyDate / Ripening State
Spec: DRAFT-3, awaiting final architect approval.
Recommend shipping before or alongside TASK-009 (ready-date notifications depend on it).

# PowerShell Merge Block
N/A — working directly on main.
