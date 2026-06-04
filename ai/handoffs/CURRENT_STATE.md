# Task
TASK-009 COMPLETE (implementation). Pre-deploy steps remain.

# Current Status
TASK-009 implementation: ALL FILES WRITTEN. Awaiting pre-deploy checklist.
TASK-010 COMPLETE (2026-06-04).
TASK-008 COMPLETE (2026-06-04). Archived.
TASK-007 COMPLETE. Migration `0003_onboarding_complete.sql` must be run in Neon SQL Editor before deploying.
TASK-006 COMPLETE. Archived.

# Files Modified (TASK-009)

## Created
- `server/db/migrations/0004_push_subscriptions.sql`
- `server/routes/push.js`
- `server/services/pushService.js`
- `client/src/hooks/usePushNotifications.js`
- `client/src/components/push/PushNotificationBanner.jsx`

## Edited
- `server/db/schema.js` — added `pushSubscriptions` table (before chatMessages)
- `server/app.js` — imported pushRouter, mounted at /api/push, added VAPID vars to REQUIRED_ENV
- `vercel.json` — added `crons` block: GET /api/push/cron at 08:00 UTC
- `client/public/sw.js` — added push + notificationclick handlers (existing cache handlers preserved)
- `client/src/pages/PantryPage.jsx` — imported + mounted PushNotificationBanner above onboarding

# Pre-Deploy Checklist (MUST complete before shipping)
1. Run `0004_push_subscriptions.sql` in Neon SQL Editor
2. `npm install web-push --prefix server`
3. `npx web-push generate-vapid-keys` → set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Vercel
4. Set CRON_SECRET in Vercel (e.g. `openssl rand -hex 32`)
5. `npm run build` — confirm passes

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- TASK-007 migration (`0003_onboarding_complete.sql`) must be run in Neon if not yet done
- TASK-009 ready-date notifications only useful after TASK-006 UI ships (column exists, UI doesn't)
- VAPID vars now in REQUIRED_ENV — local dev will throw unless .env is updated with real or test keys

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

## TASK-006 — readyDate / Ripening State
Spec: DRAFT-3, awaiting final architect approval.
Recommend shipping before or alongside TASK-009 (ready-date notifications depend on it).

# PowerShell Merge Block
N/A — working directly on main.
