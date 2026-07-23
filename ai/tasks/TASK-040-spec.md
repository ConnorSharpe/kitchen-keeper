# TASK-040 — New Household / New Member Onboarding (Welcome + Staples Checklist + Guided Tour)

Version: DRAFT-5 (post-architect review, round 3) — **APPROVED FOR IMPLEMENTATION**

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-4 | 9.6/10 — approve after two required revisions | **Adopted (required)**: (1) `PATCH /api/household`'s authorization was previously an unstated implicit choice ("no owner restriction, consistent with ai-key PATCH") — the review correctly called out that renaming isn't obviously equivalent to the AI-key case and asked for an explicit decision. Resolved by actually surveying the codebase for the pattern (something the review couldn't do without file access, not just picking an analogy): **zero** household mutations anywhere in this app are gated by household-owner role — not the AI key, not pantry/recipes/shopping/dietary-profile writes, nothing. (`viewerIsOwner` in `household.js`'s `GET /` compares against `process.env.OWNER_CLERK_ID`, the single global *platform* administrator — an entirely different concept from a household's `role: 'owner'`, which the codebase only ever uses for display, never for permission checks.) Given that, gating exactly one field (name) behind a new, one-off household-owner permission check would be inconsistent with every other mutation this app has, not a neutral safe default. Decision, now explicit in Design Part B: **any household member may rename it** — "collaborative metadata, not owner-managed configuration," matching the review's own Option B framing and this app's existing fully-shared household model. (2) The review asked how a successful rename propagates to already-fetched client state. Traced explicitly (again, requires file access the review didn't have): `HouseholdPage.jsx` has no cache — its own `load()` refetches `GET /api/household` fresh on every mount, so the common path (visiting Household settings any time before or after onboarding) is correct with no additional work. The one real gap is narrower than the review's hedge suggested: `HouseholdPage` would only show a stale name if it was already mounted *underneath* the onboarding overlay *before* the rename PATCH resolved and was never unmounted afterward — which requires the user to manually navigate to `/household` as literally their first authenticated action (the app's actual landing route is `/`, `ChatPage`, which displays no household data at all). Decision, now explicit in Design Part B: accept this narrow edge case as self-healing (navigating away from and back to `/household` re-triggers the existing fetch-on-mount) rather than building cache-invalidation machinery for it. **Adopted (minor, all four suggested)**: (a) `WelcomeStep`'s blank-name/joined-flow path called `onContinue()` without ever engaging the `submitting` guard at all (it returns before `setSubmitting(true)` is reached) — a genuine double-click bug, not just theoretical, since `disabled={submitting}` was never actually active on that path. Fixed with a synchronous `useRef` guard (state-update timing can't be relied on for click-guarding; a ref can) that resets only on a recoverable failure, not on success. (b) Added an explicit Known Risk for orientation changes mid-tour ("unsupported, tour may become visually incorrect until restarted, not worth engineering around" — the review's own framing, adopted as-is). (c) Added a `grep passwordHash` check to Verification Steps for Part E's `users`-table drop, catching an unused schema import left behind by mistake. **Not adopted**: `text` timestamps for `user_onboarding` — the review's own recommendation was to *not* change this ("if greenfield I'd use timestamptz... since the surrounding schema already stores ISO timestamps as text, I would not change it here. Consistency wins."), so no change made; recorded here only because it was evaluated, not skipped. |
| DRAFT-2 | 9.7/10 — approved, with non-blocking polish suggested | **Adopted (minor, all three suggested)**: (1) The review asked what happens if the `completeOnboarding()` PATCH fails after the tour/checklist finishes. Answering this surfaced an actual bug, not just a documentation gap: `OnboardingGate` was calling `completeOnboarding()` (async) without awaiting or catching it — a failure would become an unhandled promise rejection, not something either `StaplesChecklist`'s own try/catch or anything else would see. Fixed with a `handleFinish` wrapper in `OnboardingGate` that awaits `completeOnboarding()` and swallows a failure — the review's own suggested resolution ("intentionally let onboarding repeat next session") is now the actual, deliberate behavior: the modal closes from the user's perspective either way, and since the server-side row is still `complete: false` on failure, onboarding simply runs again next session rather than surfacing an error the user can't act on. (2) `AuthContext`'s retry `setTimeout` is now stored and cleared in the effect's cleanup function, alongside the existing `cancelled` flag. (3) The review flagged a possible migration-numbering collision with an earlier task — checked directly against the repo (the review has no file access): `server/db/migrations/0017_platform_settings.sql` **does exist on disk**, so this task's new migration is renumbered `0018_user_onboarding.sql`. This surfaced a separate, pre-existing issue while checking: `0017_platform_settings.sql` has **no corresponding entry in `server/db/migrations/meta/_journal.json`** (the journal's last entry is still idx 16 / `0016_recipe_blocklist`) — meaning either it was applied by hand outside `drizzle-kit migrate`, or the journal was never regenerated after it was created. Flagged as a new, pre-existing Known Risk below; this task does not attempt to fix it (unclear why it diverged, and guessing wrong risks corrupting migration tracking for an unrelated task). |
| DRAFT-1 | 8.8/10 — required changes before approval | **Adopted (required)**: (1) Onboarding was marked complete the instant `runProductTour()` was *called*, not when the tour actually finished — `driver().drive()` returns immediately, so closing the browser mid-tour permanently skipped it. Fixed by wiring completion to driver.js's `onDestroyed` callback (confirmed via driver.js docs this fires however the tour ends — finished, `Escape`, overlay click, or the close button — not just on natural completion), and reordering the flow to **Welcome → Tour → Checklist** (architect's suggested reorder, adopted for a second reason beyond the stated UX rationale: it makes the "wait for the async step to truly finish" fix fall out naturally, since the tour's `onDestroyed` becomes the trigger to advance to the next step rather than something racing a separate completion call). (2) The onboarding-status fetch's fail-open fallback (`{ complete: true }` on error) is unchanged as the final fallback — deliberately, the app must never be blockable by an onboarding-status outage — but now retries once after a short delay first, so a single transient failure no longer permanently suppresses onboarding for the session (only two consecutive failures do). (3) `upsertFlow`'s `ON CONFLICT DO UPDATE` now includes `WHERE user_onboarding.complete = false`, and `markComplete`'s `UPDATE` now includes the same condition — once a row is complete, it's frozen; neither `flow` nor `completedAt` can be rewritten afterward. (4) The dismiss/skip state machine was underspecified — added an explicit state-transition table to Design Part B covering every exit point, including the two the review flagged as unhandled (dismissing mid-tour; dismissing during the checklist). (5) `flow` changed from a plain `text` column to a Postgres enum (`pgEnum`), so an invalid value is a schema-level error instead of a silent bad string. **Not adopted**: (a) extracting `OnboardingGate`'s state machine into a separate `OnboardingFlow` component or a `useOnboardingFlow()` hook — the reviewer themselves flagged this as "not required today," and at three states/~40 lines this would just relocate the same logic to a different file with no reduction in complexity; matches this codebase's own established precedent of declining an extraction at a similarly small scale (TASK-038's `SOURCE_BADGE` duplication was explicitly left un-deduped as "a step too far past this bug's actual scope"). Revisit if a future change (e.g. the still-open household-naming decision, if adopted, would add a 4th state) actually grows this. (b) Storing `flow` only until completion, then discarding it — the reviewer's own assessment was "harmless," and it costs nothing to keep as low-cost historical/debug data (e.g. "what fraction of onboarding starts are joins vs new households") even with no reporting built on it yet (still explicitly Out of Scope). (c) Additional onboarding-API endpoints (retry/reset) — reviewer explicitly called the minimal `GET`/`PATCH` surface "fine for v1." **Correction to the review**: Issue 3 (unbounded `flow` rewrites) was evaluated against the actual guard logic in `householdService.js`, which the reviewer didn't have access to — `createHousehold` only ever runs from `getOrCreate`'s step 3, which is unreachable once a user owns or belongs to any household, and `joinByCode`'s Guard B throws if the caller already has a `householdMembers` row. Together these make a third `upsertFlow` call structurally impossible today, not just unlikely — the `WHERE complete = false` addition is adopted anyway as defense-in-depth against that invariant ever being relaxed elsewhere, not because the described failure mode was reachable as described. |

