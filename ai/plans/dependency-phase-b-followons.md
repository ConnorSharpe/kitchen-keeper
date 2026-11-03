# Dependency Security Phase B — follow-on investigation and scopes

Split out of TASK-071 (DRAFT-2, 2026-11-03) to keep that spec focused. Baseline advisories: TASK-071 §0.
Each follow-on gets its own TASK file once TASK-071 is approved.

## Baseline (2026-11-03, `npm audit --omit=dev`, after TASK-070)

| Advisory | Package | Path | Sev | Fix | Real exposure here |
|---|---|---|---|---|---|
| GHSA-gpj5-g38j-94v9 (escaping in `sql.identifier()`/`.as()`) | drizzle-orm 0.29.5 | direct | high | ≥0.45.2 | None: one `.as('trigger')` constant, no `sql.identifier` |
| GHSA-mrhx-c7xc-m3w5 (OOM: array schema issues accumulate) | zod 3.25.76 | direct, + openai 4 peer, + drizzle-kit (dev) | high | ≥4.6.6, **no 3.x fix** | **Yes:** unbounded `z.array` on authed routes, 10mb JSON limit |
| (via zod peer) | openai 4.104.0 | direct | high | openai ≥6 (peer `^3.25 \|\| ^4.0`) | n/a |
| GHSA-x8mw-p69m-v3mx, GHSA-gxm5-99cw-xjw9 + 15 undici | @fastify/busboy 2.1.1, undici 5.29 | @vercel/blob 0.27.3 | high | blob ≥2.0.1 (undici ^6.23) | Low: outbound calls to Vercel API only |
| GHSA-wrjc-x8rr-h8h6 (external redirect, `>=6 <7.18`) | react-router 6.30.6 (client) | direct | mod | ≥7.18.0, **no 6.x fix** | None: every `navigate`/`<Navigate>` uses a constant path |
| GHSA-337j-9hxr-rhxg (SSR hydration) | react-router (client) | direct | mod | ≥7.18.0 | None: Declarative Mode is unaffected (advisory text) |

## zod 4 + openai 6

- zod: 16 server files (10 routes, 6 chat handlers), none in the client. Unbounded arrays: `recipes.js`
  (ingredients, steps, tags), `ai.js` (steps), `shopping.js` (recipeIds).
- v4 effects: **default messages change** ("Required" → "Invalid input: expected …"), and `validate.js` sends
  `issues[].message` in 400 bodies, so this is user-visible. `.default()` short-circuits on undefined (no
  `.optional().default()` combinations found). `.email()/.url()/.datetime()` are deprecated but work (keep them).
  `.refine(fn,'string')` is unconfirmed. `ZodError.message` format changes (it goes to the model only).
  `zod/v3` is no escape (all of 3.x is affected).
- openai: zod 4 needs openai ≥6.0.0 (latest 6.49.0; 7.x requires Node ≥22). No `zodResponseFormat` in use.
  Call sites: `openaiProvider.js`, `aiService.js` (`new OpenAI`), `transcribe.js` (`toFile` from `'openai'`:
  root export in 6.x unconfirmed). Embeddings now default to base64, decoded by the SDK.

## @vercel/blob 2.x

One file: `recipeService.js` calls `put(\`recipes/${hh}/${uuid}.${ext}\`, buf, {access:'public', contentType})` and
`del(url)` ×2. 1.0 changes: `addRandomSuffix` defaults to false and overwrite needs `allowOverwrite`. Our paths
are UUID-unique, and old URLs stay deletable. `BLOB_READ_WRITE_TOKEN` still works (OIDC added with fallback).
The first version on undici 6 is **2.0.1**. Node ≥20. No receipt path uses Blob, contrary to
SYSTEM_OVERVIEW; fix that wording in TASK-073.

## react-router-dom 7

8 client files, Declarative Mode only, no data router or SSR. `App.jsx:114` already sets `v7_startTransition` and
`v7_relativeSplatPath`; the other flags are data-router only. `react-router-dom@7` still re-exports
`react-router`, so imports stay unchanged. Peer `react >=18` (18.3.1 installed); Node ≥20. v8 drops
`react-router-dom` and needs React 19, so it is out of scope.

## Follow-on task scopes

**TASK-075 (if Q1 accepted): interim zod array bounds.** Allowed: `recipes.js`, `ai.js`, `shopping.js` schemas
and their route tests. Draft ACs: each of the five arrays has a `.max(N)` with N recorded and justified against
real usage; an N+1 array → 400 on each route; an N array still passes. No dependency changes.

**TASK-072: zod 4.6.7 + openai 6.49.x.** Allowed: `server/package*.json`; zod files only where v4 forces
changes; `transcribe.js`, `openaiProvider.js`, `aiService.js`. Gates: `.refine(fn,'string')` in v4; `toFile`
root export in 6.x; embeddings still a length-1536 `number[]`; client reliance on zod message text
(`client/src/api/index.js:104`). Draft ACs: zod and openai are cleared from the audit; the existing route tests
are green; one pinned 400 message per `validate.js` path (custom messages unchanged, default text explicitly
accepted as changed); a 200k-element failing array to `POST /api/recipes` → 400 within a stated heap bound
(with TASK-075 in place, this becomes "rejected by `.max()` before element validation").
Smoke: streaming chat with a tool call, recipe/receipt parse, transcription, semantic search.

**TASK-073: @vercel/blob 2.8.x.** Requires G6. Allowed: `server/package*.json`, `recipeService.js` if needed,
SYSTEM_OVERVIEW. Draft ACs: undici 5 and @fastify/busboy are gone from `npm ls` and the audit; `put` keeps
`{access:'public', contentType}`. Smoke: upload, replace (the old blob is deleted), delete a recipe, delete a
recipe whose image URL predates the upgrade.

**TASK-074: react-router-dom 7.18.5.** Requires G6. Allowed: `client/package*.json`, `App.jsx` (drop the
now-default flags), the 8 router files only if forced. Draft ACs: client audit 0; tests and build green. Smoke:
every `App.jsx` route, the `/chat` → `/` redirect, the join flow, NavLink active state, back/forward, the PWA
offline shell.

