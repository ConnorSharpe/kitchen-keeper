# TASK-037 — Public AI Access Toggle + Per-Household Rate Limiting

Version: DRAFT-3 (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 — solid, several required fixes before implementation | **Adopted**: (1) `platform_settings` reads move behind a 5-second TTL cache with explicit invalidation on write, implemented as a small reusable `createCachedLoader` helper rather than ad hoc caching inline — reduces DB coupling on the AI hot path while keeping "next request sees the flip" true for the instance that made the change; (2) `resolveProvider(clerkUserId, decryptedKey, publicAiAccessEnabled)`'s three positional args become one options object — the function had already grown past where positional args stay unambiguous; (3) fail-closed behavior on a settings-lookup failure is now explicit: any DB error is caught and treated as "platform access disabled, default rate limit," never a 500 or an accidental fail-open; (4) `MemoryStore`'s rate-limit wording strengthened per the review's own phrasing — "abuse deterrence, not spend protection"; (5) the admin route is renamed `/api/admin/platform-settings` (from `/ai-access`) and the settings object grows a second field, `aiRateLimitMax`, so rate-limit tuning also doesn't require a redeploy — same reasoning as the toggle itself, and the review independently suggested more platform settings were likely coming; (6) `household.isOwner` becomes a top-level `viewerIsOwner` field, sibling to `household` in the API response, not nested inside it — it's a property of the requester, not the household; (7) added `cachedLoader.test.js` and a new `aiRateLimitKeyGenerator` (extracted into its own dependency-free file so it's unit-testable without transitively importing `db/client.js`) with `aiRateLimit.test.js`. **Declined, with reasoning**: (a) `CHECK (id = 1)` combined with `id` as the `PRIMARY KEY` already fully prevents a second row — any insert with `id ≠ 1` violates the check, and any insert with `id = 1` violates the primary key uniqueness once the seed row exists. The review's specific concern ("someone can still `INSERT id=2`") doesn't hold against what was already specified; no further constraint needed. Added a verification step that empirically proves this instead of just asserting it. (b) `updated_at` stays `TEXT`, not `timestamptz` — every single existing table in this schema (`households`, `pantryItems`, `recipes`, `chatMessages`, all of them) stores timestamps as ISO-string text with an identical `$defaultFn` pattern; introducing one differently-typed column would be a repo-wide convention break for an isolated "more correct in a vacuum" gain, which is a worse trade for this specific codebase than matching its existing, consistent pattern. (c) No DB transaction around the settings update — it's a single-statement `UPDATE` against one row, already atomic; the review itself called this "not critical today, future-proofing," and speculative transaction-wrapping for a hypothetical future multi-setting update is scope creep this project's conventions explicitly avoid. (d) No optimistic-concurrency/versioning — last-write-wins on an admin-only boolean+small-config toggle is genuinely harmless (worst case: the owner double-flips in two tabs and sees the current state on next load), and the review itself flagged this as minor/non-blocking. (e) `platformSettingsService` keeps its full name, not shortened to `settingsService` — this codebase already has multiple "settings"-shaped concepts (household dietary profile, AI key); the fuller name is more self-documenting and the review called this optional. (f) A full `platform_settings_history` audit table and app-level usage metrics are both deferred to Out of Scope as genuine future follow-ups, not built now — neither was needed for the actual ask ("the option to quickly switch"), and `updated_at`/`updated_by_clerk_id` on the current row already answers "who last changed this and when" for the live state. **Folded into existing surface rather than added new**: the review's suggested `GET /api/admin/ai-status` debug endpoint is redundant with the existing `GET /api/admin/platform-settings`, which now also returns `updatedAt`/`updatedByClerkId` — a second near-duplicate endpoint wasn't worth adding. **Scoped down from the review's literal ask**: automated tests for "settings lookup failure" and "missing row" are not written against `platformSettingsService.js` directly, because doing so would require importing `db/client.js` (which constructs a Neon client from `process.env.DATABASE_URL` at module load) into the automated suite for the first time — every existing test file in this codebase deliberately avoids that. Instead, the *logic* those tests would cover is fully exercised through `cachedLoader.test.js` (cache/invalidation/error-propagation, DB-free) and a live verification step (below) against a real dev database. This preserves the codebase's existing test/DB boundary rather than being the first task to cross it. |
| DRAFT-2 | 9.7/10 — approved pending two required fixes | **Adopted (required)**: (1) **Cache stampede fix** — `createCachedLoader` now memoizes the in-flight load promise, so concurrent `get()` calls that land during a cache miss on the *same* warm instance share one DB query instead of each firing their own. (Genuinely narrower in this app's serverless deployment than the general case, since concurrent requests often land on separate Vercel instances with independent module-level cache state anyway — same caveat already documented for the rate limiter's `MemoryStore` — but real and free to fix for same-instance concurrency, so fixed.) New `cachedLoader.test.js` case proves a burst of concurrent `get()` calls triggers exactly one `loadFn` call. (2) **PATCH response race fix** — `setPlatformSettings` now uses `UPDATE ... RETURNING` (Drizzle's `.returning()`, already used elsewhere in this codebase for inserts, e.g. `householdService.createHousehold`) instead of a write followed by a separate cache-backed read-back. This eliminates the race by construction — one atomic statement returns the exact row that was just written, so there's no window where a transient failure on a second query could make a successful PATCH report stale/default values. **Adopted (minor)**: rate-limit ceiling in the PATCH schema lowered from 1000 to 100 (no real use case above that for a household-scale app); cache TTL constant renamed `PLATFORM_SETTINGS_CACHE_TTL_MS` for clarity; light trim of a few comments that restated what the surrounding prose already covered. **Declined, with reasoning**: structured logging in place of `console.error` — this codebase has no structured logger anywhere (confirmed: `transcribe.js`, `householdService.js`, etc. all use `console.*` directly), so `console.error` here matches the existing, consistent convention; the review itself said "if not: fine." |

---

## Origin

The user is preparing to take this app public (open registration, real strangers). The plan: launch with AI features free for everyone, billed against the owner's own paid OpenAI key, then fall back to requiring BYOK (bring your own key) if usage gets expensive. Research done ahead of this spec surfaced one finding that changes the design: **as of 2026, OpenAI removed hard project budget caps — the dashboard spending threshold only sends a notification, it does not stop requests.** The one real hard stop (prepaid credits, auto-recharge off) is org-wide, not app-level, and has an acknowledged enforcement lag. This means the app itself has to be the fast, reliable switch — an OpenAI dashboard setting alone is not sufficient, and it has to be flippable without a redeploy, since redeploy latency is exactly the kind of delay that defeats "quickly switch."

This spec covers two things: (A) a database-backed toggle that lets the owner instantly open platform-key AI access to every household, and flip it back, with zero redeploy; (B) per-household rate limiting on the AI endpoints, since an open, free AI feature with no request limits is a standing invitation for a scripted client to burn the shared key's budget far faster than any human-paced traffic would.

## Current Behavior (confirmed by reading the code, not assumed)

`server/services/ai/resolveProvider.js` already has a BYOK/platform-key split, but it's the opposite of a public-launch mode: only the household whose `households.clerk_user_id` matches `OWNER_CLERK_ID` gets `process.env.OPENAI_API_KEY`. Every other household — including households created by brand-new sign-ups — gets a `403 NO_API_KEY` unless they've pasted their own OpenAI key into Household Settings (`households.openai_api_key`, AES-256-GCM encrypted, via `PATCH /api/household/ai-key`). This is confirmed working end-to-end already (Settings UI, encryption, `getAiConfig`/`setAiApiKey`/`removeAiApiKey`).

No rate limiting exists anywhere in the server. `express-rate-limit@7.5.1` (installed, satisfies the `^7.2.0` range in `server/package.json`) is already an installed dependency but is not imported or used anywhere — this task is the first thing to actually wire it up. Confirmed from the installed type definitions: `limit` accepts `number | (request, response) => number | Promise<number>` — an async, dynamic per-request limit is natively supported, no version upgrade needed.

The legacy `INVITE_CODE` registration gate mentioned in `.env.example`/`README.md` is dead code left over from a pre-Clerk auth system (TASK-001, archived) — it is not connected to the current Clerk-based sign-up flow. Registration openness today is entirely a Clerk Dashboard setting, outside this repo.

---

## Part A — Database-Backed Platform Settings (AI Access Toggle + Rate Limit Tuning)

### Design

A new single-row config table, `platform_settings`, holds the operational knobs the owner needs to adjust without a redeploy: `public_ai_access_enabled` (boolean) and `ai_rate_limit_max` (integer, Part B). Deliberately **not** env vars — a Vercel env var change requires a redeploy to take effect, which undercuts "quickly switch" exactly when it matters most (mid-incident, on a phone). Reads go through a 5-second in-process cache (see `cachedLoader.js` below), invalidated immediately on write, so the DB isn't queried on every single AI request while still reflecting a change within a handful of seconds.

Resolution order for a non-owner household (unchanged for the owner — the owner always uses the platform key, exactly as today):

1. If the household has its own BYOK key set → use it. (BYOK always wins — flipping the platform-wide toggle must never silently switch a household off a key they deliberately configured.)
2. Else if `public_ai_access_enabled` is true → use the platform key (`OPENAI_API_KEY`).
3. Else → `403 NO_API_KEY`, same as today.

If the settings lookup itself fails (DB outage, network blip), the system fails **closed**: treated as if `public_ai_access_enabled` were `false` and `ai_rate_limit_max` were its default (20) — a lookup failure degrades AI access for non-owner households rather than risking an accidental fail-open that grants everyone platform-key access during an outage.

### New file: `server/db/migrations/0017_platform_settings.sql`

```sql
-- Migration 0017: Add platform_settings — single-row config table for the
-- public AI access toggle and rate-limit tuning (TASK-037). Apply manually
-- in Neon SQL Editor. Deploy AFTER this migration, not before — server code
-- in this task queries this table on every AI request (through a 5s cache);
-- deploying first would 500 every AI call.
--
-- Singleton enforcement: PRIMARY KEY(id) + CHECK(id = 1) together are
-- sufficient — any insert with id != 1 violates the CHECK, and any insert
-- with id = 1 once the seed row exists violates the PRIMARY KEY's uniqueness.
-- No second row is possible. See this task's Verification Steps for a live
-- check that proves this.

CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_ai_access_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_rate_limit_max INTEGER NOT NULL DEFAULT 20,
  updated_at TEXT NOT NULL,
  updated_by_clerk_id TEXT
);

-- Seed the single settings row. Starts disabled — today's "BYOK required for
-- everyone but the owner" behavior is unchanged until the owner explicitly
-- flips this via the new admin toggle.
INSERT INTO platform_settings (id, public_ai_access_enabled, ai_rate_limit_max, updated_at)
VALUES (1, false, 20, now()::text);

-- Verify after applying:
SELECT * FROM platform_settings;
-- This should fail (violates CHECK(id = 1)):
-- INSERT INTO platform_settings (id, public_ai_access_enabled, updated_at) VALUES (2, true, now()::text);
```

### `server/db/schema.js` — add table

Add after the `mealLogs` export (end of file):

```js
export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey(),
  publicAiAccessEnabled: boolean('public_ai_access_enabled')
    .notNull()
    .default(false),
  aiRateLimitMax: integer('ai_rate_limit_max').notNull().default(20),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedByClerkId: text('updated_by_clerk_id'),
});
```

### New file: `server/services/cachedLoader.js`

Generic, dependency-free — deliberately factored out so it's unit-testable without a database, and reusable if another ops-config lookup ever needs the same TTL-cache-with-invalidation shape.

```js
// Short-TTL cache wrapper around an async loader function, with explicit
// manual invalidation. A throwing loadFn propagates and leaves the cache
// unpopulated (retried on the next get()) rather than caching a failure.
//
// Concurrent get() calls during a cache miss share one in-flight loadFn call
// instead of each firing their own (architect review round 2 — "stampede"
// fix). This only dedupes calls landing on the same instance/process; it's
// not a distributed lock, which this app's scale doesn't need.
export function createCachedLoader(loadFn, ttlMs) {
  let cache = null; // { value, expiresAt } | null
  let inFlight = null; // Promise<value> | null

  async function get() {
    if (cache && Date.now() < cache.expiresAt) return cache.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = await loadFn();
        cache = { value, expiresAt: Date.now() + ttlMs };
        return value;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function invalidate() {
    cache = null;
  }

  return { get, invalidate };
}
```

### New file: `server/services/cachedLoader.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedLoader } from './cachedLoader.js';

test('caches the loader result within the TTL window', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 10_000);
  const a = await loader.get();
  const b = await loader.get();
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test('reloads after the TTL expires', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 1);
  await loader.get();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await loader.get(), 2);
});