---

## Origin

Raised by the user in conversation: Kitchen Keeper has no onboarding experience for either (a) a brand-new
household's first user, or (b) a new member joining an existing household via invite. User confirmed the
scope should include a guided product tour, not just a welcome screen.

## Current State (confirmed by reading the code, not assumed)

**Both onboarding paths are currently silent — the user lands in the app with zero orientation:**

- A brand-new household is auto-created with no user input at all: `clerkAuth` middleware
  ([server/middleware/clerkAuth.js:12](server/middleware/clerkAuth.js:12)) calls
  `householdService.getOrCreate`, whose step 3 ([server/services/householdService.js:134](server/services/householdService.js:134))
  silently inserts a household named `'My Household'` on the user's first authenticated API call. No
  naming prompt, no welcome — the user's very first screen after signing up is `ChatPage` (the index route,
  [client/src/App.jsx:58](client/src/App.jsx:58)), with no explanation of what the app does.
- A new member joining via `/join?code=XXX` ([client/src/pages/JoinPage.jsx](client/src/pages/JoinPage.jsx))
  works mechanically — sign up, auto-created disposable household gets deleted, user is added to the
  target household via `householdService.joinByCode` — but ends in a bare `navigate('/', { replace: true })`
  with no "you've joined Sarah's household" moment.

**There is already a built onboarding modal, but it is unreachable dead code:**

- `StaplesChecklist` ([client/src/components/onboarding/StaplesChecklist.jsx](client/src/components/onboarding/StaplesChecklist.jsx))
  is a fully-built "stock your pantry" checklist, mounted only in `PantryPage`
  ([client/src/pages/PantryPage.jsx:39](client/src/pages/PantryPage.jsx:39)), gated on
  `user?.onboardingComplete === false`.
- `user` comes from `AuthContext` ([client/src/context/AuthContext.jsx](client/src/context/AuthContext.jsx)),
  built purely from Clerk's `useUser()` — it never has an `onboardingComplete` field, so this comparison is
  always `undefined === false` → `false`. **The modal can never render.**
- `AuthContext`'s `completeOnboarding()` ([client/src/context/AuthContext.jsx:30](client/src/context/AuthContext.jsx:30))
  is a no-op stub: `async function completeOnboarding() {}`.
- The `users` table (`server/db/schema.js:27`, has `passwordHash`, `onboardingComplete` with a migration
  comment describing this exact gating rule) is entirely vestigial — `grep`'d the whole `server/` tree for
  `from(users)`/`insert(users)`/`update(users)`: **zero matches**. Nothing has written or read this table
  since the app's Clerk migration. Same story for `client/src/pages/LoginPage.jsx` (unrouted — `App.jsx`
  uses Clerk's own `/sign-in`/`/sign-up` routes) and the `login`/`register` stubs it calls.
- This confirms the checklist + old email/password login page + `users` table are one coherent leftover
  from a pre-Clerk custom-auth system that was never reconnected (or cleaned up) during the Clerk migration.

**Relevant existing pieces this task builds on:**

