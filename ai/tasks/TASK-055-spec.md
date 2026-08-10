# TASK-055 — Post-Audit Hardening: Env Hygiene, Access-Control Fixes, and Duplication Cleanup

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.4/10 — approve after revisions | Praised the scope discipline (mechanical-only, no bundled refactors/dependency bumps), the confirmed-vs-assumed rigor on the env-file findings, reuse of existing `shared/*`/`createRateLimiter` patterns, and the TOCTOU hardening. Five required/recommended changes, assessed individually rather than applied wholesale: (1) **required, accepted** — move `PANTRY_CATEGORIES` into a new `shared/pantryCategories.js` instead of exporting it from `aiService.js`; the original proposal made a chat handler depend on the orchestration module for an array of strings, backwards relative to this app's layering and inconsistent with how `recipeTags`/`pantryDefaults`/`recipeSources` are already structured (Design 9, D-7 in final numbering). (2) **recommended, partially accepted** — `getExpiringItems` is now implemented internally via a private `isExpiringWithin(item, withinDays)` predicate for clarity, but the predicate itself is *not* exported: no current caller needs it standalone (every call site does `.filter()`, never `.some()`/`.count()`), and exporting it anyway would violate the review's own suggested guiding principle (D-2) against introducing abstractions for hypothetical reuse (Design 11, D-8). (3) **recommended, accepted with tightened justification** — kept the `generateRequestId` helper rather than dropping it, on the grounds that it clears the review's own two-consumers/eliminates-real-duplication bar (8 confirmed call sites, identical logic) rather than on convenience alone (D-9). (4) **minor, no change** — the review itself noted `joinRateLimit.js`/`aiRateLimit.js` already establish the one-file-per-limiter pattern in this codebase, which is the precedent Design 6-7 follows; nothing to reconsider once that precedent is visible. (5) **required, accepted** — root `.env` deletion and the `server/.env.local` dead-var cleanup moved out of `Allowed Files` into a new **Manual Developer Actions** section, since neither is a source-controlled change a PR can carry (root `.env` was never tracked; `server/.env.local` is gitignored) — `Allowed Files` now lists only what a PR actually changes. (6) **recommended, accepted** — the rate-limiter testing plan item no longer hedges with "if one exists"; `requireAiAccess.test.js` and `aiRateLimitKeyGenerator.test.js` confirm a real middleware-testing pattern already exists in this codebase to extend. (7) **required, accepted** — the dependency-audit wording for the `drizzle-orm` advisory reordered to lead with "not currently exploitable in this codebase" before the severity rating, so the two can't be read independently. Also added the review's suggested guiding principle explicitly (D-2), since it directly resolves the reasoning behind changes 2 and 3 above rather than being decorative. |
| DRAFT-2 | 9.9/10 — APPROVED FOR IMPLEMENTATION | Confirmed all five DRAFT-1 changes landed correctly, specifically praising: `PANTRY_CATEGORIES`'s corrected dependency direction (`shared` ← `aiService` and `shared` ← chat handlers, no longer chat-handler → `aiService`) as now consistent with `recipeSources`/`pantryDefaults`/`recipeTags`; the `getExpiringItems`/private-`isExpiringWithin` split as a more disciplined application of the new guiding principle than the review's own original suggestion; `Manual Developer Actions` as the correct fix since a PR cannot delete an untracked file; and the tightened dependency-advisory wording as correctly preventing a future reader from concluding the application is currently SQL-injectable. Three purely editorial notes, all applied: the `D-1`/`D-1a` split reordered into clean sequential `D-1`...`D-9` numbering, with "mechanical-only scope" promoted to `D-1` and "guiding principle" moved to `D-2` (all downstream `D-N` cross-references renumbered to match, including in this table); the self-contradictory testing-plan wording ("already-expired items included... still `>= 0`?") corrected to "already-expired items excluded... confirm this existing behavior is preserved"; a one-line forward-looking note added (not acted on) about `shared/` approaching a size where a `shared/constants/` subdirectory might eventually be worth considering. One non-blocking observation, not applied: keeping `Design 1 & 2` as numbering placeholders for the Manual Developer Actions content (rather than renumbering the remaining Designs) was endorsed as a reasonable tradeoff to avoid rewriting every cross-reference, not flagged as something to fix. No remaining architectural concerns. |

---

## Request

Connor asked for a full-project pass: security risks, reusable/duplicated code, oversized functions, and
a web search for known vulnerabilities in this stack — to discuss before drafting anything. That
discussion (two parallel investigation agents plus manual dependency/CVE research) surfaced a broad set of
findings across three categories. Connor then asked a follow-up about why multiple `.env` files exist,
which turned up a real finding of its own. He asked to fold **all of it** — env hygiene, security fixes,
and code cleanup — into one spec.

Given the volume, this spec bundles only the findings that are **mechanical, self-contained, and
independently low-risk** — no new design decision, no breaking dependency change, no behavior change
beyond "same result, safer/less duplicated implementation." Findings that need a real design decision, a
breaking dependency bump, or touch a large/complex function are catalogued at the end for future task
planning, following the same split TASK-051 used for its own research pass.

---

## Current Behavior (confirmed by reading the code)

### A. Env files

Five `.env*` files exist. `git ls-files | grep -i env` confirms only `.env.example` is tracked — the other
four are correctly gitignored (`.env.*` in [.gitignore](../../.gitignore), with `!.env.example` carving out
the template). No secret has ever leaked into git history via these files.

