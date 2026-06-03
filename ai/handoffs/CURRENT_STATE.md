# Task
Add invite-code registration gate and update README for public portfolio presentation

# Current Status
App is fully built through Phase 10 of the spec (all features complete). Build was broken due
to migration running at Vercel build time — fixed by removing `node server/db/migrate.js` from
the `vercel-build` script. App has not yet been smoke-tested on the live Vercel URL.
Next action is to implement the invite-code gate before smoke testing, then update the README.

# Files Modified
- package.json — removed `node server/db/migrate.js` from vercel-build script (committed: 23c3cde)

# Files Required Next
- server/routes/auth.js — add INVITE_CODE validation to POST /register
- client/src/pages/LoginPage.jsx — add invite code field to registration form
- README.md — full rewrite for portfolio presentation
- .env.example — add INVITE_CODE variable

# Files Already Reviewed
- server/app.js
- server/db/schema.js (Neon Postgres — pgTable, NOT SQLite)
- server/db/client.js
- server/db/migrate.js
- server/routes/ai.js
- server/routes/pantry.js
- server/services/aiService.js (Gemini 2.0 Flash — NOT Anthropic Claude)
- server/services/chatService.js
- server/middleware/upload.js
- client/src/pages/ChatPage.jsx
- client/src/components/dashboard/EatThisNow.jsx
- client/src/components/dashboard/WasteSaved.jsx
- client/src/components/pantry/ReceiptUpload.jsx
- package.json
- vercel.json
- docs/Kitchen-Keeper-Technical-Spec-v4.md

# Dependency Chain

Editing:
- server/routes/auth.js
- client/src/pages/LoginPage.jsx
- README.md
- .env.example

Requires:
- server/middleware/validate.js (Zod validation pattern already established)
- server/middleware/auth.js (requireAuth pattern — auth route follows same conventions)
- client/src/api/index.js (fetch wrapper used by all client forms)