- `server/services/householdService.js`: `createHousehold` (new-household path) and `joinByCode`
  (join-existing-household path) are the two — and only two — places a Clerk user's household membership
  is first established, and (per the Architect Review History correction above) each can only ever run
  once per user for the lifetime of that user's account, due to guards already in this file (see Design
  Part A).
- `client/src/components/layout/Sidebar.jsx`: nav items are plain `NavLink`s for Chat (`/`), Dashboard
  (`/dashboard`), Pantry (`/pantry`), Recipes (`/recipes`), Shopping (`/shopping`), Household (`/household`).
  On mobile the whole sidebar is a slide-in overlay, closed by default
  (`-translate-x-full` unless `mobileOpen`, [Sidebar.jsx:161](client/src/components/layout/Sidebar.jsx:161)) —
  relevant to the guided tour's mobile behavior, see Design Part D and Decisions Needed.
- `client/src/components/layout/AppLayout.jsx`: wraps every authenticated route (`Outlet`) — the right
  place to mount a global onboarding gate, instead of `PantryPage`-only (today's dead mount point means
  a user who never visits `/pantry` first would never see it even if it worked).
- `client/src/api/index.js`: `api.get/post/patch/delete` — standard fetch wrapper, Clerk bearer token
  injected automatically.
- No onboarding-tour library or product-tour dependency exists in `client/package.json` today.

---

## Design

### Part A — Fix the broken plumbing: per-user onboarding state

The existing `users.onboardingComplete` design (gate the checklist on a boolean, set by the one API call
that completes/skips it) was the right idea — it just never got reconnected post-Clerk, and the `users`
table it lived on has other dead baggage (`passwordHash`) that shouldn't be resurrected. This task gives
onboarding state a clean, minimal home instead.

**New table**, keyed directly by Clerk user ID (not household ID) — needed because a household **owner**
lives in `households.clerkUserId` while a **member** lives in `householdMembers.clerkUserId`; a single
table keyed by household would have to handle that asymmetry, a per-user table doesn't:

`server/db/migrations/0018_user_onboarding.sql` (renumbered in round 2 — `0017` is already taken on disk by
`0017_platform_settings.sql`, see Architect Review History):

```sql
CREATE TYPE "onboarding_flow" AS ENUM ('new_household', 'joined');

CREATE TABLE "user_onboarding" (
  "clerk_user_id" text PRIMARY KEY,
  "flow" "onboarding_flow" NOT NULL,
  "complete" boolean NOT NULL DEFAULT false,
  "created_at" text NOT NULL DEFAULT now()::text,
  "completed_at" text
);

COMMENT ON TABLE user_onboarding IS
  'One row per Clerk user, created the moment their household membership is first established '
  '(householdService.createHousehold or joinByCode). Absence of a row means the user predates this '
  'feature — treated as already-onboarded (see onboardingService.getStatus), matching this codebase''s '
  'existing convention of never retroactively onboarding pre-existing users (see 0003_onboarding_complete.sql). '
  'Once complete=true, the row is frozen — flow and completed_at are never rewritten again '
  '(see onboardingService.upsertFlow / markComplete).';

COMMENT ON COLUMN user_onboarding.flow IS
  '''new_household'' or ''joined'' — decides which welcome copy shows and whether the staples checklist '
  'step runs. Set at row creation and may be overwritten exactly once while complete=false: a brand-new '
  'signup always auto-creates a disposable household first (clerkAuth -> getOrCreate), so if that same '
  'user then joins a household via a code, joinByCode overwrites flow to ''joined'' after the fact.';
```

