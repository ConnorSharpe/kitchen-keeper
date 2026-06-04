# TASK-007 — Staples Checklist (First-Login Onboarding)

Version: DRAFT-9 (Implementation Ready)
Status: APPROVED. Ready for implementation.

---

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial design |
| DRAFT-2 | Not approved | POST /pantry/bulk already exists; JWT re-issue; AuthContext.completeOnboarding(); safeUser contract |
| DRAFT-3 | Not approved | DB-backed /me; onboardingComplete removed from JWT; middleware unchanged |
| DRAFT-4 | Not approved | sessionStorage escape hatch; req.user identity contract; hydration authority |
| DRAFT-5 | Not approved | sessionStorage removed; idempotency boundary split |
| DRAFT-6 | Not approved | In-memory escape hatch; !loading gate; bulk/complete decoupled; deleted-user 401 documented |
| DRAFT-7 | Not approved | onComplete/onDismiss semantic split; invariants consolidated to 2 core rules; /me reverted to strict form |
| DRAFT-8 | Approved with change | dismissedForUserId (user-scoped dismissal); isEligible/showOnboarding derivation split; invariant #5 moved to semantic only; onboardingState machine (idle/error); "Dismiss for now" button |
| DRAFT-9 | APPROVED | Replace dismissedForUserId with onboardingDismissed boolean + useEffect reset on user?.id change; removes identity-coupling in state values |

---

## DRAFT-8 → DRAFT-9 Changes

### Required simplification — dismissedForUserId replaced

DRAFT-8's `dismissedForUserId === user?.id` identity-coupling pattern was unnecessary
indirection. Storing a user ID inside a UI state value to derive a boolean creates
avoidable reasoning overhead: any reader must understand the equality check, track what
`null` means, and reason about identity transitions during debugging.

DRAFT-9 replaces it with a plain boolean + explicit lifecycle reset:

```js
const [onboardingDismissed, setOnboardingDismissed] = useState(false);

useEffect(() => {
  setOnboardingDismissed(false);
}, [user?.id]);
```

The `useEffect` makes the lifecycle rule explicit and readable: when the authenticated
user changes, dismissal resets. No derived equality. No identity stored in UI state.
Easier to trace during debugging. Safety is equivalent — `user?.id` change covers logout,
re-login, and user switch.

---

## DRAFT-7 → DRAFT-8 Changes

### Must-Fix #1 — User-scoped dismissal state

DRAFT-7's `onboardingDismissed: boolean` was independent of user identity, creating a
drift risk if auth state changed while the boolean remained `true`. DRAFT-8 replaces it:

```js
const [dismissedForUserId, setDismissedForUserId] = useState(null);
const onboardingDismissed = dismissedForUserId === user?.id;
```

Dismissal is now explicitly scoped to the authenticated user's ID. A user switch, logout,
or re-login resets the derived `onboardingDismissed` to `false` automatically. `null`
initial value means no user is ever considered dismissed at first render.

### Must-Fix #2 — isEligible / showOnboarding derivation split

DRAFT-7's `showOnboarding` mixed server truth and UI suppression in a single expression.
DRAFT-8 separates them:

```js
const isEligible   = !loading && user?.onboardingComplete === false; // server truth only
const showOnboarding = isEligible && !onboardingDismissed;           // render decision
```

`isEligible` is pure server-derived state. `showOnboarding` is the render gate.
Both are documented explicitly so future readers don't conflate the two concerns.

### Must-Fix #3 — Invariant #5 moved to semantic form

DRAFT-7 still embedded the SQL implementation form inside a system invariant, then noted
it "may be replaced in future auth refactor" — a contradiction (invariants should be
stable truths; a mutable implementation detail is not). DRAFT-8 moves invariant #5 to
semantic form only: "/me resolves the user from the authenticated identity's unique
identifier." The concrete query form lives in the implementation section with a comment.

### Should-Clean #4 — onboardingState machine in StaplesChecklist

Replaced `showDismiss: boolean` + `error: string` with:
```js
const [onboardingState, setOnboardingState] = useState('idle'); // 'idle' | 'error'
const [errorMessage, setErrorMessage] = useState(null);
```

The dismiss button renders when `onboardingState === 'error'`, not when an independent
boolean happens to be `true`. Retry resets both. This makes the flow states explicit and
eliminates ambiguity between "user saw error but did nothing" and "user explicitly dismissed."