- **Root `.env` is dead code — and contains live credentials.** [loadEnv.js:1](../../server/loadEnv.js)'s
  own comment states it "Loads `server/.env.local` explicitly (not the default root `.env`)"; nothing else
  in the codebase calls `dotenv.config()` against the root file, and nothing reads a bare `.env` implicitly
  (Node doesn't auto-load env files). Confirmed by full-repo grep: zero references. Despite being
  functionally dead, this file's contents are **not placeholder text** — it holds a populated
  `DATABASE_URL` with a real Neon connection string and password, real `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  values, a `VAPID_SUBJECT` with Connor's real email, a `GEMINI_API_KEY`, and a `JWT_SECRET`. (Values are
  not reproduced here or anywhere in this spec — only variable names.)
- **`GEMINI_API_KEY` and `JWT_SECRET` are dead everywhere, not just in this one file.** Grepped
  `server/**/*.js` and `server/package.json` for `jsonwebtoken`, `generative-ai`, and `GEMINI` — zero
  matches. No package that would consume either value is even installed. These are leftovers from a
  pre-Clerk auth implementation (`JWT_SECRET`) and an AI-provider experiment that was never wired in
  (`GEMINI_API_KEY`).
- **`server/.env.local` (the file that actually loads) also carries two dead vars.**
  `ENCRYPTION_KEY` was removed from `REQUIRED_ENV` and `.env.example` by TASK-051 when BYOK was deleted
  ([app.js:21-28](../../server/app.js) currently lists 6 required vars, no `ENCRYPTION_KEY`) — but the
  value was never removed from the local file that provided it. `BLOB_STORE_ID` has no reader anywhere in
  `server/`; `@vercel/blob`'s `put()`/`del()` calls (used in
  [recipeService.js](../../server/services/recipeService.js)) only need `BLOB_READ_WRITE_TOKEN`, read
  implicitly by the SDK itself (confirmed: that var isn't referenced in our own code either, by design —
  the SDK reads it directly from `process.env`).
- **Correction to something said earlier in this discussion:** `.env.example` was initially assessed as
  "missing `ENCRYPTION_KEY`/`BLOB_STORE_ID`" compared to `server/.env.local`. Closer check for this spec
  shows the opposite — `.env.example` is accurate and complete as-is; the two extra vars in
  `server/.env.local` are dead weight to remove, not gaps to fill in the template.
- **`server/.env.vercel` looks like a `vercel env pull` snapshot** — it contains the full set of
  Vercel/Neon-auto-injected vars (`VERCEL_*`, `TURBO_*`, `PG*`, `POSTGRES_*`) that only appear via that
  command, and nothing in the codebase loads it. Whether Connor uses it as a manual reference when editing
  Vercel's dashboard config isn't something the code can answer — flagged as an open question below rather
  than assumed.
- **`CONVENTIONS.md` itself references root `.env` as something that gets updated.** [CONVENTIONS.md:53-54](../../ai/handoffs/CONVENTIONS.md)
  says re-forking the `local` Neon branch means "updating `server/.env.local` and root `.env` with the new
  branch's connection string," and [CONVENTIONS.md:61-64](../../ai/handoffs/CONVENTIONS.md) repeats the same
  pairing. [CONVENTIONS.md:69-71](../../ai/handoffs/CONVENTIONS.md) separately already flags "root
  `.env.local`" (a typo for root `.env` — no such file exists) as a "stray, unused `DATABASE_URL`... harmless
  but worth deleting next time either file is touched." This task is that "next time."

### B. Security — access control and rate limiting

- **`POST /api/household/invite` has no rate limiter.** [household.js:65-76](../../server/routes/household.js) —
  compare to `/join` on the same router ([household.js:85](../../server/routes/household.js), gated by
  `joinRateLimit`) and every `/api/ai/*` route (gated by `aiRateLimit`,
  [ai.js:23](../../server/routes/ai.js)). Any authenticated household member can call this endpoint
  unlimited times with any `email`, each call triggering a real Resend send via
  [emailService.js](../../server/services/emailService.js)'s `sendHouseholdInvite`.
- **`POST /api/push/subscribe` and `POST /api/push/unsubscribe` also have no rate limiter** —
  [push.js:23](../../server/routes/push.js) and [push.js:77](../../server/routes/push.js). Lower severity
  (no email/SMS cost, no cross-household write — both correctly scope to `req.user.householdId`), but the
  same `createRateLimiter` factory used elsewhere would close the gap cheaply.
- **`createRateLimiter` already exists as a reusable factory** — [createRateLimiter.js](../../server/middleware/createRateLimiter.js)
  wraps `express-rate-limit` with this project's conventions (`standardHeaders: true`, custom `keyGenerator`,
  a `{ error: message }` body shape). `joinRateLimit.js` is the reference example of using it.
- **Pantry mutations verify ownership via a separate `SELECT`, but the mutating statement doesn't repeat
  the check.** `update`/`remove`/`markUsed`/`toggleFreeze` in
  [pantryService.js:78-219](../../server/services/pantryService.js) all follow: `SELECT ... WHERE id = ?` →
  compare `existing.householdId` in JS → `UPDATE/DELETE ... WHERE id = ?` (householdId not repeated in the
  mutating query's `WHERE`). The same file's own `splitItem`
  ([pantryService.js:276-289](../../server/services/pantryService.js)) does it the safer way — `WHERE id = ?
  AND householdId = ?` on the actual mutating statement — so this isn't a new pattern to introduce, just
  making the other four functions consistent with the one that already does it correctly.
  `recipeService.js`'s `update`/`remove`/`toggleFavorite`
  ([recipeService.js:120-165](../../server/services/recipeService.js)) have the identical read-then-write
  gap. `shoppingService.js` does not have this gap — every mutating function there already scopes by
  `householdId` via the list join. Practical risk is low today (no code path transfers a pantry item or
  recipe between households mid-request), but the fix is small and removes a real TOCTOU window rather than
  relying on it never mattering.

### C. Code-quality — duplicated constants/logic ready for a shared source of truth

All five of these have a genuine "single copy" location already established elsewhere in the codebase — this
is extending an existing pattern (`shared/expiry.js`, `shared/pantryDefaults.js`, `shared/recipeSources.js`
already exist for exactly this purpose), not inventing a new one.

1. **Pantry category enum, 3 copies.** `aiService.js` has `const PANTRY_CATEGORIES = [...]`
   ([aiService.js:74-85](../../server/services/aiService.js)) with its own comment noting it's already the
   single source for that file's 3 internal uses — but it isn't `export`ed, so
   [addPantryItem.js:10-21](../../server/services/chat/handlers/addPantryItem.js) and
   [updatePantryItem.js:10-21](../../server/services/chat/handlers/updatePantryItem.js) each hand-copy the
   identical 10-value list into their own zod schemas.
2. **Storage-location enum, 3 copies — and a source of truth already exists and is unused for this.**
   `shared/pantryDefaults.js` already exports `STORAGE_LOCATIONS = ['pantry', 'refrigerator', 'freezer']`
   ([pantryDefaults.js:23](../../shared/pantryDefaults.js)), but
   [pantry.js:20](../../server/routes/pantry.js), [pantry.js:43](../../server/routes/pantry.js), and
   [ai.js:90](../../server/routes/ai.js) each hand-type `z.enum(['pantry', 'refrigerator', 'freezer'])`
   instead of importing it.
3. **"Expiring within 7 days" filter, 3 copies in one file.** Identical 4-line block —
   `getExpiryDays(item.expiryDate)` then `days !== null && days >= 0 && days <= 7` — repeated at
   [ai.js:33-36](../../server/routes/ai.js) (`/eat-this-now`), [ai.js:140-143](../../server/routes/ai.js)
   (`/suggest-recipes`), and [ai.js:419-422](../../server/routes/ai.js) (`/chat`).
   [shared/expiry.js](../../shared/expiry.js) already holds the two functions this logic is built from
   (`getExpiryDays`, `getExpiryStatus`) — the natural home for a third, composed helper.
4. **`requestId` generation, 8 copies across 3 files.** `randomUUID().split('-')[0]` appears at
   [ai.js:27](../../server/routes/ai.js), [ai.js:54](../../server/routes/ai.js),
   [ai.js:102](../../server/routes/ai.js), [ai.js:261](../../server/routes/ai.js),
   [ai.js:324](../../server/routes/ai.js), [ai.js:411](../../server/routes/ai.js),
   [clientErrors.js:21](../../server/routes/clientErrors.js) (whose own comment says "matches household.js's
   `/members` convention"), and [household.js:43](../../server/routes/household.js).
5. **Recipe tag allow-list, 2 copies, server and client.** The identical 29-value list is hand-typed in
   [ai.js:159-190](../../server/routes/ai.js) (`TAG_ALLOWED`, a zod enum used to validate AI-parsed recipe
   tags) and [RecipeReviewModal.jsx:3-32](../../client/src/components/recipes/RecipeReviewModal.jsx)
   (`TAGS`, a plain array used to render the tag-toggle buttons). `shared/recipeSources.js` is the direct
   precedent for exactly this cross-boundary problem — its own header comment cites a real past bug
   (`url_import`) caused by exactly this kind of drift between client and server copies of one list.

---

## Design

### 1 & 2. Root `.env` deletion and the dead vars in `server/.env.local` — moved to Manual Developer Actions

Neither of these is source-controlled (root `.env` was never tracked; `server/.env.local` is gitignored),
so neither can be "completed" by a PR. Originally listed here as Design 1/2 in DRAFT-1; moved to the new
**Manual Developer Actions** section below per architect review — kept as a numbering placeholder only so
Design 3 onward and every existing `Design N` cross-reference elsewhere in this spec still points at the
same content.

### 3. `server/.env.vercel` — do not delete unilaterally; ask first

Unlike root `.env`, this file's purpose can't be confirmed from the code alone (nothing loads it either
way, but that doesn't distinguish "dead leftover" from "Connor's manual reference copy"). Flagged as an
open question (see Open Questions) rather than silently deleted or silently kept.

### 4. `.env.example` — no changes needed

Confirmed accurate as-is (Current Behavior, correcting the earlier in-conversation assessment). No design
change here; listed only so the spec's env section isn't silently incomplete.

### 5. Update `CONVENTIONS.md`'s stale references to root `.env`

Once Design 1 lands, [CONVENTIONS.md:53-54](../../ai/handoffs/CONVENTIONS.md) and
[CONVENTIONS.md:61-64](../../ai/handoffs/CONVENTIONS.md) (the local-branch re-fork runbook and the "known
gap" section) need their "root `.env`" mentions removed so the runbook doesn't tell a future session to
update a file that no longer exists. [CONVENTIONS.md:69-71](../../ai/handoffs/CONVENTIONS.md)'s own
already-flagged stray-`DATABASE_URL` note is resolved by Design 1 and can be deleted rather than reworded.

### 6. Rate-limit `POST /api/household/invite`

New `inviteRateLimit` in a new `server/middleware/inviteRateLimit.js`, built on the existing
`createRateLimiter` factory, mirroring `joinRateLimit.js`'s shape. (Architect review DRAFT-1 asked whether a
new per-limiter file is warranted over inlining `createRateLimiter({...})` directly in the router — this
codebase already answers that: `joinRateLimit.js` and `aiRateLimit.js` both exist as their own one-factory-
call files, so a new `inviteRateLimit.js` matches established precedent rather than introducing one.)

```js
import { createRateLimiter } from './createRateLimiter.js';

export const inviteRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many invite emails sent. Please wait a while and try again.',
});
```

Keyed by `req.user.id` (the inviting member), not `householdId` — matches `joinRateLimit`'s own reasoning
for why user-keying is correct here (a rate limit is about deterring one abusive actor, not throttling a
whole household's legitimate use). 10/hour proposed as a starting number — generous for real onboarding use
(inviting several household members in one sitting) while bounding the spam-relay/cost-abuse scenario this
exists to close. Applied as `router.post('/invite', inviteRateLimit, validate(inviteSchema), ...)` in
[household.js:65](../../server/routes/household.js), matching `/join`'s existing
`router.post('/join', joinRateLimit, validate(joinSchema), ...)` ordering (rate limit before validation,
consistent with this file's own precedent).

### 7. Rate-limit `POST /api/push/subscribe` and `POST /api/push/unsubscribe`

Same factory, one new `pushRateLimit` in `server/middleware/pushRateLimit.js`:

```js
export const pushRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many requests. Please wait a few minutes and try again.',
});
```

Applied to both routes in [push.js](../../server/routes/push.js): `router.post('/subscribe',
clerkAuth, pushRateLimit, ...)` and `router.post('/unsubscribe', clerkAuth, pushRateLimit, ...)`. 20/15min
is generous for legitimate use (a user re-subscribing across a couple of devices/browser reinstalls) while
bounding repeated-write abuse.

### 8. Atomic household-scoped `WHERE` on pantry/recipe mutations

`pantryService.js`'s `update` ([:78-110](../../server/services/pantryService.js)), `remove`
([:112-122](../../server/services/pantryService.js)), `markUsed`
([:124-145](../../server/services/pantryService.js)), and `toggleFreeze`
([:153-219](../../server/services/pantryService.js)) each get their mutating `.where(eq(pantryItems.id,
id))` changed to `.where(and(eq(pantryItems.id, id), eq(pantryItems.householdId, householdId)))` — `and` is
already imported in this file. The pre-check `SELECT`/`not_found`/`forbidden` logic is unchanged (still
needed to distinguish "doesn't exist" from "exists but isn't yours" for the API response); this only
hardens the mutating statement itself so it can never touch a row outside the caller's household, even in a
theoretical race window between the check and the write. `recipeService.js`'s `update`
([:120-132](../../server/services/recipeService.js)), `remove`
([:134-148](../../server/services/recipeService.js)), and `toggleFavorite`
([:150-165](../../server/services/recipeService.js)) get the identical treatment — `and` needs to be added
to that file's existing `import { eq, desc } from 'drizzle-orm'`.

### 9. Move `PANTRY_CATEGORIES` into `shared/pantryCategories.js` (revised, architect review DRAFT-1)

DRAFT-1 proposed adding `export` to `aiService.js`'s existing `const PANTRY_CATEGORIES`
([aiService.js:74](../../server/services/aiService.js)) and having the two chat handlers import it from
there. Rejected on review: that makes a chat-handler module depend on the orchestration module for a plain
array of strings — backwards relative to this app's layering, and inconsistent with every other
already-established shared constant in this codebase (`recipeSources`, `pantryDefaults`; `recipeTags`,
Design 13 above). Revised to match that pattern instead:

New `shared/pantryCategories.js`:

```js
// Canonical list of valid pantry categories, shared by client and server — no DB/Express/React
// dependency. Single source of truth for the AI tool schemas, the receipt-parsing schema, and both
// pantry-item chat handlers, matching the pattern already established by shared/recipeSources.js and
// shared/recipeTags.js.
export const PANTRY_CATEGORIES = [
  'Produce', 'Dairy', 'Meat', 'Seafood', 'Bakery',
  'Frozen', 'Pantry', 'Beverages', 'Condiments', 'Other',
];
```

`aiService.js`'s inline `const PANTRY_CATEGORIES = [...]` ([aiService.js:74-85](../../server/services/aiService.js))
is deleted in favor of `import { PANTRY_CATEGORIES } from '../../shared/pantryCategories.js';` — its 3
existing internal uses (`PANTRY_TOOLS`' add/update-item enums, `PARSE_RECEIPT_SCHEMA`) are unchanged, just
now sourced from `shared/` like everything else. `addPantryItem.js` and `updatePantryItem.js` replace their
hand-typed 10-value `z.enum([...])` arrays with `z.enum(PANTRY_CATEGORIES)`, importing from
`../../../../shared/pantryCategories.js` (same relative-path depth `addPantryItem.js` already uses to
import `getDefaultStorageLocation` from `shared/pantryDefaults.js`).

### 10. Import `STORAGE_LOCATIONS` instead of hand-typing it

`pantry.js` (both occurrences) and `ai.js` replace `z.enum(['pantry', 'refrigerator', 'freezer'])` with
`z.enum(STORAGE_LOCATIONS)`, importing the existing export from `shared/pantryDefaults.js` (already
imported in `ai.js` for `getDefaultStorageLocation`; a new import needed in `pantry.js`).

### 11. New `getExpiringItems` helper in `shared/expiry.js`, built on a private predicate (revised, architect review DRAFT-1)

Review feedback: the thing actually being duplicated is a predicate ("is this item expiring soon"), and a
lower-level `isExpiringWithin(item, withinDays)` export would let callers compose it with `.some()`/
`.count()`/etc., not just `.filter()`. Checked against the current codebase, not applied automatically: all
3 existing call sites ([ai.js:33-36](../../server/routes/ai.js), [ai.js:140-143](../../server/routes/ai.js),
[ai.js:419-422](../../server/routes/ai.js)) do exactly the same thing — `.filter()` into a full array — and
nothing else in this codebase needs the predicate standalone. Exporting it anyway would be introducing an
abstraction for reuse this task can't point to a real caller for, which is exactly what the review's own
suggested guiding principle (D-2 below) argues against. Split the difference: the predicate exists, for
clarity, but stays private; only the operation with 3 confirmed real callers is exported.

```js
function isExpiringWithin(item, withinDays) {
  const days = getExpiryDays(item.expiryDate);
  return days !== null && days >= 0 && days <= withinDays;
}

export function getExpiringItems(items, withinDays = 7) {
  return items.filter((item) => isExpiringWithin(item, withinDays));
}
```

All three call sites in `ai.js` become `const expiringItems = getExpiringItems(allItems);` — default
parameter preserves today's hardcoded `7` at every existing call site with no behavior change. If a future
caller genuinely needs the predicate alone (a `.some()`/count use, not a full filtered list), exporting
`isExpiringWithin` at that point is a one-line change with a real second consumer behind it — not a
speculative one.

### 12. New `generateRequestId` helper in `server/utils/requestId.js`

```js
import { randomUUID } from 'crypto';

export function generateRequestId() {
  return randomUUID().split('-')[0];
}
```

All 8 call sites (`ai.js` x6, `clientErrors.js`, `household.js`) replace `randomUUID().split('-')[0]` with
`generateRequestId()`, importing from the new file. `ai.js`'s existing `import { randomUUID } from
'crypto';` is removed once its own 6 call sites no longer use it directly (confirmed by search: `randomUUID`
has no other use in that file beyond request-id generation).

### 13. New `shared/recipeTags.js`, imported by both `ai.js` and `RecipeReviewModal.jsx`

New file, matching `shared/recipeSources.js`'s existing pattern and header-comment style:

```js
// Canonical list of valid recipe tags, shared by client and server — no DB/Express/React dependency.
// Single source of truth so a tag added on the client's review UI can't silently fail server-side
// validation because the two lists drifted (see shared/recipeSources.js for the same problem's earlier
// occurrence with recipes.source).
export const RECIPE_TAGS = [
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink',
  'italian', 'mexican', 'asian', 'american', 'mediterranean', 'indian', 'french', 'thai', 'japanese', 'greek', 'chinese',
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'low-carb', 'keto', 'paleo',
  'quick', 'easy', 'slow-cooker', 'one-pot', 'meal-prep', 'freezer-friendly',
];
```

`ai.js`'s `TAG_ALLOWED = z.enum([...])` ([:159-190](../../server/routes/ai.js)) becomes `z.enum(RECIPE_TAGS)`.
`RecipeReviewModal.jsx`'s `const TAGS = [...]` ([:3-32](../../client/src/components/recipes/RecipeReviewModal.jsx))
is deleted in favor of importing `RECIPE_TAGS` directly (renaming its local usages, or aliasing on import —
implementer's choice, no behavior change either way).

---

## Decisions

- **D-1: Bundled items are strictly "mechanical" — same external behavior, safer or less duplicated
  implementation only.** No item in this spec changes what a user or another system observes in the
  success case. This is the same bar TASK-051's D-6 used to decide what to bundle versus defer, applied
  here to a purely audit-driven cleanup task rather than a feature task.
- **D-2: Guiding principle (added architect review DRAFT-1): every shared abstraction this task introduces
  must already have at least two confirmed existing consumers, or directly eliminate a confirmed existing
  duplication — never introduced solely for hypothetical future reuse.** This is the same bar `recipeTags`,
  `pantryDefaults`, and `recipeSources` already meet in this codebase, made explicit so it can be applied
  consistently rather than by feel. It's also the reasoning behind two review-driven changes below: D-8
  keeps `getExpiringItems` (3 confirmed callers) but declines to export the lower-level
  `isExpiringWithin` predicate (0 confirmed standalone callers today) even though the predicate is a
  defensible abstraction in the abstract; D-9 applies the same test to the `requestId` helper in the
  other direction, keeping it because it clears the bar.
- **D-3: The larger ownership-check-boilerplate abstraction (a shared `findOwned`/`getOwnedList` helper
  collapsing pantryService/recipeService/shoppingService's ~14 near-identical lookup blocks) is
  deliberately NOT included here**, even though it's also mechanical. It touches 3 files and every mutating
  function in them — a bigger diff than the rest of this spec combined, and one worth its own focused
  review rather than folded in alongside 12 smaller changes. Catalogued below for a future task.
- **D-4: `server/.env.vercel`'s fate is not decided in this spec.** Unlike root `.env` (confirmed dead by
  code inspection) or the two stale vars in `server/.env.local` (confirmed dead the same way), this file's
  correct disposition depends on how Connor actually uses it day to day — something the code can't answer.
  Asking first, rather than guessing "probably safe to delete," matches this project's established pattern
  of treating irreversible-ish local-file decisions as a human call (see TASK-051's mandatory pre-drop
  verification query for the same reasoning applied to a DB column).
- **D-5: The pantry/recipe atomic-`WHERE` fix (Design 8) doesn't change either function's return contract.**
  `not_found` vs. `forbidden` still comes from the pre-check `SELECT`, exactly as today — a request for
  another household's item still gets the same distinguishing error response. Only the actual `UPDATE`/
  `DELETE` statement gains a redundant-but-correct household filter, closing the TOCTOU window without
  changing any client-visible behavior.
- **D-6: `ai.js`'s `import { randomUUID } from 'crypto'` is removed, not left in place "just in case."**
  Confirmed by search that `randomUUID` has no use in that file outside the 6 request-id call sites being
  replaced — leaving an unused import would be exactly the kind of drift this spec is otherwise cleaning up.
- **D-7 (architect review DRAFT-1, required change): `PANTRY_CATEGORIES` moves to `shared/pantryCategories.js`
  rather than being exported from `aiService.js`.** DRAFT-1's original proposal was directionally backwards:
  it would have made `addPantryItem.js`/`updatePantryItem.js` (chat-tool handlers) depend on `aiService.js`
  (the orchestration module that calls OpenAI, runs the tool loop, and owns the system prompt) for nothing
  more than an array of category strings. `shared/` already exists as this codebase's answer to exactly this
  problem — `recipeSources.js`, `pantryDefaults.js`, and this same spec's own new `recipeTags.js` (Design 13)
  all hold small, dependency-free constant lists consumed by both layers. Moving `PANTRY_CATEGORIES` there
  instead makes this task's own two new shared files and its one moved constant consistent with each other,
  not just individually defensible.
- **D-8 (architect review DRAFT-1, partially accepted): `isExpiringWithin` stays a private predicate inside
  `shared/expiry.js`, not a second export alongside `getExpiringItems`.** The review's point that the
  predicate is the more composable primitive is correct in the abstract — but D-2's guiding principle
  (added in this same round) asks for confirmed consumers, not composability as its own justification, and
  no current call site needs anything other than the full filtered list `getExpiringItems` already produces.
  Extracting the predicate internally still captures the review's underlying readability point (Design 11)
  without exporting an API surface this task can't point to a real caller for.
- **D-9 (architect review DRAFT-1, recommended change addressed): `generateRequestId` is kept, on the
  strength of D-2's guiding principle rather than convenience.** The review asked for justification, not
  removal — reconsidered against D-2 rather than defended reflexively: 8 confirmed call sites
  ([ai.js](../../server/routes/ai.js) x6, [clientErrors.js](../../server/routes/clientErrors.js),
  [household.js](../../server/routes/household.js)) all currently run the exact same literal expression,
  and one of them ([clientErrors.js:21](../../server/routes/clientErrors.js)) already carries a comment
  stating it's deliberately matching another file's convention — i.e. this is already understood codebase-
  wide as one shared format, just not backed by one shared implementation. That clears the two-consumers/
  real-duplication bar cleanly; kept.

---

## Manual Developer Actions (not source-controlled — see architect review DRAFT-1)

These two items are not repository changes and cannot be completed via PR — neither file is tracked
(root `.env` was never in git; `server/.env.local` is gitignored). Listed separately from `Allowed Files`
so scope isn't ambiguous about what "done" means for this task:

- **Delete root `.env`** (Design 1) — confirmed dead (no code path reads it), but contains live credential
  values (see Current Behavior/Known Risks) — delete promptly once Design 3's open question doesn't turn out
  to depend on it (Constraints).
- **Remove the `ENCRYPTION_KEY` and `BLOB_STORE_ID` lines from `server/.env.local`** (Design 2) — both
  confirmed dead (Current Behavior).

## Allowed Files

- `ai/handoffs/CONVENTIONS.md` — remove stale root-`.env` references (Design 5); this file *is* tracked,
  unlike the two items above.
- New: `server/middleware/inviteRateLimit.js`, `server/middleware/inviteRateLimit.test.js`
- New: `server/middleware/pushRateLimit.js`
- `server/routes/household.js` — apply `inviteRateLimit` to `POST /invite` (Design 6)
- `server/routes/push.js` — apply `pushRateLimit` to `POST /subscribe` and `POST /unsubscribe` (Design 7)
- `server/services/pantryService.js` — `update`/`remove`/`markUsed`/`toggleFreeze`'s mutating `.where()`
  clauses only (Design 8); no other logic in this file changes
- `server/services/recipeService.js` — `update`/`remove`/`toggleFavorite`'s mutating `.where()` clauses,
  plus the `drizzle-orm` import line to add `and` (Design 8); no other logic changes
- New: `shared/pantryCategories.js` (Design 9, D-7)
- `server/services/aiService.js` — delete the inline `PANTRY_CATEGORIES` array, replace with an import from
  `shared/pantryCategories.js` (Design 9, D-7); no other change — `PANTRY_TOOLS`/`PARSE_RECEIPT_SCHEMA`'s 3
  existing internal uses are unaffected beyond the import source
- `server/services/chat/handlers/addPantryItem.js`,
  `server/services/chat/handlers/updatePantryItem.js` — replace hand-typed category enum with the
  `shared/pantryCategories.js` import (Design 9, D-7)
- `server/routes/pantry.js`, `server/routes/ai.js` — replace hand-typed `storageLocation` enum with
  `STORAGE_LOCATIONS` import (Design 10); `ai.js` additionally: replace the 3 expiring-filter blocks with
  `getExpiringItems` (Design 11), replace all 6 `randomUUID().split('-')[0]` call sites with
  `generateRequestId()` and drop the now-unused `randomUUID` import (Design 12, D-6), replace `TAG_ALLOWED`
  with `z.enum(RECIPE_TAGS)` (Design 13)
- `shared/expiry.js` — add the private `isExpiringWithin` predicate and the exported `getExpiringItems`
  (Design 11, D-8)
- New: `shared/expiry.test.js` additions for `getExpiringItems` (existing file, extend it)
- New: `server/utils/requestId.js` (D-9)
- `server/routes/clientErrors.js`, `server/routes/household.js` — replace inline `requestId` generation
  with `generateRequestId()` import (Design 12)
- New: `shared/recipeTags.js`
- `client/src/components/recipes/RecipeReviewModal.jsx` — replace local `TAGS` array with `RECIPE_TAGS`
  import (Design 13)

---

## Forbidden Files

- `.env.example` — confirmed accurate; no change (Design 4).
- `server/.env.vercel` — not touched until Design 3's open question is answered.
- `server/services/pantryService.js`'s `splitItem`, `bulkCreate`, `getWasteSaved`, `computeExpiryForStorage`,
  `enrichWithExpiry`, `computeSplitQuantityFromServings` — unrelated to the ownership-check fix, already
  correctly scoped or not relevant.
- `server/services/shoppingService.js` — already correctly scoped (Current Behavior); no change needed or
  made.
- `server/services/chat/handlers/consumePantryItem.js`, `removePantryItem.js`, `saveRecipe.js`,
  `suggestRecipes.js` — no enum/constant duplication found in these; not touched.
- `server/middleware/aiRateLimit.js`, `server/middleware/joinRateLimit.js`, `server/middleware/createRateLimiter.js` —
  reused as-is (Design 6-7 are new consumers of the existing factory); no change to the factory itself or
  the other two existing limiters.
- Every large-function candidate from the code-quality audit (`suggestForChat`, `aiService.chat`, the
  `/chat` and `/parse-recipe-url` route handlers, `ChatPage.jsx`'s message renderer) — explicitly out of
  scope, see Related Findings below.
- All dependency version bumps (`drizzle-orm`, `@vercel/blob`, `react-router-dom`) — explicitly out of
  scope, see Related Findings below.
- `server/app.js`'s CSP configuration — explicitly out of scope, see Related Findings below.

---

## Constraints

- No new npm dependencies.
- Every Design 6-13 change must be behavior-neutral for the success path — verified by the existing test
  suite continuing to pass plus the targeted checks in Testing/Verification below, not just by code
  inspection.
- `and` must be imported (not already present) in `recipeService.js` before Design 8's change compiles —
  confirmed as a genuine addition, not already available.
- Design 1 (deleting root `.env`) must not be run before Design 3 is resolved with Connor, if `.env.vercel`'s
  disposition turns out to depend on cross-referencing root `.env`'s old values first (unlikely given
  Current Behavior's confirmation both are independently dead, but sequenced this way out of caution).
- The rate-limit windows/limits proposed in Design 6-7 (10/hour, 20/15min) are starting proposals, not
  measured values — same framing TASK-054 used for its own threshold constants. Open to adjustment in
  review.

---

## Testing / Verification Plan

1. **`inviteRateLimit` unit test** (architect review DRAFT-1: confirmed via search that no rate-limiter-
   specific test exists yet to extend — `joinRateLimit.js`/`aiRateLimit.js` have no companion test file —
   but `requireAiAccess.test.js` and `aiRateLimitKeyGenerator.test.js` establish a real Express-middleware
   testing pattern already in use in this codebase; follow that pattern rather than building new test
   infrastructure). Confirm the 11th invite request within the window is rejected with the configured
   message, and that the key is `req.user.id`-scoped (two different users each get their own 10-request
   budget).
2. **`getExpiringItems` unit tests** (added to `shared/expiry.test.js`): items with no expiry date excluded;
   already-expired items excluded (`days < 0` fails the `days >= 0` lower bound — confirm this existing
   behavior is preserved exactly, since it's the one subtle detail worth a dedicated test rather than an
   assumption); items beyond `withinDays` excluded; custom `withinDays` parameter respected independent of
   the default.
3. **Pantry/recipe atomic-`WHERE` regression test**: for at least one of `pantryService.update`/`remove` and
   one of `recipeService.update`/`remove`, add or extend a unit test asserting a call with a mismatched
   `householdId` still returns `{ status: 'forbidden' }` (unchanged contract, D-5) — this is a regression
   guard on the *return value*, since the query-level hardening itself isn't independently observable
   through the service's existing return shape.
4. `npm test --prefix server` and the root `npm test` (which also runs `shared/expiry.test.js`) — full
   suite green, no regression from any of the constant/helper extractions.
5. `npm run lint` — clean, confirming the removed `randomUUID` import in `ai.js` doesn't leave an
   unused-import warning and no new one is introduced.
6. **Live smoke test — invite rate limit**: as a real household member in local dev, call `POST
   /api/household/invite` enough times to exceed the configured limit — confirm the 429/rejection response
   and message, then confirm a normal invite still works before and after the window resets.
7. **Live smoke test — pantry/recipe mutations still work normally**: add, edit, consume/mark-used, and
   freeze-toggle a pantry item; edit and toggle-favorite a recipe — confirm all succeed exactly as before
   for the caller's own household's own data (the only behavior these functions have from a real user's
   perspective).
8. **Live smoke test — chat categories/storage/tags unaffected**: exercise the chat `add_pantry_item`/
   `update_pantry_item` tools and the recipe-URL-import review flow — confirm categories, storage location,
   and tags still validate and save correctly, proving the enum-import swaps didn't silently narrow or
   widen any accepted value set.
9. **Server boots cleanly without root `.env`**: after deleting it, start the server in local dev — confirm
   no `Missing required env var` error and no behavior change (expected, since `loadEnv.js` never read it,
   but verify live rather than trusting the static analysis alone).
10. `git status`/`git diff --stat` confirms only the files listed in Allowed Files changed, and that
    `server/.env.local` (gitignored) isn't accidentally staged.

---

## Open Questions (for Connor / architect review)

- **`server/.env.vercel`**: delete it (nothing loads it, and it goes stale the moment Vercel's dashboard
  env changes), or keep it as a manual reference and note that it should be refreshed via `vercel env pull`
  rather than trusted as current? This spec takes no position — Design 3 is a placeholder until answered.
- **Rate-limit thresholds** (Design 6: 10/hour for invites; Design 7: 20/15min for push): reasonable
  starting proposals, not measured — confirm or adjust during review, same as TASK-054's threshold framing.

---

## Related Findings Not Addressed by This Task (for future task planning)

Recorded in full so nothing from the audit gets lost, following the same pattern TASK-051 used for its own
deferred findings:

1. **Ownership-check-boilerplate abstraction** (D-3) — a shared `findOwned(table, id, householdId)` /
   `getOwnedList(householdId, listId)` helper collapsing the ~14 near-identical lookup blocks across
   `pantryService.js`, `recipeService.js`, and `shoppingService.js`. Mechanical but large — a ~14-call-site
   diff across 3 files, big enough to warrant its own focused spec and review rather than folding into this
   one.
2. **Dependency version bumps** — `npm audit` flags `drizzle-orm@0.29.5` (installed) against an advisory
   fixed in `0.45.2`. **Precision, per architect review DRAFT-1: this describes an advisory affecting the
   installed version, not a confirmed exploitable vulnerability in this application.** The advisory's actual
   trigger is passing untrusted input to `sql.identifier()` or `.as()` for dynamic SQL identifiers; a repo-
   wide grep found zero such usage anywhere in `server/` — every `sql\`...\`` call in this codebase uses
   parameterized value binding, not dynamic identifiers (confirmed independently during the original
   security audit this spec is based on). So: **advisory applies to the installed version; code inspection
   found no presently exploitable call pattern; upgrade is still recommended** as defense-in-depth against a
   future feature (e.g. user-controlled sort-by-column) accidentally introducing the vulnerable pattern —
   not because the application is SQL-injectable today. Two other bumps are needed for different reasons:
   `@vercel/blob` → `2.6.1` (resolves a transitive `undici` advisory cluster — request smuggling, CRLF
   injection, cache poisoning — in a dependency this app doesn't call directly, so exploitability depends on
   `undici`'s own usage inside `@vercel/blob`/`cheerio`, not on this app's code); client-side
   `react-router-dom` → `7.18.2` (moderate open-redirect + SSR hydration advisory). All three are breaking-
   change major/minor bumps per `npm audit` — each needs its own testing pass against the actual API surface
   changes, not a mechanical bump. Candidates for 2-3 separate small tasks, sequenced by risk (client-side
   router bump is probably safest to do first; the ORM bump touches every DB call transitively and deserves
   the most care even though it's not urgent).
3. **Oversized functions (SRP)** — `recipeSearchService.js`'s `suggestForChat` (~218 lines,
   [:374-592](../../server/services/recipeSearchService.js)), `aiService.js`'s `chat` (~188 lines,
   [:854-1042](../../server/services/aiService.js)), the `/chat` and `/parse-recipe-url` route handlers in
   `ai.js` ([:408-519](../../server/routes/ai.js), [:320-395](../../server/routes/ai.js)), and
   `ChatPage.jsx`'s message-rendering callback (~223 lines,
   [:296-520](../../client/src/pages/ChatPage.jsx)). Each has a concrete proposed split identified during
   the audit — real design/extraction work, not mechanical, and each is independently sized like a normal
   TASK-05x-scale spec on its own.
4. **CSP `img-src` breadth** — `app.js:37-46` allows any HTTPS host as an image source (needed today for
   arbitrary recipe images from user-supplied URLs and Vercel Blob). Not mechanical to tighten without a
   product decision about whether to allowlist known recipe-site domains or accept the current breadth as a
   deliberate tradeoff.
5. **`SPOONACULAR_API_KEY` as a URL query parameter** — standard for that specific third-party API, not
   something this app's code can change unilaterally; low practical severity, informational only.
6. **`shared/` is approaching a size worth watching** (architect review DRAFT-2, informational) — after this
   task, `shared/` holds `expiry.js`, `pantryDefaults.js`, `pantryCategories.js`, `recipeSources.js`, and
   `recipeTags.js`. Still perfectly manageable; not acted on here. If another 8-10 constant files accumulate
   over future tasks, grouping them into `shared/constants/` may be worth a future look — premature to do
   now, noted only so it isn't forgotten.

## Known Risks

- **Deleting root `.env` is irreversible in the sense that its specific values (Neon password, VAPID keys,
  etc.) won't be recoverable from this file again** — but since nothing reads it and its values are either
  duplicated elsewhere (VAPID keys, if still live, would also be in `server/.env.local`/Vercel) or dead
  (`GEMINI_API_KEY`, `JWT_SECRET`), this is treated as safe. If the Neon connection string in this file
  points at a still-important database not represented elsewhere, that would only be discoverable by
  comparing values directly — worth a quick manual check before deleting, not because the code needs it, but
  as a sanity check on a file that's about to be permanently removed.
- **Rate-limit thresholds (Design 6-7) are unmeasured proposals** (Open Questions) — if real usage patterns
  turn out to need more headroom (e.g. a large household onboarding many members' emails at once), the
  numbers are easy to revisit, not load-bearing architecture.
- **The atomic-`WHERE` fix (Design 8) has no live bug to reproduce** — today's TOCTOU window has never been
  observed to cause an actual cross-household mutation (no code path exists that would trigger it under
  normal use). This is defense-in-depth, not a fix for a confirmed incident.
