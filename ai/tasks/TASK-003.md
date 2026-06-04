# TASK-003: Remediation — Service Layer, Error Handling, joinCode, .env.example

**Version:** 1.1 (architect Round 1 reviewed — implementation-ready)
**Author:** Claude Sonnet 4.6 (session 2026-06-03)
**Status:** IMPLEMENTATION-READY (1 architect review complete)
**Branch:** main (no worktree — direct commit)

---

## Review History

| Round | Key changes |
|-------|-------------|
| R1    | Initial draft |
| R2    | Acknowledged join-code format as behavioral change; tightened 23505 retry to constraint-specific check with verification note; clarified "3 total attempts"; moved normalization into service (with caller cleanup requirement); fixed verification step #3; added testability constraint; added sole-generator AC; added error message fallback |

---

## Project Snapshot

Stack and architecture invariants are fully documented in [TASK-001.md](TASK-001.md).
The invariants below are the ones this task specifically restores compliance with.

**Violated invariant (introduced by TASK-003):**
> Repository pattern only — no direct DB access in route handlers

---

## Background

TASK-003 shipped the household model and invite flow without a prior spec or architect review.
Four defects were identified in post-hoc code audit:

| # | Defect | Severity |
|---|--------|----------|
| 1 | `server/routes/household.js` queries `db` directly — violates repository pattern | Critical |
| 2 | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` absent from `.env.example` | Significant |
| 3 | `HouseholdPage.jsx` `load()` has no try/catch/finally — infinite loading state on error | Significant |
| 4 | `generateJoinCode` uses `Math.random()` — can produce short/empty strings; no collision retry | Moderate |

This task fixes all four. It introduces no new features or behavioral changes.

---

## Goal

Restore architectural compliance and fix the three defects introduced by TASK-003.
No new routes, no schema changes, no behavioral changes to any user-facing flow.

---

## Scope: Four Deliverables

---

### Deliverable 1 — Extract `householdService.js`

**Problem:**
`server/routes/household.js` imports `db` directly and queries `households` and `users` tables
from within route handlers. `server/routes/auth.js` does the same for household operations
in its register handler.

**Fix:**
Create `server/services/householdService.js` following the same pattern as `pantryService.js`.
Move all household-related DB operations into it. Update both route files to use the service.

**Service API — four named exports (all async):**

```js
// Returns the household row or null.
export async function getById(householdId)

// Returns array of { id, name, email, createdAt } for all users in this household.
export async function getMembers(householdId)

// Returns the household row matching the join code, or null.
// Normalization (trim + toUpperCase) is performed inside the service — callers pass raw input.
export async function getByJoinCode(code)

// Creates a new household named "${ownerName}'s Household".
// Generates a cryptographically random 8-char hex join code.
// Maximum 3 total insert attempts. Retries only on join-code uniqueness constraint violation.
// After 3 collisions, rethrows — callers receive a 500.
export async function create(ownerName)
```

**Pattern reference:**
Follow `server/services/pantryService.js` exactly:
- Named exports, no default
- `import { db } from '../db/client.js'`
- `import { households, users } from '../db/schema.js'`
- `import { eq } from 'drizzle-orm'`
- Array destructuring: `const [row] = await db.insert(...).returning()`

**After extraction, `server/routes/household.js` must:**
- Remove `import { db } from '../db/client.js'`
- Remove `import { eq } from 'drizzle-orm'`
- Remove `import { households, users } from '../db/schema.js'`
- Add `import * as householdService from '../services/householdService.js'`
- Route handlers call service methods only

**After extraction, `server/routes/auth.js` must:**
- Remove `households` from `import { users, households } from '../db/schema.js'` → `import { users } from '../db/schema.js'`
- Add `import * as householdService from '../services/householdService.js'`
- Remove `generateJoinCode` function definition (it moves into the service)
- Replace direct household `select` (join by code) with `householdService.getByJoinCode(householdCode)`
  — pass `householdCode` raw. Do NOT call `.trim().toUpperCase()` on it first.
  Normalization is now the service's responsibility. Calling it at both sites would double-normalize.
- Replace direct household `insert` (create new) with `householdService.create(name)`

**CRITICAL — no behavioral change:**
The register flow must behave identically. The only change is where the DB calls live.
Verify: same error shapes, same status codes, same response bodies.

---

### Deliverable 2 — Fix `generateJoinCode` (crypto + collision retry)

**Problem:**
`generateJoinCode` in `auth.js` uses `Math.random().toString(36).slice(2, 10).toUpperCase()`.

Two defects:
1. `Math.random()` can return `0` → `(0).toString(36)` → `"0"` → `.slice(2, 10)` → `""` (empty string).
   This violates the `notNull` constraint and surfaces as a 500.
2. On a genuine join-code collision, Postgres throws error code `23505` on the household insert.
   The existing `23505` catch in `auth.js` only covers the `users` insert — the household insert
   is unguarded and also surfaces as a 500.

**Fix (lives inside `householdService.create()`):**

```js
import { randomBytes } from 'crypto';

