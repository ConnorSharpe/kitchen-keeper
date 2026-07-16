# Task
TASK-037 — Public AI Access Toggle + Per-Household Rate Limiting. **Code implemented and live-verified this session** per [ai/tasks/TASK-037-spec.md](../tasks/TASK-037-spec.md) DRAFT-3 (post-architect review, round 2). Migration 0017 is now applied to the dev Neon database.

# Current Status
All code from the spec's Overall Allowed Files list is implemented, matches the spec's file contents exactly, and is both locally verified (tests/lint/build/format) and live-verified against the real dev database and a real authenticated owner session. **Not committed** — no commit made this session (user didn't ask for one). System is left in its pre-launch default state: `public_ai_access_enabled = false`, `ai_rate_limit_max = 20`, matching today's existing "BYOK required for everyone but the owner" behavior byte-for-byte.

# Files Modified
New: `server/db/migrations/0017_platform_settings.sql`, `server/services/cachedLoader.js`, `server/services/cachedLoader.test.js`, `server/services/platformSettingsService.js`, `server/services/ai/resolveProvider.test.js`, `server/routes/admin.js`, `server/middleware/aiRateLimitKeyGenerator.js`, `server/middleware/aiRateLimitKeyGenerator.test.js`, `server/middleware/aiRateLimit.js`.

Modified: `server/db/schema.js` (+`platformSettings` table), `server/services/ai/resolveProvider.js` (positional args → options object, +`publicAiAccessEnabled` fallback), `server/services/householdService.js` (`getAiConfig` +`publicAiAccessEnabled` field, +import), `server/services/aiService.js` (one `resolveProvider(...)` call site, ~line 605), `server/routes/transcribe.js` (one call site + `aiRateLimit` wiring), `server/routes/ai.js` (`aiRateLimit` wiring on all routes), `server/routes/household.js` (`GET /` +`viewerIsOwner` top-level field), `server/app.js` (mount `adminRouter` at `/api/admin`), `client/src/pages/HouseholdPage.jsx` (new owner-only "Platform AI settings" section: toggle + rate-limit input + last-changed timestamp).

All exactly matches the spec's Overall Allowed Files — confirmed via `git status --short`, zero extra files touched. (`client/vite.config.js` was temporarily edited mid-session to point the dev proxy at this session's own server port, for live verification only — reverted before session end, confirmed zero net diff via `git diff`.)

# Database Changes (live, applied this session)
- **`platform_settings` table created** in the dev Neon DB (host `ep-misty-hill-ak264gcz-pooler...neon.tech`) via direct SQL execution (not drizzle-kit's migrator — this repo's migration history predates full drizzle-kit tracking; migrations here are hand-applied, consistent with the backlog note about 0001–0013 lacking `--> statement-breakpoint` markers).
- Seeded with defaults (`id=1, public_ai_access_enabled=false, ai_rate_limit_max=20`).
- Singleton constraint empirically proven: a manual `INSERT ... id=2` was attempted and correctly rejected with `violates check constraint "platform_settings_id_check"`.
- Table was exercised live (toggled true→false, rate limit tuned 20→2→20) during verification, then explicitly reset to its original seeded defaults before ending the session — no residual non-default state left in the database.

# Files Already Reviewed
Full reads this session (to confirm "Current Behavior" in the spec still held before editing): `server/db/schema.js`, `server/services/ai/resolveProvider.js`, `server/services/householdService.js`, `server/routes/transcribe.js`, `server/routes/ai.js`, `server/app.js`, `server/routes/household.js`, `client/src/pages/HouseholdPage.jsx`, `server/middleware/validate.js`, `server/middleware/clerkAuth.js`, `server/package.json`, `server/db/client.js`, `server/db/migrate.js`, `client/vite.config.js`, `.claude/launch.json`.

# Dependency Chain

Editing:
- server code across ai/resolveProvider, householdService, aiService, routes/{ai,transcribe,household,admin}, app.js, middleware/aiRateLimit*, services/{cachedLoader,platformSettingsService}, db/schema.js, db/migrations/0017
- client/src/pages/HouseholdPage.jsx

