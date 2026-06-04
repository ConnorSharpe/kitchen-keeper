# TASK-002: Electron Desktop App Migration

Version: SPEC-FINAL (architect approved — ready for implementation)
Status: ✅ APPROVED FOR IMPLEMENTATION

---

# Goal

Convert Kitchen Keeper from a Vercel-hosted web app into a fully self-contained
Electron desktop application that runs on Windows, Mac, and Linux with zero
recurring cost and no required internet connection (except for Gemini AI calls).

---

# Constraints

- **Cost: $0** — no paid services, no subscriptions, no cloud hosting
- **Preserve existing code wherever possible** — do not rewrite what works
- **Remove all Vercel/cloud-specific code** — clean break, no backwards compat shims
- **No new abstractions beyond what is strictly required**
- **Gemini API key is user-supplied** — stored via Electron main process, not Express

---

# Architecture

```
Electron Main Process
   ├── reads config.json (Gemini key)
   ├── runs SQLite migrations
   ├── creates uploads directory
   ├── starts Express on 127.0.0.1:PORT
   ├── polls /api/health until ready
   └── opens BrowserWindow → http://127.0.0.1:PORT

Express (embedded, localhost only)
   ├── serves client/dist as static (production)
   ├── /api/* routes (pantry, recipes, shopping, ai)
   └── /uploads/* static (local recipe images)

SQLite (userData/kitchen-keeper.db)
   └── all app data, persisted locally

Filesystem (userData/uploads/)
   └── recipe images

Gemini API (external, required for AI features only)
```

---

# Architecture Decision Log

## ADR-1: Express server embedding (accepted)

Embed Express as a local HTTP server inside Electron's main process. The React
frontend continues calling `fetch('/api/...')` — no client fetch code changes.
Express starts before the BrowserWindow opens.

---

## ADR-2: SQLite replacing Neon Postgres (accepted)

Migrate to SQLite via `better-sqlite3` + `drizzle-orm/better-sqlite3`.
Database file: `app.getPath('userData')/kitchen-keeper.db`.

**Schema migration is confirmed mechanical.** Schema was fully audited:

- No `jsonb`, no Postgres arrays, no enums
- JSON columns (`ingredients`, `steps`, `tags`) stored as `text` — unchanged
- Dates stored as ISO strings in `text` — unchanged
- Only two translation rules required:

| Postgres | SQLite |
|----------|--------|
| `serial('id').primaryKey()` | `integer('id').primaryKey({ autoIncrement: true })` |
| `boolean()` | `integer({ mode: 'boolean' })` |

All `text()`, `real()`, `integer()` columns are identical. Foreign keys, unique
constraints, and `$defaultFn` date helpers all work unchanged in SQLite.

**Existing database call sites have been verified to remain compatible with the
SQLite Drizzle adapter.** No query rewrites needed.

**DB bootstrap:** `migrate()` from `drizzle-orm/migrator` runs at every startup.
It is idempotent — safe to call on a database that already has all tables.

---

## ADR-3: Local filesystem replacing Vercel Blob (accepted)

Recipe images written to `app.getPath('userData')/uploads/`.
Express serves them via `express.static(uploadsDir)` at `/uploads`.
Image URLs in DB: `/uploads/filename` (was full Blob CDN URL).

**Blob code found in two places — both must change:**

1. `server/routes/ai.js` — upload path: `put(...)` → `fs.writeFileSync(...)`
2. `server/services/recipeService.js` — delete path: `del(url)` → `fs.unlink(...)`

---

## ADR-4: Auth removed entirely (accepted)

Single-user desktop app. No meaningful security benefit from auth.
`users` table retained in schema for future multi-profile support.
Single seed row `(id: 1)` inserted on first launch.
All `req.user.id` in routes replaced with `const userId = 1`.

**`req.user` scope confirmed by grep — strictly confined to routes:**
- `routes/ai.js`: 7 occurrences
- `routes/pantry.js`: 8 occurrences
- `routes/recipes.js`: 5 occurrences
- `routes/shopping.js`: 6 occurrences
- `routes/auth.js`: deleted entirely
- `middleware/auth.js`: deleted entirely
- Services (`pantryService`, `recipeService`, etc.): zero occurrences — receive `userId` as a plain parameter, no changes needed