function generateJoinCode() {
  // crypto.randomBytes(4) → 4 bytes → 8 uppercase hex chars, always exactly 8, always defined.
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function create(ownerName) {
  // 3 total attempts: 1 initial + 2 retries. Retry only on joinCode uniqueness collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [household] = await db
        .insert(households)
        .values({ name: `${ownerName}'s Household`, joinCode: generateJoinCode() })
        .returning();
      return household;
    } catch (err) {
      const isJoinCodeCollision =
        err.code === '23505' && err.constraint === JOIN_CODE_CONSTRAINT;
      if (!isJoinCodeCollision || attempt === 2) throw err;
    }
  }
}
```

Where `JOIN_CODE_CONSTRAINT` is a module-level constant holding the verified constraint name
(see "CRITICAL — Constraint Name Verification" below).

`generateJoinCode` is NOT exported — it is private to the service.

**CRITICAL — Constraint Name Verification (pre-implementation required):**

The retry loop must check `err.constraint` to avoid silently retrying on a different unique
violation (e.g., if the `households` table later gains a unique index on another column).

Drizzle ORM names inline `.unique()` constraints as `{tableName}_{columnName}_unique`.
For `households.join_code`, the expected name is **`households_join_code_unique`**.

The implementing agent MUST verify this before hardcoding. Two options:

Option A — Query the live DB:
```sql
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'households' AND constraint_type = 'UNIQUE';
```

Option B — Trigger a deliberate collision locally and log `err.constraint` to confirm.

If the actual name differs from `households_join_code_unique`, update the constant accordingly
and document the actual name in the commit message.

**Output format change (acknowledged):** codes are now 0-9, A-F (hex, 32-bit space = ~4.3B combinations).
Previously they were 0-9, A-Z (base36). Existing codes in the DB are unaffected.
This is an intentional improvement to the security properties of the generation, not a regression.

---

### Deliverable 3 — Fix `HouseholdPage.jsx` error handling

**Problem:**
`load()` in `HouseholdPage.jsx` has no try/catch/finally.
If either API call throws (e.g., the user's JWT lacks `householdId` after the TASK-003 deploy
and the server returns 401), `setLoading(false)` is never called. The page shows an infinite
loading spinner with no error message.

`api/index.js` throws `new Error(data.error || 'Request failed (${res.status})')` on non-2xx
responses (confirmed by reading `client/src/api/index.js`), so `err.message` will contain
the server's error string and is safe to display.

**Fix:**

Add `loadError` state. Wrap `load()` with try/catch/finally. Render an error state instead
of infinite loading. Include a retry button.

```js
const [loadError, setLoadError] = useState(null);

