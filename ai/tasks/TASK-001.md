# TASK-001: Invite-Code Registration Gate + Portfolio README

**Version:** 1.3 (post architect review — Round 3 / implementation-ready)
**Author:** Claude Sonnet 4.6 (session 2026-06-02)
**Status:** IMPLEMENTATION-READY (3 architect reviews complete)
**Branch:** main (no worktree — direct commit)

---

## Review History

This spec completed three rounds of GPT architect review before being marked implementation-ready.

| Round | Key changes |
|-------|-------------|
| R1    | Normalization (trim both sides), empty-string handling, case sensitivity, rate-limit non-goal, client payload warning |
| R2    | Single normalization source of truth, Zod middleware stripping risk, `400` status ruling, no-refactor constraint, spaces-only env test, inline error placement |
| R3    | All gaps closed. Status upgraded to implementation-ready. |

**Reviewer note:** Neither the original author nor any reviewer has read `LoginPage.jsx`.
The implementing agent's pre-read of that file is the last unvalidated surface.

---

## Project Snapshot

| Field              | Value                                                                      |
|--------------------|----------------------------------------------------------------------------|
| App name           | Kitchen Keeper                                                             |
| Live URL           | https://kitchen-keeper-connorsharpes-projects.vercel.app                  |
| Stack (frontend)   | React 18 + Vite + Tailwind CSS                                            |
| Stack (backend)    | Node.js + Express, deployed as a single Vercel Serverless Function        |
| Database           | Neon Postgres (serverless driver `@neondatabase/serverless`) + Drizzle ORM |
| AI                 | Google Gemini 2.0 Flash (`GEMINI_API_KEY`)                                |
| File storage       | Vercel Blob (`BLOB_READ_WRITE_TOKEN`)                                     |
| Auth               | JWT stored in `httpOnly`, `sameSite=strict` cookie                        |
| Validation         | Zod schemas on all route inputs via `server/middleware/validate.js`       |
| Entry point        | `api/index.js` (Vercel) wraps `server/app.js` (Express)                  |
| Last passing build | `23c3cde` — removed DB migration from `vercel-build` script              |

**Architecture invariants (must not be violated):**
- Repository pattern only — no direct DB access in route handlers
- All route inputs validated with Zod before any business logic
- No secrets hardcoded — all env vars, all read at runtime
- Drizzle ORM for all DB operations
- JWT middleware (`requireAuth`) wraps all protected routes
- SQLite is NOT used. Neon Postgres ONLY.

---

## Goal

Implement a lightweight invite-code registration gate so the live app is protected from
unauthorized API usage (Gemini key abuse), while the GitHub repo remains public for portfolio.

Then rewrite `README.md` to serve as a professional portfolio document.

---

## Design Model: Shared-Secret Gate (Not Authentication)

This is a shared-secret registration gate, NOT authentication. Implications:

- A single `INVITE_CODE` env var is the entire mechanism
- Anyone with the code can register; there is no per-user code
- This is intentionally minimal — the goal is deterrence, not airtight security
- Rate limiting is NOT implemented in this task (see Non-Goals)
- Mass registration by someone who has the code is an **accepted risk** for a portfolio app

This model was chosen deliberately over a DB-backed code table. Do NOT suggest migrating
to DB-stored codes — that is explicitly out of scope.

---

## Scope: Two Deliverables

### Deliverable 1 — Invite-Code Gate

**Server side (`server/routes/auth.js`):**

Step-by-step logic for the `POST /api/auth/register` handler:

```
1. Zod validates the incoming body (including inviteCode as optional string)
2. const envCode = (process.env.INVITE_CODE ?? '').trim()   ← single source of truth
3. If !envCode (falsy): gate is disabled → skip check, proceed
4. const submitted = (body.inviteCode ?? '').trim()
5. If submitted !== envCode: return 400 { <match existing auth.js error shape> }
   — do NOT log submitted value
   — do NOT reveal the expected value
6. Proceed with bcrypt + user insert
```

**Normalization — single source of truth (Round 2 fix):**
Use `(process.env.INVITE_CODE ?? '').trim()` — NOT `process.env.INVITE_CODE?.trim() ?? ''`.
Both are functionally identical in JS (optional chaining on undefined produces undefined,
then `?? ''` gives `''`), but the nullish-coalescing-first form is explicit and avoids
optional chaining ambiguity in the reader's mental model.

**Why the falsy guard handles all empty cases:**
`''` is falsy in JavaScript. `!''` is `true`. The single `if (!envCode)` guard covers:
- env var not set (`undefined` → trimmed → `''` → falsy)
- env var set to `""` (→ trimmed → `''` → falsy)
- env var set to `"   "` (spaces only → trimmed → `''` → falsy)

