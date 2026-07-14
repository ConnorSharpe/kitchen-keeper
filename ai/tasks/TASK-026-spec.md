# TASK-026 — Household Members Card with Display Names

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 | Praised: extends existing service instead of new abstraction, thin route, batched Clerk lookup, client-side "(You)", independent card failure. Requested: graceful degradation on Clerk failure/timeout instead of hard error, dedupe lookup IDs, simpler sort construction, explicit response-shape documentation, explicit `limit` on the batched call (Clerk pagination default), "Former owner" vs "Former member" distinction. Also raised (accepted as noted-but-not-actioned, reasoning below): extracting `resolveDisplayName` to a shared utility, a future `IdentityService` layer, a request-scoped identity cache, automated test scenarios, and date normalization (turned out to be a non-issue — `joinedAt`/`createdAt` are already ISO strings per `server/db/schema.js`, the architect couldn't see the schema). All actionable items incorporated below; declined items recorded in Known Risks with reasoning. |
| DRAFT-2 | 9.7/10 — APPROVED FOR IMPLEMENTATION | No further structural concerns; all round-1 architectural changes confirmed correct (Clerk is now treated as an enrichment dependency, not a source of truth). Minor polish applied: comment clarifying `Promise.race` aborts *waiting*, not the underlying Clerk request; fallback-name warn log now includes the affected member count for production diagnosability; "the endpoint stays up" reworded to "the endpoint continues returning successful responses" (availability vs. behavior distinction). One tradeoff made explicit in Known Risks per architect note: deleted-Clerk-account and Clerk-outage now render identically ("Former member"/"Former owner") — accepted as correct for this app's scale, not a bug. |

---

## Codebase Reality Check

This feature was explicitly deferred twice already:

- TASK-017 shipped `GET /api/household/members` returning real `householdMembers` rows (`clerkUserId`, `role`, `joinedAt`), but noted: *"The `GET /api/household/members` route is not called from the UI in this task... the UI card is deferred until display names are available."* ([TASK-017.md:449](../tasks/TASK-017.md))
- [CURRENT_STATE.md](../handoffs/CURRENT_STATE.md) (2026-07-14) confirms the user now wants this built, not deferred further.

| What exists | File | Notes |
|---|---|---|
| Members endpoint | `server/routes/household.js:47-50` | `GET /api/household/members` — already auth'd via `clerkAuth`, already returns real DB rows. **Unused by any client code today.** |
| Members query | `server/services/householdService.js:19-28` | `getMembers(householdId)` returns **non-owner members only** (queries `householdMembers` table). The owner is a separate row in `households`, never inserted into `householdMembers`. |
| Owner identity | `server/db/schema.js:13` | `households.clerkUserId` — set for the original creator only; `null` for households joined via `getOrCreate`'s membership path (see `householdService.js:42-59`, resolution order checks `householdMembers` first, `households.clerkUserId` second). |
| Household page | `client/src/pages/HouseholdPage.jsx` | No members section exists in the current file — it needs to be added from scratch, not "un-hidden" (contrary to how CURRENT_STATE.md's wording reads; confirmed by reading the file directly). |
| Clerk backend SDK | `server/package.json:10` | `@clerk/express@^1.7.81` already a dependency. Exports `clerkClient` (re-exported from `@clerk/backend`), whose `users.getUserList({ userId: [...] })` does a **single batched lookup** for multiple IDs — confirmed via `node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts`. No new dependency needed. |
| Existing Clerk usage | `server/middleware/clerkAuth.js` | Only uses `getAuth(req)` (session token → userId) today. No prior code calls the Backend API for user *data* — this task is the first. |
| Client display-name pattern | `client/src/context/AuthContext.jsx:14` | `clerkUser.fullName ?? clerkUser.firstName ?? clerkUser.username ?? 'User'` — the fallback chain already established for the *current* user on the frontend. This task mirrors it server-side for *other* members (the backend `User` object has no `fullName` getter — that's frontend-SDK-only). |
| Date display precedent | `client/src/pages/ShoppingPage.jsx:122` | `new Date(x).toLocaleDateString()` — reused for `joinedAt` display, no new formatting utility needed. |
| No local name cache | `server/db/schema.js:17-26` | The `users` table is dead/legacy (pre-Clerk migration, has `passwordHash`) — not a source of display names. Confirmed no other table caches Clerk profile data. |

---

## Goal

Add a "Household members" card to `HouseholdPage.jsx` listing everyone in the household (owner + joined members) with a human-readable display name instead of a raw Clerk user ID, plus their role and join date.

---

## Decision: Resolve Names Server-Side via Batched Clerk Lookup, No Caching

**Recommendation: extend `householdService.getMembers()` to (1) merge the owner into the result set and (2) resolve all display names in one batched `clerkClient.users.getUserList()` call. No local caching of names.**

### Why merge owner + members server-side, not client-side
The owner is architecturally a different record (`households.clerkUserId`) from members (`householdMembers` rows) — TASK-017 deliberately kept them separate because the route wasn't UI-facing yet. Now that a single "who's in this household" list is the actual product requirement, the merge belongs in the service, not scattered across two fetches in the component. `getMembers()` becomes the one function that answers "who is in this household" — a more honest contract for its name than today's "non-owner members only."

### Why one batched Clerk call, not N individual calls
`clerkClient.users.getUserList({ userId: [...] })` accepts an array and returns all matches in one round trip. A household in this app is small (realistically 2-5 people) but there's no reason to make N sequential API calls when one exists. This also avoids partial-failure handling for N independent promises.

### Why no caching
Household size is tiny and this endpoint is only hit when a user opens the Household settings page (not a hot path, not polled). A live Clerk call every time is simpler than adding staleness/invalidation logic for a case that doesn't have a performance problem. Revisit only if usage patterns change (e.g. members card moves to a frequently-polled view).

### Why resolution lives in the service, not the route
Matches the precedent set by TASK-025 (`recipeService.create()` owning the full Blob upload lifecycle): routes in this codebase are thin HTTP adapters, and calls to external systems (Blob, and now Clerk's Backend API) are owned by the service layer. `household.js`'s `/members` route stays a two-line passthrough.

### Why the endpoint degrades instead of failing on a Clerk outage (round 1 revision)
DRAFT-1 let a `clerkClient.users.getUserList()` rejection propagate and fail the whole `GET /api/household/members` request, relying on the client to show an error card. The architect correctly flagged this as unnecessarily brittle: the household/member *rows* are DB data we already have — only the *names* depend on Clerk being up. `getMembers()` now wraps the Clerk call in try/catch (and a timeout, see Constraint 3) and falls back to generic names on failure rather than throwing, so the endpoint continues returning successful responses and the page still renders member rows, roles, and join dates even if Clerk is down. The client-side error state (Constraint 6) remains as a backstop for genuine endpoint failures (e.g. the DB query itself failing), which is a materially different, rarer case.

---

## What Does NOT Change

- `POST /api/household/join`, `/invite`, `/ai-key` routes — untouched.
- `householdMembers` / `households` schema — no migration needed; both `clerkUserId` columns already exist.
- `clerkAuth.js` — untouched; this task only adds a new use of `clerkClient`, not a new auth mechanism.
- Client `AuthContext.jsx` — untouched; its `fullName ?? firstName ?? username` chain is precedent, not a shared function, since it's frontend-SDK-derived and not callable from Node.

---

## Allowed Files

- `server/services/householdService.js` — rewrite `getMembers()` to merge owner + members and resolve names via `clerkClient`.
- `server/routes/household.js` — no logic change expected; confirm the existing `/members` route needs no edits (response shape is changing, but the route itself just returns whatever the service returns).
- `client/src/pages/HouseholdPage.jsx` — add a members `<section>` card: fetch, loading/error state, render list.

## Forbidden Files

- `server/middleware/clerkAuth.js` — auth flow is unrelated to this task.
- `server/db/schema.js` / `server/db/migrations/` — no schema change; both `clerkUserId` columns already exist.
- `client/src/context/AuthContext.jsx` — current-user identity resolution is unrelated; this task only needs `useAuth().user.id` for read-only comparison (see Constraint 4).
- `server/routes/household.js` other routes (`/`, `/ai-key`, `/invite`, `/join`) — unrelated to this task.

---

## Constraints

1. **Batched lookup, one Clerk API call per request, deduplicated.** Collect all `clerkUserId`s (owner + members) into a `Set` before calling `clerkClient.users.getUserList({ userId: [...] })`, so a data-integrity edge case (e.g. the owner's ID somehow also appearing as a `householdMembers` row) never produces duplicate entries in the request array. Do not loop calling `getUser()` per member.

2. **Explicit `limit` on the batched call, sized to the request.** Clerk's `getUserList` is a paginated endpoint (`ClerkPaginationRequest` — `limit`/`offset`, confirmed via `node_modules/@clerk/shared/dist/types/pagination.d.ts`) with a platform-side default page size. Pass `limit: ids.length` explicitly so a household that happens to exceed Clerk's default page size doesn't silently get truncated results (some members would fall back to "Household member" instead of erroring, which would be a confusing, hard-to-notice bug). This app's households are expected to stay well under any reasonable limit, but the explicit value costs nothing and removes the assumption.

3. **Clerk lookup failure or timeout degrades to fallback names — the endpoint continues returning successful responses.** Wrap the `getUserList()` call in try/catch with a **5s timeout** (`Promise.race`, mirroring the existing pattern in `server/routes/ai.js:196-200` for the AI extraction call — this app already has this exact idiom for external-call timeouts). Note `Promise.race` only stops *waiting*; it doesn't cancel the underlying Clerk request, which keeps running in the background and is simply ignored — fine here since there are no side effects to worry about. On rejection or timeout, log a `console.warn` including the count of affected members (matching the existing warn-on-recoverable-failure style in `recipeService.js`'s oversized-image check, with an added count for production diagnosability) and treat every row as if its Clerk user was not found — i.e., reuse the same "no match" fallback path as Constraint 4, rather than duplicating logic for the outage case.

4. **Handle a clerkUserId with no matching Clerk user gracefully** (deleted account, or the outage case above). If a given ID has no match in the resolved map, fall back to a display name of `'Former owner'` (if `role === 'owner'`) or `'Former member'` (otherwise) rather than throwing or omitting the row — the row still represents real household history (e.g. their pantry contributions).

5. **"(You)" is a client-side comparison, not a server concern.** The server returns `clerkUserId` for every member as today; `HouseholdPage.jsx` compares each row's `clerkUserId` against `useAuth().user.id` (already available via `AuthContext`) to append "(You)" in the UI. Do not have the server special-case the requesting user.

6. **If the members endpoint itself fails (not just the Clerk lookup — see Constraint 3), the members card must fail independently of the rest of the page.** `HouseholdPage.jsx` already fetches household info (join code, AI key) and members from two different concerns; keep the members fetch in its own try/catch with its own error UI (e.g. "Couldn't load household members" + retry), rather than blocking the whole page load. This matches the page's existing pattern of independent form-level status states (`aiStatus`, `inviteStatus`). Given Constraint 3, this path should now only trigger on something like the DB query itself failing — genuinely rare.

7. **Ordering: owner first, then members by `joinedAt` ascending.** Build this directly — an `ownerRow` (0 or 1 items) prepended to `memberRows` sorted by `joinedAt` — rather than merging both into one array and sorting by a `role === 'owner'` comparator. Same result, one less branch to get wrong.

8. **Response shape is now a documented contract, not incidental.** See "API Response Shape" below — `displayName` is a guaranteed field on every row going forward, not an implementation detail.

---

## API Response Shape

`GET /api/household/members` — documented contract as of this task (previously undocumented since the route had no caller):

```ts
{
  members: Array<{
    clerkUserId: string;
    role:        'owner' | 'member';
    joinedAt:    string;   // ISO 8601 — already stored as such, see schema.js
    displayName: string;   // never empty; falls back to 'Former owner' / 'Former member'
  }>
}
```

`displayName` is guaranteed present on every row from this task forward — callers do not need their own fallback.

### 1. `server/services/householdService.js` — merge + resolve

```js
import { clerkClient } from '@clerk/express';

const CLERK_LOOKUP_TIMEOUT_MS = 5000;

function resolveDisplayName(clerkUser, role) {
  if (!clerkUser) return role === 'owner' ? 'Former owner' : 'Former member';
  const fullName = `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim();
  if (fullName) return fullName;
  if (clerkUser.username) return clerkUser.username;
  const primaryEmail = clerkUser.emailAddresses?.find(
    (e) => e.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;
  return primaryEmail ?? 'Household member';
}

// Returns a Map<clerkUserId, ClerkUser>, empty on any failure/timeout — callers
// treat a missing entry the same whether the user was deleted or Clerk is down.
//
// Note: Promise.race only stops *waiting* on the Clerk request past the timeout —
// it does not abort the underlying HTTP call, which keeps running in the background
// and is simply ignored when it eventually resolves. Not a problem here (no side
// effects, nothing to cancel), just worth knowing this isn't true cancellation.
async function lookupClerkUsers(ids) {
  try {
    const { data } = await Promise.race([
      clerkClient.users.getUserList({ userId: ids, limit: ids.length }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Clerk user lookup timed out')), CLERK_LOOKUP_TIMEOUT_MS)
      ),
    ]);
    return new Map(data.map((u) => [u.id, u]));
  } catch (err) {
    console.warn(`[householdService] Clerk user lookup failed, falling back for ${ids.length} household member(s):`, err.message);
    return new Map();
  }
}

export async function getMembers(householdId) {
  const household = await getById(householdId);
  if (!household) return [];

  const memberRows = await db
    .select({
      clerkUserId: householdMembers.clerkUserId,
      role:        householdMembers.role,
      joinedAt:    householdMembers.joinedAt,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.joinedAt);

  // Owner may be null for households whose creator only ever joined via a
  // householdMembers row (see getOrCreate's resolution order) — skip if so.
  const ownerRow = household.clerkUserId
    ? { clerkUserId: household.clerkUserId, role: 'owner', joinedAt: household.createdAt }
    : null;

  const orderedRows = ownerRow ? [ownerRow, ...memberRows] : memberRows;
  if (orderedRows.length === 0) return [];

  const ids = [...new Set(orderedRows.map((r) => r.clerkUserId))];
  const byId = await lookupClerkUsers(ids);

  return orderedRows.map((r) => ({
    clerkUserId: r.clerkUserId,
    role:        r.role,
    joinedAt:    r.joinedAt,
    displayName: resolveDisplayName(byId.get(r.clerkUserId), r.role),
  }));
}
```

Note: `getUserList()`'s actual response shape (`{ data, totalCount }` vs. a bare array) should be confirmed against the installed `@clerk/backend` version during implementation — the `.d.ts` confirms `Promise<PaginatedResourceResponse<User[]>>`, and `PaginatedResourceResponse` is `{ data: User[], totalCount: number }`.

### 2. `server/routes/household.js` — no change expected

```js
// GET /api/household/members — unchanged code, now returns richer rows
router.get('/members', async (req, res) => {
  const members = await householdService.getMembers(req.user.householdId);
  res.json({ members });
});
```

### 3. `client/src/pages/HouseholdPage.jsx` — new section

```jsx
const [members, setMembers]           = useState([]);
const [membersLoading, setMembersLoading] = useState(true);
const [membersError, setMembersError]     = useState(null);
const { user } = useAuth();

const loadMembers = useCallback(async () => {
  setMembersLoading(true);
  setMembersError(null);
  try {
    const { members } = await api.get('/api/household/members');
    setMembers(members);
  } catch (err) {
    setMembersError(err.message || 'Failed to load household members');
  } finally {
    setMembersLoading(false);
  }
}, []);

useEffect(() => { loadMembers(); }, [loadMembers]);
```

```jsx
{/* Members */}
<section className="bg-white border border-gray-200 rounded-2xl p-6">
  <h2 className="text-base font-semibold text-gray-800 mb-4">Household members</h2>
  {membersLoading && <p className="text-sm text-gray-400">Loading…</p>}
  {membersError && (
    <div className="flex items-center justify-between">
      <p className="text-sm text-red-600">{membersError}</p>
      <button onClick={loadMembers} className="text-sm text-orange-600 hover:underline">Retry</button>
    </div>
  )}
  {!membersLoading && !membersError && (
    <ul className="space-y-2">
      {members.map((m) => (
        <li key={m.clerkUserId} className="flex items-center justify-between text-sm">
          <span className="text-gray-800">
            {m.displayName}{m.clerkUserId === user?.id && ' (You)'}
          </span>
          <span className="text-xs text-gray-400">
            {m.role === 'owner' ? 'Owner' : 'Member'} · joined {new Date(m.joinedAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  )}
</section>
```

Requires `import { useAuth } from '../context/AuthContext.jsx';` added to the existing import block.

---

## Dependency Chain

Editing:
- `server/services/householdService.js`
- `client/src/pages/HouseholdPage.jsx`

Reads (pattern reference only, do not modify):
- `server/routes/household.js` — confirm `/members` route needs no edits
- `server/middleware/clerkAuth.js` — confirm `getAuth` vs. `clerkClient` are distinct, non-conflicting uses of `@clerk/express`
- `client/src/context/AuthContext.jsx` — confirm `useAuth().user.id` shape
- `node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts` — confirm `getUserList` signature
- `ai/tasks/TASK-017.md` — original deferral note

Irrelevant:
- `server/db/schema.js` / `server/db/migrations/`
- `server/routes/household.js` other routes (`/`, `/ai-key`, `/invite`, `/join`)
- `client/src/components/settings/DietaryProfileForm.jsx`

---

## Acceptance Criteria

- [ ] Household settings page shows a "Household members" card listing the owner and all joined members
- [ ] Each row shows a human display name (first+last name, or username, or email — never a raw Clerk user ID)
- [ ] The current user's own row is marked "(You)"
- [ ] Owner is listed first; remaining members ordered by join date ascending
- [ ] A household with only an owner (no joined members yet) shows just the one row, no error
- [ ] A household with a null owner (`households.clerkUserId` unset — creator joined via a `householdMembers` row instead) shows only the member rows, no crash
- [ ] If a member's Clerk account no longer exists, their row still renders with a "Former member" placeholder (or "Former owner" if that row's role is owner) instead of crashing the card
- [ ] If the Clerk API call fails or times out (simulate by pointing `CLERK_SECRET_KEY` at an invalid value, or by temporarily lowering `CLERK_LOOKUP_TIMEOUT_MS` to 1ms), `GET /api/household/members` still returns 200 with all rows present and fallback display names — it does not error
- [ ] A genuine endpoint failure (e.g. a deliberately broken DB query, local test only) still shows the client-side error card + retry without breaking the rest of the Household page (join code, invite form, dietary profile, AI key sections all still render)
- [ ] Only one call to Clerk's Backend API is made per page load, regardless of household size (verify via a log line or network inspection during manual testing)
- [ ] A `householdMembers` row whose `clerkUserId` happens to duplicate the owner's (manually inserted in a local test DB) does not produce two Clerk API lookups for the same ID and does not duplicate a row in the response

Given this project verifies via live smoke testing rather than an automated test suite (see TASK-024/025 smoke test results), the above should be exercised manually against local dev per this pattern rather than written as unit tests — the Clerk-outage and duplicate-ID cases are the two most worth deliberately forcing since they won't come up in normal manual testing otherwise.

---

## Known Risks / Implementation Notes

1. **No DB/Clerk consistency guarantee.** If a user deletes their Clerk account, nothing in this app is notified — their `householdMembers` row (or `households.clerkUserId`) becomes orphaned until someone manually cleans it up. This task papers over that with "Former member"/"Former owner" but doesn't fix the underlying gap. Not addressed here — would require a Clerk webhook (`user.deleted`) to actively remove rows, which is real new surface area or a separate task if the user cares about it later.
2. **Clerk Backend API has its own rate limits.** At this app's scale (single-digit households, low traffic) this is not a practical concern, but worth noting since this is the first code path in the app that calls the Backend API for user *data* rather than session verification.
3. **`getUserList` response shape assumption.** The `.d.ts` confirms `PaginatedResourceResponse<User[]>` (i.e., `{ data, totalCount }`), but this should be sanity-checked with one real call during implementation before assuming the exact destructure in the code sample above is correct.
4. **5s Clerk lookup timeout is a starting guess, not a tuned value.** No prior art in this codebase for a Clerk Backend API call's typical latency (only `getAuth()` — local JWT verification, not a network call — is used today). If 5s proves too tight or too generous once this is exercised against real Clerk latency, adjust the constant; it's not load-bearing for anything else.
5. **Deleted-account and Clerk-outage cases are no longer distinguishable to the user.** Both a genuinely deleted Clerk account and a transient Clerk outage now render as "Former member"/"Former owner" (Constraint 3 reuses Constraint 4's fallback path for both). Originally "Former member" meant only "this person's Clerk account was deleted"; it now also covers "Clerk was unreachable when this page loaded." Accepted deliberately — the alternative (a distinct "Clerk unavailable" state per row) is not worth the added complexity at this app's scale, and a page reload resolves the outage case on its own. Worth knowing if this is ever debugged from a support angle.

### Explicitly declined (from architect review round 1)

- **Extracting `resolveDisplayName()` into a shared `server/utils/` module.** There is exactly one caller (`householdService.getMembers()`). The architect's own justification was speculative future callers (recipe ownership, activity feed, audit log) that don't exist in this codebase today. Per this project's stated preference against premature abstraction, keeping it local until a second real caller shows up is the better default — moving it later is a trivial extraction, not a redesign.
- **A dedicated `IdentityService` layer between `householdService` and Clerk.** Same reasoning as above, and the architect's own framing ("no need yet, just noting the direction") flagged this as non-actionable. This mirrors existing precedent: `recipeService` already owns its one external system (Vercel Blob) directly, no intermediate abstraction layer — a service owning one external call is not architecturally overloaded at this app's size.
- **A request-scoped identity cache.** Justified by the architect as guarding against "duplicate lookups as the app grows," but there is currently exactly one call site per request (`getMembers()` is the only function that calls `lookupClerkUsers()`, and the batched call already dedupes IDs within that one call per Constraint 1). There's no duplication to guard against yet — this would be speculative infrastructure for a problem that doesn't exist.
- **Automated test scenarios.** This project verifies via live/manual smoke testing against real infrastructure (see TASK-024 and TASK-025 smoke test results in `CURRENT_STATE.md`), not an automated test suite — no test runner or test files exist in the repo. The specific scenarios the architect listed are folded into the Acceptance Criteria above as manual verification steps instead.
- **Date normalization (`joinedAt`).** Non-issue — the architect couldn't see `server/db/schema.js`. Both `householdMembers.joinedAt` and `households.createdAt` are `text()` columns with `.$defaultFn(() => new Date().toISOString())`, so they're already ISO strings by the time they reach the API response. No change needed.

---

## Out of Scope (v1)

- Removing a member from a household (kick/leave flow) — this task is read-only display.
- Profile pictures / avatars — display name only.
- Clerk webhook sync for deleted users — see Known Risks #1.
- Editing the current user's own display name from this app (that's Clerk's own account UI, out of this app's scope).