### Should-Clean #5 — "Dismiss for now" button text

"Continue without saving" implied a failed persistence operation. "Dismiss for now"
signals temporariness without implying a failed save.

---

## Pre-Spec Note

**TASK-008 is a 1–3 line server-side change** (pass all pantry items to recipe AI, not
just expiring ones). Not a dependency — onboarding UX works regardless. Without TASK-008,
staples added without expiry dates won't surface in recipe suggestions. Recommend shipping
alongside.

---

# Goal

Show a one-time staples checklist modal to newly registered users when they first land on
the Pantry page. The user selects common pantry items and bulk-adds them, or skips. The
modal never shows again after server-confirmed completion. On server failure, the user can
retry or dismiss for the current session — neither path corrupts DB or auth state.

This is a **client-orchestrated, server-authoritative state transition**: the UI drives
the flow; `onboardingComplete` is only committed by confirmed server mutation.

---

# Core Rules

## Persistence Rule
Only `POST /auth/onboarding-complete` may set `onboardingComplete = true` in the DB.
No client-side action, storage write, or optimistic update may produce this outcome.

## UI Dismissal Rule
Any modal closure that does not call `POST /auth/onboarding-complete` is purely visual.
It MUST NOT update `AuthContext` user state, write to any storage API, or be signalled
via a callback name that implies persistence (e.g. `onComplete`).

All derived behaviours (escape hatch, retry, bulk independence, session-scoped dismissal)
follow from these two rules.

---

# System Invariants

1. **DB is the sole persistent source of truth** for `onboardingComplete`. JWT never
   carries it.

2. **`req.user` is identity-only.** Contains `{ id, email, name, householdId }` from
   JWT decode. MUST NOT be read for application state.

3. **`safeUser()` is the sole serializer.** Every code path returning user data to the
   client MUST go through it.

4. **Hydration authority:**
   - *Initial hydration:* login/register return `safeUser(dbUser)` from a fresh DB row.
   - *Session rehydration:* `GET /me` always hits the DB and returns `safeUser(dbUser)`.

5. **`/me` resolves the user from the authenticated identity's unique identifier.**
   Implementation uses `users.id` (primary key). See implementation section for query form.

6. **`onboardingComplete === true` is permanent.** Once set via the Persistence Rule,
   never unset. Modal never shows for users with DB `true`.

7. **Any new user creation path MUST explicitly set `onboardingComplete: false`.** The DB
   `DEFAULT true` protects existing rows — it silently bypasses onboarding for any INSERT
   that omits the field.

8. **`POST /auth/onboarding-complete` is idempotent.** Repeated calls are a DB no-op.
   Always 200.

9. **`POST /pantry/bulk` is NOT idempotent.** Repeated calls insert duplicate rows.

10. **Modal eligibility (`isEligible`) is derived from server state only.**
    `isEligible = !loading && user?.onboardingComplete === false`. No client-side state
    contributes to eligibility. The render gate (`showOnboarding`) is a separate derivation
    that may add UI-only suppression (`onboardingDismissed`) on top of eligibility.

11. **Dismissal resets on user identity change.**
    `onboardingDismissed` is a plain boolean. A `useEffect` keyed on `user?.id` resets
    it to `false` whenever the authenticated user changes — covering logout, re-login,
    and user switch. No identity value is stored inside UI state.

12. **Stale JWT / deleted user:** `/me` returns 401 if DB user not found. `api/index.js`
    intercepts any 401 outside `/login` and redirects to `/login`. `AuthContext` catch
    sets `user = null`. No onboarding logic required.

---

# Allowed Files

**Creating:**
- `server/db/migrations/0003_onboarding_complete.sql`
- `client/src/components/onboarding/StaplesChecklist.jsx`

**Editing:**
- `server/db/schema.js` — add `onboardingComplete` to `usersTable`
- `server/routes/auth.js` — add `onboardingComplete` to `safeUser()`; set `false` on
  registration INSERT; make `/me` DB-backed; add `POST /auth/onboarding-complete`
- `client/src/context/AuthContext.jsx` — add `completeOnboarding()`
- `client/src/pages/PantryPage.jsx` — `isEligible`/`showOnboarding` derivation;
  `dismissedForUserId` state; `onComplete`/`onDismiss` callbacks;
  mount `<StaplesChecklist />`

