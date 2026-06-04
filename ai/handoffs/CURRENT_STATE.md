# Task
TASK-003: Remediation — service layer, error handling, joinCode, .env.example

# Current Status
TASK-003 COMPLETE. All four deliverables implemented and verified. Ready to commit.

# What Was Built (TASK-003 — shipped on main)
- Household model: all data scoped by household_id (not user_id)
- Register creates a new household or joins an existing one via householdCode
- GET /api/household — returns household name + joinCode
- GET /api/household/members — lists all members in the household
- POST /api/household/invite — sends join code via Resend email
- HouseholdPage (/household) — shows join code, members list, invite-by-email form
- Household nav link added to Sidebar
- JWT now embeds householdId — re-login required after deploy (old tokens lack it)

# What TASK-003 Fixed
1. ARCHITECTURE VIOLATION — extracted server/services/householdService.js
   Both server/routes/household.js and server/routes/auth.js now use the service layer.
   No direct DB access remains in either route file for household operations.

2. ENV DOCS — added RESEND_API_KEY and RESEND_FROM_EMAIL to .env.example with comments.

3. HOUSEHOLD PAGE ERROR HANDLING — load() now has try/catch/finally.
   loadError state + retry button added to HouseholdPage.jsx.

4. JOIN CODE GENERATION — moved to crypto.randomBytes(4).toString('hex').toUpperCase()
   inside householdService.create(). Constraint-specific retry loop (max 3 attempts).
   Constraint name: households_join_code_unique (Drizzle convention, verified from schema).

# Files Modified by TASK-003 (remediation)
- server/services/householdService.js — NEW: getById, getMembers, getByJoinCode, create
- server/routes/household.js — refactored to use householdService (no direct DB)
- server/routes/auth.js — removed generateJoinCode, uses householdService
- client/src/pages/HouseholdPage.jsx — loadError state + try/catch/finally + retry button
- .env.example — added RESEND_API_KEY and RESEND_FROM_EMAIL entries

# Verification Results
- household.js: no import from db/client ✓
- household.js: no import from drizzle-orm ✓
- household.js: no import from schema ✓
- auth.js: no db.insert(households) ✓
- auth.js: no db.select().from(households) ✓
- auth.js: no generateJoinCode ✓
- auth.js: no import of households from schema ✓

# Operational Items (not code — owner action required)
- Add RESEND_API_KEY to Vercel env vars
- Add RESEND_FROM_EMAIL to Vercel env vars
- Re-deploy after env vars are set
- Re-login after deploy (old JWTs lack householdId)
- BLOB_READ_WRITE_TOKEN not set in Vercel — image upload broken until configured
- Constraint name households_join_code_unique used as JOIN_CODE_CONSTRAINT constant
  (derived from Drizzle ORM convention — verify against live DB if collision errors arise)

# Architecture Notes
- JWT embeds householdId; all data is household-scoped (not user-scoped)
- joinCode is 8-char uppercase hex (crypto); existing base36 codes in DB unaffected
- householdService.js is the sole join-code generator in the codebase
- emailService.js falls back to 503 if RESEND_API_KEY not set — expected behavior

# Future Specs (priority order — none started)

## TASK-004 — Chat Tool-Calling (Add to Pantry via Conversation)
Highest daily-use value. Lets user say "add leftover pad thai, 2 servings, good for 3 days"
and the AI inserts it to the DB mid-conversation instead of requiring the add-item modal.
Requires: Gemini function-calling (supported by gemini-2.0-flash), new tool definition in
aiService.js, route handler dispatch loop, confirmation UX in ChatPage.

## TASK-005 — Barcode Scanner + Open Food Facts
Zero-cost pantry onboarding. User points phone camera at a grocery item barcode →
Open Food Facts API returns name + category → pre-fills add-item form.
Pure client change. No backend changes needed.

## TASK-006 — readyDate / Ripening State
Adds a "not yet ready" state for items that need time. Requires schema migration.

## TASK-007 — Staples Checklist (First-Login Onboarding)
One-time screen after registration for common pantry staples.

## TASK-008 — Fix suggestRecipes for No-Expiry Pantry Items
Low-effort: pass all pantry items to AI, not just expiring ones.

## TASK-009 — PWA Push Notifications
Largest scope task. Depends on TASK-006 for full value.

## TASK-010 — Gemini Substitution Suggestions in Recipe Flow
Extend expandSuggestion() to include missing ingredients + substitutes.

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled yet
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- JOIN_CODE_CONSTRAINT constant uses Drizzle-derived name — confirm against live DB
  if a uniqueness retry error surfaces unexpectedly

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- TASK-003 complete — commit pending

# PowerShell Merge Block
N/A — working directly on main.

```powershell
git add server/services/householdService.js server/routes/household.js server/routes/auth.js client/src/pages/HouseholdPage.jsx .env.example ai/handoffs/CURRENT_STATE.md ai/tasks/TASK-003.md
git commit -m "TASK-003: extract householdService, fix joinCode generation, fix HouseholdPage error handling, update .env.example"
git push
```
