# TASK-051 — Remove BYOK, Unify AI Access Gating, and Ship Low-Risk AI-Efficiency Fixes

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.6/10 — approve after one revision | Praised the Current Behavior investigation, the middleware-based authorization redesign, scope discipline (deferring structured outputs/streaming/context-truncation/URL-parse-caching), and the mandatory pre-drop migration check. One required change: `requireAiAccess` was doing a fresh `householdService.getById()` DB lookup on every AI request without first confirming the household wasn't already available from the request pipeline — investigated and confirmed below (D-11): `clerkAuth` already calls `householdService.getOrCreate()` on every request but discards everything except `.id`, and `getOrCreate`'s non-owner-member branch didn't even fetch `clerkUserId` in the first place. Fixed by widening `getOrCreate`'s narrow member-lookup query to also select the household's `clerkUserId` (a single indexed join, its only caller is `clerkAuth`) and attaching it to `req.user`, so `requireAiAccess` no longer makes any DB call of its own beyond the already-cached toggle check. Four accepted minor recommendations, all applied below: (1) Design 6's shared-client rationale reframed around the OpenAI SDK being designed for instance reuse and the client being stateless, not just "connection pooling"; (2) the `Today: ${date}` line's placement in the dynamic suffix (Design 5) called out explicitly as an implementation invariant in Constraints, not just implied by the design text; (3) a new Constraint stating all future AI endpoints must mount under the protected `/api/ai` router or explicitly include `requireAiAccess`, to preserve the gating invariant as the codebase grows; (4) no change requested to `requireAiAccess` running before `aiRateLimit`, or to keeping authorization and abuse-protection as separate middleware — both endorsed as-is. |
| DRAFT-2 | 9.9/10 — APPROVED FOR IMPLEMENTATION | Confirmed the required change resolved the review-1 concern correctly, specifically praising: the small blast radius (one new field, `householdOwnerClerkId`, not the full household row); the investigation reasoning ("clerkAuth already has it" refined into "one specific branch doesn't, and here's why"); the future-invariant Constraint preventing architectural drift; the `Today:` cache-guardrail callout; and the strengthened shared-client rationale (SDK statelessness/reuse-by-design over "connection pooling"). Two non-blocking naming observations, explicitly not required and not applied: `getOrCreate` could arguably be renamed (`resolveHousehold`/`resolveHouseholdContext`) now that it returns more than an id — left as-is per the reviewer's own guidance not to churn it in this task; `NoApiKeyError` now semantically means "AI access disabled" rather than "missing API key," but renaming was explicitly declined by the reviewer in favor of preserving the existing 403/`NO_API_KEY` contract untouched — both logged here rather than silently dropped, in case either becomes worth revisiting in a future cleanup. No remaining architectural concerns — full scorecard: scope discipline, middleware design, separation of concerns, dead-code removal, request pipeline, migration safety, verification plan, and future maintainability all rated Excellent. |

---

## Request

Connor's ask: remove BYOK (bring-your-own-key) entirely. The app should not offer households the
ability to supply their own OpenAI key. Connor's own platform key should be the only key the app ever
uses. If AI usage ever starts costing too much, he wants a single switch he can flip to cut off
non-owner households — not a per-household key-management feature.

Investigation before drafting this spec surfaced a second problem directly relevant to that stated
goal: the "single switch" Connor is describing already exists (`publicAiAccessEnabled`, a platform-wide
toggle), but today it only actually gates 2 of the app's 7 AI endpoints. The other 5 bypass it entirely.
Connor confirmed (when asked) that this spec should fix both — delete BYOK, and make the toggle actually
cover every AI endpoint, since a toggle that silently doesn't work everywhere isn't the safety switch he
asked for.

A separate, unrelated research pass (see the earlier AI-efficiency discussion) surfaced 8 more findings
about the app's AI calls — token efficiency, accuracy, cost visibility. Connor asked to bundle in the
low-risk ones here rather than defer everything: **Design 5-7 below** (chat-prompt reordering for
OpenAI's automatic caching, cost/token-usage logging on all 7 AI calls, and one shared OpenAI client
instead of six per-call ones) are added to this same spec. They're unrelated *in purpose* to the
BYOK/gating work above, but each is small, self-contained, and low-risk enough not to warrant its own
review cycle — see D-6 for why they're bundled here rather than split out. The remaining 5 findings
(structured outputs, a vision-model accuracy eval, streaming, a context-size cap, and content-hash
caching for recipe-URL parsing) are **not** included — each needs either a real design decision, a
measurement, or usage data this session doesn't have, and stays queued for its own future spec (full
list preserved at the bottom of this document).

---

## Current Behavior (confirmed by reading the code)