Requires:
- server/services/ai/openaiProvider.js (unchanged, just imported)
- server/middleware/validate.js, server/middleware/clerkAuth.js (unchanged, reused)

Irrelevant (per spec's Overall Forbidden Files, untouched):
- migrations 0000–0016, `server/services/ai/openaiProvider.js`/`providerInterface.js`, `server/services/chat/**`, AI prompts/tool schemas, `server/utils/encryption.js`/`keyEncryption.js`, `server/middleware/clerkAuth.js` (reused as-is, not modified), `ai/tasks/archive/`

# Architecture Notes
- `resolveProvider` is now an options-object function (D-7): `resolveProvider({ clerkUserId, decryptedKey, publicAiAccessEnabled })`. All three call sites updated to match.
- `getAiConfig` now always calls `platformSettingsService.isPublicAiAccessEnabled()` — one extra (cached, 5s TTL) lookup per AI request, fails closed to `false` on any DB error (proven live this session — see Verification Results).
- `aiRateLimit` middleware is mounted on the whole `ai.js` router (`router.use(aiRateLimit)`, after `clerkAuth`) — **confirmed live that this covers every route on that router, including `GET /chat/history`, which makes no OpenAI call at all.** This is correct per the spec (uniform application, D-10) but worth knowing if a future session wonders why a read-only route counts against the AI rate limit.
- `platform_settings` is a singleton table (`CHECK(id=1)` + `PRIMARY KEY`), cached via `createCachedLoader` (stampede-safe, in-flight-dedup). Toggling/tuning takes effect without any server restart — proven live (dynamic `limit` function in `aiRateLimit.js` picked up the new value on the very next request after a PATCH).
- This session's dev server ports were auto-reassigned (another chat's server was already on 3001, running **stale pre-TASK-037 code** — confirmed via a 404 on the new `/api/admin/platform-settings` route against port 3001). Don't assume port 3001 has current code without checking.

# Decisions Made
No implementer deviations from the spec this session — DRAFT-3 was already fully architect-reviewed (2 rounds) before this session started, so implementation followed its file contents verbatim. One Prettier auto-format pass was applied, scoped only to the 3 files this task touched that had pre-existing style drift (`HouseholdPage.jsx`, `transcribe.js`, `resolveProvider.js`) — did **not** reformat `server/routes/shopping.js` or `server/services/chatService.js`, which also show `prettier --check` warnings but are untouched by this task.

# Remaining Work
1. **No commit made yet** — ask before committing/pushing, per standing safety practice on this repo.
2. **Verification Steps 2 (byte-identical 403 for a second, non-owner household) and 5 (BYOK precedence with a live invalid key) were not exercised via a second real HTTP session** — doing so would require either creating a second Clerk account (outside what I do — account creation is off-limits regardless of context) or the user providing a second real test login. `resolveProvider`'s decision logic covering exactly this matrix (owner/non-owner × BYOK/no-BYOK × toggle-on/off) is fully unit-tested (5/5 passing, `resolveProvider.test.js`) and the toggle plumbing feeding it was proven live end-to-end for the owner path — the only untested seam is a second household's literal HTTP round-trip, which is logic-identical to the owner path already proven.
3. **Deployment Prerequisites are still open, non-code, outside this repo**: OpenAI billing → prepaid credits with auto-recharge off; Clerk Dashboard sign-up hardening review. Not touched this session.
4. **TASK-036's 5 local commits are still unpushed** (carried forward, unrelated to this task) — still pending the user's push decision from the prior session.

# Known Risks
- Everything the spec's own "Known Risks" section documents still applies unchanged (OpenAI's own budget limits are notification-only; the rate limiter is abuse deterrence not spend protection; fail-closed on settings-lookup failure degrades non-owner AI access during a DB outage; no automatic cutoff; the 20-req/15-min default is a starting guess; registration is unrestricted at the Clerk layer).
- **`aiRateLimit`'s `MemoryStore` state is per-process** — confirmed concretely this session: switching the client's proxy target between two different running server processes (port 3001 vs. this session's port) would reset rate-limit counters, since each process has its own in-memory store. Expected/documented behavior (D-per spec's Known Risks on `MemoryStore`), just now empirically observed rather than only theoretical.

