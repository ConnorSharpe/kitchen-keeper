# Task
TASK-004: Chat Tool-Calling — Add to Pantry via Conversation

# Current Status
TASK-004 IMPLEMENTATION COMPLETE. Code merged to main.
TASK-005 spec drafting in progress — next session.

# What TASK-004 Shipped (complete — on main)
- server/services/aiService.js: PANTRY_TOOLS constant, dispatch loop (max 5 iterations),
  _buildFallbackReply(), chat() signature extended with toolHandlers param,
  return type changed string → { reply, itemsAdded }
- server/routes/ai.js: toolHandlers object with add_pantry_item (Zod validation,
  UTC midnight expiry computation, pantryService.create()), res.json({ reply, itemsAdded })
- client/src/pages/ChatPage.jsx: itemsAdded attached to assistant messages,
  green chips rendered below assistant bubbles for each added item

# Architecture Notes
- aiService.js remains DB-free. Tool execution stays in the route via toolHandlers callback map.
- chat() return type: { reply: string, itemsAdded: PantryItem[] }
- shelfLifeDays (integer ≥ 0) in tool schema; route converts to UTC midnight ISO date
- Dispatch loop max 5 iterations; exhaustion returns safe fallback reply (not 500)
- Insert-always semantics for duplicate items (no upsert)
- Pantry summary rebuilt from DB on every request — no cache invalidation needed

# TASK-004 Smoke Test Checklist
Run these manually before closing out TASK-004. Start dev server (`npm run dev`).

- [ ] Single item with shelf life — "add leftover chicken, good for 2 days"
      → 1 DB row, expiryDate = UTC midnight + 2d, AI confirms, 1 chip visible
- [ ] Multiple items — "add 2 eggs and a carton of milk"
      → 2 DB rows, 2 chips, single AI reply
- [ ] No tool call — "what should I make for dinner?"
      → No DB write, itemsAdded = [], reply non-empty, no chips
- [ ] No shelf life — "add some olive oil"
      → expiryDate = null, item created, no error
- [ ] shelfLifeDays 0 — "add the leftover soup, use it today"
      → expiryDate = today UTC midnight, Zod nonnegative() passes
- [ ] Insert-always — "add milk" twice → 2 separate DB rows
- [ ] chat_messages table — only user + assistant text rows (no tool intermediates)
- [ ] Server logs — no unhandled errors across all steps

# Known Risks (ongoing)
- Multer 1.x vulnerability — pre-existing, no fix scheduled
- BLOB_READ_WRITE_TOKEN missing in Vercel — image upload broken until set
- JOIN_CODE_CONSTRAINT constant uses Drizzle-derived name — confirm against live DB if
  uniqueness retry error surfaces

# Verification Results
- TASK-004: implementation complete — smoke test pending

# Recommended Next Action
Implement TASK-005 (Barcode Scanner + Open Food Facts). Spec is DRAFT-3, approved after 2 architect review rounds. Pure client change — no backend needed.

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

## TASK-005 — Barcode Scanner + Open Food Facts (SPEC APPROVED — ready to implement)
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
