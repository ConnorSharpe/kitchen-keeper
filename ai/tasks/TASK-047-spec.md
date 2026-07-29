# TASK-047 — Private "Suggest an Improvement" Feedback Box

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.6/10 | Praised the narrow scope, the `clientErrors.js` reuse, and declining an admin UI/read endpoint. Two required changes, both accepted: (1) add indexes on `created_at` and `clerk_user_id` to the migration — cheap on a brand-new table, and `clerk_user_id` directly serves the "what did this user submit" query the review itself raised; (2) explicitly document insert-failure behavior — verified against the actual code (`express-async-errors` in `server/app.js:2` means the route's async throw needs no try/catch, and the global handler at `app.js:71-78` returns `500 { error: 'Internal server error' }`) rather than asserted. Two "strong recommendations" accepted as documentation-only, both confirmed against real code rather than assumed: the 10MB `express.json()` body limit at `app.js:55` already covers this route, and a one-line "no transaction needed" note. One strong recommendation declined: switching `created_at` from `text` to a native `timestamptz` — verified that every timestamp-like column across the current schema is `text`, so this would make `suggestions` the sole exception, for no operational benefit at this table's scale; the review itself flagged this as optional ("If changing conventions is out of scope, that's fine"). Minor UX polish accepted: character counter, placeholder copy, toast copy. Forward-looking note on a possible future unified owner-only diagnostics surface (`clientErrors` + `suggestions`) added to Out of Scope, not committed to. |
| DRAFT-2 | 9.9/10 — APPROVED | Confirmed all DRAFT-1 revisions land correctly, in particular praising that the `timestamptz` recommendation was independently verified against the schema rather than accepted at face value, and that the failure-behavior write-up traces actual control flow (`express-async-errors` → global handler → response body) rather than describing expected behavior generically. One non-blocking fix requested and applied: the acceptance criterion asserting `EXPLAIN` shows an index scan on `idx_suggestions_created_at` was reworded to only require the index exists and is eligible to satisfy the query's `ORDER BY` — a specific plan choice is a cost-based planner decision Postgres can legitimately skip on a still-tiny table, not a correctness property this task should assert. One optional future enhancement noted, explicitly not for this task: persisting operational context (`appVersion`/`deploySha`/`url`) alongside each suggestion, so "the Pantry page is acting weird" reports carry deploy context. Not added — the review itself said the current schema is "appropriately minimal" — but recorded in Out of Scope for later. |

---

## Request

Add a section to the Dashboard that lets any signed-in user submit a free-text suggestion for app
improvements, visible only to Connor (the app owner) — nobody else, including other members of the
submitter's own household, can read submitted suggestions.

Two scope questions were resolved directly with Connor before drafting (not inferred):

1. **Owner-side viewing:** no UI at all. Suggestions are persisted to the database; Connor queries them
   directly (Neon SQL editor / Drizzle Studio) when he wants to check. No `/admin/suggestions` page, no
   read endpoint.
2. **Submitter-side UX:** fire-and-forget. A success toast on submit, no history view, no status
   tracking. Matches the existing client-error-report pattern exactly (see below).

---

## Build vs. Buy — Web Research

Searched for current (2026) practice on in-app feedback collection for small SaaS products before
proposing a design, per the request to "go out on the web and find out the best way to accomplish
this."

Findings, and why they point at a custom build rather than a third-party tool (Canny, Featurebase,
Frill, Gleap, Survicate, etc.):

- The dominant pattern in the feedback-tool ecosystem is a **public-facing workflow**: collect → feature
  voting → public roadmap → changelog, explicitly to "close the loop" with the whole user base. That is
  the opposite of what's wanted here — Connor explicitly wants a private, owner-only inbox, not a public
  roadmap or voting board. Adopting one of these tools would mean either paying for capability that's
  actively unwanted (public visibility) or fighting the tool's default posture to hide it.
- These tools are priced and scoped for products with meaningfully larger user bases than this app's
  (a handful of households). The overhead — a new vendor, a new script/widget embed, a new place
  household data could leak to — isn't justified at this scale.
- For spam/abuse prevention, the common recommendations (honeypot fields, timing checks, reCAPTCHA) are
  aimed at **unauthenticated public forms**. This form only exists behind Clerk auth (same
  `clerkAuth` middleware as every other route in this app) — the submitter is always a known
  `clerkUserId` — so that entire category of defense is unnecessary here. A simple per-user rate limit
  (already a pattern in this codebase, see `server/middleware/joinRateLimit.js`) is the appropriate
  equivalent for an authenticated endpoint.
- This codebase already has the exact shape of feature needed, in miniature:
  `server/routes/clientErrors.js` — an authenticated, fire-and-forget, one-way POST endpoint with no
  corresponding read UI. The only material difference this task needs is persisting to a table instead
  of `console.error`, since Connor wants to query it later rather than dig through Vercel logs.

Conclusion: build it natively, following the `clientErrors.js` shape, persisted to a new table. No
third-party dependency.

Sources consulted: [Gleap — In-App Feedback Widgets Guide](https://www.gleap.io/blog/in-app-feedback-widgets-guide),
[Featurebase — 15 Best SaaS Feedback Tools 2026](https://www.featurebase.app/blog/saas-feedback-tools),
[Savio — 10 Best In-App Feedback Tools](https://www.savio.io/blog/in-app-feedback-tools/),
[Arcjet — Protecting a React Hook Form from Spam](https://blog.arcjet.com/protecting-a-react-hook-form-from-spam/),
[7 Ways to Stop Form Spam in Remix/Node.js](https://antoninmarxer.hashnode.dev/7-ways-to-stop-form-spam-in-remix-nodejs).

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Nearest precedent | `server/routes/clientErrors.js` | Authenticated, fire-and-forget POST, no read side. This task's route is structurally the same, minus the `console.error` and plus a DB insert. |
| Auth | `server/middleware/clerkAuth.js` | Populates `req.user = { id, householdId }` from the Clerk session; already required on every existing route via `router.use(clerkAuth)`. Nothing new needed. |
| Rate limiting | `server/middleware/createRateLimiter.js`, `joinRateLimit.js` | Factory over `express-rate-limit`, keyed by `req.user?.id ?? req.ip`. Reused as-is for this task's limiter. |
| Validation | `server/middleware/validate.js` | Zod `safeParse` against `req.body`, 400 on failure. Reused as-is. |
| Schema conventions | `server/db/schema.js` | Every table uses `serial('id')`, a `householdId` FK with `onDelete: 'cascade'`, and `text('created_at').notNull().$defaultFn(() => new Date().toISOString())` for timestamps (e.g. `recipeBlocklist`, `chatMessages`). Followed exactly. |
| Migration convention | `server/db/migrations/0016_recipe_blocklist.sql` + `ai/handoffs/CONVENTIONS.md` | `CREATE TABLE IF NOT EXISTS`, hand-applied to Neon's SQL editor per environment (staging first, then production), with `drizzle`'s migrator still able to safely re-run it as a no-op on server boot. Latest migration on disk is `0019_drop_users.sql` → this task is `0020_suggestions.sql`. |
| Owner identity | `server/routes/admin.js` | `req.user.id !== process.env.OWNER_CLERK_ID` is the existing "only Connor" gate — **not used by this task**, since there is no read endpoint for anyone to gate. Noted here only to confirm the env var already exists and is the established mechanism, in case a future admin UI is added (see Out of Scope). |
| Dashboard page | `client/src/pages/DashboardPage.jsx` | Three existing sections ("zones"): `ExpiryStrip`, `EatThisNow`, `QuickAdd`, each a `<section>` wrapping a card component. This task adds a fourth zone, same shape. |
| Client form pattern | `client/src/components/dashboard/QuickAdd.jsx` | `useState` + `api.post()` + `react-hot-toast` + disabled-while-submitting button. Followed exactly for the new `SuggestionBox` component. |
| API client | `client/src/api/index.js` | `api.post(path, body)` — attaches the Clerk bearer token, throws on non-2xx with `err.message`/`err.fieldErrors`. No changes needed. |

---

## Decision

### Schema — new `suggestions` table

`server/db/schema.js` addition, following the `recipeBlocklist`/`chatMessages` pattern exactly:

```js
export const suggestions = pgTable('suggestions', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),
  message: text('message').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

`clerkUserId` is stored (not just `householdId`) so Connor can tell *which member* of a multi-person
household submitted a given suggestion when reading the table directly — households can have several
members (`householdMembers`), and "who said this" is useful context that costs nothing to keep.

No `status` column, no reply/thread — deliberately, per the fire-and-forget decision above.

**Considered and declined (architect review round 1): `timestamptz` instead of `text` for
`created_at`.** Architecturally fairer as a native timestamp type, but checking every timestamp-like
column across the current `server/db/schema.js` (`households.createdAt`, `pantryItems.createdAt`/
`updatedAt`, `recipes.savedAt`/`updatedAt`, `shoppingLists.createdAt`/`updatedAt`,
`pushSubscriptions.createdAt`, `householdMembers.joinedAt`, `userOnboarding.createdAt`/`completedAt`,
`chatMessages.createdAt`, `recipeBlocklist.blockedAt`, `platformSettings.updatedAt`,
`mealLogs.loggedAt`) confirms none of them use a native Postgres timestamp type — every single one is
`text`, ISO-8601-formatted. Making `suggestions.created_at` the one exception would trade a real,
schema-wide consistency cost for a benefit that doesn't apply at this table's scale (a handful of
households, not a table where timestamp arithmetic/timezone-aware querying is load-bearing). Inherited
convention, not this task's problem to fix in isolation — flagged in the review as optional for exactly
this reason.

### Migration — `server/db/migrations/0020_suggestions.sql`

Two indexes added per architect review round 1: `created_at DESC` directly serves the manual
`ORDER BY created_at DESC` query Connor will run (see Known Risks below), and `clerk_user_id` serves
"what has this user submitted" if that's ever asked. Both are effectively free — the table is brand new
and empty, so there's no backfill cost, only the (negligible, one-time) cost of creating them.

```sql
-- TASK-047: private, owner-only "suggest an improvement" feedback box.
-- New, empty table — no backfill. IF NOT EXISTS + statement-breakpoint, hand-applied directly in
-- Neon's SQL Editor (staging first, then production per CONVENTIONS.md's canonical migration order),
-- but server/db/migrate.js still runs drizzle's migrator on every server boot — must be a safe no-op
-- if re-attempted afterward.

CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_suggestions_clerk_user_id ON suggestions (clerk_user_id);

-- Down migration (if needed):
-- DROP TABLE suggestions;
```

Not mirrored as `index()`/`uniqueIndex()` calls in `schema.js` — same precedent as
`recipe_blocklist_unique` in `0016_recipe_blocklist.sql`, which also exists only in the migration SQL,
not in the Drizzle schema definition. Followed for consistency rather than introducing a new pattern.

### Service — `server/services/suggestionService.js` (new file)

```js
import { db } from '../db/client.js';
import { suggestions } from '../db/schema.js';

export async function submitSuggestion({ householdId, clerkUserId, message }) {
  await db.insert(suggestions).values({ householdId, clerkUserId, message });
}
```

No read function — deliberately, matching the "DB only" decision. Connor reads via direct SQL (sample
query in Known Risks / Implementation Notes below) or Drizzle Studio.

No transaction wrapper — deliberately. The operation is a single `INSERT`; there is nothing else to
keep atomic with it. Flagged explicitly (per architect review round 1) so a future contributor doesn't
add a transaction "for safety" if this function ever grows a second write (e.g. an audit log) — at that
point it becomes a real design decision to evaluate, not a default to reach for pre-emptively today.

### Route — `server/routes/suggestions.js` (new file)

```js
import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import { createRateLimiter } from '../middleware/createRateLimiter.js';
import * as suggestionService from '../services/suggestionService.js';

const router = express.Router();
router.use(clerkAuth);

// Authenticated-only endpoint (every caller has a known clerkUserId) — a per-user limit is
// sufficient; no honeypot/CAPTCHA needed, unlike a public-facing form (see Build vs. Buy above).
const suggestionRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many suggestions submitted. Please try again in a bit.',
});

const suggestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

// POST /api/suggestions — fire-and-forget, same response shape as clientErrors.js.
router.post(
  '/',
  suggestionRateLimit,
  validate(suggestSchema),
  async (req, res) => {
    await suggestionService.submitSuggestion({
      householdId: req.user.householdId,
      clerkUserId: req.user.id,
      message: req.body.message,
    });
    res.status(204).end();
  }
);

export default router;
```

**Failure behavior, made explicit per architect review round 1** (verified against the actual code, not
assumed): the route handler is `async` with no `try/catch`, which is safe in this codebase because
`server/app.js:2` imports `express-async-errors` before any route is registered — a rejected promise
inside an async handler (e.g. `db.insert()` failing because Neon is unreachable, the connection times
out, or the insert itself errors) is automatically forwarded to Express's error-handling middleware,
exactly as every other route in this codebase already relies on (none of them wrap their DB calls in
`try/catch` either). The global handler at `app.js:71-78` then logs `err.stack` via `console.error` and,
since a DB failure carries no `.status`, responds `500` with body `{ "error": "Internal server error" }`
— the same generic failure response every other endpoint in this app returns for an unhandled error.
There is no partial state to worry about: the request performs exactly one `INSERT`, which either fully
commits or doesn't happen at all.

**Body size, made explicit per architect review round 1**: no new limit is added in this router.
`server/app.js:55` already applies `express.json({ limit: '10mb' })` globally, before any router is
mounted — this route inherits that ceiling like every other POST endpoint in the app. A 10MB cap is far
looser than this endpoint needs (the Zod schema already rejects anything over 2000 characters of
`message`), but tightening the global limit is out of scope for this task — it's shared middleware every
other route also depends on, not something to narrow for one new endpoint.

`server/app.js` registration (alongside the other route mounts, e.g. after line 67's
`clientErrorsRouter`):

```js
import suggestionsRouter from './routes/suggestions.js';
// ...
app.use('/api/suggestions', suggestionsRouter);
```

### Client — `client/src/components/dashboard/SuggestionBox.jsx` (new file)

Placeholder and toast copy updated per architect review round 1 (pure copy, no behavior change), and a
character counter added — cheap (one `<span>` reading `message.length`), and directly useful given the
field has a hard 2000-character limit with no other affordance showing that:

```jsx
import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';

const MAX_LENGTH = 2000;

export default function SuggestionBox() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.post('/api/suggestions', { message: message.trim() });
      toast.success('Thanks! Your feedback helps improve Kitchen Keeper.');
      setMessage('');
    } catch (err) {
      toast.error(err.message || 'Failed to send suggestion');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">
        Suggest an Improvement
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's frustrating? What's missing? We'd love your ideas."
          maxLength={MAX_LENGTH}
          rows={3}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm resize-none
                     focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          required
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {message.length}/{MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md
                       hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : 'Send Suggestion'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

### `DashboardPage.jsx` — new fourth zone

```jsx
import SuggestionBox from '../components/dashboard/SuggestionBox.jsx';
// ...
{/* Zone 4: private, owner-only suggestion box */}
<section aria-labelledby="suggestion-heading">
  <h2 id="suggestion-heading" className="sr-only">
    Suggest an Improvement
  </h2>
  <SuggestionBox />
</section>
```

Visible to **every** signed-in user (any household, any role) — the *submitting* side is intentionally
open to all users; only the *reading* side is owner-only, and the reading side has no UI at all.

---

## What Does NOT Change

- No new admin/owner-only page or route — deliberately, per the resolved scope questions.
- `server/routes/admin.js` / `requireOwner` — untouched. Not reused here since there's no read
  endpoint to gate. Exists in the codebase already if a future task adds a read UI (see Out of Scope).
- `clientErrors.js` — untouched; a separate, unrelated fire-and-forget endpoint that happens to share
  this task's shape.
- No changes to `householdService.js`, `clerkAuth.js`, `validate.js`, `createRateLimiter.js` — all
  reused as-is.

## Allowed Files

- `server/db/schema.js` — add the `suggestions` table export.
- `server/db/migrations/0020_suggestions.sql` — new migration.
- `server/services/suggestionService.js` — new file.
- `server/routes/suggestions.js` — new file.
- `server/app.js` — one import + one `app.use()` line to mount the new router.
- `client/src/components/dashboard/SuggestionBox.jsx` — new file.
- `client/src/pages/DashboardPage.jsx` — add the fourth `<section>` and its import.

## Forbidden Files

- `server/routes/admin.js` — no read endpoint is being added in this task; not touched.
- `server/routes/clientErrors.js` — unrelated, pre-existing endpoint; not touched.
- Every other route/service/component not listed above — no reason for this task to touch them.

---

## Dependency Chain

Editing:
- `server/db/schema.js`, `server/routes/suggestions.js`, `server/services/suggestionService.js`,
  `server/app.js`, `client/src/components/dashboard/SuggestionBox.jsx`,
  `client/src/pages/DashboardPage.jsx`

Creating:
- `server/db/migrations/0020_suggestions.sql`

Reads (pattern reference only, do not modify):
- `server/routes/clientErrors.js` — structural precedent for the fire-and-forget route shape.
- `server/middleware/joinRateLimit.js`, `createRateLimiter.js` — rate-limit pattern reused verbatim.
- `client/src/components/dashboard/QuickAdd.jsx` — client form pattern reused verbatim.
- `ai/handoffs/CONVENTIONS.md` — canonical migration order (staging Neon branch first, then
  production), followed for applying `0020_suggestions.sql`.

Irrelevant:
- Everything under `server/services/ai/`, `server/services/chat/` — no relation to this feature.

---

## Acceptance Criteria

- [ ] From the Dashboard, any signed-in user sees a "Suggest an Improvement" box below Quick Add, can
      type a message, and submitting shows a success toast and clears the textarea.
- [ ] Submitting an empty/whitespace-only message is blocked client-side (submit button disabled) and,
      if bypassed, rejected server-side with a 400 (Zod `min(1)`).
- [ ] Submitting a message over 2000 characters is rejected server-side with a 400.
- [ ] After a successful submit, a new row appears in the `suggestions` table (verified via direct SQL
      against the `staging` Neon branch) with the correct `household_id`, `clerk_user_id`, `message`,
      and a populated `created_at`.
- [ ] Submitting 11 suggestions within an hour as the same user: the 11th returns 429 with the
      configured rate-limit message; a different user is unaffected (confirms the per-user
      `keyGenerator`).
- [ ] No unauthenticated request can reach `POST /api/suggestions` — confirmed by `clerkAuth` returning
      401 without a valid session token, same as every other route.
- [ ] No new console errors introduced on the Dashboard.
- [ ] Migration applied cleanly to the `staging` Neon branch first (per `CONVENTIONS.md`'s canonical
      order), verified there, then applied to production before merging `staging` → `main`.
- [ ] `\d suggestions` (or equivalent) on the `staging` Neon branch shows both
      `idx_suggestions_created_at` and `idx_suggestions_clerk_user_id` present after the migration runs.
- [ ] `idx_suggestions_created_at` exists and is eligible to satisfy the Known-Risks sample query's
      `ORDER BY s.created_at DESC` (confirmed via `\d suggestions` / `pg_indexes`, not via asserting a
      specific `EXPLAIN` plan — Postgres may legitimately choose a sequential scan over the index while
      the table is still tiny, since that's a cost-based planner decision, not a correctness property;
      per architect review round 2).
- [ ] Simulate an insert failure (e.g. temporarily point `DATABASE_URL` at an unreachable host, or
      revoke the table briefly) and confirm the response is `500 { "error": "Internal server error" }`
      with the stack trace logged server-side — not an unhandled rejection or a hung request.

---

## Known Risks / Implementation Notes

1. **No read UI means "verification" for Connor is a manual SQL query.** Sample query for checking
   submitted suggestions, joined with household name for context — served by `idx_suggestions_created_at`
   rather than a sequential scan + sort, per architect review round 1:
   ```sql
   SELECT s.id, s.message, s.created_at, s.clerk_user_id, h.name AS household_name
   FROM suggestions s
   JOIN households h ON h.id = s.household_id
   ORDER BY s.created_at DESC;
   ```
   If this ends up being checked often enough to be annoying, a follow-up task to add a minimal
   owner-only read page (reusing `requireOwner` from `admin.js`) is a small, additive change on top of
   this table — not a rework.
2. **Rate limit numbers (10/hour/user) are a starting guess**, not derived from any observed abuse
   pattern (there is none yet, this is a new feature) — open to adjustment during review.
3. **No profanity/content filtering.** Since there's no UI that renders this content back to anyone
   (only direct SQL/Drizzle Studio access by Connor), and React would escape it by default if a future
   admin UI ever does render it, this is not a stored-XSS concern today — flagged only because it would
   become relevant if Out of Scope item 1 below is ever built.

## Out of Scope (v1)

- An owner-only page/route to read suggestions in-app — explicitly declined for this task (Connor will
  query the DB directly); see Known Risk 1 for the natural follow-up shape if this changes.
- A unified owner-only operational surface covering both `suggestions` and `clientErrors` (the two
  "private sink" tables/logs this codebase now has). Not building this now — flagged per architect
  review round 1 only so the evolution path stays visible if operational needs grow later; nothing in
  this task's design blocks or complicates that possibility (both are already simple, independent,
  owner-scoped data sources that a future read-only page could join against without any rework here).
- Status tracking, replies, or any two-way communication with the submitter.
- Per-submitter suggestion history.
- Categorization/tagging of suggestions.
- Any third-party feedback tool (Canny, Featurebase, etc.) — see Build vs. Buy above.
- Persisting operational context per suggestion (`appVersion`, `deploySha`, `url`) so a report like "the
  Pantry page is acting weird" carries deploy/page context for free. Noted per architect review round 2
  as a plausible future enhancement, explicitly not needed now — the current four-column schema is
  "appropriately minimal" for what's being asked for today.