test('invalidate() forces a reload on the next get()', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 10_000);
  await loader.get();
  loader.invalidate();
  assert.equal(await loader.get(), 2);
});

test('a throwing loader propagates and does not poison the cache', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  }, 10_000);
  await assert.rejects(() => loader.get());
  assert.equal(await loader.get(), 'ok');
  assert.equal(calls, 2);
});

test('deduplicates concurrent loads on a cache miss (no stampede)', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return calls;
  }, 10_000);
  const [a, b, c] = await Promise.all([
    loader.get(),
    loader.get(),
    loader.get(),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(c, 1);
});
```

### New file: `server/services/platformSettingsService.js`

Not covered by automated tests directly (see Architect Review History — avoids being the first module to pull `db/client.js` into the test suite); its cache/fail-closed *logic* is exercised via `cachedLoader.test.js`, and its DB behavior via the live verification steps below.

```js
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import { createCachedLoader } from './cachedLoader.js';

const SETTINGS_ROW_ID = 1;
const PLATFORM_SETTINGS_CACHE_TTL_MS = 5000;

// Used both if the settings row is somehow missing (shouldn't happen —
// migration 0017 seeds it) and if the DB lookup itself fails.
const DEFAULTS = {
  publicAiAccessEnabled: false,
  aiRateLimitMax: 20,
  updatedAt: null,
  updatedByClerkId: null,
};

