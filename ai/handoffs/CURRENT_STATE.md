# Task
TASK-004: Chat Tool-Calling — Add to Pantry via Conversation

# Current Status
TASK-004 spec is IMPLEMENTATION-READY (2 architect review rounds complete, DRAFT-3 final).
No code has been written yet. Next session begins implementation.

# What TASK-003 Shipped (complete — on main)
- householdService.js extracted (getById, getMembers, getByJoinCode, create)
- server/routes/household.js and auth.js refactored to use service layer
- joinCode generation moved to crypto.randomBytes(4).toString('hex').toUpperCase()
- HouseholdPage.jsx: loadError state + try/catch/finally + retry button
- .env.example: RESEND_API_KEY and RESEND_FROM_EMAIL added

# Files Required Next Session (TASK-004)
- server/services/aiService.js — modify chat() to support tool-calling dispatch loop
- server/routes/ai.js — build toolHandlers, update POST /api/ai/chat response
- client/src/pages/ChatPage.jsx — render itemsAdded chips

# Files Already Reviewed (read-only, no changes needed)
- server/services/pantryService.js — create(householdId, data) is the write target
- server/db/schema.js — pantryItems columns confirmed; no migration needed
- server/utils/expiry.js — UTC-day granularity pattern confirmed for expiryDate computation
- server/services/chatService.js — no changes needed

# Dependency Chain

Editing:
- server/services/aiService.js
- server/routes/ai.js
- client/src/pages/ChatPage.jsx

Requires:
- server/services/pantryService.js (read-only)
- server/db/schema.js (read-only)
- server/utils/expiry.js (read-only)

Irrelevant:
- server/services/chatService.js
- server/services/householdService.js
- server/routes/auth.js
- server/routes/household.js
- All other client pages

# Architecture Notes
- aiService.js remains DB-free. Tool execution stays in the route via toolHandlers callback map.
- chat() return type changes: string → { reply: string, itemsAdded: PantryItem[] }
- Response contract is a superset: { reply } → { reply, itemsAdded } (backward-compatible)
- shelfLifeDays (integer ≥ 0) in tool schema; route converts to UTC midnight ISO date
- Dispatch loop max 5 iterations; exhaustion returns safe fallback reply (not 500)
- Pantry summary rebuilt from DB every request — no cache invalidation needed

# Decisions Made
- Server-side expiry computation via shelfLifeDays (not expiryDate string from model)
- UTC midnight normalization: setUTCHours(0,0,0,0) + setUTCDate(+N) — matches expiry.js
- shelfLifeDays: z.coerce.number().int().nonnegative() — allows 0 ("expires today")
- Insert-always semantics for duplicate items (no upsert)
- No client-side confirmation dialog — Gemini's text reply IS the confirmation
- Loop-exhaustion returns { reply: "I couldn't complete that request...", itemsAdded }
- Failed-tool fallback: "I couldn't add those items..." (not misleading "Done.")

# Remaining Work
- [ ] Implement aiService.js changes (PANTRY_TOOLS constant, dispatch loop, _buildFallbackReply)
- [ ] Implement ai.js route changes (toolHandlers, destructure { reply, itemsAdded }, update res.json)
- [ ] Implement ChatPage.jsx changes (itemsAdded in state, chip rendering)
- [ ] Verify: single item, multi-item, no-tool-call, shelfLifeDays 0, loop guard, unknown tool
- [ ] Update CURRENT_STATE.md on completion

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- JOIN_CODE_CONSTRAINT constant uses Drizzle-derived name — confirm against live DB if
  uniqueness retry error surfaces

# Verification Results
- TASK-004: not yet started

# Recommended Next Action
Implement TASK-004. Start with aiService.js (PANTRY_TOOLS constant + dispatch loop),
then ai.js route update, then ChatPage.jsx chips. Full spec at ai/tasks/TASK-004.md.

# Forbidden Exploration
- server/db/* (no schema changes)
- server/services/pantryService.js (read-only)
- server/routes/auth.js (unrelated)
- server/routes/household.js (unrelated)
- client/src/* (except ChatPage.jsx)

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- Completed tasks archived to: ai/tasks/archive/

# Future Specs (priority order — none started)

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

# PowerShell Merge Block
N/A — working directly on main.
