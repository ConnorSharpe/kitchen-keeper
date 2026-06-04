# Task
TASK-001: COMPLETE. Next: PWA (installable on phone via Vercel)

# Current Status
TASK-001 fully shipped. TASK-002 (Electron) scoped and spec'd but abandoned —
user preference is browser on laptop, installable app on phone. PWA on top of
the existing Vercel deployment is the correct path forward.

# Recent Shipped Changes
- server/routes/auth.js — invite code gate
- client/src/context/AuthContext.jsx — 4th param to register()
- client/src/pages/LoginPage.jsx — invite code field (register mode only)
- client/src/components/layout/Sidebar.jsx — hamburger menu (mobile only)
- client/src/components/pantry/ReceiptUpload.jsx — camera capture (mobile only)
- README.md — portfolio rewrite
- api/index.js — CJS dynamic import wrapper for Vercel ESM compatibility
- vercel.json — restored API rewrite + functions config

# Architecture Notes
- api/index.js is a CJS lazy-loader that dynamic imports server/app.js (ESM)
- Neon DB schema applied via Neon SQL Editor (0000_init.sql)
- drizzle migrate.js incompatible with Neon HTTP driver — future migrations via Neon SQL Editor
- Vercel Blob token not yet set — image upload will fail until configured

# Next Task: PWA
Make the Vercel web app installable on mobile (iOS/Android home screen).
Minimum viable PWA requires:
- public/manifest.json — app name, icons, theme color, display: standalone
- public/sw.js — service worker (can be minimal — just enables installability)
- <link rel="manifest"> in client/index.html
- HTTPS already satisfied by Vercel

Once installed, the app behaves like a native app: full screen, home screen icon,
no browser chrome. Camera capture and hamburger menu already work on mobile.

# Known Risks / Open Questions
- BLOB_READ_WRITE_TOKEN not set in Vercel — image upload fails until configured
- Multer 1.x vulnerability — follow-up task
- drizzle migrate.js incompatible with neon-http driver — follow-up task
- Health endpoint returns { status: 'ok' } without db field — follow-up task

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