function rowToSettings(row) {
  return {
    publicAiAccessEnabled: row.publicAiAccessEnabled,
    aiRateLimitMax: row.aiRateLimitMax,
    updatedAt: row.updatedAt,
    updatedByClerkId: row.updatedByClerkId,
  };
}

async function loadFromDb() {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, SETTINGS_ROW_ID));
  return row ? rowToSettings(row) : DEFAULTS;
}

const cache = createCachedLoader(loadFromDb, PLATFORM_SETTINGS_CACHE_TTL_MS);

// Fails closed: any DB error (Neon outage, network blip) is treated as
// "platform access disabled, default rate limit" rather than 500ing every AI
// request or accidentally fail-opening to grant everyone platform-key access.
export async function getPlatformSettings() {
  try {
    return await cache.get();
  } catch (err) {
    console.error(
      '[platformSettingsService] lookup failed, failing closed:',
      err.message
    );
    return DEFAULTS;
  }
}

export async function isPublicAiAccessEnabled() {
  const { publicAiAccessEnabled } = await getPlatformSettings();
  return publicAiAccessEnabled;
}

// Uses UPDATE ... RETURNING (Drizzle's .returning(), already used elsewhere
// in this codebase — see householdService.createHousehold) so the response
// reflects exactly the row just written, in the same atomic statement. This
// avoids a race where invalidating the cache and then re-reading it as two
// separate steps could return stale/default data if the second read failed
// (architect review round 2). Verify .returning() works on .update() with
// the installed drizzle-orm@0.29.5 + neon-http combination before relying on
// it — proven for .insert() in this codebase already, not yet for .update().
export async function setPlatformSettings(patch, updatedByClerkId) {
  const [row] = await db
    .update(platformSettings)
    .set({ ...patch, updatedAt: new Date().toISOString(), updatedByClerkId })
    .where(eq(platformSettings.id, SETTINGS_ROW_ID))
    .returning();
  cache.invalidate();
  return rowToSettings(row);
}
```

### `server/services/ai/resolveProvider.js` — full replacement (options object)

```js
import { OpenAIProvider } from './openaiProvider.js';

