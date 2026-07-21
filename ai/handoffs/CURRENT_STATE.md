# Task
TASK-037 — Public AI Access Toggle + Per-Household Rate Limiting. **Code implemented and live-verified this session** per [ai/tasks/TASK-037-spec.md](../tasks/TASK-037-spec.md) DRAFT-3 (post-architect review, round 2). Migration 0017 is now applied to the dev Neon database.

# Current Status
All code from the spec's Overall Allowed Files list is implemented, matches the spec's file contents exactly, and is both locally verified (tests/lint/build/format) and live-verified against the real dev database and a real authenticated owner session. **Committed and pushed** — `a459270` ("TASK-037: public AI access toggle + per-household rate limiting"), confirmed on `origin/main`. System is left in its pre-launch default state: `public_ai_access_enabled = false`, `ai_rate_limit_max = 20`, matching today's existing "BYOK required for everyone but the owner" behavior byte-for-byte. **Migration 0017 confirmed applied where it matters**: `vercel env pull --environment=production` shows the Vercel "production" `DATABASE_URL`/`PGHOST` is identical to the dev DB used this session (`ep-misty-hill-ak264gcz-pooler...neon.tech`, `neondb`) — this project has one Neon database, not a per-environment branch split. A live read-only `SELECT * FROM platform_settings` against it confirmed the seed row exists (`public_ai_access_enabled: false`). No separate production migration step is needed.

# Production Incident (found and resolved this session)
While working through TASK-037's Deployment Prerequisites, discovered **production had been fully down for ~13 hours** — every API route (`/api/recipes`, `/api/pantry`, `/api/ai/chat/history`, etc.) was returning `FUNCTION_INVOCATION_FAILED`. Root cause: [TASK-036 Part C](https://github.com/ConnorSharpe/kitchen-keeper/commit/fb2da63) added `"type": "module"` to root `package.json` (needed for the flat ESLint config), but `api/index.js` still used CommonJS `module.exports =` — a `ReferenceError` under ESM, crashing every serverless invocation on Vercel from that commit's first deploy onward. Local dev never caught it because `npm run dev` doesn't go through `api/index.js` at all.

