# Task
TASK-003: COMPLETE — Household model, invite flow, documentation

# Current Status
Fully shipped. DB migration run. All code, UI, and docs updated.
Next: add RESEND_API_KEY + RESEND_FROM_EMAIL to Vercel env vars, re-deploy, re-login.

# What Was Built
- Household model: all data scoped by household_id (not user_id)
- Register creates a new household or joins an existing one via joinCode
- GET /api/household — returns household name + joinCode
- GET /api/household/members — lists all members in the household
- POST /api/household/invite — sends join code via Resend email
- HouseholdPage (/household) — shows join code, members list, invite-by-email form
- Household nav link added to Sidebar

# Architecture Notes
- JWT embeds householdId; re-login required after deploy (old tokens lack it)
- joinCode is 8-char uppercase alphanumeric, unique constraint in DB
- Chat history is household-scoped (shared pantry context)
- emailService.js uses Resend; falls back to 503 if RESEND_API_KEY not set

# Known Risks / Open Questions
- BLOB_READ_WRITE_TOKEN not set in Vercel — image upload fails until configured
- Multer 1.x vulnerability — follow-up task
- joinCode collision (Math.random, no retry) — negligible risk for family app

# Next Tasks (priority order)
1. Set RESEND_API_KEY + RESEND_FROM_EMAIL in Vercel, re-deploy
2. Re-login (old JWT lacks householdId)
3. Use Household page to email invite to wife
4. PWA installability (manifest.json + service worker)

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