export class NoApiKeyError extends Error {
  constructor() {
    super('Please add your OpenAI API key in Settings to use AI features.');
    this.status = 403;
    this.code = 'NO_API_KEY';
  }
}

// clerkUserId: the requesting household's Clerk user ID (used to identify the owner)
// decryptedKey: the household's stored OpenAI key (null if not set)
// publicAiAccessEnabled: platform-wide toggle (server/services/platformSettingsService.js).
// When true, non-owner households without their own key fall back to the platform key.
// BYOK always takes precedence over the toggle when a household has its own key set.
export function resolveProvider({
  clerkUserId,
  decryptedKey,
  publicAiAccessEnabled = false,
}) {
  const isOwner = clerkUserId === process.env.OWNER_CLERK_ID;
  const key = isOwner
    ? process.env.OPENAI_API_KEY
    : (decryptedKey ?? (publicAiAccessEnabled ? process.env.OPENAI_API_KEY : null));
  if (!key) throw new NoApiKeyError();
  return new OpenAIProvider(key);
}
```

### `server/services/householdService.js` — `getAiConfig` change

Add import at top: `import * as platformSettingsService from './platformSettingsService.js';`

Replace `getAiConfig`:

```js
export async function getAiConfig(householdId) {
  const row = await getById(householdId);
  const publicAiAccessEnabled =
    await platformSettingsService.isPublicAiAccessEnabled();
  if (!row?.openaiApiKey) {
    return {
      provider: row?.clerkUserId ?? null,
      decryptedKey: null,
      publicAiAccessEnabled,
    };
  }
  try {
    const decryptedKey = decrypt(row.openaiApiKey);
    return { provider: row.clerkUserId, decryptedKey, publicAiAccessEnabled };
  } catch {
    const err = new Error(
      'Your configured AI key could not be decrypted. Please update it in Household Settings.'
    );
    err.status = 422;
    throw err;
  }
}
```

`getAiKeyPreview` is unchanged — it doesn't call `resolveProvider` and has nothing to do with the toggle.

### Two `resolveProvider(...)` call sites

`server/services/aiService.js` (inside `chat()`, ~line 605):

```js
const provider = resolveProvider({
  clerkUserId: aiConfig?.provider ?? null,
  decryptedKey: aiConfig?.decryptedKey ?? null,
  publicAiAccessEnabled: aiConfig?.publicAiAccessEnabled ?? false,
});
```

`server/routes/transcribe.js` (~line 35):

```js
const provider = resolveProvider({
  clerkUserId: aiConfig.provider,
  decryptedKey: aiConfig.decryptedKey,
  publicAiAccessEnabled: aiConfig.publicAiAccessEnabled,
});
```

Both call sites already receive `aiConfig` from `householdService.getAiConfig(...)`, which now carries `publicAiAccessEnabled` — no other plumbing changes needed. `aiService.chat()`'s own signature (8 positional params) is unchanged.

### New file: `server/services/ai/resolveProvider.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, NoApiKeyError } from './resolveProvider.js';

const OWNER = 'owner_clerk_id';

test('owner always gets the platform key, regardless of toggle or BYOK', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: OWNER,
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: false,
  });
  assert.equal(provider.client.apiKey, 'platform-key');
});

test('non-owner with BYOK key uses their own key when toggle is off', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: false,
  });
  assert.equal(provider.client.apiKey, 'household-byok-key');
});

test('non-owner with BYOK key uses their own key even when toggle is on', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: 'household-byok-key',
    publicAiAccessEnabled: true,
  });
  assert.equal(provider.client.apiKey, 'household-byok-key');
});

test('non-owner without a key gets the platform key when toggle is on', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  const provider = resolveProvider({
    clerkUserId: 'other_user',
    decryptedKey: null,
    publicAiAccessEnabled: true,
  });
  assert.equal(provider.client.apiKey, 'platform-key');
});

test('non-owner without a key throws NoApiKeyError when toggle is off', () => {
  process.env.OWNER_CLERK_ID = OWNER;
  process.env.OPENAI_API_KEY = 'platform-key';
  assert.throws(
    () =>
      resolveProvider({
        clerkUserId: 'other_user',
        decryptedKey: null,
        publicAiAccessEnabled: false,
      }),
    NoApiKeyError
  );
});
```

Implementer note: verify `provider.client.apiKey` is actually how the installed `openai` SDK version exposes the configured key on its client instance before relying on it in these assertions — inspect `node_modules/openai`'s client constructor if it's not obvious from `OpenAIProvider`'s own code.

### New file: `server/routes/admin.js`

Owner-only. `clerkAuth` populates `req.user`; `requireOwner` compares against `OWNER_CLERK_ID` — this is the actual security boundary, not the client-side `viewerIsOwner` gating in the UI section below.

```js
import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import * as platformSettingsService from '../services/platformSettingsService.js';

const router = express.Router();
router.use(clerkAuth);

function requireOwner(req, res, next) {
  if (req.user.id !== process.env.OWNER_CLERK_ID) {
    const err = new Error('Owner access required');
    err.status = 403;
    return next(err);
  }
  next();
}