The implementing agent does NOT need a secondary empty-string check. Do not over-engineer.

**Normalization rules:**
- Both sides trimmed as shown above
- Codes are **case-sensitive** — no `.toLowerCase()` on either side
- No unicode normalization — ASCII invite codes only (document this in `.env.example`)

**Comparison:**
- Use strict equality `===`
- Constant-time comparison is NOT required — this is a shared secret, not a per-user
  credential. The risk profile doesn't warrant `crypto.timingSafeEqual` complexity.
  (Round 1 feedback accepted; this constraint is now explicit, not hedged.)

**Zod schema:**
```js
// Register schema addition
inviteCode: z.string().trim().optional()
// NOT .default('') — we want undefined vs '' to behave differently:
// undefined → body.inviteCode ?? '' → '' → gate check handles it
// '' → same path
// 'correctcode' → passes gate
// Zod .optional() is correct. Do not use .default('').
```

**CRITICAL — Zod middleware stripping (Round 2 addition):**
The existing `validate.js` middleware may use `.strict()` or strip fields not in the schema.
Before implementation, confirm that `inviteCode` is present in the **parsed output** that
reaches the route handler. If middleware strips unknown fields, adding `inviteCode` to the
Zod schema explicitly is what prevents it from being dropped — the `.optional()` declaration
is not just for type safety, it is what keeps the field alive through validation.

**Error response shape:**
Must match the existing error format used elsewhere in `auth.js`.
Before implementing, the agent must grep `auth.js` for existing error responses and confirm
the shape. If existing errors use `{ message: '...' }`, use that. If they use `{ error: '...' }`,
use that. Do not invent a new shape. The spec uses `{ error: '...' }` as a placeholder —
match the actual convention.

**HTTP status code — RESOLVED (Round 2):**
Use `400 Bad Request`. Reasoning:
- `403` is semantically incorrect pre-authentication (implies identity was established)
- `422` is valid but introduces inconsistency unless already used in `auth.js`
- `400` aligns with Zod validation semantics and matches frontend form error expectations

**Override rule:** If `auth.js` already uses a different status for validation failures,
match that convention. The spec defaults to `400` — the implementing agent's grep of
existing error responses takes precedence.

**Client side (`client/src/pages/LoginPage.jsx`):**

- Add an "Invite Code" `<input type="text">` to the registration form, NOT the login form
- Field renders only when the UI is in "register" mode
- Label: `Invite Code` — placeholder: `Required for live demo`
- NOT marked `required` in HTML (dev graceful fallback)
- Value included in the `POST /api/auth/register` fetch body as `inviteCode`

**CRITICAL — serialization warning (Round 1 addition):**
The implementing agent must ensure `inviteCode` is included in the **same payload object**
as existing registration fields (`email`, `password`, etc.). If the existing form uses a
helper function or `FormData` serialization, the agent must verify that `inviteCode` is not
silently dropped. Read the existing fetch/submit handler before adding the field.

**CRITICAL — no-refactor constraint (Round 2 addition):**
The implementing agent must NOT refactor, restructure, or clean up existing form state,
handlers, or validation logic in `LoginPage.jsx`. Only extend what exists to include `inviteCode`.
Unsolicited refactoring of an unread file is the most common LLM failure mode on this class
of task.

**Environment:**
- Add `INVITE_CODE=your-secret-invite-code` to `.env.example`
- Add comment: `# ASCII only. Case-sensitive. Avoid ambiguous chars (O/0, l/1). Leave unset or empty to disable in dev.`
- Owner adds the real value to Vercel project settings manually (not in this task)

---

### Deliverable 2 — README Rewrite

New `README.md` structure (in order):

1. **# Kitchen Keeper** — one-paragraph description: AI-powered food waste management app.
   Add pantry items manually or by scanning a grocery receipt. See what's expiring.
   Get AI meal suggestions, save recipes, build shopping lists, chat with an AI kitchen assistant.

2. **## Live Demo** — link + note:
   > Live demo available at [kitchen-keeper URL]. Invite code required — unauthorized
   > registrations are blocked to protect shared API resources. Contact Connor to request access.

3. **## Tech Stack** — table matching the Project Snapshot above

4. **## Features** — bulleted list:
   - Receipt scanning (image → Gemini vision → structured pantry items)
   - Expiry tracking with color-coded urgency
   - "Eat This Now" AI meal suggestions from expiring ingredients
   - Recipe save, manage, and web search
   - Shopping list builder
   - AI chat assistant ("Explore" tab)
   - Freeze toggle with AI storage tips
   - Waste-saved counter