---

## ADR-5: Production boot flow (accepted)

Option B — Express serves `client/dist` as static files. `BrowserWindow` loads
`http://127.0.0.1:PORT`. Frontend and API share the same origin — no CORS, no
base URL changes, no client fetch rewrites needed.

**Confirmed: no API URL migration needed.** All client fetch calls route through
`client/src/api/index.js` using bare relative paths (e.g. `'/api/pantry'`).
Grep confirmed zero `VITE_API_URL`, `API_URL`, or `BASE_URL` references in client.

**Health endpoint already exists** at `server/app.js:47`:
```js
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
```
No new code needed. Electron main polls this URL before opening the window.

**Dev mode:** Electron loads `http://localhost:5173` (Vite dev server). Existing
Vite proxy (`/api → localhost:3001`) handles API forwarding unchanged.

---

## ADR-6: Config via Electron IPC, not Express (resolves architect Issue #1)

Gemini API key is managed entirely in the Electron main process — not through
an Express route. A config route would give a web API filesystem write access
to desktop configuration, which is architecturally incorrect.

**Flow:**
```
SettingsPage (renderer)
  → window.electronAPI.saveGeminiKey(key)    [contextBridge]
  → ipcMain handler
  → writes userData/config.json
  → sets process.env.GEMINI_API_KEY
```

`electron/preload.js` exposes two methods via `contextBridge`:
```js
contextBridge.exposeInMainWorld('electronAPI', {
  saveGeminiKey: (key) => ipcRenderer.invoke('config:save-gemini-key', key),
  getGeminiKey:  ()    => ipcRenderer.invoke('config:get-gemini-key'),
});
```

`electron/main.js` handles both channels:
```js
ipcMain.handle('config:save-gemini-key', (_, key) => { /* write config.json */ });
ipcMain.handle('config:get-gemini-key',  ()       => { /* read config.json  */ });
```

`server/routes/config.js` is **removed from scope** — not needed.
`SettingsPage.jsx` calls `window.electronAPI.*` directly, not `api.post(...)`.

---

# Startup Sequence (complete)

```
1. app.on('ready')
2. Read userData/config.json → set process.env.GEMINI_API_KEY (if present)
3. Ensure userData/uploads/ exists:
     fs.mkdirSync(uploadsDir, { recursive: true })
4. Set process.env.PORT, DB_PATH, UPLOADS_DIR
5. Run drizzle migrate():
     const migrationsFolder = app.isPackaged
       ? path.join(process.resourcesPath, 'drizzle')
       : path.join(__dirname, '../drizzle')
6. Seed users table: INSERT OR IGNORE INTO users (id, ...) VALUES (1, ...)
7. Import server/app.js → app.listen('127.0.0.1', port)
8. Poll http://127.0.0.1:PORT/api/health (100ms interval, 10s timeout, reject on timeout)
9. new BrowserWindow({ webPreferences: { contextIsolation: true, nodeIntegration: false, preload } })
10. isDev ? win.loadURL('http://localhost:5173') : win.loadURL(`http://127.0.0.1:${port}`)
```

**Dev startup race:** Electron must not open until Vite is ready. Use `wait-on`:
```json
"dev": "concurrently \"npm run dev:client\" \"npm run dev:electron\"",
"dev:client":   "vite --cwd client",
"dev:electron": "wait-on tcp:5173 && electron ."
```

---

# Files to Delete

| File | Reason |
|------|--------|
| `api/index.js` | Vercel serverless CJS wrapper |
| `vercel.json` | Vercel deployment config |
| `server/db/migrate.js` | Neon-HTTP migration, replaced by drizzle migrator |
| `server/routes/auth.js` | Auth removed |
| `server/middleware/auth.js` | Auth removed |
| `client/src/context/AuthContext.jsx` | Auth removed |
| `client/src/components/layout/ProtectedRoute.jsx` | Auth removed |
| `client/src/pages/LoginPage.jsx` | Auth removed |

---

# Dependencies to Remove

| Package | Location | Replacement |
|---------|----------|-------------|
| `@neondatabase/serverless` | server | `better-sqlite3` |
| `@vercel/blob` | server | `node:fs` |
| `bcrypt` | server | removed with auth |
| `jsonwebtoken` | server | removed with auth |
| `cookie-parser` | server | removed with auth |
| `uuid` | server | `node:crypto` (`randomUUID()`) |

---

# Dependencies to Add

| Package | Location | Purpose |
|---------|----------|---------|
| `electron` | root devDep | Desktop shell |
| `electron-builder` | root devDep | Package to .exe / .dmg / .AppImage |
| `better-sqlite3` | server | SQLite driver (native module) |
| `get-port` | root | Free port at startup |
| `concurrently` | root devDep | Parallel dev processes |
| `wait-on` | root devDep | Block Electron until Vite ready |

---

# New Files

```
electron/
  main.js               — full boot sequence (see Startup Sequence above)
  preload.js            — contextBridge: saveGeminiKey, getGeminiKey
  assets/
    icon.ico            — Windows icon (256x256 min)
    icon.icns           — macOS icon
    icon.png            — Linux icon (256x256)
