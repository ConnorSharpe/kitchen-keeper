# Task
TASK-002: Electron Desktop App Migration — SPEC APPROVED, READY FOR IMPLEMENTATION

# Current Status
Spec completed three architect review rounds. Final verdict: APPROVED FOR IMPLEMENTATION ✅
Scores: Architecture 9.5/10 | Implementation Readiness 9.5/10 | Execution Risk: Low

Full spec at ai/tasks/TASK-002.md.
Next action: create worktree `task/002-electron` and begin implementation.

# Recent Changes (since TASK-001)
- client/src/components/layout/Sidebar.jsx — hamburger menu (mobile only)
- client/src/components/pantry/ReceiptUpload.jsx — camera capture (mobile only)
- ai/tasks/TASK-002.md — Electron migration spec (FINAL)

# TASK-002 Summary

## Architecture
```
Electron Main
  → migrate SQLite
  → create uploads dir
  → start Express on 127.0.0.1:PORT
  → poll /api/health
  → open BrowserWindow → http://127.0.0.1:PORT

Express
  → serves client/dist (static)
  → /api/* routes
  → /uploads/* (local images)

SQLite (userData/kitchen-keeper.db)
Filesystem (userData/uploads/)
Gemini API (AI features only)
```

## Key Decisions (all resolved)
- Express embedded in Electron main (not IPC rewrite)
- SQLite replaces Neon — migration confirmed mechanical
- Local filesystem replaces Vercel Blob
- Auth removed entirely — userId hardcoded to 1
- Gemini key stored via IPC/config.json — not Express route
- `wait-on` eliminates dev startup race
- `extraResources` + `process.resourcesPath` fixes packaged migration path
- `postinstall: electron-builder install-app-deps` handles better-sqlite3 ABI

## Files to Delete
api/index.js, vercel.json, server/db/migrate.js,
server/routes/auth.js, server/middleware/auth.js,
client/src/context/AuthContext.jsx,
client/src/components/layout/ProtectedRoute.jsx,
client/src/pages/LoginPage.jsx

## New Files
electron/main.js, electron/preload.js, electron/assets/icon.*,
client/src/pages/SettingsPage.jsx, root package.json

## req.user.id replacement scope (confirmed by grep)
- routes/ai.js: 7 occurrences
- routes/pantry.js: 8 occurrences
- routes/recipes.js: 5 occurrences
- routes/shopping.js: 6 occurrences
- services/: zero — receives userId as plain parameter, no changes needed

## Implementation Order
1. Root package.json + Electron skeleton
2. SQLite schema + client swap
3. Auth removal (requireAuth + req.user.id → userId=1)
4. Blob → local filesystem (ai.js + recipeService.js)
5. server/app.js cleanup
6. Full Electron boot sequence
7. drizzle-kit generate → commit migrations
8. IPC config + SettingsPage
9. Delete legacy files
10. npm run build:win smoke test

# Known Risks (medium severity)
- better-sqlite3 native ABI: handled by postinstall
- ESM/CJS interop: electron/main.js is CJS, uses dynamic import() for server/app.js
- Drizzle migrations path: extraResources + isPackaged branch in main.js
- Helmet CSP: verify images still load after removing CSP override

# Context Notes
- branch: main
- worktree: none yet — create task/002-electron for implementation
- context pressure: low
- Vercel deployment remains live until Electron build is validated

# PowerShell Merge Block
N/A — working directly on main. No worktree.