const load = useCallback(async () => {
  setLoading(true);
  setLoadError(null);
  try {
    const [h, m] = await Promise.all([
      api.get('/api/household'),
      api.get('/api/household/members'),
    ]);
    setHousehold(h.household);
    setMembers(m.members);
  } catch (err) {
    setLoadError(err.message || 'Failed to load household');
  } finally {
    setLoading(false);
  }
}, []);
```

Replace the current `if (loading)` early return with:

```jsx
if (loading) {
  return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
}
if (loadError) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm text-red-600">{loadError}</p>
      <button onClick={load} className="text-sm text-orange-600 hover:underline">Retry</button>
    </div>
  );
}
```

**CRITICAL — no-refactor constraint:**
Only add `loadError` state and the try/catch/finally. Do not restructure, rename, or clean up
any other part of `HouseholdPage.jsx`.

---

### Deliverable 4 — `.env.example` additions

**Problem:**
`server/services/emailService.js` reads `RESEND_API_KEY` and `RESEND_FROM_EMAIL` at runtime.
Neither is in `.env.example`. Anyone cloning the repo and following "Run Your Own Instance"
will hit a silent 503 when they try to send an invite, with no hint of what's missing.

**Fix:**
Add both entries to `.env.example` with comments, grouped after the existing `BLOB_READ_WRITE_TOKEN` entry:

```
# Resend email service — required for household invite emails (https://resend.com)
# ASCII only. Leave RESEND_API_KEY unset to disable email (POST /api/household/invite returns 503).
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM_EMAIL=you@yourdomain.com
```

---

## Allowed Files

```
server/services/householdService.js    ← new file
server/routes/household.js             ← refactor (remove direct DB, use service)
server/routes/auth.js                  ← refactor (remove household DB calls, use service)
client/src/pages/HouseholdPage.jsx     ← add error state + try/catch/finally
.env.example                           ← add two env var entries
```

---

## Forbidden Files

```
server/db/schema.js                    ← no schema changes
server/db/client.js                    ← no changes
server/db/migrate.js                   ← no changes
server/middleware/*                    ← no changes
server/services/emailService.js        ← already correct
server/services/pantryService.js       ← read-only reference only
server/routes/pantry.js                ← unrelated
server/routes/recipes.js               ← unrelated
server/routes/shopping.js              ← unrelated
server/routes/ai.js                    ← unrelated
client/src/context/AuthContext.jsx     ← no changes
client/src/context/PantryContext.jsx   ← no changes
client/src/components/**/*             ← no changes
client/src/App.jsx                     ← no changes
client/src/api/index.js                ← read-only reference only
api/index.js                           ← Vercel entry point, do not touch
vercel.json                            ← deployment config, do not touch
package.json                           ← no dependency changes (crypto is Node built-in)
```

---

## Constraints

1. No new npm dependencies. `crypto` is a Node.js built-in — no install required.
2. No DB schema changes. No migration.
3. No API or workflow behavioral changes. Newly generated join codes will use a cryptographically
   secure hexadecimal format — this is an intentional improvement, not a defect.
4. Service method signatures must match the four exports listed in Deliverable 1 exactly.
5. `generateJoinCode` must NOT be exported from `householdService.js` — it is private.
   `householdService.js` must be the SOLE location in the codebase responsible for generating
   join codes. No other file may define or call a join-code generator.
6. `generateJoinCode` must always return exactly 8 uppercase characters.
7. `householdService.create()` must retry only when the join-code uniqueness constraint is
   violated — not on any other 23505. See Deliverable 2 for constraint name verification.
   Maximum of 3 total insert attempts (1 initial + 2 retries). On the 3rd failure, rethrow.
8. The register flow in `auth.js` must produce identical HTTP responses before and after refactor.
9. `HouseholdPage.jsx` must not be refactored beyond adding the error state and try/catch/finally.
10. Existing join codes in the DB (base36) are unaffected — only new codes use the hex format.
11. Service functions must remain side-effect free except for database writes and must not
    access `req` or `res` objects. This keeps the service layer independently testable.

---

## Acceptance Criteria

### Deliverable 1 — Service extraction

- [ ] `server/services/householdService.js` exists and exports exactly: `getById`, `getMembers`, `getByJoinCode`, `create`
- [ ] `getByJoinCode` performs `.trim().toUpperCase()` normalization internally
- [ ] `server/routes/household.js` contains no `import.*db` and no `import.*drizzle-orm`
- [ ] `server/routes/household.js` contains no `import.*schema`
- [ ] `server/routes/auth.js` does not import `households` from schema
- [ ] `server/routes/auth.js` does not contain `generateJoinCode`
- [ ] `server/routes/auth.js` does not contain `db.insert(households)` or `db.select().from(households)`
- [ ] `server/routes/auth.js` does not call `.trim().toUpperCase()` on `householdCode` before passing to the service (normalization moved to service layer)
- [ ] `POST /api/auth/register` behavior is unchanged: creates household if no `householdCode`, joins existing if valid `householdCode`, returns 400 if invalid `householdCode`

### Deliverable 2 — joinCode fix

- [ ] `generateJoinCode` in `householdService.js` uses `randomBytes` from Node `crypto`
- [ ] `generateJoinCode` always returns exactly 8 uppercase characters
- [ ] `householdService.js` is the only file in the codebase that defines a join-code generator
- [ ] `householdService.create()` makes a maximum of 3 total insert attempts (1 initial + 2 retries)
- [ ] `householdService.create()` retries ONLY when `err.code === '23505'` AND `err.constraint` matches the verified join-code constraint name
- [ ] `householdService.create()` throws immediately on any other error
- [ ] `generateJoinCode` is not exported from `householdService.js`
- [ ] The join-code constraint name was verified against the live DB before being hardcoded

### Deliverable 3 — HouseholdPage error handling

- [ ] `HouseholdPage.jsx` has a `loadError` state variable
- [ ] `load()` has a `try/catch/finally` block — `setLoading(false)` is always called
- [ ] An error message is displayed when `loadError` is set
- [ ] A retry button is displayed alongside the error message
- [ ] Loading spinner still displays while `loading === true`

### Deliverable 4 — .env.example

- [ ] `.env.example` contains `RESEND_API_KEY` with comment
- [ ] `.env.example` contains `RESEND_FROM_EMAIL` with comment
- [ ] Comments explain that leaving `RESEND_API_KEY` unset disables email (503)

---

## Verification Steps

```
Pre-implementation (required before writing create()):
0. Verify the households join-code constraint name:
   Query: SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_name = 'households' AND constraint_type = 'UNIQUE';
   Expected: households_join_code_unique (Drizzle convention for inline .unique())
   Record actual name — use it as the JOIN_CODE_CONSTRAINT constant.