package.json            — root: Electron entry, scripts, electron-builder config
client/src/pages/
  SettingsPage.jsx      — Gemini key input, calls window.electronAPI.saveGeminiKey
```

---

# Modified Files

## `server/db/client.js` — replace entirely

```js
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database(process.env.DB_PATH);
sqlite.pragma('journal_mode = WAL');
export const db = drizzle(sqlite, { schema });
```

---

## `server/db/schema.js`

Replace imports and two column types — all other columns unchanged:

```js
// Before:
import { pgTable, text, integer, real, boolean, serial } from 'drizzle-orm/pg-core';

// After:
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// serial('id').primaryKey()  →  integer('id').primaryKey({ autoIncrement: true })
// boolean()                  →  integer({ mode: 'boolean' })
// pgTable                    →  sqliteTable
```

---

## `server/routes/ai.js`

- Remove `requireAuth` import and `router.use(requireAuth)`
- Replace all `req.user.id` with `const userId = 1` (7 occurrences)
- Remove `import { put } from '@vercel/blob'`
- Remove `import { v4 as uuidv4 } from 'uuid'`
- Add `import { randomUUID } from 'node:crypto'`
- Add `import fs from 'node:fs'` and `import path from 'node:path'`
- In `parse-recipe-image` handler, replace Blob upload:
  ```js
  // Before:
  const { url } = await put(`${uuidv4()}${ext}`, req.file.buffer, { access: 'public' });

  // After:
  const filename = randomUUID() + ext;
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, filename), req.file.buffer);
  const url = '/uploads/' + filename;
  ```

---

## `server/services/recipeService.js`

- Remove `import { del } from '@vercel/blob'`
- Add `import fs from 'node:fs'` and `import path from 'node:path'`
- In `remove()`, replace Blob delete:
  ```js
  // Before:
  if (existing.imageUrl?.startsWith('http')) {
    del(existing.imageUrl).catch(...);
  }

  // After:
  if (existing.imageUrl?.startsWith('/uploads/')) {
    const filename = existing.imageUrl.replace('/uploads/', '');
    fs.unlink(path.join(process.env.UPLOADS_DIR, filename), () => {});
  }
  ```

---

## `server/routes/pantry.js`, `recipes.js`, `shopping.js`

For each file:
- Remove `requireAuth` import
- Remove `router.use(requireAuth)`
- Replace all `req.user.id` with `const userId = 1`
  - `pantry.js`: 8 occurrences
  - `recipes.js`: 5 occurrences
  - `shopping.js`: 6 occurrences

---

## `server/app.js`

- Remove `cors` import and `app.use(cors(...))`
- Remove `cookieParser` import and `app.use(cookieParser())`
- Remove `helmet` CSP customization (simplify to `app.use(helmet())`)
- Remove `CLIENT_ORIGIN` env var reference
- Add: `app.use('/uploads', express.static(process.env.UPLOADS_DIR))`
- Remove: `/api/auth` route registration
- `GET /api/health` at line 47 — **already exists, no change needed**

---

## `client/src/App.jsx`

- Remove `AuthProvider`, `ProtectedRoute`, `LoginPage` imports
- Remove `/login` route
- Remove `<AuthProvider>` wrapper
- Remove `<ProtectedRoute>` wrapper (routes render directly under `<AppLayout>`)
- Add `import SettingsPage from './pages/SettingsPage.jsx'`
- Add `/settings` route → `<SettingsPage />`

---

## `client/src/api/index.js`

- Remove the `if (res.status === 401 ...)` redirect block (dead code without auth)

---

## `client/src/components/layout/Sidebar.jsx`

- Add Settings nav link pointing to `/settings`

---

## Root `package.json` (new)

```json
{
  "name": "kitchen-keeper",
  "version": "2.0.0",
  "main": "electron/main.js",
  "scripts": {
    "dev":          "concurrently \"npm run dev:client\" \"npm run dev:electron\"",
    "dev:client":   "vite --cwd client",
    "dev:electron": "wait-on tcp:5173 && electron .",
    "build":        "vite build --cwd client && electron-builder",
    "build:win":    "electron-builder --win",
    "build:mac":    "electron-builder --mac",
    "build:linux":  "electron-builder --linux",
    "postinstall":  "electron-builder install-app-deps"
  },
  "build": {
    "appId": "com.connorsharpe.kitchenkeeper",
    "productName": "Kitchen Keeper",
    "asar": true,
    "directories": { "output": "dist-electron" },
    "files": [
      "electron/**/*",
      "server/**/*",
      "client/dist/**/*",
      "drizzle/**/*",
      "!server/node_modules/.cache",
      "!**/*.map"
    ],
    "extraResources": [
      { "from": "drizzle", "to": "drizzle" }
    ],
    "nativeRebuilder": "sequential",
    "win":   { "target": "nsis",     "icon": "electron/assets/icon.ico"  },
    "mac":   { "target": "dmg",      "icon": "electron/assets/icon.icns" },
    "linux": { "target": "AppImage", "icon": "electron/assets/icon.png"  }
  }
}
```

`"postinstall": "electron-builder install-app-deps"` rebuilds native modules
(including `better-sqlite3`) against the Electron ABI on every `npm install`.

`extraResources` copies the `drizzle/` migrations folder outside of `app.asar`
so `path.join(process.resourcesPath, 'drizzle')` resolves correctly in packaged builds.

---

## `.env.example`

Remove: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `CLIENT_ORIGIN`, `INVITE_CODE`, `JWT_SECRET`

Keep (local dev only — Electron sets these automatically in production):
```
GEMINI_API_KEY=your_key_here
DB_PATH=./dev.db
UPLOADS_DIR=./uploads
PORT=3001
```

---

# Dependency Chain

## Editing:
- `server/db/client.js`
- `server/db/schema.js`
- `server/routes/ai.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `server/services/recipeService.js`
- `server/app.js`
- `client/src/App.jsx`
- `client/src/api/index.js`
- `client/src/components/layout/Sidebar.jsx`

