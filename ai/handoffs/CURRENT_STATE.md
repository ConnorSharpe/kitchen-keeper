# Task
TASK-003: Remediation — service layer, error handling, joinCode, .env.example

# Current Status
TASK-003 shipped (household model, invite flow, household page). Four defects were identified
in post-hoc audit. TASK-003 spec drafted, completed architect Round 1 review, revised to v1.1.
IMPLEMENTATION-READY — next dev should implement TASK-003 immediately.

# What Was Built (TASK-003 — shipped on main)
- Household model: all data scoped by household_id (not user_id)
- Register creates a new household or joins an existing one via householdCode
- GET /api/household — returns household name + joinCode
- GET /api/household/members — lists all members in the household
- POST /api/household/invite — sends join code via Resend email
- HouseholdPage (/household) — shows join code, members list, invite-by-email form
- Household nav link added to Sidebar
- JWT now embeds householdId — re-login required after deploy (old tokens lack it)

# Known Defects (TASK-003 will fix)
See ai/tasks/TASK-003.md for full spec.

1. ARCHITECTURE VIOLATION — server/routes/household.js queries db directly (no service layer)
   server/routes/auth.js also does direct household DB calls in the register handler
   Fix: extract server/services/householdService.js; refactor both route files

2. MISSING ENV DOCS — RESEND_API_KEY and RESEND_FROM_EMAIL are used by emailService.js
   but absent from .env.example
   Fix: add both entries with comments

3. HOUSEHOLD PAGE ERROR HANDLING — load() has no try/catch/finally
   Infinite loading spinner if either API call fails (e.g. expired JWT lacking householdId)
   Fix: add loadError state + try/catch/finally + retry button

4. JOIN CODE GENERATION — Math.random() can produce empty string; no collision retry
   Fix: crypto.randomBytes(4).toString('hex').toUpperCase() + constraint-specific retry loop

# Files Modified by TASK-003
- server/db/schema.js — added households table, householdId FK on all tables
- server/routes/auth.js — register creates/joins household, JWT embeds householdId
- server/routes/household.js — new file (has architecture defect — see above)
- server/services/emailService.js — new file (Resend invite email)
- server/app.js — mounts /api/household router
- client/src/pages/HouseholdPage.jsx — new file (has error handling defect — see above)
- client/src/pages/LoginPage.jsx — added householdCode field to register form
- client/src/context/AuthContext.jsx — register() passes householdCode to API
- client/src/components/layout/Sidebar.jsx — household nav link
- client/src/App.jsx — /household route added

# Files TASK-003 Will Modify
- server/services/householdService.js — NEW (extract from route handlers)
- server/routes/household.js — refactor to use service
- server/routes/auth.js — remove household DB calls, use service
- client/src/pages/HouseholdPage.jsx — add error handling
- .env.example — add RESEND_API_KEY, RESEND_FROM_EMAIL

# Operational Items (not code — owner action required)
- Add RESEND_API_KEY to Vercel env vars
- Add RESEND_FROM_EMAIL to Vercel env vars
- Re-deploy after env vars are set
- Re-login after deploy (old JWTs lack householdId)
- BLOB_READ_WRITE_TOKEN not set in Vercel — image upload fails until configured

# Architecture Notes
- JWT embeds householdId; all data is household-scoped (not user-scoped)
- joinCode is 8-char uppercase; currently base36 (Math.random) — TASK-003 moves to hex (crypto)
- Existing codes in DB are unaffected by the format change
- emailService.js falls back to 503 if RESEND_API_KEY not set — expected behavior
- Chat history is household-scoped (shared pantry context across household members)

# Future Specs (priority order — none started)

## TASK-004 — Chat Tool-Calling (Add to Pantry via Conversation)
Highest daily-use value. Lets user say "add leftover pad thai, 2 servings, good for 3 days"
and the AI inserts it to the DB mid-conversation instead of requiring the add-item modal.
Requires: Gemini function-calling (supported by gemini-2.0-flash), new tool definition in
aiService.js, route handler dispatch loop, confirmation UX in ChatPage.
Key design questions: what fields does the AI control vs. default? Does user confirm before insert?
Dependency: none — independent of TASK-003.

## TASK-005 — Barcode Scanner + Open Food Facts
Zero-cost pantry onboarding. User points phone camera at a grocery item barcode →
Open Food Facts API (free, 2.5M products, no key required) returns name + category →
pre-fills add-item form.
Requires: react-barcode-detection (or equivalent), GET call to
world.openfoodfacts.net/api/v2/product/{barcode}, no backend changes needed (pure client).
Key design question: camera permission UX on mobile vs. desktop fallback.
Dependency: none — independent of all other tasks.

## TASK-006 — readyDate / Ripening State
Adds a "not yet ready" state for items that need time before use (avocados, pears picked
from the tree, etc.). Requires a readyDate column on pantry_items, a new expiry status
('ripening'), updates to getExpiryStatus(), AI suggestion filtering to exclude not-yet-ready
items, and UI treatment in PantryTable.
Key design question: does readyDate replace purchaseDate semantically, or sit alongside it?
Dependency: schema migration required — coordinate with any concurrent schema work.

## TASK-007 — Staples Checklist (First-Login Onboarding)
One-time screen after first registration offering toggle checkboxes for common pantry staples
(salt, pepper, olive oil, flour, sugar, eggs, butter, garlic, etc.). Gets 80% of pantry
basics in with no typing. Staples have no expiry date and are flagged as no-expiry items.
Requires: one-time flag on user (hasCompletedOnboarding), new onboarding route/page,
bulk insert via existing pantryService.bulkCreate().
Dependency: none — independent.

## TASK-008 — Fix suggestRecipes for No-Expiry Pantry Items
Low-effort, high-value prompt fix. suggestRecipes() in aiService.js currently only passes
expiringItems to the AI — if no items are expiring, it returns [] even when the pantry is
full. Fix: pass all pantry items as context with expiringItems as the priority signal,
not the only signal. Also gates the 150-lb pear-tree use case.
No schema changes. Server-only change (aiService.js + prompt wording).
Dependency: none — safe to implement any time.

## TASK-009 — PWA Push Notifications (Ripeness / Expiry Reminders)
Infrastructure for push notifications — needed for avocado/ripeness reminders and general
expiry nudges. Requires service worker registration, Web Push API (VAPID keys), new
notifications table, and a scheduled check mechanism (Vercel Cron or client-side on app open).
Largest scope of the pending tasks. Depends on TASK-006 (readyDate) for ripeness-specific
notifications to be meaningful.
Dependency: TASK-006 should land first for full value.

## TASK-010 — Gemini Substitution Suggestions in Recipe Flow
When AI suggests a recipe, also return substitution suggestions for ingredients the pantry
is missing. Leverages existing Gemini integration — no new API key or dependency.
Extend expandSuggestion() in aiService.js to include a "missing ingredients + substitutes"
field in its output. Surface in the recipe detail UI.
Dependency: none — contained to aiService.js and RecipeModal/RecipeCard.

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled yet
- joinCode collision (Math.random, current production code) — TASK-003 fixes this
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- TASK-003 spec: ai/tasks/TASK-003.md (v1.1 — IMPLEMENTATION-READY)

# PowerShell Merge Block
N/A — working directly on main.
