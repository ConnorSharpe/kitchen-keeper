# TASK-042 — Public-Launch Security Hardening, Dependency Cleanup, and Pre-Launch Friction Fixes

Version: DRAFT-3 (post-architect review, round 2) — **APPROVED FOR IMPLEMENTATION**

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-2 | 9.95/10 — approved, two optional non-blocking tweaks | **Adopted (1)**: Part A's `overrides` rationale gains an explicit removal condition — pinning a floor is not meant to be permanent. **Partially adopted (2), by design rather than by default**: the review's core point — don't let a README assert an "open sign-up" *policy* that could silently go stale — is valid and adopted for tone. But the review's two suggested replacements (`"Authentication is provided by Clerk"` / `"Create an account using the application's sign-up flow"`) would delete the one piece of information that specific line exists to convey: the README's "Live Demo" section's entire job is telling a visitor whether clicking the link gets them in, which the Tech Stack table's Auth row (also being corrected in this same Part) doesn't answer — restating "Clerk" twice in two different sections isn't more accurate, just more redundant. Kept the substantive, purpose-relevant fact (registration is currently unrestricted) but dropped the customer-service-toned framing (**"contact Connor with questions"**) the review's underlying objection was really about — landing on `"Sign-up is currently unrestricted — create an account via the link above."`, a present-tense description of current state rather than a narrated promise. The doc-drift risk the review raised is the same one DRAFT-2 already built a mitigation for (the existing note that this line gets a follow-up edit once Part D's registration-posture decision lands) — not a new gap this round exposed. |
| DRAFT-1 | 9.7/10 — approve after one revision | **Adopted (all five required changes)**: (1) Part A rewritten from a `npm audit fix` instruction into deterministic target versions — verified with `npm audit fix --dry-run` in both `server/` and `client/` (confirmed no tracked files were touched by the dry run itself) rather than guessed, and pinned via `package.json` version bumps for direct dependencies plus a new `overrides` block for the transitive ones, so a future implementer gets the same resolution regardless of registry drift — a stronger mechanism than the review's own literal suggestion ("Upgrade X to >=Y" in prose), which wouldn't have survived transitive-dependency drift either. (2) Part F's diagnostics expanded to a structured log line (request ID, household ID, user ID, Neon query duration, Clerk lookup duration, whether the Clerk timeout fired) instead of a bare catch-and-log. (3) Part C's rate limiter now goes through a new shared `createRateLimiter()` factory, and `aiRateLimit.js` is refactored to use it too — adopted, with an explicit added risk note (see Known Risks) that this touches already-shipped, working code, not just additive new code, and a new verification step confirming AI rate-limiting behavior is unchanged after the refactor. `aiRateLimitKeyGenerator.js` and its existing test are left untouched — only the `rateLimit({...})` construction boilerplate (the two constant header options, the message-wrapping) was actually duplicated, so that's all the factory extracts. (4) Part E now specifies exact neutral wording ("Authentication provided by Clerk") to ship immediately, decoupled from Part D's timeline, rather than leaving the wording to be decided later. (5) Completion criteria split into two explicit tiers — "Implementation Complete" (Parts A/B/C/E/F, no hardware dependency) and "Release Validation Complete" (Parts D/G) — so physical-device availability no longer blocks marking the code-level work done. **Also adopted (minor comments, all low-cost)**: `npm ls <pkg>` added alongside grep in the dead-dependency verification step (checked first whether this codebase's dynamic-import usage could have hidden a live reference from grep — confirmed zero dynamic `import()` calls of any of the six packages being removed, so the grep-based claim already held; the `npm ls` check is added as free additional insurance, not because a gap was actually found); `npm dedupe` added to Part B's post-install step; Part D's OpenAI billing item reworded from "recommended" to "confirmed" as a precondition. |

---

## Origin

Connor asked Claude to audit the whole project outside the usual spec workflow — "are we ready to go
public, are there security flaws, will there be friction" — and to back findings with web research rather
than assumption. This spec turns that audit's "needs action" and "friction" findings into one task. Every
claim below was verified directly during that audit: by reading the actual code (not the docs describing
it), running `npm audit` in all three workspaces, scanning the full git history for committed secrets, and
querying the live production site (`kitchenkeeper.kitchen`) from the browser console. Bundled here as one
task, split into independently-shippable parts, following this project's own pattern (TASK-041) for
multi-part sessions that share a single "make this app safe/clean to hand to strangers" motivation.

## Current State (confirmed by reading the code, not assumed)

### 1. Registration is unrestricted at the Clerk layer (external, non-code)

`server/app.js` mounts `clerkMiddleware()` with no additional gate. The `INVITE_CODE` mechanism documented
in `README.md:26` ("Invite code required — unauthorized registrations are blocked") and `.env.example:22`
is dead: grepping the entire `server/` tree for `INVITE_CODE` returns zero matches outside `.env.example`
and README — no route, middleware, or service reads it. `ai/tasks/TASK-037-spec.md:28` already confirmed
this in its own "Current Behavior" section: *"The legacy `INVITE_CODE` registration gate ... is dead code
left over from a pre-Clerk auth system ... Registration openness today is entirely a Clerk Dashboard
setting, outside this repo."* That same spec's Deployment Prerequisites (`TASK-037-spec.md:795`) called out
reviewing Clerk's sign-up settings (email verification, bot/CAPTCHA, invite-only/waitlist mode) *before
going public* — nothing in `ai/tasks/` or `ai/handoffs/CURRENT_STATE.md` through TASK-041 confirms this was
ever done.

### 2. OpenAI billing has no hard spend cap in code (external, non-code)

`server/services/ai/resolveProvider.js:25` falls back to `process.env.OPENAI_API_KEY` (the platform key)
whenever a household has no BYOK key and `publicAiAccessEnabled` is `true`. `TASK-037-spec.md:794` flagged
switching the OpenAI org to prepaid credits with auto-recharge off as a prerequisite *"before the first time
`public_ai_access_enabled` is set to `true` in production"* — same spec's own reasoning: 2026 OpenAI budget
thresholds are notification-only and don't stop requests. Same as above, no later handoff confirms this was
done.

### 3. Dependency vulnerabilities — exact resolvable versions, confirmed via dry run

Full `npm audit` results (including dev dependencies), with `npm audit fix --dry-run` run in both `server/`
and `client/` to get the *exact* versions npm resolves today — not a re-run-later `npm audit fix` command,
which could resolve differently once registry/advisory state moves on. Dry run confirmed safe: `git status`
showed zero file changes from either dry run.

**Server — non-breaking, exact versions from the dry run:**

| Package | Installed | Target | Direct or transitive |
|---|---|---|---|
| `express` | 4.19.2 | 4.22.2 | direct (`^4.19.2` in `server/package.json` already permits this) |
| `morgan` | 1.10.0 | 1.11.0 | direct (`^1.10.0` does **not** permit this — needs a `package.json` bump) |
| `qs` | 6.14.2 | 6.15.3 | transitive (via express) |
| `body-parser` | 1.20.4 | 1.20.6 | transitive (via express) |
| `form-data` | 4.0.5 | 4.0.6 | transitive |
| `brace-expansion` | 2.1.0 / 5.0.5 | 2.1.2 / 5.0.8 | transitive (two separate ranges in the tree) |
| `side-channel` | 1.1.0 | 1.1.1 | transitive |
| `hasown` | 2.0.3 | 2.0.4 | transitive |
| `on-finished` | 2.3.0 | — (removed) | transitive, dropped entirely by the resolution |

**Client — non-breaking, exact versions from the dry run:**

| Package | Installed | Target | Direct or transitive |
|---|---|---|---|
| `react-router-dom` | 6.30.3 | 6.30.4 | direct (`^6.23.1` in `client/package.json` already permits this, but bump the floor anyway — see Part A) |
| `react-router` | 6.30.3 | 6.30.4 | transitive (via react-router-dom) |
| `postcss` | 8.5.10 | 8.5.22 | transitive |
| `@babel/core` | 7.29.0 | 7.29.7 | transitive (via `@vitejs/plugin-react`) |
| `nanoid` | 3.3.11 | 3.3.16 | transitive |
| (six more `@babel/*` helper packages) | various | 7.29.7 | transitive, resolve automatically once `@babel/core` moves |

**Only fixable via a semver-major bump (`npm audit fix --force`) — out of scope, see below:**

| Workspace | Package | Installed → Fix | Advisory |
|---|---|---|---|
| server | `@vercel/blob` | 0.27.3 → 2.6.1 | high — `undici` HTTP smuggling / unbounded decompression / WebSocket DoS (transitive) |
| server | `drizzle-orm` | 0.29.5 → 0.45.2 | pulled in by the same audit run; not itself the flagged CVE, but blocks a fully-clean audit tree |
| server | `drizzle-kit` (dev) | 0.21.4 → 0.31.10 | moderate — `esbuild`/`@esbuild-kit` dev-server request forgery |
| client | `vite` (dev) | 5.x → 8.1.5 | moderate — `esbuild` dev-server request forgery |
| server | `uuid` | 9.0.1 → 14.0.1 | moderate — buffer bounds check (dependency is dead, see Part B: remove instead of upgrading) |

### 4. Dead/stray dependencies inflating the vulnerability surface

- **Root `package.json`**: lists `@clerk/nextjs` as a dependency. Grepping the entire repo (excluding
  `node_modules`) for `@clerk/nextjs` — both static imports and dynamic `import(...)` calls — matches only
  `package.json`/`package-lock.json` themselves. This project has no Next.js code (it's Express + Vite). This
  single stray line pulls an entire unused Next.js install (and its own high-severity CVEs — Server Actions
  SSRF/DoS, cache confusion) into `node_modules`, which will falsely alarm anyone who scans the repo.
- **`client/package.json`**: lists both `@clerk/clerk-react` and `@clerk/react`. Grep (static and dynamic)
  confirms every client import uses `@clerk/clerk-react` (`App.jsx:9`, `AuthContext.jsx:9`, `JoinPage.jsx:3`,
  `main.jsx:3`) — `@clerk/react` has zero importers of either kind.
- **`server/package.json`**: four dead dependencies, all traceable to the pre-Clerk auth system, none
  referenced via static or dynamic import anywhere in the repo:
  - `jsonwebtoken` — sole consumer is `server/middleware/auth.js`, itself marked dead
    (`auth.js:1`: *"DEPRECATED — replaced by clerkAuth.js (TASK-016B). Kept for rollback only. Delete after
    Clerk is stable in production."*). Grep for `requireAuth` across `server/` matches only that same file —
    zero routes import it.
  - `bcrypt` — zero matches anywhere in `server/` source. Clerk owns password handling entirely now.
  - `uuid` — zero import matches in `server/` source (`server/routes/ai.js` already uses `node:crypto`'s
    `randomUUID()` directly, per the Electron-migration-spec-era cleanup).
  - `cookie-parser` — `server/app.js`'s only use is `app.use(cookieParser())`; the only route-level reader
    of `req.cookies` anywhere in `server/` is the same dead `auth.js`.

### 5. No rate limit on `/api/household/join`

`server/routes/household.js:93` accepts a join code with only Zod shape validation (`joinSchema`), no rate
limiting — unlike `/api/ai/*`, which has had `aiRateLimit` applied at the router level since TASK-037
(`server/routes/ai.js:22`). Join codes are `randomBytes(4).toString('hex')`
(`server/services/householdService.js:15`) — 32 bits of entropy, roughly 4.3 billion combinations, so
brute-forcing one is impractical even unthrottled. Still, every other write-ish authenticated endpoint in
this app that resembles a guessable secret gets a rate limit; this one doesn't, for no stated reason.

### 6. Stale README

- `README.md:20` still lists Auth as *"JWT stored in `httpOnly`, `sameSite=strict` cookies"* — `server/app.js`
  shows `clerkMiddleware()` is what's actually mounted; there is no `jsonwebtoken`/cookie-based auth in the
  live app.
- `README.md:50` and `.env.example:22` both document `INVITE_CODE` as an active registration gate — dead, per
  item 1 above.
- `README.md:26`'s "Live Demo" line claims *"Invite code required — unauthorized registrations are
  blocked"* — not true today at the code level.

### 7. Unresolved intermittent 500 on `GET /api/household/members`

`ai/handoffs/CURRENT_STATE.md:96-98` (TASK-041's handoff) recorded: *"`GET /api/household/members` returned
a transient 500 during this session's local dev verification (reproduced once, then succeeded on retry with
no code changes). Not investigated ... Worth a look if it recurs on production."* Reading
`server/services/householdService.js:73-109`'s `getMembers()`: it calls `getById()` (a single Neon query)
then `lookupClerkUsers()`, which already wraps its own Clerk API call in a `Promise.race` timeout and
**catches its own errors**, returning an empty `Map` rather than throwing (`householdService.js:63-70`). So
whatever threw was either the Neon query itself or something else entirely — the existing code gives no
visibility into which, or how long either call took. Still unreproduced as of this writing.

### 8. Device-unverified mobile behavior carried forward from TASK-041

`ai/handoffs/CURRENT_STATE.md:85-91` (TASK-041's own "Known Risks," never revisited since):
- The iOS camera-picker fix (label-based file inputs, TASK-041 Part D) *"is based on published guidance and
  matches the user's original screenshot, but needs an actual iPhone check — not done this session (no
  physical device available)."*
- *"Mobile viewport for the full tour (steps 1–11 ...) was checked for the header offset only (Part C), not
  walked step-by-step on a mobile viewport."*

Separately, this audit confirmed via a live JS check against `kitchenkeeper.kitchen` in production that the
web app manifest (`client/public/manifest.json`), an active registered service worker with a fetch handler
(`client/public/sw.js`), and a secure (HTTPS) context are all present and correct — meeting every criterion
Chrome documents for Android installability (`name`, `start_url`, `display: standalone`, a 512×512 icon,
HTTPS, a service worker with a fetch handler). That check proves the *infrastructure* is platform-neutral,
already true today, needing no code change — but it cannot substitute for actually completing an install on
a physical Android device, which has never been done (mirroring the iOS gap above).

---

## Web Research Findings

- Chrome's installability bar (`web.dev/articles/install-criteria`, `developer.chrome.com/docs/lighthouse/pwa/installable-manifest`)
  requires exactly the manifest fields and service-worker behavior already present in this app — confirms
  item 8's live production check was checking the right things, not an incomplete proxy for real
  installability.
- 2026 SaaS pre-launch security guidance (Strobes' Web Application Pentesting Checklist, peiko.space's SaaS
  Security Checklist) consistently flags exactly two of this task's categories as the most common pre-launch
  misses for small teams: **unrestricted/ungated sign-up** and **stale or unpatched dependencies** — both
  are Parts of this spec, not novel concerns invented for this audit.

---

## Design

### Part A — Apply exact, pinned dependency version targets (all three workspaces)

Not `npm audit fix` — the specific versions from Current State item 3's tables, made durable against future
registry drift via `overrides`:

**`server/package.json`:**
```json
{
  "dependencies": {
    "express": "^4.22.2",
    "morgan": "^1.11.0"
  },
  "overrides": {
    "qs": "6.15.3",
    "body-parser": "1.20.6",
    "form-data": "4.0.6",
    "brace-expansion": "2.1.2",
    "side-channel": "1.1.1",
    "hasown": "2.0.4"
  }
}
```

**`client/package.json`:**
```json
{
  "dependencies": {
    "react-router-dom": "^6.30.4"
  },
  "overrides": {
    "postcss": "8.5.22",
    "@babel/core": "7.29.7",
    "nanoid": "3.3.16"
  }
}
```

After editing both files, run `npm install` in each workspace (root, `server/`, `client/`), then `npm dedupe`
in each to collapse any duplicate resolved trees the version bumps leave behind. Confirm with `npm audit` in
each workspace that only the Current State item 3 "out of scope" table's five packages remain flagged —
nothing else. `on-finished` (server) is expected to disappear entirely from `npm ls` — its dry-run resolution
was a removal, not a version bump, so no override entry exists for it.

**Why `overrides` instead of only bumping direct dependencies:** most of the vulnerable packages above
(`qs`, `body-parser`, `form-data`, `brace-expansion`, `side-channel`, `hasown`, `postcss`, `@babel/core`,
`nanoid`) aren't in either `package.json` today — they're pulled in transitively. Editing only the direct
dependencies (`express`, `morgan`, `react-router-dom`) leaves the transitive floor unpinned, so a future
`npm install` on a slightly different registry snapshot could re-resolve any of them back down to a
vulnerable range. `overrides` pins a floor npm won't resolve below, regardless of what any dependency's own
`package.json` requests — this is the actual mechanism that makes Part A reproducible over time, not just a
one-time fix.

**These overrides are a floor, not a permanent fixture.** Each one exists only because a direct dependency
(`express`, `@vitejs/plugin-react`, `tailwindcss`, etc.) hasn't yet bumped its own minimum to a patched
version. When a future upgrade of that direct dependency naturally requires a version at or above the
override's pinned floor, the override becomes redundant weight, not protection — remove it at that point
rather than leaving it in place indefinitely. A quick way to check during any future dependency bump:
temporarily delete an override, run `npm install`, and see whether the resolved version is still >= the
override's value on its own.

### Part B — Remove dead dependencies and dead code

1. Delete `server/middleware/auth.js` outright (confirmed zero importers — static or dynamic — Current
   State item 4).
2. `server/package.json`: remove `jsonwebtoken`, `bcrypt`, `uuid`, `cookie-parser`. Remove
   `import cookieParser from 'cookie-parser'` and `app.use(cookieParser())` from `server/app.js`.
3. Root `package.json`: remove the `@clerk/nextjs` dependency entirely (it has no build/runtime role — the
   app never imports it, statically or dynamically).
4. `client/package.json`: remove `@clerk/react` (unused; keep `@clerk/clerk-react`, which every import
   actually uses).
5. `.env.example`: remove the `INVITE_CODE` and `JWT_SECRET` rows entirely (both dead per item 1/4 above).
6. Run `npm install` in root, `server/`, and `client/` afterward to regenerate all three lockfiles in one
   pass, then `npm dedupe` in each (same as Part A, cheap insurance against duplicate vulnerable trees
   surviving the removal), then `npm run lint && npm test && npm run build` to confirm nothing implicitly
   depended on any of the above (see Known Risks re: `cookie-parser` specifically).

### Part C — Rate-limit `/api/household/join`, via a shared rate-limiter factory

New file `server/middleware/createRateLimiter.js` — the one piece of shared shape between this new limiter
and the existing `aiRateLimit`, factored out rather than copy-pasted:

```js
import rateLimit from 'express-rate-limit';

export function createRateLimiter({ windowMs, limit, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { error: message },
  });
}
```

`server/middleware/aiRateLimit.js` is refactored to use it (behavior unchanged — same `windowMs`, same
dynamic `limit` function reading `platformSettingsService`, same `aiRateLimitKeyGenerator` import, same
message text):

```js
import { createRateLimiter } from './createRateLimiter.js';
import { getPlatformSettings } from '../services/platformSettingsService.js';
import { aiRateLimitKeyGenerator } from './aiRateLimitKeyGenerator.js';

export const aiRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: async () => (await getPlatformSettings()).aiRateLimitMax,
  keyGenerator: aiRateLimitKeyGenerator,
  message: 'Too many AI requests. Please wait a few minutes and try again.',
});
```

`aiRateLimitKeyGenerator.js` and its existing test file are **not touched** — the factory only extracts the
`rateLimit({...})` construction boilerplate (the two constant header options, the message object shape),
which was the only part actually duplicated between the two limiters; the `limit` value, `windowMs`, and
`keyGenerator` all stay call-site-specific.

New file `server/middleware/joinRateLimit.js`:

```js
import { createRateLimiter } from './createRateLimiter.js';

export const joinRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many join attempts. Please wait a few minutes and try again.',
});
```

Keyed by `req.user.id` (the Clerk user), not `householdId` — a successful join changes the caller's
household mid-request, so a household-keyed limiter would be measuring the wrong thing across attempts.
Applied in `server/routes/household.js`: `router.post('/join', joinRateLimit, validate(joinSchema), ...)`.
The `limit: 10` value is a starting guess, same as `TASK-037-spec.md:839` called its own AI rate-limit
default — not derived from real traffic, open to revision (see Decisions Needed).

### Part D — Public-launch prerequisites checklist (non-code, tracked so it isn't lost again)

No code deliverable. Two external settings, both already identified by TASK-037 and never confirmed
resolved in any later handoff — tracked here specifically so that doesn't happen a second time:

1. **Clerk Dashboard**: decide and configure a sign-up posture before allowing public traffic — options
   include requiring email verification, enabling bot/CAPTCHA protection, and/or restricted
   (invitation-only or waitlist) mode. Now that Part B retires the last documentation trace of the old
   `INVITE_CODE` gate, this is the one remaining place registration can be controlled at all — worth an
   explicit decision rather than defaulting to "wide open" by omission.
2. **OpenAI org billing**: switch to prepaid credits with auto-recharge off. This must be **confirmed done**
   — not merely recommended — before `public_ai_access_enabled` is ever set `true` in production (it
   currently defaults `false` per `server/services/platformSettingsService.js:12` — confirm it's still
   `false` in production today as part of this check, and do not flip it to `true` until this item is
   confirmed).

Both require access to dashboards outside this repo — to be walked through with Connor directly (screen-share
or Connor confirms status in chat), not something a code diff can prove.

### Part E — README accuracy pass (ships independently of Part D)

- `README.md:20` Auth row: `JWT stored in httpOnly, sameSite=strict cookies` → `Authentication provided by
  Clerk`. Neutral, factually correct today, and doesn't need revisiting once Part D's registration-posture
  decision is made.
- Remove the `INVITE_CODE` row from `README.md`'s env var table and from `.env.example` (dead per Part B).
- Replace `README.md:26`'s invite-code claim with: *"Sign-up is currently unrestricted — create an account
  via the link above."* Present-tense description of current state, not a narrated promise — doesn't claim
  "invite-only" (false until Part D configures it) or make any promise about bot protection, and doesn't
  duplicate the Tech Stack table's Auth row above with a second mention of Clerk (the Live Demo section's job
  is telling a visitor whether the link gets them in, not re-stating the auth provider). If Part D later
  adds restricted/waitlist mode, this line gets a follow-up edit at that time — but Part E itself ships now,
  without waiting on Part D.

### Part F — Structured diagnostics for the intermittent `household/members` 500

Since Current State item 7 confirms the existing code can't distinguish "which layer threw, or how long
either call took," wrap `server/routes/household.js`'s `GET /` handler's call into `getMembers()` with
timing and structured logging — enough context to actually diagnose a recurrence, not verbose request/response
dumping:

```js
router.get('/members', async (req, res) => {
  const requestId = randomUUID().split('-')[0];
  const start = Date.now();
  try {
    const members = await householdService.getMembers(req.user.householdId, { requestId });
    res.json({ members });
  } catch (err) {
    console.error(
      `[kitchen-keeper] request_id=${requestId} function=getMembers ` +
        `householdId=${req.user.householdId} userId=${req.user.id} ` +
        `elapsedMs=${Date.now() - start} error=${err.message}`
    );
    throw err;
  }
});
```

`householdService.getMembers()` and its internal `lookupClerkUsers()` gain their own timing instrumentation
— logging the Neon query's duration separately from the Clerk lookup's duration, and explicitly noting
whether `lookupClerkUsers`'s existing `Promise.race` timeout fired (it already swallows that case into an
empty `Map`, per Current State item 7 — this only adds a log line at that catch site, it doesn't change the
fallback behavior). This follows the existing `requestId`-per-call pattern already used throughout
`server/services/aiService.js` and `recipeUrlImportService.js`, rather than inventing a new logging
convention. The existing global error handler (`server/app.js:71-78`) is unchanged — the client still
receives the same generic 500 it always did; this only adds server-side visibility.

### Part G — Real-device verification pass (Release Validation, not Implementation — see Decisions/Completion Criteria below)

1. **iOS Safari, physical device**: confirm TASK-041 Part D's label-based file-input fix
   (`RecipeUpload.jsx`, `ReceiptUpload.jsx`) actually opens the camera/photo library directly with no
   duplicate native action sheet — the exact gap TASK-041's own Known Risks left open.
2. **iOS Safari, physical device**: walk the full 11-step onboarding tour (post-barcode-removal count, per
   `ai/handoffs/CURRENT_STATE.md:44`) start to finish on an actual mobile viewport — TASK-041 only verified
   the header-offset fix in isolation, not the whole tour on mobile.
3. **Android Chrome, physical device**: complete an actual "Install app" / "Add to Home Screen" flow and
   confirm the installed PWA opens correctly. This audit confirmed the manifest/service-worker/HTTPS
   foundation is already correct in production (Current State item 8) — this step is the one thing a
   browser-console check can't cover: a real device completing a real install.

---

## Completion Criteria (two tiers, not one)

**Implementation Complete** — Parts A, B, C, E, F. All code-level, all shippable and verifiable without
physical hardware or external dashboard access. This is the bar for merging/deploying this task's code.

**Release Validation Complete** — Parts D and G, additionally. Both require something Claude cannot do
alone (Connor's dashboard access; a physical iPhone and Android device). "Ready to go public" as a claim
requires both tiers; "TASK-042 implemented" only requires the first. Do not hold the code-level work hostage
to hardware availability — track D/G separately in the handoff, explicitly marked open, if they aren't done
when A/B/C/E/F ship.

## Decisions Needed From Connor

1. **Registration posture for Part D** — pick one before configuring Clerk: (a) leave sign-up fully open,
   (b) require email verification only, (c) add bot/CAPTCHA protection, or (d) restricted/waitlist mode.
   No longer blocks Part E (which now ships with neutral wording regardless), but still needs an answer for
   Part D itself.
2. **Join rate-limit threshold (Part C)** — is `10` attempts per 15 minutes per user reasonable, or is there
   a legitimate reason a real user would retype a join code that many times in that window (e.g., reading it
   off a phone screen to another device)?

## Out of Scope

- **Upgrading `@vercel/blob` (0.27.3 → 2.6.1) and `drizzle-orm` (0.29.5 → 0.45.2)** — both fix real
  vulnerabilities (`undici` HTTP smuggling; the drizzle bump unblocks a clean audit tree) but are semver-major
  jumps touching the file-storage and database layers this app actively uses in production. `@vercel/blob`
  alone is jumping across two major version lines with no changelog review done yet; `drizzle-orm` is the
  ORM every route in this app depends on. Bundling either into a dependency-cleanup task risks exactly the
  scope creep this project's specs consistently avoid (TASK-041, TASK-036). **Recommended as its own
  follow-up task** once this one ships, with a dedicated migration/rollback plan and staging soak time before
  production — not something to rush alongside unrelated cleanup.
- **Upgrading `drizzle-kit`/`vite` past their audit-flagged versions** — both are dev-only build tooling
  (their vulnerabilities are dev-server request-forgery issues, not exploitable in the deployed app); lower
  urgency than anything touching runtime code. Can ride along with the follow-up task above rather than
  justify its own.
- **Building a new, custom registration-gating feature in application code** (e.g., reimplementing an
  invite-code check independent of Clerk) — Part D's checklist exhausts Clerk's own built-in options first;
  only worth revisiting if those prove insufficient for Connor's actual needs.
- **Investigating/fixing the `household/members` 500 beyond adding diagnostics (Part F)** — there is nothing
  to fix without a reproduction; guessing at a root cause from one unreproduced occurrence would be exactly
  the kind of speculative fix this project's specs avoid elsewhere.
- **A custom `beforeinstallprompt`-driven "Install this app" banner** — raised during the audit as a
  possible future UX polish for Android/desktop Chrome, not a "needs action" or "friction" finding (the app
  is already fully installable on both platforms today without it) — a candidate for its own future task if
  Connor wants it, not part of this cleanup.
- **A more general rate-limiter refactor beyond `createRateLimiter()`** — e.g., auto-discovering all routes
  needing limits, or a config-driven limiter registry. Two call sites (`aiRateLimit`, `joinRateLimit`)
  justify one thin factory; anything more is speculative for a codebase this size.
- **General performance/bundle-size review of any dependency changes in Part A.**

## Known Risks

- **Part B's `cookie-parser` removal** is based on grepping `server/` for `req.cookies` and finding only the
  file being deleted in the same part — but Clerk's own cookie-parsing is internal to `@clerk/express` and
  wasn't independently verified against `cookie-parser` specifically. Verify via Part B's own step 6
  (lint/test/build, then a real sign-in against a local dev server) before considering this safe, not by
  code-reading alone.
- **Part C's refactor touches already-shipped, working code (`aiRateLimit.js`), not just additive new
  code.** Low risk (the change is mechanical — extracting duplicated constants into a factory, no logic
  change to `windowMs`, `limit`, or `keyGenerator`), but it means Part C's verification must include
  confirming AI rate-limiting still behaves identically post-refactor, not just that the new join limiter
  works.
- **Part A's `overrides` pin a floor, not a ceiling, and aren't meant to be permanent** — they guarantee
  these transitive packages never resolve *below* the listed versions, but don't auto-update as new patches
  ship. Whoever next bumps a direct dependency that pulls one of these transitively should check whether it
  now satisfies the override on its own (per Part A's removal check) and delete the override at that point,
  rather than letting pins accumulate indefinitely alongside dependencies that no longer need them.
- **Part D is not shippable unilaterally** — it depends on Connor's direct access to the Clerk and OpenAI
  dashboards. Per the Completion Criteria split above, this no longer blocks Implementation Complete, but
  "ready to go public" as a whole claim still depends on it.
- **Part C's threshold is an unvalidated guess**, same caveat TASK-037 gave its own AI rate limit default —
  flagged explicitly in Decisions Needed rather than silently picked.
- **Part F adds logging, not a fix** — if the 500 recurs, this task's scope ends at "now we can see why";
  actually fixing whatever it turns out to be is separate follow-up work.

## Verification Steps

**Implementation Complete (Parts A, B, C, E, F — no hardware/dashboard dependency):**

1. `npm audit` in root, `server/`, and `client/` — confirm zero vulnerabilities remain other than the five
   packages in Current State item 3's "out of scope" table (`@vercel/blob`, `drizzle-orm`, `drizzle-kit`,
   `vite`, `uuid` — the last one gone entirely per Part B, not upgraded).
2. `grep -rE "import\s|require\(" --include=*.js` (or equivalent) across the repo for
   `@clerk/nextjs|@clerk/react|jsonwebtoken|bcrypt|cookie-parser` returns zero matches outside
   `package-lock.json` files; `grep -rn "'uuid'" server --include=*.js` returns zero matches. Additionally,
   `npm ls @clerk/nextjs jsonwebtoken bcrypt uuid cookie-parser` from repo root and `npm ls @clerk/react`
   from `client/` each report the package as not installed — confirms removal took effect in the resolved
   tree, not just in `package.json`.
3. `npm run lint && npm test && npm run build` pass clean in all three workspaces after Parts A and B.
4. Fresh sign-in against a local dev server after Part B's `cookie-parser` removal — confirm Clerk auth still
   works end-to-end (session persists across a page reload).
5. Existing AI-route tests/behavior unchanged after Part C's `aiRateLimit.js` refactor — run
   `aiRateLimitKeyGenerator.test.js` and manually confirm the admin-tunable `aiRateLimitMax` setting still
   takes effect on `/api/ai/*` without a redeploy, exactly as before the refactor.
6. Attempt `/api/household/join` with a wrong code 11 times in under 15 minutes as the same user — confirm
   the 11th attempt is rejected with the rate-limit message, and that a correct code still succeeds for a
   *different* user in the same window (confirms per-user, not global, keying).
7. `README.md` and `.env.example` no longer mention `INVITE_CODE` or `JWT_SECRET`; Auth row accurately says
   "Authentication provided by Clerk"; the Live Demo line no longer claims an invite code is required.
8. Trigger a manufactured error in `getMembers()` (e.g., temporarily break the Neon query) and confirm Part
   F's logging surfaces a request-id-tagged, timing-annotated server-side log entry (household ID, user ID,
   elapsed time), while the client still receives the same generic 500 it always did (no client-facing
   behavior change, only server-side visibility).

**Release Validation Complete (Parts D and G — requires Connor's dashboard access and physical devices):**

9. Confirm Part D's two checklist items directly with Connor and record the outcome (decision made + action
   taken) in the handoff, even though neither has a code diff to point to.
10. Complete Part G's three device-verification steps (iOS camera picker, full iOS tour walkthrough, real
    Android install) and record the outcome in the handoff. Until all three are confirmed, the handoff must
    state "Implementation Complete, Release Validation pending" rather than implying the task is fully done.