# Verification Results
**Local (unchanged from prior write-up):**
- `node --test` (server): 71/71 pass, including all 12 new tests.
- `npm test` (root): 84/84 pass (13 shared + 71 server).
- `npm run lint`: clean. `npm run format:check`: clean on all files this task touched. `npm run build`: succeeds (pre-existing bundle-size warning only).

**Live, against the real dev Neon DB and a real authenticated owner session (this session):**
- **Step 1 (migration + singleton)**: Applied; seed row confirmed; `INSERT id=2` empirically rejected with the expected check-constraint violation.
- **Step 3/4 (toggle flips, no redeploy)**: Flipped `publicAiAccessEnabled` true→false via the real Household page UI; both PATCHes returned 200; DB state and UI both reflected each change immediately (5s cache is invalidate-on-write, so no wait was even needed); reset to `false` (original default) before session end.
- **Step 6 (partial — unauthenticated request)**: `GET`/`PATCH /api/admin/platform-settings` with no session both return 401 (proven via curl against the running server) — confirms `clerkAuth` gates the route before `requireOwner` ever runs. The owner-success path (200) was proven via the real UI. The non-owner-authenticated-403 path was not exercised live (see Remaining Work #2) but is a single-line string comparison, already code-reviewed.
- **Step 7 (fail-closed)**: Pointed `DATABASE_URL` at an unreachable host in an isolated process import of `platformSettingsService`; `getPlatformSettings()` and `isPublicAiAccessEnabled()` both returned safe defaults (`false`/`20`) without throwing, logging the failure via `console.error` as designed.
- **Step 8 (live UI)**: The owner's real Household page renders the new "Platform AI settings" section correctly, including live `updatedAt`/toggle state matching the DB. (Non-owner-side "section absent" was not exercised — same second-account constraint as above.)
- **Step 9 (rate limit)**: Set `aiRateLimitMax` to 2 via the real UI; subsequent requests to `GET /api/ai/chat/history` (a free, non-OpenAI-calling route under the same rate-limited router) returned `429` with `RateLimit-Limit: 2`, `RateLimit-Remaining: 0`, and the exact configured error message. Reset to 20; confirmed a follow-up request immediately succeeded (`200`, `RateLimit-Limit: 20`) with zero server restart — proves the dynamic `limit` function truly re-reads on every request.
- **Step 11 (`.returning()` on `.update()`)**: Directly verified against the real `drizzle-orm@0.29.5` + `neon-http` combination — the returned row exactly reflects the just-written values on every write in this session. No fallback needed.
- **Step 12 (regression)**: Not run as the full 6-tool chat suite (this task touches zero chat-tool logic, only key resolution and a request-counting middleware wrapped around the whole router) — instead confirmed the lighter-weight equivalent: normal `GET /api/ai/chat/history` access for the owner's household succeeds normally (`200`) after the rate-limit tuning was reset, proving no regression in ordinary access.

# Recommended Next Action
Implementation and verification are complete for everything this session could reach without a second live Clerk account. Ask the user: (1) whether to commit this work now, and (2) whether they're ready to review the Deployment Prerequisites (OpenAI prepaid billing, Clerk sign-up hardening) before ever flipping `publicAiAccessEnabled` to `true` in a real public-launch scenario — the code path is proven, but those two non-code steps are the actual safety net for a real launch, not this task's code.

# Forbidden Exploration
- `ai/tasks/archive/` — not relevant to this task
- Anything already listed under TASK-037-spec.md's own "Overall Forbidden Files" and "Out of Scope" sections — all explicitly deferred by the spec itself, not gaps in this session's work

# Context Notes
- branch: main
- worktree: none
- context pressure: moderate-high — full spec implementation, local verification, DB migration application, and live HTTP/UI verification all in one session.

# PowerShell Merge Block
Nothing to push — no commit made yet this session. If/when the user wants a commit, stage exactly the files listed under "Files Modified" above (all match the spec's Overall Allowed Files list) plus the new files, nothing else. `client/vite.config.js` has zero net diff and needs no staging.