`server/db/migrations/meta/_journal.json` — append a new entry (idx 17, immediately following the existing
idx 16 / `0016_recipe_blocklist` entry — **not** idx 18, since the journal itself has no entry for `0017` to
follow; see the Known Risks note on why this task doesn't attempt to backfill that separately):

```json
{
  "idx": 17,
  "version": "6",
  "when": <generated by drizzle-kit at migration-creation time>,
  "tag": "0018_user_onboarding",
  "breakpoints": true
}
```

`server/db/schema.js` addition (near `households`/`householdMembers`; `pgEnum` added to the existing
`drizzle-orm/pg-core` import):

```js
import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  serial,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

// ...

export const onboardingFlowEnum = pgEnum('onboarding_flow', [
  'new_household',
  'joined',
]);

export const userOnboarding = pgTable('user_onboarding', {
  clerkUserId: text('clerk_user_id').primaryKey(),
  flow: onboardingFlowEnum('flow').notNull(),
  complete: boolean('complete').notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});
```

**New file** `server/services/onboardingService.js`:

```js
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userOnboarding } from '../db/schema.js';

// No row = user predates this feature. Treat as already-onboarded rather than
// retroactively showing onboarding to existing users (mirrors the DEFAULT TRUE
// convention in 0003_onboarding_complete.sql, just expressed as row-absence
// instead of a column default, since this is a brand-new table with no legacy
// rows to protect).
export async function getStatus(clerkUserId) {
  const [row] = await db
    .select()
    .from(userOnboarding)
    .where(eq(userOnboarding.clerkUserId, clerkUserId));
  if (!row) return { complete: true, flow: null };
  return { complete: row.complete, flow: row.flow };
}

// Called from householdService.createHousehold (flow='new_household') and
// joinByCode (flow='joined'). Guarded by `WHERE complete = false` — once
// onboarding is complete, the row is frozen. In practice a third call is
// already structurally impossible: createHousehold only runs from
// getOrCreate's step 3 (unreachable once a user owns or belongs to any
// household), and joinByCode's Guard B throws if the caller already has a
// householdMembers row. The WHERE clause is defense-in-depth against that
// invariant ever being relaxed elsewhere, not a workaround for a reachable bug
// (architect review round 1, corrected — see Architect Review History).
export async function upsertFlow(clerkUserId, flow) {
  await db
    .insert(userOnboarding)
    .values({ clerkUserId, flow })
    .onConflictDoUpdate({
      target: userOnboarding.clerkUserId,
      set: { flow },
      where: eq(userOnboarding.complete, false),
    });
}

// Idempotent: a second concurrent PATCH is a no-op (the WHERE clause matches
// zero rows on the second call), so completedAt can't be nudged by a race
// (architect review round 1).
export async function markComplete(clerkUserId) {
  await db
    .update(userOnboarding)
    .set({ complete: true, completedAt: new Date().toISOString() })
    .where(
      and(
        eq(userOnboarding.clerkUserId, clerkUserId),
        eq(userOnboarding.complete, false)
      )
    );
}
```

**`server/services/householdService.js` changes** — two call sites, both already-existing functions:

```js
// createHousehold — after the successful insert, before `return row;`
await onboardingService.upsertFlow(clerkUserId, 'new_household');
```

```js
// joinByCode — after Guard C passes, before the insert/delete pair
await onboardingService.upsertFlow(clerkUserId, 'joined');
```

(plus `import * as onboardingService from './onboardingService.js';` at the top)

**New file** `server/routes/onboarding.js`:

```js
import express from 'express';
import { z } from 'zod';
import * as onboardingService from '../services/onboardingService.js';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();
router.use(clerkAuth);

// GET /api/onboarding — { complete, flow }
router.get('/', async (req, res) => {
  const status = await onboardingService.getStatus(req.user.id);
  res.json(status);
});

// PATCH /api/onboarding — mark complete (only transition this route allows)
const completeSchema = z.object({ complete: z.literal(true) });
router.patch('/', validate(completeSchema), async (req, res) => {
  await onboardingService.markComplete(req.user.id);
  res.json({ complete: true });
});

export default router;
```

`server/app.js`: add `import onboardingRouter from './routes/onboarding.js';` and
`app.use('/api/onboarding', onboardingRouter);` alongside the other routers.

### Part B — Client: real onboarding state + a global gate

**`client/src/context/AuthContext.jsx`** — replace the stub with a real fetch-on-load (one bounded retry
on failure, per architect review round 1) + real completion call:

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { api } from '../api/index.js';

const AuthContext = createContext(null);
const ONBOARDING_RETRY_DELAY_MS = 2000;

export function AuthProvider({ children }) {
  const { user: clerkUser, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [onboarding, setOnboarding] = useState(null); // { complete, flow } | null while loading

  useEffect(() => {
    if (!isLoaded || !clerkUser) return;
    let cancelled = false;
    let retryTimer = null;

    function load(isRetry) {
      api
        .get('/api/onboarding')
        .then((status) => {
          if (!cancelled) setOnboarding(status);
        })
        .catch(() => {
          if (cancelled) return;
          // A single transient failure (network blip, cold start) shouldn't
          // permanently suppress onboarding for the whole session — retry
          // once before falling back. The fallback still fails open
          // (never lets an onboarding-status outage lock a user out of their
          // own pantry) — it just takes two consecutive failures to reach it
          // now, not one (architect review round 1).
          if (!isRetry) {
            retryTimer = setTimeout(() => load(true), ONBOARDING_RETRY_DELAY_MS);
          } else {
            setOnboarding({ complete: true, flow: null });
          }
        });
    }

    load(false);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer); // round 2: avoid a stray timer firing after unmount
    };
  }, [isLoaded, clerkUser]);

  const user = clerkUser
    ? {
        id: clerkUser.id,
        name: clerkUser.fullName ?? clerkUser.firstName ?? clerkUser.username ?? 'User',
        email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
      }
    : null;

  async function logout() {
    await signOut();
  }

  const completeOnboarding = useCallback(async () => {
    await api.patch('/api/onboarding', { complete: true });
    setOnboarding((prev) => ({ ...prev, complete: true }));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading: !isLoaded, onboarding, logout, completeOnboarding }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

(`login`/`register` stubs removed — nothing calls them post-cleanup; see Decisions Needed on whether that
cleanup happens in this task or a follow-up.)

**State machine.** `OnboardingGate` (below) has three steps for a `new_household` user and two for a
`joined` user. Every exit point is enumerated here explicitly (architect review round 1 flagged the
original spec's transitions, especially around dismissal, as underspecified):

| From | Action | To | Marks complete server-side? |
|---|---|---|---|
| `welcome` | Continue (`new_household` flow: also saves the name field via `PATCH /api/household` first, if non-empty — see Part B's household-naming addition; a save failure shows an inline error and does **not** advance, same pattern as `StaplesChecklist`'s own save-failure handling) | `tour` (tour starts immediately) | No |
| `welcome` | Skip | closed (session only) | **No** — same "come back next session" semantics as the pre-existing `StaplesChecklist` error-state dismiss, so every skip point in the flow behaves the same way. Any unsaved name-field text is discarded, not saved. |
| `tour` | destroyed (driver.js `onDestroyed` — fires whether the user finished all steps, hit `Escape`, clicked the overlay, or clicked the close button) | `checklist` if `flow === 'new_household'`, else closed | Only if going straight to closed (`joined` flow) |
| `checklist` | Add items / Continue (existing `handleAdd`/`handleSkip` in `StaplesChecklist`) | closed | **Yes** |
| `checklist` | "Dismiss for now" (existing error-recovery-only link in `StaplesChecklist`, only reachable after a save failure) | closed (session only) | No — unchanged from `StaplesChecklist`'s pre-existing contract |

Reordering to **Welcome → Tour → Checklist** (adopted from architect review round 1's suggestion — the
tour gives context on where Pantry is before asking the user to stock it) has a second benefit beyond the
UX rationale: it's what makes "don't mark complete until the tour actually finishes" fall out naturally —
the tour's `onDestroyed` callback *is* the transition to the next step, not a separate completion call
racing against `drive()`'s immediate return.

**New file** `client/src/components/onboarding/OnboardingGate.jsx` — mounted once in `AppLayout`, orchestrates
the whole first-run sequence regardless of which page the user first lands on:

```jsx
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import WelcomeStep from './WelcomeStep.jsx';
import StaplesChecklist from './StaplesChecklist.jsx';
import { runProductTour } from './productTour.js';

// setMobileNavOpen is threaded down from AppLayout (Part D — the mobile tour
// needs to force the slide-in sidebar open across all six nav steps, so its
// open/closed state can no longer live only inside Sidebar.jsx).
export default function OnboardingGate({ setMobileNavOpen }) {
  const { onboarding, completeOnboarding } = useAuth();
  const [dismissed, setDismissed] = useState(false); // session-only, see State machine table above
  const [step, setStep] = useState('welcome'); // 'welcome' | 'tour' | 'checklist'

  if (!onboarding || onboarding.complete || dismissed) return null;

  // Wraps completeOnboarding() so a PATCH failure can't become an unhandled
  // promise rejection (architect review round 2 caught this: the tour/
  // checklist callbacks below were previously firing completeOnboarding()
  // without awaiting or catching it). Documented, deliberate behavior on
  // failure: swallow it. The modal has already closed from the user's
  // perspective, there's nothing actionable to show them, and since the
  // server-side row is still `complete: false`, onboarding simply runs again
  // next session — an acceptable outcome for a first-run UI, not an error
  // worth surfacing.
  async function handleFinish() {
    try {
      await completeOnboarding();
    } catch {
      /* see comment above — intentionally swallowed */
    }
  }

  function startTour() {
    setStep('tour');
    runProductTour(
      () => {
        // Fires on driver.js's onDestroyed — however the tour ended, it's done.
        if (onboarding.flow === 'new_household') {
          setStep('checklist');
        } else {
          handleFinish();
        }
      },
      { setMobileNavOpen }
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeStep
        flow={onboarding.flow}
        onContinue={startTour}
        onDismiss={() => setDismissed(true)}
      />
    );
  }

  if (step === 'checklist') {
    return (
      <StaplesChecklist onComplete={handleFinish} onDismiss={() => setDismissed(true)} />
    );
  }

  return null; // 'tour' step: driver.js renders its own overlay outside React
}
```

**`client/src/components/layout/AppLayout.jsx`** — `mobileOpen` state is lifted out of `Sidebar.jsx`
(Part D needs to control it from the tour, not just from the hamburger button) and now lives here, passed
down to both `Sidebar` and `OnboardingGate`:

```jsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import OnboardingGate from '../onboarding/OnboardingGate.jsx';
import { PantryProvider } from '../../context/PantryContext.jsx';

export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <PantryProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <OnboardingGate setMobileNavOpen={setMobileNavOpen} />
    </PantryProvider>
  );
}
```

**`client/src/components/layout/Sidebar.jsx`**: change `const [mobileOpen, setMobileOpen] = useState(false);`
to props — `export default function Sidebar({ mobileOpen, setMobileOpen })` — removing the `useState` import
if nothing else in the file needs it. Every existing internal usage (`setMobileOpen(false)` on nav-link
click, the hamburger button, the backdrop click) is otherwise unchanged; this is a controlled-component
conversion, not a behavior change for the existing hamburger-menu flow.

**`client/src/pages/PantryPage.jsx`**: remove the dead `onboardingDismissed` state, the `isEligible`/
`showOnboarding` computation, the `StaplesChecklist` import and mount, and `handleOnboardingComplete`/
`handleOnboardingDismiss` — all superseded by `OnboardingGate`.

**New file** `client/src/components/onboarding/WelcomeStep.jsx` — copy branches on `flow`; the
`new_household` variant additionally renders an optional household-naming input, saved via the new
`PATCH /api/household` endpoint (below) before advancing:

```jsx
import { useState, useRef } from 'react';
import { api } from '../../api/index.js';

export default function WelcomeStep({ flow, onContinue, onDismiss }) {
  const joined = flow === 'joined';
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Guards double-clicking Continue. A plain `submitting` check isn't enough
  // on its own: the blank-name/joined-flow branch below returns before
  // `setSubmitting(true)` is ever reached, so `disabled={submitting}` was
  // never actually engaged on that path — a genuine double-fire bug caught
  // in architect review round 3, not just a theoretical race. A ref updates
  // synchronously (no render needed), so it guards both branches uniformly.
  const startedRef = useRef(false);

  async function handleContinue() {
    if (startedRef.current) return;
    startedRef.current = true;

    const trimmed = name.trim();
    if (joined || !trimmed) {
      onContinue(); // joined flow, or the name field was left blank — keep the default household name
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.patch('/api/household', { name: trimmed });
      onContinue();
    } catch (err) {
      // Matches StaplesChecklist's own save-failure pattern: show the error
      // inline and do NOT advance automatically — the user can retry, edit
      // the name, or clear the field and press Continue again to skip naming
      // and proceed with the default.
      startedRef.current = false; // recoverable — allow the user to retry
      setError(err.message || 'Could not save that name — you can rename it later in Household settings.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center space-y-4">
        <span className="text-4xl">{joined ? '🎉' : '🍳'}</span>
        <h2 className="text-xl font-semibold text-gray-900">
          {joined ? "You're in!" : 'Welcome to Kitchen Keeper'}
        </h2>
        <p className="text-sm text-gray-500">
          {joined
            ? "You've joined a household — its pantry, recipes, and shopping list are now shared with you."
            : 'Track your pantry, save recipes, and get AI meal suggestions from what you already have.'}
        </p>

        {!joined && (
          <div className="text-left">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Name your household (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Household"
              maxLength={100}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-sm"
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <button onClick={onDismiss} className="text-sm text-gray-400 hover:text-gray-600">
            Skip
          </button>
          <button
            onClick={handleContinue}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : joined ? "Let's go" : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Authorization decision (explicit, per architect review round 3): any household member may rename it.**
Household names are collaborative metadata, not owner-managed configuration — this is a deliberate choice,
not an oversight, grounded in a full survey of this codebase's existing permission model rather than an
analogy to any one endpoint: **no household mutation anywhere in this app is gated by household-owner
role** — not the AI key, not pantry/recipes/shopping-list writes, not the dietary profile. (`viewerIsOwner`,
used in `HouseholdPage.jsx` to gate the "Platform AI settings" section, compares against
`process.env.OWNER_CLERK_ID` — the app's single global *platform* administrator, a different concept
entirely from a household's own `role: 'owner'`, which this codebase only ever uses for display, e.g. the
members list, never for a permission check.) Gating exactly the `name` field behind a new, one-off
household-owner check would be inconsistent with this app's existing fully-shared household model, not a
safe default. If household roles ever grow real teeth later (e.g. restricting who can remove members), this
decision should be revisited alongside that change, not in isolation.

**`server/routes/household.js`** — new `PATCH /` alongside the existing `GET /`, no role check beyond the
router's existing `clerkAuth` (any authenticated member of the household):

```js
const updateNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

router.patch('/', validate(updateNameSchema), async (req, res) => {
  await householdService.updateName(req.user.householdId, req.body.name);
  res.json({ ok: true });
});
```

**`server/services/householdService.js`** — new function:

```js
export async function updateName(householdId, name) {
  await db.update(households).set({ name }).where(eq(households.id, householdId));
}
```

**Client-state propagation decision (explicit, per architect review round 3):** no cache-invalidation
mechanism is built. Traced directly: `HouseholdPage.jsx` (the only place `household.name` is ever
displayed anywhere in the client) has no cache of its own — its `load()` calls `GET /api/household` fresh
inside a `useEffect` on every mount, so the common case (visiting Household settings any time, before or
after onboarding) already shows the correct name with zero additional work. The only path where staleness
could occur is narrower than it might first appear: `HouseholdPage` would have to already be mounted
*underneath* the onboarding overlay *before* the Welcome step's rename `PATCH` resolves, and then never
unmount afterward — which requires the user to manually navigate to `/household` as literally their first
authenticated action, since the app's actual landing route (`/`, `ChatPage`) displays no household data at
all. Accepted as a narrow, self-healing edge case (navigating away from and back to `/household` re-triggers
the existing fetch-on-mount) rather than building a shared household-data cache/context that nothing else
in this codebase currently has, for this one case.

### Part C — Staples checklist: no functional changes, just reconnected

`StaplesChecklist.jsx` itself needs exactly one change: remove its own `completeOnboarding()` call
([StaplesChecklist.jsx:72](client/src/components/onboarding/StaplesChecklist.jsx:72)) — `OnboardingGate`
now wires `completeOnboarding` directly as its `onComplete` prop (Part B), so the component's `handleAdd`
just calls `onComplete()` after the pantry-bulk save succeeds, same as `handleSkip` already does. Everything
else — the item grid, `api.post('/api/pantry/bulk', ...)`, the error/dismiss state machine — is unchanged;
it was already fully built, just unreachable.

### Part D — Guided product tour (driver.js)

Add `driver.js` to `client/package.json` dependencies (~4KB gzipped, zero dependencies, spotlight+tooltip
only — no bundled analytics/checklist/survey features this app doesn't need).

**`client/src/components/layout/Sidebar.jsx`**: add a `data-tour="nav-<name>"` attribute to each `NavLink`
(`nav-chat`, `nav-dashboard`, `nav-pantry`, `nav-recipes`, `nav-shopping`, `nav-household`) — plus the
`mobileOpen`/`setMobileOpen` prop conversion described in Part B (the tour needs to hold the mobile sidebar
open across all six steps, not just the hamburger button toggling it).

**New file** `client/src/components/onboarding/productTour.js` — same 6-step tour on desktop and mobile
(reversing DRAFT-3's desktop-only scoping, per the user's explicit direction that this app is primarily
used on the phone). On mobile, opens the sidebar before the tour starts and closes it again when the tour
ends, via the `setMobileNavOpen` now threaded down from `AppLayout`:

```js
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const NAV_STEPS = [
  { element: '[data-tour="nav-chat"]', popover: { title: 'Chat', description: 'Ask the AI assistant to add pantry items, suggest meals, or build a shopping list — just by typing.' } },
  { element: '[data-tour="nav-dashboard"]', popover: { title: 'Dashboard', description: "See what's expiring soon and what you can cook tonight." } },
  { element: '[data-tour="nav-pantry"]', popover: { title: 'Pantry', description: 'Everything you have on hand, with expiry tracking.' } },
  { element: '[data-tour="nav-recipes"]', popover: { title: 'Recipes', description: 'Save recipes by photo, URL, or search — cook from what you have.' } },
  { element: '[data-tour="nav-shopping"]', popover: { title: 'Shopping', description: 'Auto-built shopping lists from what your pantry is missing.' } },
  { element: '[data-tour="nav-household"]', popover: { title: 'Household', description: 'Invite others, manage members, and set dietary preferences shared by everyone here.' } },
];

const START_DELAY_MS = 100;
// Matches Sidebar.jsx's `transition-transform duration-200` on the slide-in
// overlay — the tour must wait out this transition before driver.js measures
// nav-item positions, or it spotlights their pre-transition (off-screen)
// location.
const SIDEBAR_TRANSITION_MS = 200;

// onFinished fires once, whichever way the tour ends (driver.js's
// onDestroyed callback runs on natural completion, Escape, overlay click, or
// the close button alike — confirmed against driver.js's own docs) — this is
// deliberately the single source of "the tour step is over," not a separate
// call made when the tour merely *starts* (architect review round 1).
export function runProductTour(onFinished, { setMobileNavOpen } = {}) {
  const isMobile = !window.matchMedia('(min-width: 768px)').matches; // matches Tailwind `md:` used throughout Sidebar.jsx

  function launch() {
    driver({
      showProgress: true,
      steps: NAV_STEPS,
      onDestroyed: () => {
        if (isMobile) setMobileNavOpen?.(false);
        onFinished();
      },
    }).drive();
  }

  if (isMobile) {
    setMobileNavOpen?.(true);
    setTimeout(() => requestAnimationFrame(launch), SIDEBAR_TRANSITION_MS);
  } else {
    // Called after at least one prior user click (the Welcome step's
    // Continue button), so desktop's always-visible nav is already long
    // painted — this delay is cheap insurance against a future caller that
    // skips that click, not a fix for an observed bug.
    requestAnimationFrame(() => setTimeout(launch, START_DELAY_MS));
  }
}
```

Called from `OnboardingGate.startTour()` (Part B) for both flows — same tour regardless of `new_household`
vs `joined`, since by that point both kinds of user are looking at the same nav.

### Part E — Dead-code cleanup (bundled into this task per user decision)

- Delete `client/src/pages/LoginPage.jsx` outright — confirmed via `grep` (this session) it has zero
  importers anywhere in `client/`; `App.jsx` already routes exclusively through Clerk's own `/sign-in` and
  `/sign-up` components.
- The dead `login`/`register` stubs are already gone as a side effect of Part B's `AuthContext` rewrite
  (the new version's provider value never included them).
- Drop the vestigial `users` table: new migration `server/db/migrations/0019_drop_users.sql`:
  ```sql
  DROP TABLE "users";
  ```
  and remove the `users` export from `server/db/schema.js`. Confirmed via `grep` (this session) — zero
  references to `from(users)`/`insert(users)`/`update(users)` anywhere in `server/`, and no test file
  references the table.
- Journal entry: idx 18, tag `0019_drop_users`, immediately after this task's own `0018_user_onboarding`
  entry (idx 17) — see Part A.

---

## Decisions (resolved by user, 2026-07-22)

1. **Household naming — include it.** Design Part B now folds a "name your household" input directly into
   the `new_household` welcome step (not a new state — see the updated state machine), backed by a new
   `PATCH /api/household` endpoint.
2. **Mobile tour scope — full tour on mobile too**, per the user's explicit reasoning ("this app will most
   likely be used on the phone"), reversing DRAFT-3's desktop-only recommendation. Design Part D now lifts
   the sidebar's `mobileOpen` state out of `Sidebar.jsx` so the tour can open it programmatically and hold
   it open through all six nav steps.
3. **Re-triggering the tour later — one-time only for v1**, as recommended. No change from DRAFT-3.
4. **Dead-code cleanup — bundled into this task.** Design now includes deleting `LoginPage.jsx`, dropping
   the `users` table, and removing the dead `login`/`register` AuthContext stubs (the latter was already
   implicit in Part B's `AuthContext` rewrite, confirmed here explicitly). Verified via `grep` (this
   session): `LoginPage.jsx` has zero importers anywhere in `client/`, and no test file references the
   `users` table — safe to remove outright, not just leave orphaned.

## Out of Scope

- Clerk Organizations (discussed and explicitly declined by the user in favor of this lighter-weight
  approach — see conversation).
- Any change to the join-code/invite mechanism itself (`householdService.joinByCode`, `/api/household/invite`)
  beyond the one-line `upsertFlow` call.
- Tour analytics/completion tracking beyond the existing `user_onboarding.complete` flag (no per-step
  tracking, no "% of users who finish the tour" reporting) — `flow` is kept post-completion as free,
  low-cost historical data in case this changes later, but nothing reads it today.
- Additional onboarding-API endpoints beyond `GET`/`PATCH` (no manual reset/retry endpoint) — the minimal
  surface is intentional for v1.

## Known Risks

- `OnboardingGate`'s `onboarding` fetch retries once on failure (Part B) before failing open; two
  consecutive failures (rather than one) now still result in onboarding being silently skipped for that
  session with no further retry. Accepted — the alternative (retrying indefinitely, or on every route
  change) risks the opposite failure mode: an onboarding-status outage repeatedly interrupting an otherwise
  working app.
- The `flow` overwrite behavior in `onboardingService.upsertFlow` (Part A) depends on `createHousehold`
  always running before `joinByCode` within the same user's journey — true today because `clerkAuth`'s
  `getOrCreate` unconditionally runs on every authenticated request including the join request itself, and
  now additionally guarded by `WHERE complete = false` (round 1). If `clerkAuth`'s call order ever changes,
  this combination should be revisited.
- `runProductTour`'s `requestAnimationFrame` + 100ms delay (Part D) is a defensive measure, not a verified
  fix for an observed timing bug — worth a quick manual check during verification regardless (see
  Verification Steps).
- **New in this round — mobile tour interaction.** driver.js's default behavior for whether the spotlighted
  element itself remains tappable during a step was not verified against driver.js's actual docs/behavior
  this round (unlike `onDestroyed`, which was). If a highlighted nav item is tappable mid-tour, tapping
  "Pantry" while on the "Chat" step could navigate away mid-tour on mobile in a way it more plausibly
  wouldn't on desktop (mouse users are more likely to read the tooltip and click "Next"). Worth an explicit
  check during implementation, not just verification.
- **New in this round — lifting `mobileOpen` out of `Sidebar.jsx`.** This is a controlled-component
  conversion of a previously self-contained piece of UI state, touching `AppLayout.jsx`, `Sidebar.jsx`, and
  `OnboardingGate.jsx`/`productTour.js` together. Low risk in isolation (the prop contract is simple), but
  it's the one change in this task that touches a widely-used, already-shipped component (`Sidebar`) rather
  than purely new or previously-dead code — worth its own regression pass on the ordinary hamburger-menu
  flow, independent of onboarding (see Verification Steps).
- **Mobile orientation changes mid-tour are unsupported** — `runProductTour`'s `isMobile` check runs once,
  at tour start; rotating the device mid-tour can leave the sidebar/tour visually incorrect until the tour
  is restarted. Explicitly not worth engineering around (architect review round 3).
- **New in this round — household-naming failure UX.** `WelcomeStep`'s name-save error path blocks
  advancing past Welcome until the user retries or clears the field (Part B), unlike every other failure
  point in this spec, which fails open. This is deliberate (matches `StaplesChecklist`'s existing
  save-failure pattern) but is a real, if small, inconsistency worth being aware of: it's the one point in
  the whole onboarding flow where a network hiccup can stall the user rather than just silently degrading.
- **Pre-existing, unrelated to this task's own changes**: `server/db/migrations/0017_platform_settings.sql`
  exists on disk but has no entry in `server/db/migrations/meta/_journal.json` (discovered while checking
  this task's own migration number — round 2). Either it was applied by hand outside `drizzle-kit migrate`,
  or the journal was never regenerated after it was created. This task's own migration (`0018`) is numbered
  and journaled correctly regardless of this gap, but if `drizzle-kit migrate` is ever run expecting the
  journal to be authoritative, `0017` won't be (re-)applied from it. Worth checking directly (Neon console
  or `\d user_onboarding` / `\d platform_settings` style query) before this task ships, but is not this
  task's to fix blind.

## Verification Steps

1. Brand-new sign-up (no invite code): confirm welcome step shows "Welcome to Kitchen Keeper" copy plus the
   household-name input, then the 6-step tour, then the staples checklist; confirm `GET /api/onboarding`
   returns `{ complete: true }` **only after** the checklist is submitted or skipped, not immediately when
   the tour starts (close the browser mid-tour and reload to confirm onboarding restarts from Welcome, not
   skipped).
2. Household naming: enter a custom name and click "Get started" — confirm `HouseholdPage.jsx` shows the
   new name afterward. Leave it blank and click "Get started" — confirm the household keeps the default
   "My Household" name (no `PATCH` call made). Force a `PATCH /api/household` failure — confirm an inline
   error shows, Welcome does **not** advance, and clearing the field + continuing still lets the user
   proceed with the default name.
3. Sign-up via `/join?code=...`: confirm welcome step shows "You're in!" copy with no name input, then the
   tour, then no staples checklist; confirm `GET /api/onboarding` returns `{ complete: true }` only after
   the tour's `onDestroyed` fires (e.g. clicking the tour's close button before reaching the last step
   should still mark it complete — that's "the tour is over," not "the tour was skipped").
4. Skip at the welcome step: confirm `onDismiss` closes the modal for the session but does **not** call
   `completeOnboarding()` — a page refresh should show onboarding again, and any text typed into the name
   field is discarded, not saved.
5. Dismiss during the checklist's error state ("Dismiss for now"): confirm same session-only semantics as
   step 4 — no `completeOnboarding()` call, reappears on refresh.
6. Existing pre-existing household/user (created before this ships, no `user_onboarding` row): confirm
   `GET /api/onboarding` returns `{ complete: true, flow: null }` and no onboarding UI ever shows.
7. Two rapid `PATCH /api/onboarding` calls (e.g. via curl or double-click): confirm `completedAt` is set
   once and not rewritten by the second call.
8. Mobile viewport: confirm the tour opens the sidebar automatically before the first step, holds it open
   through all six nav-item steps, and closes it again once the tour ends (`onDestroyed`) — regardless of
   whether the tour was finished or closed early. Separately, confirm the ordinary hamburger-menu
   open/close flow (unrelated to onboarding) still works correctly after the `Sidebar` controlled-component
   conversion — this is the one change in this task touching an already-shipped, widely-used component.
9. Simulate a `PATCH /api/onboarding` failure (e.g. temporarily throw in `onboardingService.markComplete`)
   and confirm: no unhandled rejection in the console, the onboarding modal still closes, and a page
   refresh correctly restarts onboarding from Welcome (round 2's `handleFinish` behavior).
10. Confirm `0018_user_onboarding.sql` and `0019_drop_users.sql` both apply cleanly on top of the current
    migration state (`staging` Neon branch, per `CONVENTIONS.md`'s canonical migration order) regardless of
    the separate, pre-existing `0017_platform_settings.sql` journal gap noted in Known Risks.
11. Confirm nothing else in the app broke from removing `LoginPage.jsx` and the `users` table (e.g. no
    stray import, no route still pointing at `/login`) — grep again post-implementation, not just
    pre-implementation as this spec did. Specifically `grep -r passwordHash` across the repo after dropping
    the table, to catch an unused schema import left behind by mistake (architect review round 3).
12. Rename the household, then navigate to `/household` — confirm the new name shows. Separately, confirm
    double-clicking Welcome's "Get started"/"Continue" button (both with and without a name typed) starts
    exactly one tour, not two.
13. `npm test` / `npm run lint` / `npm run build` all pass.