---

# Forbidden Files

- `server/middleware/auth.js` — identity-only JWT mapping; no changes needed
- `server/routes/pantry.js` — `POST /pantry/bulk` already exists; untouched
- `server/services/pantryService.js` — untouched
- `server/routes/household.js` — unrelated
- `client/src/api/index.js` — 401 redirect already present; untouched
- `client/src/components/pantry/*` — untouched

---

# Current Code — Relevant Excerpts (for architect review)

## auth.js — serializer, token signer, /me, registration INSERT

```js
// signToken — identity only, UNCHANGED
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, householdId: user.householdId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// safeUser — currently missing onboardingComplete
function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, householdId: user.householdId };
}

// Registration INSERT — sole user creation path (auth.js:90)
[user] = await db.insert(users).values({ email, passwordHash, name, householdId }).returning();

// register response (auth.js:102)
res.status(201).json({ user: safeUser(user) });

// login SELECT — same db.select pattern used by /me (auth.js:109)
const [user] = await db.select().from(users).where(eq(users.email, email));

// login response (auth.js:123)
res.json({ user: safeUser(user) });

// /me — currently JWT passthrough, to become DB-backed
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
```

## middleware/auth.js — identity-only, UNCHANGED

```js
// onboardingComplete intentionally absent from req.user
req.user = { id: payload.sub, email: payload.email, name: payload.name, householdId: payload.householdId };
```

## api/index.js — 401 handler, UNCHANGED

```js
if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
  window.location.href = '/login';
  throw new Error('Session expired');
}
```

## AuthContext.jsx — current shape

```jsx
// { user, loading, login, register, logout }
// loading: true until /me resolves or fails
const [user, setUser] = useState(null);
const [loading, setLoading] = useState(true);
```

## pantry.js — existing bulk endpoint (lines 52–59, untouched)

```js
const bulkCreateSchema = z.object({ items: z.array(createSchema).min(1).max(100) });
router.post('/bulk', validate(bulkCreateSchema), async (req, res) => {
  const items = await pantryService.bulkCreate(req.user.householdId, req.body.items);
  res.status(201).json({ items });
});
// Correctly registered before all /:id routes
```

## schema.js — users table (no onboardingComplete yet)