5. **## Run Your Own Instance** — numbered steps:
   1. Clone the repo
   2. `cp .env.example .env` and fill in all values
   3. Create a [Neon](https://neon.tech) Postgres database — copy `DATABASE_URL`
   4. Get a [Gemini API key](https://aistudio.google.com) (free tier available)
   5. Deploy to [Vercel](https://vercel.com) — add all env vars from `.env.example`
      (Neon and Blob integrations auto-provide their tokens via Vercel marketplace)
   6. Run migrations: `npx drizzle-kit push` (from project root, with `.env` populated)
   7. Visit the deployed URL and register (leave `INVITE_CODE` unset on your own instance)

6. **## Environment Variables** — table:

   | Variable              | Description                                              | Source                  |
   |-----------------------|----------------------------------------------------------|-------------------------|
   | DATABASE_URL          | Neon Postgres connection string                          | Neon Vercel integration |
   | JWT_SECRET            | Secret for signing auth cookies                          | Set manually            |
   | GEMINI_API_KEY        | Google Gemini API key                                    | Google AI Studio        |
   | NODE_ENV              | `production` on Vercel                                   | Set manually            |
   | CLIENT_ORIGIN         | Frontend URL for CORS                                    | Set manually            |
   | INVITE_CODE           | Registration gate secret. Omit or leave empty to disable | Set manually            |
   | BLOB_READ_WRITE_TOKEN | Vercel Blob access token                                 | Vercel Blob integration |

7. **## Local Development**
   ```bash
   npm install
   cp .env.example .env   # fill in values
   npm run dev            # Express on :3001, React on :5173
   ```

---

## Allowed Files

```
server/routes/auth.js
client/src/pages/LoginPage.jsx
README.md
.env.example
```

---

## Forbidden Files

```
server/services/*          — no service layer changes
server/db/*                — no schema or migration changes
server/routes/pantry.js    — unrelated
server/routes/recipes.js   — unrelated
server/routes/shopping.js  — unrelated
server/routes/ai.js        — unrelated
client/src/components/**/* — LoginPage only, no component changes
client/src/hooks/*         — unrelated
client/src/context/*       — unrelated
api/index.js               — Vercel entry point, do not touch
vercel.json                — deployment config, do not touch
package.json               — no dependency changes
```

---

## Constraints

1. Use strict equality `===` for invite code comparison. No bcrypt, no `crypto.timingSafeEqual`.
2. Trim both sides before comparison — env var AND submitted value.
3. Codes are case-sensitive. No case normalization.
4. The submitted invite code must NEVER appear in `console.log`, `console.error`, or any logger.
5. The error response must NEVER reveal the expected value.
6. The error response shape must match the existing convention in `auth.js` (grep before writing).
7. The client field renders only in register mode, not login mode.
8. The Zod schema uses `.optional()` — NOT `.default('')`.
9. `inviteCode` must be included in the existing fetch body payload, not added separately.
10. No new npm dependencies.
11. No DB schema changes.
12. README describes actual deployed stack only (Gemini, Neon Postgres, Vercel Blob).
13. Do NOT refactor, restructure, or clean up existing logic in `LoginPage.jsx`. Extend only.

---

## Non-Goals (Explicitly Out of Scope)

These were raised in Round 1 review and deliberately deferred:

| Non-Goal | Reason |
|----------|--------|
| Rate limiting on `/register` | Not required for a portfolio app; low traffic expected |
| Per-IP throttling | Overkill; no infra for it without a new dependency |
| Multiple invite codes | Single env var is sufficient; rotation is a future concern |
| Code rotation / expiry | Premature; owner distributes manually |
| DB-backed code table | Explicit rejection — adds schema complexity for no benefit |
| `crypto.timingSafeEqual` | Risk profile doesn't justify it for a shared secret |

---

## Pre-Implementation Required Reads

**CRITICAL — LoginPage.jsx (UNREAD by any agent):**

The implementing agent MUST read `client/src/pages/LoginPage.jsx` before touching it.
Determine:
- How login/register toggle is implemented (boolean state? URL param? enum?)
- How form submission constructs the request body (manual object? FormData? helper?)
- Which fields exist in the register form and how they are named
- Whether any field validation or serialization helper could drop unknown fields

**Recommended — auth.js error convention:**

Grep existing error responses in `server/routes/auth.js` to confirm shape before writing
the invite code error. Do not assume `{ error: '...' }` — verify.

---

## Acceptance Criteria

### Invite-Code Gate

- [ ] Correct code → `201 Created`, user registered
- [ ] Wrong code → `400` (or matching convention), body matches auth.js error shape, no user created
- [ ] No code submitted + `INVITE_CODE` env unset → `201 Created` (dev fallback)
- [ ] No code submitted + `INVITE_CODE` env set → `400` error (empty string fails gate)
- [ ] `INVITE_CODE` env set to `""` (empty string) → gate disabled (treated as unset)
- [ ] `INVITE_CODE` env set to `"   "` (spaces only) → gate disabled (trimmed to `''`, falsy)
- [ ] Correct code with leading/trailing whitespace → still accepted (both sides trimmed)
- [ ] Wrong code with correct casing except one char → rejected (case-sensitive)
- [ ] Login flow (`POST /api/auth/login`) completely unaffected
- [ ] Server logs contain no trace of the submitted invite code value

### Client Form

- [ ] Register form shows "Invite Code" input
- [ ] Login form does NOT show "Invite Code" input
- [ ] `inviteCode` is present in the fetch body on register submission
- [ ] Error from server surfaces as a readable message displayed **inline near the form** — not console-logged only, not in a modal, not a silent failure

### README

- [ ] Stack table matches actual deployment (Gemini, Neon, Vercel Blob — NOT Anthropic/SQLite)
- [ ] Live demo link present with invite-code note and framing
- [ ] "Run Your Own Instance" guide is accurate and complete
- [ ] Env var table present and complete

### .env.example

- [ ] `INVITE_CODE` present with correct comment (ASCII only, case-sensitive, omit to disable)

---

## Verification Steps

```
1. Read server/routes/auth.js — confirm INVITE_CODE check is before bcrypt call
2. Read server/routes/auth.js — confirm submitted inviteCode does not appear in any log
3. Read server/routes/auth.js — confirm error response shape matches existing convention
4. Read client/src/pages/LoginPage.jsx — confirm inviteCode field is render-gated
5. Read client/src/pages/LoginPage.jsx — confirm inviteCode is in the fetch body payload
6. Read .env.example — confirm INVITE_CODE present with comment
7. Grep auth.js for 'inviteCode' — must not appear in console.log/error calls
8. Test: submit correct code with trailing space — should still pass (trim working)
9. Test: set INVITE_CODE to spaces-only string → registration should succeed (treated as disabled)
10. Confirm inviteCode is present in Zod schema AND in parsed body reaching the handler (middleware stripping check)
```

Manual smoke test (after Vercel deploy):
```
1. Register with correct invite code → succeeds
2. Register with wrong code → error shown in UI
3. Register with correct code + trailing space → succeeds
4. Login → unaffected, no invite code field visible
```

---

## Dependency Chain

**Editing:**
- `server/routes/auth.js`
- `client/src/pages/LoginPage.jsx`
- `README.md`
- `.env.example`

**Requires (read-only before editing):**
- `server/middleware/validate.js` — Zod pattern reference
- `server/middleware/auth.js` — route convention reference

**Irrelevant:**
- `server/services/*`
- `server/db/*`
- `client/src/components/*`
- `client/src/hooks/*`
- `client/src/context/*`

---

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| LoginPage.jsx structure unknown to all agents | High | MUST read before editing; check serialization helpers |
| auth.js error shape assumed incorrectly | Medium | Grep before writing the 4xx response |
| Invite code logged accidentally | High | Grep verification step before commit |
| HTTP status code | Resolved | Use `400`; override if auth.js uses different convention |
| Env var set to empty string mishandled | Low | Falsy guard already covers this — do not over-engineer |

---

## Open Questions — All Resolved After Round 2

| Question | Resolution |
|----------|------------|
| HTTP status code | `400 Bad Request`; override if auth.js uses different convention |
| Client-side validation | No `required` attribute. Server is source of truth. Inline server error is sufficient. |
| LoginPage.jsx risk | Pre-read is sufficient. No-refactor constraint (Constraint 13) is the safeguard. |

---

## Out of Scope (Documented Follow-Up Tasks)

- Health endpoint: add `db: 'connected'` to `GET /api/health`
- Multer 1.x vulnerability: upgrade to 2.x
- Rate limiting on `/register` endpoint
- PWA / Capacitor packaging
- Smoke test on iPhone

---

## Session End Protocol

When implementation is complete, the implementing agent MUST:

1. Update `ai/handoffs/CURRENT_STATE.md`
2. Record all files modified
3. Record verification results
4. Record remaining smoke test items

Then output:

```powershell
git add server/routes/auth.js client/src/pages/LoginPage.jsx README.md .env.example ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-001: add invite-code gate and rewrite README for portfolio"
git push
```

No worktree — working directly on main.