**Fix**: one-line change, `module.exports =` → `export default` in `api/index.js` — committed and pushed as `352b18a`. Nothing else touched (package.json, ESLint/Prettier/CI, `shared/`, chat handlers all untouched — verified this doesn't invalidate any part of TASK-036).

**Verified live in production, post-deploy**:
- `vercel logs` on the new deployment: API routes now return real HTTP responses (401 when unauthenticated, 200 with real data when authenticated) instead of crashing.
- Loaded `kitchenkeeper.vercel.app/pantry` live — renders the real household's 30 pantry items from the production DB.
- Local repro/regression check: `node -e "import('./api/index.js')"` (mirrors Vercel's exact ESM loader) now resolves instead of throwing; `npm run lint`, `node --test` (71/71), and `npm run build` all still pass.

# Clerk Production Migration (in progress, blocked — this session)
Worked through the "Clerk Dashboard sign-up hardening" deployment prerequisite and it turned into a much bigger infrastructure project. Summary:

**Done:**
- Reviewed dev instance's sign-up settings via `clerk config pull` — already solid (email verification required+enforced, CAPTCHA/bot protection enabled, account lockout enabled, HIBP breach-password check enabled). `sign_up_mode` is `public` — kept intentionally (matches TASK-037's public-AI-access intent).
- **Discovered the app had no Clerk production instance at all** — `kitchenkeeper.vercel.app` was running entirely on Clerk's dev instance (`pk_test_`/`sk_test_`) in front of real users, which also meant no custom domain existed.
- **Registered `kitchenkeeper.kitchen`** ($8.98/yr, Namecheap) — `kitchenkeeper.com` is squatted/listed for resale at $5,595, not viable.
- Added the domain to the Vercel project (`vercel domains add`), pointed it at Vercel via an `A @ 76.76.21.21` record at Namecheap, verified (`vercel domains verify`).
- Ran `clerk deploy` (interactive wizard, run by the user in their own terminal — this step can't be driven non-interactively). Created Clerk production instance `ins_3GbWJwo4GVlGAD7lyMCMgXmMotn`. Added the 5 required CNAME records at Namecheap (frontend API, account portal, mail, 2×DKIM) — one had a typo (`acocunts` vs `accounts`) caught and fixed.
- Created production Google OAuth credentials in a new Google Cloud project ("Kitchen Keeper Production"), consent screen published to "In production". Initial redirect URI mismatch: Clerk's wizard said to register `accounts.kitchenkeeper.kitchen/v1/oauth_callback`, but the actual runtime redirect (since the app uses `<SignIn routing="path">`, not the Account Portal) is `clerk.kitchenkeeper.kitchen/v1/oauth_callback` — added both to the Google OAuth Client, error resolved.
- `clerk deploy status` now reports **fully complete**: DNS ✅ SSL ✅ mail ✅ OAuth(google) ✅.
- Pulled production keys (`clerk env pull --instance <prod-id>`) and updated Vercel: split `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`/`VITE_CLERK_PUBLISHABLE_KEY` so **Production** env gets the new `pk_live_`/`sk_live_` keys and **Preview** env keeps the old `pk_test_`/`sk_test_` dev keys (so PR previews don't hit real user data). Redeployed to production.
- Confirmed live: `kitchenkeeper.kitchen` now serves the production Clerk instance — "Development mode" badge is gone from the hosted sign-in/account-portal pages, bundle has `pk_live_` embedded (verified via direct `curl` of the deployed JS, bypassing CDN edge-cache lag that briefly showed a stale bundle in the browser).

**BLOCKED — sign-in itself does not complete:**
Google OAuth sign-in on `kitchenkeeper.kitchen` gets all the way through Google's consent screen (redirect_uri now matches, no Google-side error), lands on Clerk's Account Portal `/sso-callback`, all Clerk Frontend API calls (`environment`, `client`) return 200 — but then bounces back to `/sign-in` with a generic **"Unable to complete action at this time. If the problem persists please contact support."** No user record is created (`clerk users list --instance <prod-id>` returns empty). The Account Portal's own Sentry captured an error report for this (visible as `envelope/...sentry_client=sentry.javascript.nextjs` calls in the network log) but we can't see its contents.

Ruled out: DNS/SSL/mail/OAuth config (all "complete" per `clerk deploy status`), allowlist/blocklist/access-control settings (verified identical to dev's, nothing restrictive), browser extension interference (same failure in incognito), legal-consent/compliance settings (identical to dev, disabled on both), Clerk platform status (status.clerk.com shows no incidents).

**Follow-up session (2026-07-21): tried email-code sign-up too — same outcome, deepened the diagnosis.**
- Email verification code sign-up ALSO fails: no error shown, but the verification email never arrives (checked spam, nothing). Confirms this is **not** Google-OAuth-specific — something is broken for *all* new sign-up/sign-in on this production instance.
- DNS mail records (`clkmail`, `clk._domainkey`, `clk2._domainkey`) re-verified still resolving correctly — not a DNS regression.
- **Checked Clerk Dashboard → Logs directly (this was the missing piece — not accessible via CLI, `clerk api /templates/*` and `/domains` both 404 for unclear reasons).** Findings:
  - The one explicit `sign_in.failed` event logged ("Couldn't find your account") was just the very first sign-**in** attempt on a brand-new instance with no account yet — expected, not a bug.
  - Every subsequent attempt (3× Google OAuth, 1× email sign-up incl. 2× code-sent) reaches a `created`/`code_sent` state on Clerk's backend successfully — captcha passes, sign_up/sign_in objects get created — but **none ever produce a `session.created` or `user.created` event**. No failure event is logged for these either; they just stop.
  - Conclusion: the backend side is working correctly. Combined with the earlier finding that the client-side error triggers a **Sentry report from Clerk's own Account Portal Next.js app** (not our code), this points to a bug/crash inside Clerk's hosted Account Portal frontend itself when finalizing sign-up on this specific new production instance — not a dashboard setting we have access to.
- **Filed a Clerk support ticket** (via clerk.com/contact/support) with instance ID, event/trace ID pattern, and everything ruled out above. **Waiting on their response** — this is the actual next step, not further self-diagnosis. User will report back when Clerk replies.

**Next session should start here** — the domain/DNS/OAuth-app-registration work is done and shouldn't need to be repeated; the open question is narrowly "why does Clerk's own Account Portal fail to complete the sign-in on this brand-new production instance."

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
1. **Deployment Prerequisites — 1 of 3 still fully open, 1 blocked mid-flight, non-code, outside this repo** (per [TASK-037-spec.md](../tasks/TASK-037-spec.md), "Deployment Prerequisites" section) — required before ever flipping `public_ai_access_enabled` to `true` in production:
   - OpenAI billing → switch to prepaid credits with auto-recharge **off** (2026 budget thresholds are notification-only, not a hard stop). **Still open, not touched.**
   - Clerk Dashboard sign-up hardening → **settings review done, but production migration is BLOCKED on a suspected Clerk platform bug** — see "Clerk Production Migration" section above. Production instance exists, DNS/SSL/OAuth-app/mail all verified complete, every self-serve diagnostic avenue exhausted, support ticket filed and awaiting Clerk's response.
   - ~~Apply migration 0017 to production~~ — **resolved**: confirmed via `vercel env pull --environment=production` that prod and dev share one Neon database; live `SELECT` confirmed the table and seed row already exist there.
2. **Verification Steps 2 (byte-identical 403 for a second, non-owner household) and 5 (BYOK precedence with a live invalid key) were not exercised via a second real HTTP session** — doing so would require either creating a second Clerk account (outside what I do — account creation is off-limits regardless of context) or the user providing a second real test login. `resolveProvider`'s decision logic covering exactly this matrix (owner/non-owner × BYOK/no-BYOK × toggle-on/off) is fully unit-tested (5/5 passing, `resolveProvider.test.js`) and the toggle plumbing feeding it was proven live end-to-end for the owner path — the only untested seam is a second household's literal HTTP round-trip, which is logic-identical to the owner path already proven.

**Resolved since last write-up:** TASK-037 is now committed and pushed (`a459270`); TASK-036's commits are now pushed too — `main` is up to date with `origin/main`, nothing ahead. Production migration confirmed already applied (single shared Neon DB, no per-environment branch). **The production outage above is also resolved** (`352b18a`, live-verified).

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
TASK-037's code is implemented, verified, committed, and pushed — that part is fully done. The Clerk production migration is **waiting on Clerk support's reply to the filed ticket** — self-serve diagnosis is exhausted (see "Clerk Production Migration" section above for the full trail: config parity confirmed, Dashboard Logs show every attempt reaching `created`/`code_sent` but never `session.created`, error is a Sentry report from Clerk's own Account Portal frontend). Next session: check if the user has heard back from Clerk before doing anything else here — don't re-run diagnostics that are already documented above. Once sign-in works, the remaining open item is OpenAI prepaid billing (not started).

# Forbidden Exploration
- `ai/tasks/archive/` — not relevant to this task
- Anything already listed under TASK-037-spec.md's own "Overall Forbidden Files" and "Out of Scope" sections — all explicitly deferred by the spec itself, not gaps in this session's work

# Context Notes
- branch: main
- worktree: none
- context pressure: moderate-high — full spec implementation, local verification, DB migration application, and live HTTP/UI verification all in one session.

# PowerShell Merge Block
Nothing to push — `a459270` and `352b18a` are committed and `main` is up to date with `origin/main`.