```js
export const users = pgTable('users', {
  id:           serial('id').primaryKey(),
  householdId:  integer('household_id').notNull().references(() => households.id),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name:         text('name').notNull(),
  createdAt:    text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:    text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

---

# Dependency Chain

Creating:
- `server/db/migrations/0003_onboarding_complete.sql`
- `client/src/components/onboarding/StaplesChecklist.jsx`

Editing:
- `server/db/schema.js`
- `server/routes/auth.js`
- `client/src/context/AuthContext.jsx`
- `client/src/pages/PantryPage.jsx`

Irrelevant (confirmed):
- `server/middleware/auth.js`, `server/routes/pantry.js`, `server/services/pantryService.js`
- `client/src/api/index.js`, `client/src/components/pantry/*`

---

# Implementation Plan

## 1. `server/db/migrations/0003_onboarding_complete.sql` — NEW

```sql
ALTER TABLE "users"
  ADD COLUMN "onboarding_complete" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN users.onboarding_complete IS
  'TRUE = onboarding completed or skipped (modal never shows). '
  'FALSE = show staples checklist on first pantry visit. '
  'New registrations set FALSE explicitly — DEFAULT TRUE protects existing rows only. '
  'Any new user creation path MUST also set this to FALSE.';
```

---

## 2. `server/db/schema.js` — Modify

```js
name:               text('name').notNull(),
onboardingComplete: boolean('onboarding_complete').notNull().default(true),  // ← ADD
createdAt:          text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
```

---

## 3. `server/routes/auth.js` — Modify

### 3a. `safeUser`

```js
function safeUser(user) {
  return {
    id:                 user.id,
    email:              user.email,
    name:               user.name,
    householdId:        user.householdId,
    onboardingComplete: user.onboardingComplete,   // ← ADD
  };
}
```

`signToken` NOT modified.

### 3b. Registration INSERT

```js
[user] = await db.insert(users).values({
  email, passwordHash, name, householdId,
  onboardingComplete: false,   // ← ADD; overrides DEFAULT true for new registrations
}).returning();
```

### 3c. `/me` — DB-backed

```js
router.get('/me', requireAuth, async (req, res) => {
  // Resolves user from authenticated identity's unique identifier (users.id = primary key).
  // May be replaced with equivalent identity lookup in a future auth refactor.
  const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
  if (!user) {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }
  res.json({ user: safeUser(user) });
});
```

### 3d. `POST /auth/onboarding-complete`

```js
router.post('/onboarding-complete', requireAuth, async (req, res) => {
  const [updatedUser] = await db
    .update(users)
    .set({ onboardingComplete: true })
    .where(eq(users.id, req.user.id))
    .returning();
  res.json({ user: safeUser(updatedUser) });
});
```

Idempotent. No JWT re-issue.

---

## 4. `client/src/context/AuthContext.jsx` — Modify

```jsx
async function completeOnboarding() {
  const data = await api.post('/api/auth/onboarding-complete');
  setUser(data.user);
  // Throws on non-200. Caller handles error in UI.
}

<AuthContext.Provider value={{ user, loading, login, register, logout, completeOnboarding }}>
```

---

## 5. `client/src/components/onboarding/StaplesChecklist.jsx` — NEW

```jsx
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/index.js';

const STAPLES = [
  { category: 'Baking',            items: ['Flour', 'Sugar', 'Salt', 'Baking soda', 'Baking powder', 'Vanilla extract'] },
  { category: 'Grains & Pasta',    items: ['Rice', 'Pasta', 'Oats', 'Breadcrumbs'] },
  { category: 'Oils & Condiments', items: ['Olive oil', 'Vegetable oil', 'Soy sauce', 'Vinegar', 'Hot sauce'] },
  { category: 'Canned & Jarred',   items: ['Canned tomatoes', 'Canned beans', 'Chicken broth', 'Tomato paste'] },
  { category: 'Spices',            items: ['Black pepper', 'Garlic powder', 'Onion powder', 'Paprika', 'Cumin', 'Oregano', 'Cinnamon'] },
];

const ALL_STAPLES = STAPLES.flatMap(({ category, items }) =>
  items.map((name) => ({ name, category }))
);

export default function StaplesChecklist({ onComplete, onDismiss }) {
  const { completeOnboarding } = useAuth();
  const [selected, setSelected] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  // 'idle' | 'error' — explicit state machine; 'dismissed' lives in PantryPage
  const [onboardingState, setOnboardingState] = useState('idle');
  const [errorMessage, setErrorMessage] = useState(null);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function handleAdd() {
    setSubmitting(true);
    setOnboardingState('idle');
    setErrorMessage(null);
    try {
      if (selected.size > 0) {
        const items = ALL_STAPLES.filter(({ name }) => selected.has(name));
        await api.post('/api/pantry/bulk', { items });
      }
      await completeOnboarding();   // Persistence Rule: only path that commits onboardingComplete
      onComplete();                 // triggers PantryPage.refresh()
    } catch {
      setOnboardingState('error');
      setErrorMessage('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    setOnboardingState('idle');
    setErrorMessage(null);
    try {
      await completeOnboarding();   // Persistence Rule
      onComplete();
    } catch {
      setOnboardingState('error');
      setErrorMessage('Could not save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">Stock your pantry</h2>
          <p className="mt-1 text-sm text-gray-500">
            Select items you already have. You can add more anytime.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {STAPLES.map(({ category, items }) => (
            <div key={category}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {items.map((name) => {
                  const active = selected.has(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggle(name)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-green-400'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {onboardingState === 'error' && (
          <div className="px-6 py-2 border-t border-gray-100">
            <p className="text-sm text-red-600">{errorMessage}</p>
            {/* UI Dismissal Rule: calls onDismiss, NOT onComplete.
                No completeOnboarding(). No auth state update. No pantry refresh.
                PantryPage sets dismissedForUserId=user.id; modal closes for this session.
                On next page load: dismissal resets, /me returns false → modal reappears. */}
            <button
              onClick={onDismiss}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600"
            >
              Dismiss for now
            </button>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Skip
          </button>
          <button
            onClick={handleAdd}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold
                       hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? 'Saving…'
              : selected.size > 0
              ? `Add ${selected.size} item${selected.size === 1 ? '' : 's'}`
              : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 6. `client/src/pages/PantryPage.jsx` — Modify

