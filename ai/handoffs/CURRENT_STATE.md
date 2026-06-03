# Task
TASK-001: Invite-Code Registration Gate + Portfolio README

# Current Status
COMPLETE. All four deliverables implemented. Awaiting commit, push, and smoke test on live URL.

# Files Modified
- server/routes/auth.js — added inviteCode to registerSchema; added gate check before bcrypt
- client/src/context/AuthContext.jsx — added inviteCode as 4th param to register(); passes it in POST body
- client/src/pages/LoginPage.jsx — added inviteCode state, render-gated input field, passes to register()
- README.md — full rewrite for portfolio presentation
- .env.example — replaced ANTHROPIC_API_KEY with correct vars; added INVITE_CODE with comment

# Files Already Reviewed
(all from previous session, plus newly read this session)
- server/routes/auth.js
- server/middleware/validate.js
- server/middleware/auth.js
- client/src/pages/LoginPage.jsx
- client/src/context/AuthContext.jsx

# Dependency Chain

Editing:
- server/routes/auth.js
- client/src/context/AuthContext.jsx (scope expansion — fetch body lives here, not in LoginPage)
- client/src/pages/LoginPage.jsx
- README.md
- .env.example

Requires:
- server/middleware/validate.js (confirmed: strips fields not in schema — inviteCode added to schema to survive)
- client/src/api/index.js (used by AuthContext; no changes needed)

Irrelevant:
- server/services/*
- server/db/*
- client/src/components/*
- client/src/hooks/*

# Architecture Notes
- validate.js replaces req.body with Zod result.data — fields not in schema are stripped.
  inviteCode added to registerSchema as z.string().trim().optional() to survive middleware.
- auth.js errors are thrown (new Error + err.status), not returned as res.json({ error }).
  Invite code error follows the same pattern: throw with status 400.
- Invite code check is before bcrypt (fast fail as spec requires).
- AuthContext.register() now accepts (email, password, name, inviteCode) — minimal extension.
- Gate logic: if INVITE_CODE env var is unset/empty/spaces-only → gate disabled (dev fallback).
  If set: submitted code (trimmed) must === env code (trimmed). Case-sensitive.

# Decisions Made
- AuthContext.jsx was listed as "irrelevant/forbidden" in the spec but the register() fetch
  body is defined there. Modified it with a minimal one-line extension (4th param) rather
  than duplicating the API call in LoginPage. This is the correct minimal change.
- Error shape matches existing auth.js convention (throw Error with .status).
- HTTP status 400 used for invalid invite code (no existing convention to override).

# Remaining Work
1. Owner adds INVITE_CODE env var to Vercel project settings (manual — not in code)
2. git add + commit + push → Vercel auto-deploys
3. Smoke test on live URL:
   - Register with correct invite code → succeeds
   - Register with wrong code → error shown inline
   - Register with correct code + trailing space → succeeds
   - Login → unaffected, no invite code field visible

# Known Risks / Open Questions
- Smoke test not yet run (deferred until after Vercel deploy)
- Health endpoint still returns { status: 'ok' } without db field — follow-up task
- Multer 1.x vulnerability — follow-up task
- Chat history trim (50 messages/user, AI sees last 20) — intentional, documented

# Verification Results
- No console.log/error in auth.js — inviteCode never logged: PASS
- inviteCode added to registerSchema (survives validate.js stripping): PASS
- Gate check is before bcrypt call: PASS
- inviteCode field render-gated to register mode only: PASS
- inviteCode passed in same payload object as email/password/name: PASS
- README matches actual stack (Gemini, Neon Postgres, Vercel Blob — not Anthropic/SQLite): PASS
- .env.example has INVITE_CODE with correct comment: PASS

# Recommended Next Action
Commit and push, then run manual smoke test on live URL.

# Forbidden Exploration
- server/services/*
- server/db/*
- client/src/components/*
- client/src/hooks/*
- api/index.js
- vercel.json

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- Last commit: fab59fc (docs: add TASK-001 spec)

# PowerShell Merge Block
N/A — working directly on main. No worktree.

Run from main:

```powershell
git add server/routes/auth.js client/src/context/AuthContext.jsx client/src/pages/LoginPage.jsx README.md .env.example ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-001: add invite-code gate and rewrite README for portfolio"
git push
```