Post-implementation:
1. Grep household.js for 'from.*db/client' — must return no matches
2. Grep household.js for 'from.*drizzle-orm' — must return no matches
3. Grep household.js for 'from.*schema' — must return no matches
4. Grep auth.js for 'db.insert(households)' — must return no matches
5. Grep auth.js for 'db.select().from(households)' — must return no matches
6. Grep auth.js for 'generateJoinCode' — must return no matches
7. Grep auth.js for '.toUpperCase()' near 'householdCode' — must return no matches (normalization moved to service)
8. Read householdService.js — confirm all four exports, generateJoinCode is private, uses randomBytes
9. Read householdService.js — confirm create() retry checks BOTH err.code === '23505' AND err.constraint === JOIN_CODE_CONSTRAINT
10. Read householdService.js — confirm getByJoinCode normalizes internally with trim().toUpperCase()
11. Read HouseholdPage.jsx — confirm loadError state, try/catch/finally, error + retry render path, fallback message
12. Read .env.example — confirm RESEND_API_KEY and RESEND_FROM_EMAIL present with comments
```

Manual smoke test (after deploy):
```
1. Register new user → new household created → household page loads → join code displayed (8 uppercase hex chars)
2. Register second user with join code → joins household → household page shows both members
3. Navigate to Household page while logged out / with expired JWT → error message displayed, retry button visible
4. Send invite email → succeeds if RESEND_API_KEY is set, returns 503 with clear message if not
```

---

## Dependency Chain

**Editing:**
- `server/services/householdService.js` (new — written first)
- `server/routes/household.js` (depends on householdService.js being written first)
- `server/routes/auth.js` (depends on householdService.js being written first)
- `client/src/pages/HouseholdPage.jsx` (independent of server changes)
- `.env.example` (independent)

**Requires (read-only before editing):**
- `server/services/pantryService.js` — service pattern reference
- `server/db/client.js` — confirm db import path
- `server/db/schema.js` — confirm table and column names
- `client/src/api/index.js` — confirm error shape thrown on non-2xx (already confirmed: `err.message` is the server's error string)

**Irrelevant:**
- `server/services/aiService.js`
- `server/services/emailService.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `client/src/components/*`