### 6a. Imports

```js
import StaplesChecklist from '../components/onboarding/StaplesChecklist.jsx';
import { useAuth } from '../context/AuthContext.jsx';
```

### 6b. State and derivations

```jsx
const { user, loading } = useAuth();

// Plain boolean. useEffect resets it on user identity change (System Invariant #11).
const [onboardingDismissed, setOnboardingDismissed] = useState(false);

useEffect(() => {
  setOnboardingDismissed(false);
}, [user?.id]);  // resets on logout, re-login, or user switch

// isEligible: pure server truth (System Invariant #10).
const isEligible = !loading && user?.onboardingComplete === false;

// showOnboarding: render gate = server eligibility + session-scoped UI suppression.
const showOnboarding = isEligible && !onboardingDismissed;
```

### 6c. Callbacks

```jsx
// Server-confirmed completion (Persistence Rule): refresh pantry list.
function handleOnboardingComplete() {
  refresh();
}

// UI-only dismissal (UI Dismissal Rule): close modal for this session.
// MUST NOT call completeOnboarding() or update auth state.
function handleOnboardingDismiss() {
  setOnboardingDismissed(true);
}
```

### 6d. Render

```jsx
return (
  <div className="p-6 max-w-6xl mx-auto">
    {showOnboarding && (
      <StaplesChecklist
        onComplete={handleOnboardingComplete}
        onDismiss={handleOnboardingDismiss}
      />
    )}
    {/* Existing PantryPage content — unchanged */}
    ...
  </div>
);
```

---

# Data Flow Summary

```
Registration:
  POST /auth/register
    → INSERT users { ..., onboardingComplete: false }
    → safeUser(user) → { ..., onboardingComplete: false }
    → AuthContext.setUser(...)
    → isEligible = true; onboardingDismissed = false → showOnboarding = true

Page load:
  GET /api/auth/me (AuthContext mount)
    → requireAuth: JWT → req.user (identity only)
    → db.select().from(users).where(eq(users.id, req.user.id))
    → safeUser(dbUser) → { ..., onboardingComplete: false | true }
    → loading = false → isEligible evaluated → showOnboarding derived

Server-confirmed completion (Persistence Rule path):
  [handleAdd or handleSkip]
  → [if items] POST /api/pantry/bulk  — not idempotent, atomic batch insert
  → completeOnboarding()
      → POST /auth/onboarding-complete → UPDATE → 200 → safeUser
      → AuthContext.setUser({ ..., onboardingComplete: true })
  → onComplete() → handleOnboardingComplete() → refresh()
  → isEligible = false → showOnboarding = false → modal unmounts permanently

Server failure — dismiss path (UI Dismissal Rule path):
  → onboardingState = 'error'; errorMessage shown; "Dismiss for now" appears
  → onDismiss() → handleOnboardingDismiss() → setOnboardingDismissed(true)
  → onboardingDismissed = true → showOnboarding = false → modal closes for session
  → NO completeOnboarding(), NO auth state update, NO refresh()
  → isEligible remains true; next page load: dismissedForUserId resets → modal reappears

Stale JWT / deleted user:
  /me → 401 → api/index.js → window.location.href = '/login'
  AuthContext catch → setUser(null), loading = false
  Redirected to login; onboarding state irrelevant
```

---

# Acceptance Criteria

1. **Existing users unaffected.** `DEFAULT true` + `COMMENT ON COLUMN`.

2. **New user sees modal once** (server-confirmed). After `onComplete`, never shows again
   on refresh, re-login, or across devices.

3. **Select + add.** Chips toggle. Label: "Add N item(s)" / "Continue". Submits to
   existing `POST /pantry/bulk` then `POST /auth/onboarding-complete`. Pantry refreshes.