## New:
- `electron/main.js`
- `electron/preload.js`
- `electron/assets/icon.*`
- `client/src/pages/SettingsPage.jsx`
- Root `package.json`

## Deleting:
- `api/index.js`
- `vercel.json`
- `server/db/migrate.js`
- `server/routes/auth.js`
- `server/middleware/auth.js`
- `client/src/context/AuthContext.jsx`
- `client/src/components/layout/ProtectedRoute.jsx`
- `client/src/pages/LoginPage.jsx`

## Verify before touching (expected clean — grep for `req.user`, `blob`, `neon` before skipping):
- `server/services/pantryService.js`
- `server/services/chatService.js`
- `server/services/shoppingService.js`
- `server/services/aiService.js`
- `server/middleware/validate.js`
- `server/middleware/upload.js`

---

# Acceptance Criteria

1. `npm run dev` opens a native desktop window — no login screen, goes straight to Dashboard
2. All five pages load (Dashboard, Pantry, Recipes, Shopping, Chat) plus Settings
3. Pantry CRUD operations persist to SQLite in `userData` across app restarts
4. Receipt scan (photo → Gemini → items) works end-to-end
5. Recipe image upload stores file in `userData/uploads/` and displays in UI
6. Deleting a recipe with an image removes the file from `userData/uploads/`
7. Gemini chat responds correctly
8. Settings page saves Gemini API key; AI features work after saving
9. App opens and shows all existing data while disconnected from the internet
10. Reconnecting internet restores AI features without restart
11. `npm run build:win` produces an installable `.exe` with no build errors
12. **Fresh install on a machine with no existing database** — app creates database automatically and loads successfully on first launch
13. No Vercel, Neon, or Blob references remain in any non-deleted file
14. Packaged build launches successfully on a machine with no Node.js installed