Irrelevant:
- server/services/* (no service changes needed)
- server/routes/pantry.js
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/ai.js
- client/src/components/dashboard/*
- client/src/components/pantry/*
- client/src/components/recipes/*
- client/src/components/shopping/*
- server/db/*

# Architecture Notes
- Stack: React + Vite + Tailwind (client) / Node.js + Express (server) / Neon Postgres + Drizzle ORM / Gemini 2.0 Flash
- Deployed on Vercel. API is a single serverless function at api/index.js. Client is static.
- Auth: JWT in httpOnly + sameSite=strict cookie. requireAuth middleware on all protected routes.
- All env vars live in Vercel project settings (DATABASE_URL, GEMINI_API_KEY, JWT_SECRET, NODE_ENV, etc.)
- INVITE_CODE should be added as a new Vercel env var — NOT hardcoded.
- Registration is POST /api/auth/register in server/routes/auth.js. It already does Zod validation
  and bcrypt before inserting the user. The invite code check should happen before bcrypt (fast fail).
- The spec originally called for ANTHROPIC_API_KEY but the app uses GEMINI_API_KEY. README must
  reflect the actual implementation, not the spec.
- Local /uploads directory is NOT used — recipe images go to Vercel Blob. Receipts are in-memory only.
- SQLite is NOT used — database is Neon Postgres (serverless driver via @neondatabase/serverless).

# Decisions Made
- Invite code approach chosen over open registration to protect shared Gemini API key from abuse
- Code lives in a single INVITE_CODE env var (not a DB table of codes) — simple, no UI needed
- Owner (Connor) distributes the code manually to trusted users
- Public GitHub repo is desirable for portfolio — code stays open, live app stays gated
- README should explain: what the project is, how to run your own instance, live demo link,
  and a note that the live demo requires an invite code with contact info
- PWA / Capacitor decision deferred — not in scope for this task
- Smoke test deferred until after invite gate is in place

# Remaining Work
1. Add INVITE_CODE env var to Vercel project settings (owner does this manually via Vercel dashboard)
2. Update server/routes/auth.js — validate invite code on POST /register before bcrypt
3. Update client/src/pages/LoginPage.jsx — add invite code input field to the registration form
4. Update .env.example — add INVITE_CODE=your-secret-invite-code placeholder
5. Rewrite README.md for portfolio presentation (see spec below)
6. Commit and push → Vercel auto-deploys
7. Smoke test live app on iPhone (register with invite code, add pantry items, scan receipt,
   trigger Eat This Now, save a recipe, use chat)

# Known Risks / Open Questions
- LoginPage.jsx has not been read yet — the agent must read it before editing to understand
  the current registration form structure (toggle between login/register modes, field layout, etc.)
- Invite code should NOT be logged server-side (it is a secret)
- If INVITE_CODE env var is not set, the server should decide: block all registrations or allow all.
  Recommended: if env var is absent, allow registration (graceful dev fallback). Document this.
- The health endpoint returns { status: 'ok' } but spec requires { status: 'ok', db: 'connected' }.
  This is a known gap — out of scope for this task but worth a follow-up task.
- Multer 1.x has known vulnerabilities (flagged in build log). Upgrade to 2.x is a future task.
- Chat history is trimmed to 50 messages per user. AI only sees last 20. This is intentional.

# Verification Results
- Build fix: PASS (23c3cde removed migration from vercel-build — build no longer errors on DB connect)
- Smoke test: NOT YET RUN
- Live URL: https://kitchen-keeper-connorsharpes-projects.vercel.app

# Recommended Next Action
Read client/src/pages/LoginPage.jsx first to understand the current form structure.
Then implement the invite code gate (server validation + client field).
Then rewrite README.md.
Then commit, push, and smoke test.

# Forbidden Exploration
- server/services/* — no service layer changes needed for this task
- server/db/* — no schema or migration changes needed
- client/src/components/* — no component changes needed (only LoginPage.jsx)
- client/src/hooks/* — no hook changes needed
- client/src/context/* — no context changes needed

# README Spec (for the agent writing it)
The new README should contain these sections in order:

## Kitchen Keeper
One-paragraph description: AI-powered food waste management app. Add pantry items (manually
or by scanning a grocery receipt), see what's expiring, get AI meal suggestions, save recipes,
build shopping lists, chat with an AI kitchen assistant.

## Live Demo
Link: https://kitchen-keeper-connorsharpes-projects.vercel.app
Note: live demo requires an invite code — contact Connor to request access.

## Tech Stack
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express (Vercel Serverless Functions)
- Database: Neon Postgres (Drizzle ORM)
- AI: Google Gemini 2.0 Flash
- File Storage: Vercel Blob
- Auth: JWT (httpOnly cookies)

## Features
Short bulleted list: receipt scanning, expiry tracking, Eat This Now AI suggestions,
recipe save/manage, web recipe search, shopping list builder, AI chat assistant (Explore),
freeze toggle with AI storage tips, waste-saved counter.

## Run Your Own Instance
Step-by-step for a developer who wants to deploy their own copy:
1. Clone the repo
2. Create a Neon Postgres database — copy the DATABASE_URL
3. Get a Gemini API key from Google AI Studio (free tier available)
4. Deploy to Vercel — add all env vars from .env.example
5. Run migrations: npx drizzle-kit push (from project root, with .env populated)
6. Visit the deployed URL and register

## Environment Variables
Table of all vars with descriptions — match .env.example exactly.
Include: DATABASE_URL, JWT_SECRET, GEMINI_API_KEY, NODE_ENV, CLIENT_ORIGIN, INVITE_CODE,
BLOB_READ_WRITE_TOKEN.
Note which are auto-provided by Vercel integrations (DATABASE_URL via Neon, BLOB_READ_WRITE_TOKEN via Blob).

## Local Development
npm install → fills .env → npm run dev → Express on :3001, React on :5173

# Context Notes
- branch: main
- worktree: none (working directly on main)
- context pressure: low
- token usage concerns: none
- Vercel project: connorsharpes-projects/kitchen-keeper
- GitHub user: ConnorSharpe
- Last commit: 23c3cde (fix: remove migration from vercel-build)

# PowerShell Merge Block
N/A — working directly on main branch, no worktree in use.
Commit and push directly:

git add ai/handoffs/CURRENT_STATE.md
git commit -m "docs: add CURRENT_STATE.md handoff for invite-gate + README task"
git push