4. **Zero selection = Continue.** Calls `completeOnboarding()` only. Confirms bulk/complete
   independence (System Invariant #8 path without bulk).

5. **Skip.** Confirmed 200 → `onComplete()` → modal closes permanently.

6. **Server failure — retry + dismiss.**
   - `onboardingState === 'error'`: error message shown; "Dismiss for now" appears.
   - Retry (Skip or Add): resets to `idle`, attempts again.
   - "Dismiss for now": calls `onDismiss()` (not `onComplete()`); `dismissedForUserId = user.id`;
     modal closes; NO refresh(), NO auth update.
   - Next page load: `dismissedForUserId` resets; `/me` returns `false`; modal reappears.

7. **No modal during hydration.** `!loading` gate; `isEligible` not evaluated until
   `loading === false`.

8. **Dismissal resets on user change.** `useEffect` keyed on `user?.id` resets
   `onboardingDismissed` to `false`. Stale dismissal does not survive user switch or
   re-login.

9. **DB is sole persistent gate.** `isEligible` is pure server-derived state. No storage
   API involved. Verified by: grep sessionStorage/localStorage in onboarding files → zero.

10. **Serializer consistency.** Register, login, `/me`, completion — all return
    `onboardingComplete` via `safeUser()`.

11. **Persistence Rule enforced.** Only `handleAdd` and `handleSkip` call `completeOnboarding()`.
    `handleOnboardingDismiss` does not. Verified by code review.

12. **Completion idempotent; seeding not.** `/auth/onboarding-complete` 200 twice. Bulk
    creates duplicates if called twice.

13. **No regression.** All existing auth, pantry, recipe, household flows unaffected.

---

# Verification Steps

```
1.  Neon SQL Editor:
      ALTER TABLE "users" ADD COLUMN "onboarding_complete" boolean NOT NULL DEFAULT true;
      COMMENT ON COLUMN users.onboarding_complete IS '...';
    Verify: existing users = true.

2.  npm run build — no errors.

3.  Register a new user.
    → During /me fetch: loading=true → showOnboarding=false → no modal flash.
    → /me resolves → loading=false, isEligible=true → modal appears.
    → Existing user: onboardingComplete=true → isEligible=false → no modal.

4.  Select 3 staples → "Add 3 items":
    → 200 → onComplete() → refresh() → modal closes permanently.
    → Pantry list: 3 new items.
    → Refresh: /me returns true → no modal.

5.  Register → Skip → 200 → modal closes permanently. No modal on refresh/re-login.

6.  Register → select 0 → "Continue" → 200 → modal closes (confirms bulk independence).

7.  Simulate /auth/onboarding-complete failure:
    → onboardingState='error'; error shown; "Dismiss for now" appears.
    → Retry: onboardingState resets to 'idle'; can attempt again.
    → "Dismiss for now": modal closes; no refresh; AuthContext.user unchanged.
    → Refresh: modal reappears (isEligible still true; dismissedForUserId reset).
    → Restore server → complete → modal gone permanently.

8.  JWT inspection (jwt.io): onboardingComplete absent from payload.

9.  GET /me after completion: onboardingComplete: true (from DB).

10. Code review: grep StaplesChecklist + PantryPage:
    → completeOnboarding() called only in handleAdd, handleSkip → ✓
    → setUser( / setDismissedForUserId called nowhere near onDismiss path → ✓
    → sessionStorage / localStorage → zero references → ✓

11. POST /auth/onboarding-complete twice → 200 both times.

12. Spot-check: add/edit/freeze/thaw/used/delete/scan/receipt/login/register — unaffected.
```

---

# Known Risks / Open Questions

1. **Duplicate staples on partial failure retry.** Bulk succeeds, `completeOnboarding()`
   fails, user retries → duplicate items possible. Accepted: manually deletable; low
   frequency; consequence of execution order, not completion contract.

2. **Joined-household users (open question).** Join-path registrations get
   `onboardingComplete: false` but inherit an existing household pantry. Architect to
   confirm: should join-path set `true` to bypass onboarding?

3. **`/me` query cost.** One extra DB query per session restore. Acceptable on Neon.

4. **Enum future-proofing.** Boolean may expand to a status enum for join-bypass, partial
   completion, or admin reset states. Out of scope for this task.

---

# Out of Scope (Deferred)

- Editing the staples list (admin UI)
- Localization / country-specific staples
- "Add custom item" within the onboarding flow
- Re-triggering onboarding (no reset mechanism)
- Enum-based onboarding status
- Join-flow bypass (see Known Risk #2)
- Empty-pantry fallback prompt if user skips
- TASK-008: pass all pantry items to recipe AI (recommend shipping alongside)