**Implementation order:**
Write `householdService.js` first. Then refactor `household.js` and `auth.js` (order between
these two is arbitrary). Then `HouseholdPage.jsx` and `.env.example` (fully independent).

---

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `auth.js` is security-sensitive — refactor must not change register/login behavior | High | Verify: same status codes, same response bodies, same error shapes before and after |
| Hex join codes (0-9, A-F) are shorter character set than base36 (0-9, A-Z) | Low | 4 bytes = 2^32 possible codes — collision probability negligible for a family app |
| `create()` retry loop could mask a real 23505 on the `users` insert if code is wrong | Low | Retry loop is inside `create()` which only inserts into `households` — the users insert is in auth.js, outside the service |
| Implementing agent may not read `pantryService.js` before writing the service | Medium | Pre-read is required and listed in dependency chain above |

---

## Non-Goals (Explicitly Out of Scope)

| Non-Goal | Reason |
|----------|--------|
| Household rename / management features | New feature — separate spec |
| Removing a member from a household | New feature — separate spec |
| Changing join code format to UUID or ULID | Hex is sufficient; not worth the churn |
| Adding indexes to the `households` table | Schema change — separate task |
| Multer 1.x vulnerability | Pre-existing — listed in prior handoffs |

---

## Open Questions — Resolution Status

All three original questions resolved by architect in Round 1:

| Question | Resolution |
|----------|------------|
| Hex vs. base36 | **Approved: hex.** 32-bit space is sufficient for a family app. |
| Friendly error after 3 collisions | **Keep raw error / 500.** Three collisions indicate an operational issue, not a user-correctable problem. |
| Retry button UX | **Approved: `<button onClick={load}>`.** Redirecting away from the page would be worse UX. |

New question introduced in R2:

4. **Drizzle constraint name** — The retry loop checks `err.constraint` against a constant.
   Drizzle ORM convention for inline `.unique()` is `{tableName}_{columnName}_unique`, predicting
   `households_join_code_unique`. The implementing agent must verify this against the live DB
   before hardcoding (see Verification Step 0). If the actual name differs, document it in the
   commit message. No spec revision needed — the constant approach handles any name.

---

## Session End Protocol

When implementation is complete, the implementing agent MUST:

1. Update `ai/handoffs/CURRENT_STATE.md`
2. Record all five files modified
3. Record verification results (all grep checks + smoke test)
4. Record any remaining operational items

Then output:

```powershell
git add server/services/householdService.js server/routes/household.js server/routes/auth.js client/src/pages/HouseholdPage.jsx .env.example ai/handoffs/CURRENT_STATE.md ai/tasks/TASK-003.md
git commit -m "TASK-003: extract householdService, fix joinCode generation, fix HouseholdPage error handling, update .env.example"
git push
```

No worktree — working directly on main.