router.get('/platform-settings', requireOwner, async (_req, res) => {
  const settings = await platformSettingsService.getPlatformSettings();
  res.json(settings);
});

const patchSchema = z
  .object({
    publicAiAccessEnabled: z.boolean().optional(),
    aiRateLimitMax: z.number().int().min(1).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

router.patch(
  '/platform-settings',
  requireOwner,
  validate(patchSchema),
  async (req, res) => {
    const settings = await platformSettingsService.setPlatformSettings(
      req.body,
      req.user.id
    );
    res.json(settings);
  }
);

export default router;
```

### `server/app.js` — mount the router

```js
import adminRouter from './routes/admin.js';
// ...
app.use('/api/admin', adminRouter);
```

### `server/routes/household.js` — expose `viewerIsOwner` (top-level, not nested)

In the `GET /` handler:

```js
res.json({
  household: {
    id: household.id,
    name: household.name,
    joinCode: household.joinCode,
    maskedKey: aiPreview.maskedKey,
  },
  viewerIsOwner: req.user.id === process.env.OWNER_CLERK_ID,
});
```

`viewerIsOwner` is a property of the requester, not the household, so it's a sibling field in the response, not nested inside `household`.

### `client/src/pages/HouseholdPage.jsx` — owner-only admin section

New state (near the existing `aiKey`/`aiSaving` state block):

```jsx
const [viewerIsOwner, setViewerIsOwner] = useState(false);
const [platformSettings, setPlatformSettings] = useState(null); // { publicAiAccessEnabled, aiRateLimitMax, updatedAt, updatedByClerkId } | null
const [platformSettingsLoading, setPlatformSettingsLoading] = useState(false);
const [platformSettingsSaving, setPlatformSettingsSaving] = useState(false);
const [platformSettingsError, setPlatformSettingsError] = useState('');
const [rateLimitInput, setRateLimitInput] = useState('');
```

Update the existing `load` callback to also capture `viewerIsOwner` from the top-level response field:

```jsx
const load = useCallback(async () => {
  setLoading(true);
  setLoadError(null);
  try {
    const { household, viewerIsOwner } = await api.get('/api/household');
    setHousehold(household);
    setViewerIsOwner(viewerIsOwner);
  } catch (err) {
    setLoadError(err.message || 'Failed to load household');
  } finally {
    setLoading(false);
  }
}, []);
```

New effect + handlers:

```jsx
useEffect(() => {
  if (!viewerIsOwner) return;
  setPlatformSettingsLoading(true);
  api
    .get('/api/admin/platform-settings')
    .then((s) => {
      setPlatformSettings(s);
      setRateLimitInput(String(s.aiRateLimitMax));
    })
    .catch((err) => setPlatformSettingsError(err.message))
    .finally(() => setPlatformSettingsLoading(false));
}, [viewerIsOwner]);

async function patchPlatformSettings(patch) {
  setPlatformSettingsSaving(true);
  setPlatformSettingsError('');
  try {
    const result = await api.patch('/api/admin/platform-settings', patch);
    setPlatformSettings(result);
    setRateLimitInput(String(result.aiRateLimitMax));
  } catch (err) {
    setPlatformSettingsError(err.message);
  } finally {
    setPlatformSettingsSaving(false);
  }
}

function toggleAiAccess() {
  patchPlatformSettings({
    publicAiAccessEnabled: !platformSettings.publicAiAccessEnabled,
  });
}

function saveRateLimit(e) {
  e.preventDefault();
  const value = Number(rateLimitInput);
  if (!Number.isInteger(value) || value < 1) return;
  patchPlatformSettings({ aiRateLimitMax: value });
}
```

New section JSX, placed after the existing "OpenAI API key" section, rendered only when `viewerIsOwner`:

```jsx
{viewerIsOwner && (
  <section className="bg-white border border-gray-200 rounded-2xl p-6">
    <h2 className="text-base font-semibold text-gray-800 mb-1">
      Platform AI settings (owner only)
    </h2>
    <p className="text-xs text-gray-500 mb-4">
      When public AI access is enabled, every household without their own
      OpenAI key uses your platform key. Turn this off instantly if usage
      spikes — households without their own key will need to add one to
      keep using AI features.
    </p>
    {platformSettingsLoading && (
      <p className="text-sm text-gray-400">Loading…</p>
    )}
    {platformSettings && (
      <div className="space-y-4">
        <button
          onClick={toggleAiAccess}
          disabled={platformSettingsSaving}
          className={`w-full py-2 px-4 font-medium rounded-lg transition-colors text-sm disabled:opacity-50 ${
            platformSettings.publicAiAccessEnabled
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {platformSettingsSaving
            ? 'Saving…'
            : platformSettings.publicAiAccessEnabled
              ? 'Disable public AI access (require BYOK)'
              : 'Enable public AI access (use platform key for all)'}
        </button>

        <form onSubmit={saveRateLimit} className="flex items-center gap-2">
          <label className="text-xs text-gray-600 flex-1">
            AI requests per household / 15 min
          </label>
          <input
            type="number"
            min="1"
            value={rateLimitInput}
            onChange={(e) => setRateLimitInput(e.target.value)}
            className="w-20 rounded-lg border-gray-300 shadow-sm text-sm"
          />
          <button
            type="submit"
            disabled={platformSettingsSaving}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Save
          </button>
        </form>

        {platformSettings.updatedAt && (
          <p className="text-xs text-gray-400">
            Last changed{' '}
            {new Date(platformSettings.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
    )}
    {platformSettingsError && (
      <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
        {platformSettingsError}
      </p>
    )}
  </section>
)}
```

### Decisions

- **D-1**: DB-backed settings, not env vars — the entire point is flipping/tuning without a redeploy.
- **D-2**: BYOK always takes precedence over the platform-wide toggle for non-owner households.
- **D-3**: 5-second TTL cache with invalidate-on-write, not a plain per-request DB read (revised from DRAFT-1 per architect review) and not a longer/uncapped cache (would weaken "quickly switch").
- **D-4**: The owner's own resolution path is untouched by this task.
- **D-5**: Server-side `requireOwner` in `admin.js` is the real security boundary; `viewerIsOwner` in the client is UX convenience only.
- **D-6** *(new)*: Settings-lookup failures fail closed (disabled access, default rate limit), never fail open and never 500 the AI request path.
- **D-7** *(new)*: `resolveProvider` takes one options object, not positional args — the signature had grown past where that stays safe (two same-typed string params next to each other).
- **D-8** *(new)*: Rate-limit tuning (`aiRateLimitMax`) lives in the same `platform_settings` row as the access toggle, and is exposed through the same admin route, rather than a separate mechanism (env var or second table) — consistent with D-1's reasoning and the review's own observation that more platform-wide settings were likely coming.
- **D-13** *(round 2)*: `createCachedLoader` dedupes concurrent in-flight loads on a cache miss — prevents a stampede of DB queries when the 5-second TTL expires under concurrent traffic on the same warm instance.
- **D-14** *(round 2)*: `setPlatformSettings` returns the row from `UPDATE ... RETURNING` directly, rather than writing then separately re-reading through the cache — removes a narrow race where a successful write could be reported back with stale/default values if the follow-up read failed.

---

## Part B — Per-Household Rate Limiting on AI Endpoints

### Design

Applied to every AI-calling route (`/api/ai/*` and `/api/ai/transcribe`), keyed by `householdId` (available on every request past `clerkAuth`), not IP — a household with multiple members on different networks should share one limit; an IP-based limit would both over- and under-restrict in different cases.

Applied uniformly, regardless of the Part A toggle or BYOK status — this protects against runaway loops and scripted abuse in general (a compromised BYOK key still burns that household's own money and this app's server resources), not just platform-key spend specifically.

**This is abuse deterrence, not spend protection**, and the distinction matters enough to state plainly rather than bury in a caveat: the default `MemoryStore` does not persist across serverless cold starts and is not shared between concurrent Vercel function instances. It raises the bar against a single script hammering one endpoint from one warm instance. It is not a guarantee against a more sophisticated abuser spread across many concurrent invocations, and it does nothing at all to bound OpenAI spend on its own — that job belongs to Part A's toggle (as a fast manual lever) and the non-code prepaid-credits step under Deployment Prerequisites (as the actual financial backstop).

### New file: `server/middleware/aiRateLimitKeyGenerator.js`

Extracted into its own dependency-free file (no import of `platformSettingsService`/`db/client.js`) specifically so it's unit-testable without a database — consistent with how `cachedLoader.js`/`resolveProvider.js` were kept DB-free.

```js
// Keyed by householdId (set by clerkAuth, which always runs before this
// middleware) rather than IP — a household's members share one limit
// regardless of network. req.ip is only a defensive fallback for the case
// where this middleware is ever reordered ahead of clerkAuth.
export function aiRateLimitKeyGenerator(req) {
  return req.user?.householdId?.toString() ?? req.ip;
}
```

### New file: `server/middleware/aiRateLimitKeyGenerator.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiRateLimitKeyGenerator } from './aiRateLimitKeyGenerator.js';

test('keys by householdId when clerkAuth has populated req.user', () => {
  const req = { user: { householdId: 42 }, ip: '1.2.3.4' };
  assert.equal(aiRateLimitKeyGenerator(req), '42');
});

test('falls back to req.ip when req.user is absent', () => {
  const req = { user: undefined, ip: '1.2.3.4' };
  assert.equal(aiRateLimitKeyGenerator(req), '1.2.3.4');
});
```

### New file: `server/middleware/aiRateLimit.js`

```js
import rateLimit from 'express-rate-limit';
import { getPlatformSettings } from '../services/platformSettingsService.js';
import { aiRateLimitKeyGenerator } from './aiRateLimitKeyGenerator.js';

// windowMs stays a fixed code constant (express-rate-limit's window
// bucketing isn't designed to change at runtime). `limit` is dynamic —
// confirmed supported by the installed express-rate-limit@7.5.1 types
// (`(request, response) => number | Promise<number>`) — so the per-household
// cap can be tuned from the admin UI without a redeploy.
//
// Abuse deterrence, not spend protection — see Known Risks.
export const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: async () => {
    const { aiRateLimitMax } = await getPlatformSettings();
    return aiRateLimitMax;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: aiRateLimitKeyGenerator,
  message: {
    error: 'Too many AI requests. Please wait a few minutes and try again.',
  },
});
```

### `server/routes/ai.js` — wire in

```js
import { aiRateLimit } from '../middleware/aiRateLimit.js';
// ...
const router = express.Router();
router.use(clerkAuth);
router.use(aiRateLimit);
```

### `server/routes/transcribe.js` — wire in

```js
import { aiRateLimit } from '../middleware/aiRateLimit.js';
// ...
router.post('/', clerkAuth, aiRateLimit, upload.single('audio'), async (req, res) => {
```

### Decisions

- **D-9**: Rate limiting is keyed by `householdId`, not IP.
- **D-10**: Applied uniformly to all households, not conditionally on the Part A toggle.
- **D-11** *(new)*: The key generator is factored into its own file specifically to keep it unit-testable without a DB import, mirroring the same reasoning as `cachedLoader.js`.
- **D-12** *(new)*: `windowMs` stays a fixed code constant; only `limit` (the request cap) is made dynamic via `platform_settings` — a deliberate, narrower response to the review's tuning request rather than making the whole limiter config dynamic, because `express-rate-limit`'s window semantics aren't designed for runtime changes.

---

## Deployment Prerequisites (Non-Code — Do Before Flipping the Toggle On)

These are dashboard actions outside this repo, not implemented by this spec, but load-bearing for the plan this spec exists to support:

1. **OpenAI billing**: switch the org to prepaid credits with auto-recharge **off**. Per the research behind this spec, 2026 OpenAI project budget thresholds are notification-only and do not stop requests — prepaid-credits-without-auto-recharge is the only real (if laggy) hard stop available today. Do this before the first time `public_ai_access_enabled` is set to `true` in production.
2. **Clerk Dashboard**: review sign-up settings (email verification, bot/CAPTCHA protection, any invite-only/waitlist mode) before going public. This app currently has no code-level registration gate — the legacy `INVITE_CODE` mechanism is dead, pre-Clerk code (see Current Behavior above).
3. **Migration ordering**: apply `0017_platform_settings.sql` to the **production** Neon database, then deploy this task's code — not the other way around. `getAiConfig` (via `platformSettingsService`) will query the new table on every AI request (subject to the 5s cache); deploying code before the table exists 500s every AI call.

---

## Overall Allowed Files

- New: `server/db/migrations/0017_platform_settings.sql`, `server/services/cachedLoader.js`, `server/services/cachedLoader.test.js`, `server/services/platformSettingsService.js`, `server/services/ai/resolveProvider.test.js`, `server/routes/admin.js`, `server/middleware/aiRateLimitKeyGenerator.js`, `server/middleware/aiRateLimitKeyGenerator.test.js`, `server/middleware/aiRateLimit.js`
- Modified: `server/db/schema.js` (new table only), `server/services/ai/resolveProvider.js`, `server/services/householdService.js` (`getAiConfig` + new import), `server/services/aiService.js` (one `resolveProvider(...)` call site), `server/routes/transcribe.js` (one call site + rate-limit wiring), `server/routes/ai.js` (rate-limit wiring), `server/routes/household.js` (`GET /` response field), `server/app.js` (mount new router), `client/src/pages/HouseholdPage.jsx` (new owner-only section)

## Overall Forbidden Files

- Any existing migration file (0000–0016) — additive only, new migration file
- `server/services/ai/openaiProvider.js`, `server/services/ai/providerInterface.js` — provider adapter contract is unrelated to this task
- `server/services/chat/**`, AI prompts, tool JSON schemas, chat dispatch loop — this task changes key *resolution*, not chat behavior
- `server/utils/encryption.js`, `server/utils/keyEncryption.js` — BYOK encryption is unchanged
- `server/middleware/clerkAuth.js` — reused as-is
- `ai/tasks/archive/`

## Constraints

- Zero new npm dependencies — `express-rate-limit` is already installed; everything else uses libraries already in use (`drizzle-orm`, `zod`, `express`).
- With the migration applied and `platform_settings` left at its seeded defaults (`public_ai_access_enabled = false`, `ai_rate_limit_max = 20`), behavior must be byte-identical to today's for platform-key resolution: only the owner's household uses the platform key. (The rate limiter itself is new behavior even at defaults — see Acceptance/Verification.)
- Toggling and rate-limit tuning must require zero redeploy — verified by changing them via the API/UI only, no `vercel env` command, no deploy, confirming the effect within the 5-second cache window.
- BYOK precedence (D-2), owner-only enforcement (D-5), and fail-closed behavior (D-6) are all correctness-critical, not polish — cover all three explicitly in verification.
- `updated_at` on the new table is `TEXT` (ISO string via `$defaultFn`), matching every other table in this schema — not a native timestamp type. Deliberate consistency choice; see Architect Review History for the reasoning this overrides.

## Out of Scope (considered, explicitly declined)

- **Automated usage-based auto-disable** (polling OpenAI's usage API and flipping the toggle off automatically past a threshold) — a real answer to the "soft limit" problem, but a meaningfully bigger feature (needs a cron, per TASK-023's precedent of this app's existing push-notification cron, plus usage-API integration). Worth a follow-up task once this manual toggle is live and the owner has a feel for real usage patterns; not built here since the user asked for a manual "option to quickly switch," not full automation.
- **`platform_settings_history` audit table** — the current row's `updated_at`/`updated_by_clerk_id` already answers "who last changed this and when" for the live state; a full change-history log is a genuine future nice-to-have (raised in architect review round 1) but not needed for the core ask. Revisit if the owner finds themselves wanting a "when did I disable it last week" answer in practice.
- **Usage metrics/counters** (platform-key AI calls vs. BYOK vs. no-access) — raised in review, explicitly flagged there as "future task perhaps." Not built here; would pair naturally with the automated auto-disable follow-up above if that's ever taken on.
- **Distributed rate-limit store** (Redis/Upstash) — `MemoryStore`'s serverless limitations (see Known Risks) are accepted for this task; revisit if abuse patterns in practice show the best-effort limiter isn't enough.
- **Clerk Dashboard configuration changes** (email verification, bot protection, waitlist) — non-code, listed under Deployment Prerequisites, not implemented here.
- **Switching OpenAI billing to prepaid credits** — non-code, listed under Deployment Prerequisites, not implemented here.
- **Per-request token/cost estimation or budgeting** — existing `max_tokens` caps per call-site (already in place, e.g. `aiService.js`) are left unchanged; a finer-grained cost model is a separate, larger effort.
- **DB transaction around the settings update, optimistic concurrency/versioning, further singleton constraints beyond `CHECK(id=1)`** — all raised in review round 1 and declined with reasoning; see Architect Review History.

## Known Risks

- **OpenAI's own budget limits won't save you** — as of 2026, project spending thresholds are notification-only, not enforcement. This spec's toggle and rate limiter are mitigations that reduce exposure and give the owner a fast lever, not a guarantee against overspend between "usage spikes" and "owner notices and flips the switch." The real backstop is the non-code prepaid-credits step above.
- **The rate limiter is abuse deterrence, not spend protection** — stated plainly per architect review round 1. `MemoryStore` rate limiting is best-effort under Vercel's serverless model: counts reset on cold start and aren't shared across concurrent function instances. A determined or distributed abuser spread across enough concurrent invocations can exceed the nominal per-household limit substantially. It does not, by itself, bound OpenAI spend.
- **Fail-closed on settings-lookup failure is a deliberate trade-off** — during a Neon outage, non-owner households with no BYOK key lose AI access entirely (even if the toggle was `true` before the outage) rather than risk fail-open. This is the safer default given this table's role, but it does mean a DB blip degrades a feature that wasn't itself the cause of the outage.
- **No automatic cutoff** — the toggle is manual by design (per the user's actual ask). If the owner doesn't notice a usage spike, nothing in this spec disables platform-key access on its own.
- **Rate limit default (20 requests / 15 min / household) is a starting guess**, not derived from real traffic data — now tunable without a redeploy (D-8), but still needs real usage data to validate.
- **Registration is currently unrestricted at the Clerk layer** — this spec doesn't change that; it's called out under Deployment Prerequisites as something to review before going public, not fixed here.

## Verification Steps

1. Apply migration 0017 in the dev Neon database; confirm the seed row via the `SELECT * FROM platform_settings;` in the migration file, and confirm the commented-out `INSERT ... VALUES (2, ...)` genuinely fails with a check-constraint violation when tried manually — proves D-1's singleton claim empirically rather than by assertion.
2. With settings left at their defaults, confirm a second (non-owner, no BYOK key) test household still gets `403 NO_API_KEY` on `/api/ai/chat` and `/api/ai/transcribe` — byte-identical to pre-task behavior.
3. As the owner, `PATCH /api/admin/platform-settings` with `{ publicAiAccessEnabled: true }`. Without restarting the server or redeploying, confirm the same second household succeeds using the platform key within the 5-second cache window (retry briefly if the first request lands inside the old cache entry).
4. Flip back to `{ publicAiAccessEnabled: false }`; confirm the same household gets `403 NO_API_KEY` again within the cache window, no restart.
5. With the toggle `true`, set a (deliberately invalid, for test purposes) BYOK key on the second household and confirm the request fails using *that* key's error, not a silent fallback to the platform key — proves BYOK precedence (D-2).
6. Confirm a non-owner Clerk user gets `403` from both `GET` and `PATCH /api/admin/platform-settings`.
7. Simulate a settings-lookup failure (e.g., temporarily point `DATABASE_URL` at an unreachable host, or drop the `platform_settings` table in a scratch dev DB) and confirm AI requests degrade to `403 NO_API_KEY` for non-owner households rather than 500ing — proves fail-closed behavior (D-6).
8. Live UI check: the owner's Household page shows the new "Platform AI settings" section (toggle + rate-limit input + last-changed timestamp) and both controls work via the UI; a non-owner household's Household page does not render the section at all.
9. `PATCH /api/admin/platform-settings` with `{ aiRateLimitMax: 5 }`; confirm the 6th AI request from a test household within 15 minutes returns `429` with the configured message, and that a different household's requests are unaffected in the same window. Reset back to `20` afterward.
10. Run the existing test suite (`node --test`) plus the new `cachedLoader.test.js` (including the concurrent-load-dedup case), `resolveProvider.test.js`, and `aiRateLimitKeyGenerator.test.js` — all passing.
11. Confirm `setPlatformSettings`'s `.returning()` call actually returns the updated row against the installed `drizzle-orm`/`neon-http` combination (a quick manual `PATCH` + inspect-the-response check covers this — if `.returning()` isn't supported as expected, this needs a fallback before merging, see the implementer note on `setPlatformSettings`).
12. Re-run TASK-036's six-tool live chat verification once more as a regression check, now with the rate limiter active but under its threshold, confirming no unintended interference with normal use.