---

# Verification Steps

```
1.  npm run dev → window opens, Dashboard visible, no login screen         ✓
2.  Add pantry item → quit → relaunch → item persists                      ✓
3.  Upload recipe image → visible in recipes list                           ✓
4.  Delete recipe with image → file gone from userData/uploads/             ✓
5.  Scan receipt photo → items appear in preview                            ✓
6.  Ask kitchen chat → response received                                    ✓
7.  Disconnect internet → relaunch → all data visible, no crash            ✓
8.  Reconnect internet → AI features work without restart                   ✓
9.  Enter Gemini key in Settings → save → AI calls succeed                  ✓
10. npm run build:win → dist-electron/*.exe produced, no errors             ✓
11. Install .exe → fresh machine (no DB) → app creates DB, loads dashboard ✓
```

---

# Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `better-sqlite3` ABI mismatch in packaged build | Medium | `postinstall` runs `install-app-deps`. Windows requires Visual Studio Build Tools installed. |
| Drizzle migrations path in packaged `.asar` | Medium | `extraResources` copies `drizzle/` outside asar. Main uses `app.isPackaged ? process.resourcesPath : __dirname` path branch. |
| `server/package.json` `"type": "module"` vs Electron CJS | Medium | `electron/main.js` is CJS (no `"type":"module"` in root `package.json`). Uses dynamic `import()` to load `server/app.js` (ESM) — same pattern as the deleted `api/index.js`, proven to work. |
| Dev race: Electron loads before Vite ready | Low | `wait-on tcp:5173` in `dev:electron` script blocks until Vite is accepting connections. |
| Port collision on startup | Low | `get-port` resolves a free port before Express binds. |
| Gemini key missing on first launch | Low | AI routes return `{ error: 'Gemini API key not configured — see Settings.' }`. App does not crash. |
| Helmet CSP removal side-effects | Low | Previous CSP allowed `img-src: self data: https:`. After simplifying to `app.use(helmet())`, verify recipe images and any external image sources still load correctly in the window. |
| macOS Gatekeeper / Windows SmartScreen | Low | Personal use: right-click → Open (Mac), "More info → Run anyway" (Windows). |
| Multi-profile future compatibility | Low | `INSERT OR IGNORE user (id=1)` seed works for single-user. If multi-profile support is added later, this bootstrap logic must be revisited before adding a profiles table. |

---

# Recommended Implementation Order

1. Root `package.json` + `electron/main.js` skeleton — open a window with a placeholder page
2. SQLite schema + client swap — verify server starts standalone with SQLite
3. Auth removal — strip `requireAuth` from all four route files, hardcode `userId = 1`
4. Blob → filesystem — `ai.js` upload + `recipeService.js` delete
5. `server/app.js` cleanup — remove CORS/cookies, add static uploads
6. Wire Electron main: full boot sequence (migrate, seed, Express, health poll, window)
7. `drizzle-kit generate` — generate migrations folder, commit it
8. IPC config — `preload.js` + `ipcMain` handlers + `SettingsPage.jsx`
9. Delete all legacy files
10. `npm run build:win` — smoke test packaged build end-to-end

---

# Context Notes

- branch: main
- worktree: recommended for implementation (`task/002-electron`)
- context pressure: low
- Vercel deployment remains live and untouched until Electron build is fully validated