**BYOK exists in the backend, but has no working frontend UI.** `PATCH /api/household/ai-key`
([household.js:52-62](../../server/routes/household.js)) and `householdService.setAiApiKey`/
`removeAiApiKey`/`getAiKeyPreview` ([householdService.js:281-329](../../server/services/householdService.js))
are fully implemented, and `GET /api/household` already returns a `maskedKey` preview
([household.js:19-31](../../server/routes/household.js)). But
[HouseholdPage.jsx](../../client/src/pages/HouseholdPage.jsx) — the only client file that references
anything BYOK-related — has no form, input, or button that calls `PATCH /api/household/ai-key` or
displays `maskedKey` anywhere (confirmed by targeted search of the whole file). **No household has ever
been able to set their own key through the app's UI.** The only realistic way a row's `openai_api_key`
column is non-null today is a direct API call (e.g. during Connor's own testing) — this significantly
lowers the risk of deleting it.

**Two independent, overlapping AES-256-GCM implementations exist for this one feature.**
`server/utils/encryption.js` (uses `process.env.ENCRYPTION_KEY`, colon-delimited format) is what
`householdService.js` actually calls for encrypt/decrypt. `server/utils/keyEncryption.js` (uses
`process.env.API_KEY_ENCRYPTION_SECRET`, versioned `v1:` format) has its own encrypt/decrypt that are
never imported anywhere — only its `maskKey` export is used, by `householdService.js` and
`household.js`. Both files are used **exclusively** for the BYOK key (confirmed — no other caller of
either file exists anywhere in `server/`). `API_KEY_ENCRYPTION_SECRET` is consequently unused dead
config already; `ENCRYPTION_KEY` is the one actually load-bearing today, and is in `app.js`'s
`REQUIRED_ENV` startup check ([app.js:21-29](../../server/app.js)).

**Only 2 of 7 AI endpoints check anything before spending the platform key.** `resolveProvider`
([resolveProvider.js](../../server/services/ai/resolveProvider.js)) implements: the household's owner
always gets the platform key regardless of the toggle; other households get their BYOK key if they have
one; otherwise they get the platform key only if `publicAiAccessEnabled` is on, else a 403
(`NoApiKeyError`). This is called from exactly two places: `/api/ai/chat`
([ai.js:452-462](../../server/routes/ai.js)) and `/api/transcribe`
([transcribe.js:40-45](../../server/routes/transcribe.js)). The other five —
`/api/ai/eat-this-now`, `/api/ai/expand-suggestion`, `/api/ai/parse-receipt`, `/api/ai/parse-recipe-image`,
`/api/ai/parse-recipe-url` (which calls `parseRecipeText`/`enrichRecipeFields`) — call straight into
`aiService.js` functions that each do `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
([aiService.js:280, 338, 372, 451, 536, 612](../../server/services/aiService.js)), with **no owner check
and no toggle check at all**. Today, if Connor turned `publicAiAccessEnabled` off specifically to stop a
cost spike, these five endpoints would keep working, unthrottled by anything except the existing
abuse-deterrence rate limiter ([aiRateLimit.js](../../server/middleware/aiRateLimit.js)).

**The "owner" check is household-scoped, not request-scoped — this matters for the redesign.**
`resolveProvider`'s `isOwner` check compares the **household's** `clerkUserId`
(`households.clerk_user_id`, set at household creation — see `getAiConfig`,
[householdService.js:281-302](../../server/services/householdService.js)) against
`process.env.OWNER_CLERK_ID`, not the *requesting member's* own Clerk ID. This means any member of
Connor's household (not just Connor personally) already bypasses the toggle today. This must be
preserved — the new unified gate must key off the household's owner identity, not
`req.user.id`, or a family member using Connor's household would be newly and incorrectly gated by the
toggle.

**Two pre-existing, unrelated "deprecated but kept" columns already exist for context.**
`households.ai_provider` and `households.ai_api_key` ([schema.js:22-23](../../server/db/schema.js)) are
commented `// deprecated — kept for schema compat; unused after TASK-016B` — an earlier (pre-Clerk)
BYOK generation that was left in place rather than dropped, because it held real historical data for
early households. `openai_api_key` (the column this task removes) is different: given no UI has ever
written to it for a real household, dropping it carries materially less risk than that precedent — see
Decisions (D-1) for why this task drops it instead of following the same "deprecate in place" pattern.

---

## Design

### 1. New middleware: `requireAiAccess` — the actual single switch, with zero extra DB calls

New file, `server/middleware/requireAiAccess.js`. Exports `requireAiAccess` (async Express middleware)
and `NoApiKeyError` (moved here from `resolveProvider.js`, same shape: `status = 403`,
`code = 'NO_API_KEY'` — matches the existing centralized error handler's contract,
[app.js:73-80](../../server/app.js), and preserves the exact `res.status === 403` contract
`useWhisperInput.js:50` already depends on for its "no-api-key" UX).

```js
export async function requireAiAccess(req, res, next) {
  const isOwnerHousehold = req.user.householdOwnerClerkId === process.env.OWNER_CLERK_ID;
  if (isOwnerHousehold) return next();

  const enabled = await platformSettingsService.isPublicAiAccessEnabled();
  if (!enabled) throw new NoApiKeyError();
  next();
}
```

- Makes **no database call of its own**. `req.user.householdOwnerClerkId` is populated once per request
  by `clerkAuth` (Design 2 below) — see D-11 for why this was worth a small upstream change rather than
  each of the 7 AI routes paying for a redundant `householdService.getById()` lookup that `clerkAuth`
  already had 90% of the data for.
- The only remaining call is `platformSettingsService.isPublicAiAccessEnabled()` (existing, 5s-cached,
  fails closed on DB error — [platformSettingsService.js:37-50](../../server/services/platformSettingsService.js)).
  No new caching layer needed.
- `NoApiKeyError`'s message is generic ("AI features are temporarily unavailable...") rather than the
  current BYOK-flavored copy ("Please add your OpenAI key in Settings"), since there is no key to add
  anymore.
- Applied via `router.use(requireAiAccess)` in [ai.js](../../server/routes/ai.js) (alongside the existing
  `router.use(aiRateLimit)`), covering all 7 `/api/ai/*` routes uniformly — including the 5 that
  currently check nothing. Applied inline in transcribe.js's existing middleware chain
  (`clerkAuth, requireAiAccess, aiRateLimit, upload.single(...)`, matching its current explicit-chain
  style since that route doesn't use a shared router-level `.use()`).
- Placed before `aiRateLimit` in both cases: a request that's going to be rejected for access shouldn't
  also burn the household's abuse-rate-limit budget.
- **Invariant this depends on**: every AI endpoint must be mounted under a router that applies
  `requireAiAccess` (or include it explicitly) — see Constraints for why this is called out as a standing
  rule for future AI routes, not just satisfied once here.

### 2. `clerkAuth` and `getOrCreate` widened so the household-owner check is already free by the time it reaches `requireAiAccess`

[clerkAuth.js:11-14](../../server/middleware/clerkAuth.js) already calls
`householdService.getOrCreate(userId)` on **every** authenticated request (not just AI ones), but only
keeps `{ id: userId, householdId: household.id }` on `req.user` — discarding the rest of the row.
`getOrCreate` itself ([householdService.js:144-161](../../server/services/householdService.js)) is
inconsistent across its three resolution branches: Step 2 (household-owner login) and Step 3
(newly-created household) both already fetch/return the full row (including `clerkUserId`), but Step 1
(non-owner household member — the exact case D-3 cares about) does a narrow
`select({ householdId: householdMembers.householdId })` with no join to `households` at all, so
`clerkUserId` isn't fetched even implicitly for that branch.

- Widen Step 1's query to join `households` and also select `clerkUserId`:
  ```js
  const [membership] = await db
    .select({
      householdId: householdMembers.householdId,
      clerkUserId: households.clerkUserId,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.clerkUserId, clerkUserId));
  if (membership) return { id: membership.householdId, clerkUserId: membership.clerkUserId };
  ```
  Steps 2 and 3 need no change — both already return the full row, which includes `clerkUserId`.
- `clerkAuth.js` attaches the new field under its own name, distinct from `req.user.id` (the *requesting*
  user's own Clerk ID) to avoid the exact confusion D-3 exists to prevent:
  `req.user = { id: userId, householdId: household.id, householdOwnerClerkId: household.clerkUserId }`.
- `getOrCreate` has exactly one caller anywhere in the codebase (`clerkAuth.js`) — confirmed by search —
  so widening its return shape is contained and carries no risk of breaking another consumer's
  assumptions about the old narrow shape.
- `req.user` has exactly two fields read anywhere in the app today (`.id`, `.householdId`, confirmed by
  search) — adding a third, unread-elsewhere field is purely additive.

### 3. `resolveProvider` becomes a trivial platform-key wrapper

Gating is now `requireAiAccess`'s job, done once per request before any AI-service function runs.
`resolveProvider.js` no longer needs to know about households, owners, or toggles at all:

```js
export function resolveProvider() {
  return new OpenAIProvider(process.env.OPENAI_API_KEY);
}
```

- `aiService.chat()` drops its `aiConfig` parameter entirely (was only ever used to feed
  `resolveProvider`) — calls `resolveProvider()` with no arguments.
  ([aiService.js:674-682, 736-740](../../server/services/aiService.js))
- `routes/ai.js`'s `/chat` handler drops the `householdService.getAiConfig(householdId)` call and the
  `aiConfig` argument it passed into `aiService.chat(...)` ([ai.js:452-462](../../server/routes/ai.js)).
- `routes/transcribe.js` drops its `householdService` import and the `getAiConfig`/`resolveProvider({...})`
  call, replacing both with a plain `resolveProvider()`
  ([transcribe.js:40-45](../../server/routes/transcribe.js)).
- See Decisions (D-2) for why gating isn't *also* re-checked inside `resolveProvider` as
  defense-in-depth.

### 4. Delete the BYOK data path end to end

- `server/utils/encryption.js` — deleted (BYOK-only, confirmed no other caller).
- `server/utils/keyEncryption.js` and its test `keyEncryption.test.js` — deleted (BYOK-only; its own
  encrypt/decrypt were already dead code, only `maskKey` was live, and only for BYOK).
- `householdService.js`: remove `getAiConfig`, `getAiKeyPreview`, `setAiApiKey`, `removeAiApiKey`, and
  the now-unused `encrypt`/`decrypt`/`maskKey` imports.
- `routes/household.js`: remove the `PATCH /ai-key` route and its `aiKeySchema`; remove the `maskKey`
  import; `GET /api/household` stops calling `getAiKeyPreview` and drops `maskedKey` from its response
  (confirmed safe — no client code reads `household.maskedKey` anywhere).
- `schema.js`: remove `openaiApiKey` from the `households` table definition.
- New migration `server/db/migrations/0021_drop_byok.sql` — `ALTER TABLE households DROP COLUMN
  openai_api_key;`, following the same "apply manually in Neon SQL Editor" convention as migration 0010
  (which added this column), including a pre-flight verification query. See Constraints for the required
  pre-drop check.
- `app.js`: remove `'ENCRYPTION_KEY'` from `REQUIRED_ENV`.
- `.env.example`: remove `ENCRYPTION_KEY` (and confirm `API_KEY_ENCRYPTION_SECRET` isn't present — it
  was never wired into `REQUIRED_ENV`, so likely nothing to remove there, but check).

### 5. Reorder the chat system prompt so OpenAI's automatic caching can actually apply

[aiService.js:688-734](../../server/services/aiService.js) currently builds the chat system prompt as:
greeting+date → full pantry JSON → full recipe JSON → dietary section → *then* ~500 words of static
tool-selection instructions. OpenAI auto-caches identical prompt *prefixes* (no code change, no fee to
write the cache) — but only the leading run of tokens that's byte-identical across calls. Today the
prefix is the part that changes almost every call (pantry/recipe/dietary data, and even the date line),
so the static instructions and the 220-line `PANTRY_TOOLS` schema
([aiService.js:35-257](../../server/services/aiService.js)) never get a cache hit, even across the
tool-loop's up-to-5 same-turn iterations ([aiService.js:763-767](../../server/services/aiService.js)).

Reorder to a pure content-neutral rearrangement — every existing instruction sentence stays word-for-word
identical, only its position moves:

- **Static prefix** (identical on every call, forever, unless the instruction text itself is edited):
  `"You are Kitchen Keeper, a helpful AI kitchen assistant.\n\n"` followed by the entire existing
  instructional block verbatim — "Status values: ok=fresh...", "Answer helpfully...", all of the "Tool
  selection rules" bullets, through to the final "Dietary conditions are soft constraints..." sentence.
- **Dynamic suffix** (appended after, varies per call): a new `=== CURRENT CONTEXT ===` block containing
  `Today: ${new Date().toDateString()}`, the pantry JSON, the recipe JSON, and `dietarySection` — same
  content as today, just moved to the end instead of the front.

Also add `prompt_cache_key: 'kitchen-keeper-chat-v1'` to the `chat.completions.create()` call in
[openaiProvider.js:28-32](../../server/services/ai/openaiProvider.js) — see D-7 for why one fixed,
app-wide key rather than a per-household one.

### 6. Cost/token-usage logging on all 7 AI calls

Two of seven AI functions currently log `response.usage?.completion_tokens` only, under a `response_tokens`
label and with no `request_id` (their `requestId` parameters are prefixed `_requestId`, signaling
intentionally-unused — [aiService.js:267, 319](../../server/services/aiService.js)). The other four
(`parseReceipt`, `parseRecipeImage`, `parseRecipeText`, `enrichRecipeFields`) already have a per-call
`request_id=... function=...` log line each (this codebase's existing convention — one bespoke,
domain-specific log line per function, not a shared generic logger — see D-8), but none include token
counts. Extend all six in place, matching this file's existing per-function log-line style rather than
introducing a new abstraction:

- `eatThisNow`/`expandSuggestion` ([aiService.js:267, 319](../../server/services/aiService.js)): rename
  `_requestId` → `requestId` (now actually used) and extend the existing log lines
  ([aiService.js:301-304, 359-362](../../server/services/aiService.js)) to add `request_id=`,
  `prompt_tokens=`, `total_tokens=`, and `cached_tokens=` alongside the existing `completion_tokens`.
- `parseReceipt` ([aiService.js:433-437](../../server/services/aiService.js)): `response` is already in
  outer scope — add the same token fields to the existing log line.
- `enrichRecipeFields` ([aiService.js:643-646](../../server/services/aiService.js)): `response` is
  already in scope at the log-line call site — add the same token fields.
- `parseRecipeText` ([aiService.js:563-577](../../server/services/aiService.js)): `response` is currently
  block-scoped inside the `try` — hoist a `usage` variable to outer scope (`let text, usage;`) alongside
  `text` so the existing log line can reference it.
- `parseRecipeImage` ([aiService.js:493-523](../../server/services/aiService.js)): `callOnce()` currently
  discards the response after extracting `.content` — change it to return `{ content, usage }`, and update
  both call sites to capture `usage` into an outer variable, then add the same token fields to the
  existing log line. See D-9 for the retry-path accounting tradeoff this implies.
- `chat` (via [openaiProvider.js](../../server/services/ai/openaiProvider.js)): `sendMessage` is the
  single choke point for every OpenAI call `chat()` makes (the initial call and every tool-loop
  iteration), so one log line there covers the whole function. `startChatSession` gains an optional
  `requestId` parameter (stored on the returned `session` object); `aiService.js`'s `chat()` passes its
  own `requestId` through when calling `provider.startChatSession({ systemPrompt, tools, history,
  requestId })`. `sendMessage` logs `request_id=${session.requestId} function=chat model=gpt-4o-mini`
  plus the same token fields, once per underlying API call — meaning a 5-iteration tool-calling turn
  produces 5 log lines, which is accurate (and useful: it makes Design 5's caching improvement directly
  observable via `cached_tokens` in production logs).
- `transcribe.js` needs no change — see D-10.

All added fields read from `response.usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) and
`response.usage?.prompt_tokens_details?.cached_tokens ?? 0`. No prompt or response *content* is logged —
only counts, matching every existing AI log line in this file.

### 7. One shared OpenAI client instead of six per-call instantiations

`eatThisNow`, `expandSuggestion`, `parseReceipt`, `parseRecipeImage`, `parseRecipeText`, and
`enrichRecipeFields` each currently do `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` inline
([aiService.js:280, 338, 372, 451, 536, 612](../../server/services/aiService.js)) — six separate client
instances, constructed fresh on every request. The OpenAI Node SDK is explicitly designed for a client
to be constructed once and reused: it's stateless (holds only config — the API key, base URL, timeout/
retry settings — no per-request mutable state) and internally manages its own connection pooling: Add
one module-level `const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });` near the top
of `aiService.js` (alongside the existing `import OpenAI from 'openai';`), and replace all six inline
`const openai = new OpenAI(...)` declarations with references to this shared instance. Confirmed safe —
no test file mocks or constructs `OpenAI` for any of these six functions (none exist today), so there's
no test-isolation reason to keep per-call construction. `openaiProvider.js`'s own `OpenAIProvider`
constructor (used only by `chat`/`transcribe`, via `resolveProvider()`) is intentionally left
unchanged — see Forbidden Files.

### 8. Owner-only admin toggle copy update

[HouseholdPage.jsx:299-306](../../client/src/pages/HouseholdPage.jsx)'s platform-settings description
currently reads: *"When public AI access is enabled, every household without their own OpenAI key uses
your platform key... households without their own key will need to add one to keep using AI
features."* This copy describes BYOK as the fallback for when the toggle is off — no longer accurate.
Replace with copy reflecting the actual new behavior: turning it off blocks all non-owner AI usage
outright (no BYOK fallback exists). The toggle button labels
([HouseholdPage.jsx:321-325](../../client/src/pages/HouseholdPage.jsx)) — *"Disable public AI access
(require BYOK)"* / *"Enable public AI access (use platform key for all)"* — also need the "(require
BYOK)" half of the disabled-state label removed or reworded, since disabling it no longer means "require
BYOK," it means "block everyone but the owner."

---

## Decisions

- **D-1: Actually `DROP COLUMN`, not "deprecate in place" like `ai_provider`/`ai_api_key`.** Those two
  older columns were left rather than dropped because they held real historical data for early
  households. `openai_api_key` almost certainly doesn't — no UI has ever let a real household write to
  it (see Current Behavior). Connor also explicitly said "removed," not "hidden," and a live column with
  no code path ever reading or writing it is a stronger drift risk (see this task's own motivating
  finding about code drift) than the small one-time cost of a verified `DROP COLUMN`. The verification
  step (Constraints) that confirms zero non-null values before dropping is what makes this safe rather
  than assumed.
- **D-2: `resolveProvider` does not re-check owner/toggle itself as defense-in-depth.** Considered keeping
  a redundant check inside `resolveProvider` in addition to `requireAiAccess`, matching this codebase's
  general fail-closed philosophy (e.g. `platformSettingsService`'s explicit fail-closed-on-DB-error
  design). Rejected: it would require `resolveProvider`'s two callers (`aiService.chat`,
  `transcribe.js`) to fetch the household row and toggle state a *second* time per request, purely to
  re-derive a decision `requireAiAccess` already made moments earlier in the same request — a real,
  measurable extra DB round-trip for no real safety gain, since there's no code path that reaches
  `resolveProvider` without first passing through `requireAiAccess` (both call sites are inside routers
  where it's applied). If a future AI route is ever added without wiring up `requireAiAccess`, that's a
  code-review/testing gap to catch, not something a second redundant check in `resolveProvider` would
  reliably catch either (it's just as easy to forget to pass the right arguments as it is to forget the
  middleware).
- **D-3: The owner check stays household-scoped (`household.clerkUserId`), not request-scoped
  (`req.user.id`).** See Current Behavior's callout — this preserves an existing, deliberate behavior
  (any member of the owner's household bypasses the toggle) that a naive `req.user.id ===
  OWNER_CLERK_ID` swap would silently break for household members who aren't Connor personally.
- **D-4: `resolveProvider.test.js` is deleted, not simplified in place.** Once `resolveProvider` is a
  one-line wrapper with no branching, there is nothing left to unit test beyond "it returns an
  `OpenAIProvider` constructed with `process.env.OPENAI_API_KEY`" — the actual gating logic these tests
  used to cover moves to `requireAiAccess.test.js` (new), which is where the real branching now lives.
- **D-5: `client/src/pages/HouseholdPage.jsx` needs a copy fix but no structural change.** Confirmed by
  full-file search that no BYOK key-entry form exists to remove — the only client-side change this task
  needs is the admin-toggle description text (Design 8).
- **D-6: The 3 AI-efficiency items (Design 5-7) are bundled into this spec rather than split out, unlike
  the other 5 findings.** All three are self-contained, mechanical, and independently low-risk: Design 5
  is a pure content reorder (no new logic), Design 6 only adds fields to log lines that already exist for
  4 of 6 functions, and Design 7 replaces six identical one-line client constructions with one. None
  require a new design decision, a measurement, or data this session doesn't have — the bar the other 5
  findings failed (see the full list at the end of this document). Bundling them avoids a second
  near-trivial spec/review cycle for changes this small.
- **D-7: `prompt_cache_key` uses one fixed, app-wide constant (`'kitchen-keeper-chat-v1'`), not a
  per-household key.** The cacheable static prefix (Design 5's instructions block plus the
  `PANTRY_TOOLS` schema) is byte-identical across every household — nothing household-specific lives in
  it. Routing every household's chat calls to the same cache-key pool maximizes hit rate across the whole
  user base; a per-household key would fragment the same cache for no benefit, since the thing being
  cached doesn't vary by household in the first place.
- **D-8: Token-usage logging extends each function's existing per-call log line rather than introducing a
  shared logging helper.** `aiService.js` already has an established convention — one bespoke,
  domain-specific log line per function (item counts, retry flags, "usable" booleans) — not a generic
  logger abstraction. Matching that convention keeps this a small, additive diff instead of a
  refactor, and four of the six functions already have the log line in place; only the token fields are
  new.
- **D-9: `parseRecipeImage`'s retry path logs only the final (used) call's token usage, not the sum of
  both calls when a retry occurs.** This undercounts true spend on the retry path (a real, if
  infrequent, cost). Accepted as a best-effort-observability tradeoff rather than building summing logic
  across both `callOnce()` invocations — this is meant to give Connor visibility into typical costs and
  prove the Design 5 caching fix is working, not to be billing-grade accounting. Flagged in Known Risks
  rather than silently accepted.
- **D-10: `transcribe.js` gets no logging change.** Whisper (`whisper-1`) is priced by audio duration, not
  tokens, and its transcription response doesn't carry the same `usage.prompt_tokens`/`completion_tokens`
  shape chat-completions responses do. The route already logs `mime`/`size`/`duration`
  ([transcribe.js:60-63](../../server/routes/transcribe.js)) — the correct cost proxy for this endpoint
  already exists; adding a token-usage line here would log a field that doesn't meaningfully apply.
- **D-11: `requireAiAccess` reuses `clerkAuth`'s already-fetched household data instead of doing its own
  `householdService.getById()` lookup** (architect review round 1's required change). Investigated
  whether the household was already available in the request pipeline before accepting either the
  original design or a fix: `clerkAuth` calls `householdService.getOrCreate()` on every request, but
  discards everything except `.id`, and `getOrCreate`'s non-owner-member branch
  ([householdService.js:145-150](../../server/services/householdService.js)) didn't even fetch
  `clerkUserId` in the first place — the data wasn't fully "already there" for the household-member case,
  only for the owner-login/household-creation cases. Rather than leave the redundant lookup (defensible
  but not what the reviewer asked for) or do a much larger change (attaching the full household row to
  every request app-wide), widened only the one narrow query that was missing a single column, via a join
  that was cheap to add and has exactly one caller. This satisfies the reviewer's actual concern — no
  duplicate request-scoped lookup — without expanding `clerkAuth`'s blast radius beyond what's needed.

---

## Allowed Files

- New: `server/middleware/requireAiAccess.js`
- New: `server/middleware/requireAiAccess.test.js`
- New: `server/db/migrations/0021_drop_byok.sql`
- `server/db/schema.js` — remove `openaiApiKey` field.
- `server/services/ai/resolveProvider.js` — simplify to the no-arg wrapper (Design 3); move
  `NoApiKeyError` out to `requireAiAccess.js`.
- Delete: `server/services/ai/resolveProvider.test.js`
- `server/middleware/clerkAuth.js` — attach `req.user.householdOwnerClerkId` from the household row
  `getOrCreate` already fetches (Design 2/D-11).
- `server/services/householdService.js` — remove `getAiConfig`, `getAiKeyPreview`, `setAiApiKey`,
  `removeAiApiKey`, and the `encrypt`/`decrypt`/`maskKey` imports; widen `getOrCreate`'s Step 1 query to
  join `households` and select `clerkUserId` (Design 2/D-11).
- `server/routes/household.js` — remove the `ai-key` route, `aiKeySchema`, `maskKey` import, and
  `maskedKey` from the `GET /` response.
- `server/routes/ai.js` — add `requireAiAccess` to the router-level middleware; drop `getAiConfig`/
  `aiConfig` from the `/chat` handler.
- `server/routes/transcribe.js` — add `requireAiAccess` to the route's middleware chain; drop the
  `householdService` import and simplify the `resolveProvider()` call.
- `server/services/aiService.js` — `chat()` drops the `aiConfig` parameter and calls `resolveProvider()`
  with no arguments; passes `requestId` into `provider.startChatSession(...)`; system-prompt string
  reordered per Design 5 (content-neutral); `eatThisNow`/`expandSuggestion` param rename
  `_requestId`→`requestId` and their log lines extended; `parseReceipt`/`enrichRecipeFields` log lines
  extended in place; `parseRecipeText`/`parseRecipeImage` hoist a `usage` variable and extend their log
  lines (`parseRecipeImage`'s `callOnce()` return shape changes to `{ content, usage }`); one
  module-level shared `openaiClient` added, replacing all six inline `new OpenAI(...)` calls (Design 7).
  No other function logic changes.
- `server/services/ai/openaiProvider.js` — `startChatSession` gains an optional `requestId` param
  (stored on the session); `sendMessage` adds `prompt_cache_key: 'kitchen-keeper-chat-v1'` to the
  `chat.completions.create()` call and logs token usage after each response (Design 5-6). No change to
  `extractToolCalls`/`extractText`/`buildToolResult`/`isResponseValid`/the constructor.
- Delete: `server/utils/encryption.js`
- Delete: `server/utils/keyEncryption.js`
- Delete: `server/utils/keyEncryption.test.js`
- `server/app.js` — remove `'ENCRYPTION_KEY'` from `REQUIRED_ENV`.
- `.env.example` — remove `ENCRYPTION_KEY` (and `API_KEY_ENCRYPTION_SECRET` if present).
- `client/src/pages/HouseholdPage.jsx` — copy-only change to the platform-settings description and
  toggle button labels (Design 8). No structural/state changes.

## Forbidden Files

- `server/services/aiService.js` — scope is limited to exactly what's listed above (`chat()`'s
  `aiConfig` removal, the prompt reorder, the six functions' logging/client changes). No change to
  `PANTRY_TOOLS`, `safeParseJSON`, `wrapAIError`, `RECIPE_ENRICHABLE_FIELDS`, `suggestRecipes`, the tool
  dispatch loop's control flow, or any function's actual prompt *wording*/business logic beyond the
  system prompt's reordering.
- `server/services/ai/openaiProvider.js` — scope is limited to `startChatSession`'s new `requestId`
  param and `sendMessage`'s new `prompt_cache_key` + logging line. No change to how tool calls are
  extracted/built or how the constructor takes an API key.
- `server/middleware/aiRateLimit.js` — abuse-deterrence rate limiting is unchanged and unrelated to this
  task; `requireAiAccess` is a new, separate middleware, not a modification of this one.
- `server/middleware/clerkAuth.js` and `server/services/householdService.js`'s `getOrCreate` — scope is
  limited to exactly the Design 2/D-11 change (attaching `householdOwnerClerkId`, widening Step 1's
  query). No change to `getOrCreate`'s resolution order, Steps 2/3, or any other part of `clerkAuth`'s
  401/error handling.
- `server/services/platformSettingsService.js`, `server/routes/admin.js` — the platform toggle's
  storage, caching, and admin PATCH endpoint are all reused unchanged. This task only adds a new
  *consumer* of `isPublicAiAccessEnabled()`.
- `server/routes/ai.js`'s route handlers other than `/chat`'s `aiConfig` removal and the router-level
  `requireAiAccess` addition — no change to `eat-this-now`/`expand-suggestion`/`parse-receipt`/
  `parse-recipe-image`/`parse-recipe-url`'s own bodies; they call the same `aiService.js` functions the
  same way, just now gated upstream by the middleware.
- Every non-AI route/service (`pantry`, `recipes` CRUD, `shopping`, `dietary`, `push`, `onboarding`,
  etc.) — entirely unrelated to AI access gating or AI-efficiency logging.

## Constraints

- **Pre-drop verification is mandatory, not optional.** Before applying the `0021_drop_byok.sql`
  migration to any environment, run `SELECT id, clerk_user_id FROM households WHERE openai_api_key IS
  NOT NULL;` against that environment's DB and confirm the result is empty (or, if not empty, stop and
  tell Connor which household(s) have a stored key before proceeding — do not silently drop real data).
- Zero new npm dependencies.
- The centralized error handler's existing contract (`err.status`, `err.message`, `err.code` —
  [app.js:73-80](../../server/app.js)) is what `NoApiKeyError` must continue to satisfy; no change to
  `app.js`'s error-handling middleware itself.
- `useWhisperInput.js`'s `res.status === 403` check for "no-api-key" UX
  ([useWhisperInput.js:50](../../client/src/hooks/useWhisperInput.js)) must keep working — `transcribe.js`
  must still produce a 403 in the denied case, via `requireAiAccess` (or `resolveProvider` throwing
  through it) exactly as it does today via the old `resolveProvider`.
- `OWNER_CLERK_ID` and `OPENAI_API_KEY` remain required env vars (`REQUIRED_ENV` in `app.js`) — only
  `ENCRYPTION_KEY` is removed from that list.
- No behavior change intended for the 2 previously-gated endpoints (`/chat`, `/transcribe`) beyond how
  the gate is implemented — an owner-household request or a toggle-enabled non-owner request must
  succeed exactly as before; a toggle-disabled non-owner request must still get a 403.
- **The chat system-prompt reorder (Design 5) must be content-neutral.** Every instruction sentence in
  the current prompt must appear, word-for-word, somewhere in the reordered version — only position
  changes. Verify by diffing the set of instruction substrings before/after, not just by eyeballing the
  new code.
- **Implementation invariant (architect review round 1): `Today: ${new Date().toDateString()}` must stay
  in the dynamic suffix, generated fresh on every call.** Called out explicitly because it's easy to
  accidentally move it back into the static prefix during implementation (it reads naturally as part of
  the opening greeting) — doing so would silently defeat Design 5's whole point by making the "static"
  prefix change once a day instead of never.
- **No prompt or response content in the new log lines (Design 6).** Only token counts, model name, and
  `request_id`/`function` identifiers — matching every existing AI log line in this file, none of which
  currently log full prompt/response text.
- **`prompt_cache_key` and the reorder must not change chat's actual behavior** — same tool-selection
  rules, same tone, same tool-calling triggers as today. This is a caching/observability change, not a
  prompt-content change.
- **Standing invariant (architect review round 1): every current and future AI endpoint must be mounted
  under `/api/ai` (or `/api/transcribe`) with `requireAiAccess` applied — either via the router-level
  `.use()` or an explicit per-route include.** `router.use(requireAiAccess)` only protects routes
  registered on that router; a future AI endpoint added elsewhere, or added to `ai.js` in a way that
  bypasses the shared router (unlikely, but possible), would silently reopen the exact gap this task
  fixes. Not enforceable by this spec's code alone — flagged here as a rule for code review to catch
  going forward, not a runtime check.

## Out of Scope (v1)

- **Per-household cost tracking or spend-based (as opposed to access-based) limits.** `requireAiAccess`
  is a binary on/off switch, matching exactly what Connor asked for ("a single switch... if it starts
  costing too much money"), not a metered/budgeted system. If usage-based limits are ever wanted, that's
  a distinct future task.
- **Removing the deprecated `ai_provider`/`ai_api_key` columns** ([schema.js:22-23](../../server/db/schema.js)).
  Unrelated to this task's BYOK generation and, per Current Behavior, believed to hold real historical
  data — not touched here.

### Related findings not addressed by this task (remaining 5, for future task planning)

The original research pass (codebase read of `aiService.js`/`routes/ai.js` plus external research on LLM
cost/accuracy practices) surfaced 8 findings. Three are now addressed by Design 5-7 above (prompt-cache
ordering, cost/token logging, the shared client). The remaining 5 are recorded here in full so they
aren't lost — each needs a design decision, a measurement, or usage data this session doesn't have, and
is a candidate for its own future task:

1. **Four of seven AI calls skip structured outputs.** `parseReceipt`, `parseRecipeImage`,
   `parseRecipeText`, and `enrichRecipeFields` rely on prompt-instructed JSON + regex-stripped markdown
   fences (`safeParseJSON`, [aiService.js:9-22](../../server/services/aiService.js)) instead of
   `response_format: json_schema` with strict mode. `eatThisNow`/`expandSuggestion` use the weaker
   `json_object` mode (valid JSON, not schema-conformant JSON). `parseRecipeImage` already carries a
   bespoke retry-on-parse-failure path
   ([aiService.js:454, 509-517](../../server/services/aiService.js)) that schema-constrained decoding
   would likely make unnecessary. Needs 4 JSON schemas designed and each call site's retry/validation
   logic reconsidered — a real design task, not a mechanical change.
2. **`gpt-4o` for vision OCR is an unvalidated assumption.**
   [aiService.js:453](../../server/services/aiService.js) hardcodes `gpt-4o` (vs. `gpt-4o-mini`
   everywhere else) based on a code comment, not a measured accuracy comparison. Needs an actual
   side-by-side eval against real receipt/recipe images before any code change makes sense — a
   measurement task, not a spec.
3. **No caching for content that isn't personalized.** `parseRecipeText`/`enrichRecipeFields`/
   `parseRecipeImage`/`parseReceipt` operate on inputs (a URL's page text, an image) that aren't
   household-specific — if two households import the same public recipe URL, today that's two identical,
   fully-priced LLM calls. A simple content-hash cache (not full semantic/vector caching) would likely
   capture most of the value — but only worth building if URL collisions across households are actually
   common, which is unknown without usage data.
4. **No streaming on chat responses.** Every AI call, including chat, is a blocking
   `chat.completions.create`. A latency/UX issue, not a token-cost issue — same total tokens either way.
   Needs new server+client streaming infrastructure, not a small patch.
5. **Unbounded context growth risk ("context rot").**
   [ai.js:423-437](../../server/routes/ai.js) already trims pantry/recipe fields sensibly, but there's no
   cap on *item count* — a household with hundreds of pantry items or saved recipes gets all of them
   stuffed into every chat prompt. Not a live problem at current scale, but a latent one with no guard
   rail; research shows LLM accuracy measurably degrading as context length grows even when relevant
   information is present. Needs a threshold decision and a truncation strategy before it's spec-able.

## Known Risks

- **If `publicAiAccessEnabled` is ever `false` in an environment when this ships, every non-owner
  household immediately loses access to all 7 AI endpoints, not just chat/transcribe (5 endpoints that
  silently worked before now correctly don't).** Per `ai/handoffs/CURRENT_STATE.md`, production currently
  has this toggle set to `true` (set deliberately after the earlier public-sign-up 403 incident), so this
  is not expected to cause a regression in prod — but must be confirmed before deploying, and is exactly
  the kind of change worth confirming in staging first if a staging environment with its own toggle value
  exists.
- **Pre-drop verification (Constraints) is a manual step, not something this spec's code can enforce.**
  If skipped, a household with a real stored key loses it permanently with no recovery path (BYOK is
  being deleted entirely, not archived). Flagged prominently rather than silently assumed safe.
- **`getOrCreate`'s Step 1 query gains a join it didn't have before** (Design 2/D-11) — a single
  indexed join on every non-owner member's request across the *entire app*, not just AI routes, since
  `clerkAuth` runs on every authenticated request. Expected to be negligible (one additional indexed
  join, same query shape this codebase already uses elsewhere), but flagged because it's the one part of
  this task whose blast radius extends beyond AI endpoints — see Constraints/Forbidden Files for why this
  was kept as small as possible (one column, one join) rather than fetching the full household row.

## Verification Steps

1. **Owner household, toggle off**: as the owner's household (any member, not necessarily Connor's own
   Clerk login if the household has other members), with `publicAiAccessEnabled = false`, call all 7 AI
   endpoints (`chat`, `transcribe`, `eat-this-now`, `expand-suggestion`, `parse-receipt`,
   `parse-recipe-image`, `parse-recipe-url`) — confirm all succeed. This is the D-3 household-scoped-owner
   behavior; if there's no second member of the owner's household available to test with, verify by direct
   code inspection that `requireAiAccess` reads `req.user.householdOwnerClerkId`, and that
   `clerkAuth`/`getOrCreate` populate it correctly from `household.clerkUserId` in all three resolution
   branches (existing member, owner login, newly-created household) — not just `req.user.id`.
2. **Non-owner household, toggle on**: confirm all 7 endpoints succeed using the platform key.
3. **Non-owner household, toggle off**: confirm all 7 endpoints now return 403 with a clear error message
   (previously, 5 of these would have silently succeeded — this is the core fix).
4. **Voice input error UX still works**: with toggle off on a non-owner household, trigger voice input
   (`useWhisperInput`) — confirm the existing "no-api-key"-flavored UI still appears (403 contract
   preserved).
5. **No client breakage from removed `maskedKey`**: load the Household settings page as any household —
   confirm no console error and no broken UI element (there was never a rendered element for it, per
   Current Behavior, but verify live rather than trusting the earlier static search alone).
6. **Admin toggle copy**: as the owner, view the platform-settings section on the Household page — confirm
   the updated copy (Design 8) makes sense and doesn't reference BYOK as a fallback.
7. **Server boots without `ENCRYPTION_KEY`**: remove `ENCRYPTION_KEY` from local `.env` — confirm the
   server starts cleanly (no `Missing required env var` crash).
8. **Migration pre-flight check**: run the `SELECT ... WHERE openai_api_key IS NOT NULL` query
   (Constraints) against the target environment before applying `0021_drop_byok.sql`; only proceed with
   the actual `DROP COLUMN` once confirmed empty.
9. **Existing test suites still pass**: `npm test --prefix server` — confirm no leftover reference to
   deleted files/exports breaks the run; confirm the new `requireAiAccess.test.js` covers the three
   branches in Verification Steps 1–3 at the unit level.
10. **Chat prompt reorder is behavior-neutral**: exercise a handful of chat scenarios that exercise
    different tool-selection rules (add an item, consume an item, ask "what should I make?", trigger a
    clarification question) before and after the reorder — confirm identical tool selection and reply
    tone. This is the Design 5/D-6 content-neutrality requirement; verify live, not just by code review.
11. **Prompt caching is actually working**: send two chat messages in the same session (same pantry/recipe
    state between them) — confirm the second call's logged `cached_tokens` (Design 6) is greater than
    zero, proving the reorder + `prompt_cache_key` combination is effective, not just theoretically
    correct.
12. **Token logging appears on all 7 calls**: trigger each of the 7 AI endpoints once in local dev —
    confirm each produces a log line with `prompt_tokens`/`completion_tokens`/`total_tokens` (or, for
    `transcribe`, confirm its existing `mime`/`size`/`duration` line is unchanged per D-10).
13. **Shared client works under load**: exercise at least two of the six affected functions
    (`eatThisNow`, `expandSuggestion`, `parseReceipt`, `parseRecipeImage`, `parseRecipeText`,
    `enrichRecipeFields`) back to back — confirm both succeed using the single shared `openaiClient`,
    with no error related to concurrent use of one client instance.
14. **`clerkAuth`/`getOrCreate` widening doesn't regress non-AI routes**: exercise at least one non-AI
    endpoint (e.g. `GET /api/pantry`) as a non-owner household member — confirm it still succeeds
    identically to before, proving Step 1's added join didn't break the member-lookup path itself.
15. **`requireAiAccess` makes no DB call of its own**: confirm via code inspection (and, if convenient, a
    query-count check in local dev) that `requireAiAccess` only reads `req.user.householdOwnerClerkId`
    and calls the already-cached `isPublicAiAccessEnabled()` — no `householdService.getById()` or
    equivalent fresh lookup remains in the AI request path. This is the architect review round 1 required
    change; verify it actually landed, not just that the code compiles.
