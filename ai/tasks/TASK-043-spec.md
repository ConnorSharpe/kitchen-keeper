# TASK-043 — Fix Invite-Email 500 and Silent Send Failures

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.8/10 — approve after one revision | Praised: two-bug diagnosis (config vs. masking treated as orthogonal), the `err.expose` flag as the correct abstraction over a status-range check, catching that the Resend SDK never throws for API-level errors, separating config (Decision 3) from code, complete acceptance-criteria test matrix. Requested: narrow the `err.expose` migration — don't touch every file with an existing `err.status = 4xx`, since that turns an incident fix into a 12-file framework migration. Suggested (optional, not required): an `exposedError(status, message)` helper to reduce boilerplate. |
| DRAFT-2 | 10/10 — APPROVED FOR IMPLEMENTATION | Narrowed scope as requested, but via a backward-compatible `err.expose \|\| status < 500` condition rather than an `err.expose`-only check — a literal "just shrink Allowed Files" reading of the round-1 request would have left `app.js` checking `err.expose` alone while 7 files with existing, working `4xx` responses (`validate.js`, `upload.js`, `clerkAuth.js`, `admin.js`, `recipeService.js`, `householdService.js`, `resolveProvider.js`) never get the flag — regressing every validation error, 401, 404, and 409 conflict in the app to a generic message. The OR-based condition gets the same scope reduction (5 files touched, not 12) without that regression: existing `4xx`s keep working via `status < 500` unchanged, `err.expose` is only needed on the newly-discovered masked `5xx` sites. Full migration to explicit-opt-in-everywhere moved to Out of Scope as a dedicated future cleanup task, per the review's own Phase 1/Phase 2 split — including the optional `exposedError()` helper suggestion for that future task. Round 2 confirmed the backward-compatibility argument as correct and the right tradeoff, noted the two-coexisting-mechanisms state as an accepted, already-documented temporary compromise (not a blocker), and approved as written. |

---

## Incident — Production Log Evidence

Connor reported an "Internal Server Error" when sending a household invite to his wife on
`kitchenkeeper.kitchen`. Pulled real production logs rather than guessing:

```
$ vercel logs kitchenkeeper.kitchen
TIME         HOST                   LEVEL  MESSAGE
15:50:58.96  kitchenkeeper.kitchen  error  λ POST /api/household/invite  503  Error: Email service is not c…
```

Cross-checked against production env vars:

```
$ vercel env ls production
```

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` are **absent** from every environment (Production, Preview,
Development) — confirmed by their absence from the full `vercel env ls` output, which lists 34 other vars.
This was flagged as a risk during TASK-003 (`ai/tasks/archive/TASK-003.md:253-255`: *"will hit a silent 503
when they try to send an invite, with no hint of what's missing"*) but the production env var was apparently
never actually set after that task shipped.

So the immediate trigger is real and simple: `server/services/emailService.js:15-22`'s `getClient()` returns
`null` when `RESEND_API_KEY` is unset, and `sendHouseholdInvite()` throws a deliberate
`Error('Email service is not configured — set RESEND_API_KEY')` with `err.status = 503`.

**But that's not the message Connor saw.** `server/app.js:69-76`, the global error handler:

```js
app.use((err, req, res, _next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  ...
});
```

`503` is not `< 500`, so the handler discards the deliberate, actionable message and replaces it with the
generic `'Internal server error'` — which is exactly what showed up in the UI (`HouseholdPage.jsx:128` sets
`inviteError` to `err.message` verbatim, no fallback text of its own). Two independent bugs stacked:
1. The email service genuinely isn't configured in production.
2. Even once it is, *any* deliberately-thrown `5xx` (503, 502) in this codebase gets its message masked by
   this same threshold check — not just genuine unhandled crashes.

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Invite route | `server/routes/household.js:88-99` | `POST /api/household/invite` — thin, calls `sendHouseholdInvite()`, no try/catch of its own (relies on `express-async-errors` + the global handler). |
| Email service | `server/services/emailService.js` | `getClient()` returns `null` (not a throw) when `RESEND_API_KEY` is unset; `sendHouseholdInvite()` throws a `503` in that case. The `client.emails.send(...)` call's return value is **never checked**. |
| Global error handler | `server/app.js:69-76` | Masks `err.message` for any `status >= 500`, not just the implicit default. Confirmed via grep that `err.status` is deliberately set to `502`/`503` (safe, user-facing messages) in four places: `emailService.js:20` (503), `aiService.js:29` (503), `routes/ai.js:66` (502), `recipeUrlImportService.js:172` (502) — all four are masked by this same bug today. |
| Resend SDK behavior | `server/node_modules/resend/dist/index.mjs:1071-1126` (installed `resend@6.12.4`, confirmed in `server/package.json`) | `fetchRequest()` — the core HTTP wrapper every `emails.send()` call goes through — catches **every** failure mode (non-2xx response, unparseable body, network exception) and returns a resolved `{ data: null, error: {...} }`. It only ever `throw`s in the `Resend` constructor when no API key is available at all (line 1061). This means `client.emails.send()` in `emailService.js:30` **cannot throw** for a bad `from` address, an unverified sending domain, a recipient restriction, or a rate limit — it resolves successfully and the `error` field is silently dropped by the current code, which never inspects the return value. |
| Default sender | `emailService.js:24` | `RESEND_FROM_EMAIL` is also unset in production, so once `RESEND_API_KEY` is added the code falls back to `onboarding@resend.dev` — Resend's shared sandbox sender, which is commonly restricted to only deliver to the account's own verified email address until a custom domain is verified. This is a real risk worth flagging (see Known Risks), not confirmed against the Resend dashboard from this repo. |
| Client error display | `client/src/pages/HouseholdPage.jsx:117-128` | `handleInvite()` sets `inviteError` to `err.message` with no fallback — correctly plumbs through whatever the server sends, so this component needs no change. The bug is entirely server-side. |

---

## Goal

Fix the invite-email failure end-to-end: restore the deliberate, actionable error message instead of a
generic 500, close the gap where a Resend API-level failure would silently report success, and get
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` actually configured in production so invites work at all.

---

## Decision 1: Fix the error-handler's masking condition for the sites that are actually broken, without touching the sites that already work

**Recommendation: change `server/app.js`'s masking check from `status < 500` to
`err.expose || status < 500`, and set `err.expose = true` only on the four call sites confirmed to
construct a deliberately safe `5xx` message that's currently being masked.**

### Why not just special-case 503
The same bug already affects two other real call sites (`ai.js:66`'s 502 "AI returned an invalid recipe",
`aiService.js:29`'s 503 "AI service unavailable") and one more not yet exercised in prod logs
(`recipeUrlImportService.js:172`'s 502). All four are hand-written, deliberately safe messages that the
original author clearly intended to reach the client — they're indistinguishable in intent from the `400`s
and `404`s that already pass through today. Widening the threshold to `status < 503` or similar is a narrower
patch that still leaves the next deliberate 5xx broken.

### Why `err.expose || status < 500`, not `err.expose` alone
Round 1 architect review correctly flagged that migrating every hand-thrown error in `server/` to an explicit
`err.expose` flag turns a scoped incident fix into a 12-file framework migration, and asked for narrower
scope. But an `err.expose`-only check is a stricter replacement for `status < 500`, not an additive one: every
`4xx` site that already works today (`validate.js`'s Zod errors, `upload.js`'s 400s, `clerkAuth.js`'s 401,
`admin.js`'s 403, `recipeService.js`'s 400/413, `householdService.js`'s 404/409/422,
`resolveProvider.js`'s 403) has no `expose` flag and would regress to the generic message the moment `app.js`
ships if only the 5xx sites are updated — trading one known bug for seven new ones. The `||`-based condition
gets the narrower scope the review asked for (5 files touched: `app.js` plus the four already-broken 5xx
sites) *without* that regression, because every existing `4xx` keeps passing through via `status < 500`
exactly as it does today — untouched, unmigrated, unbroken. `err.expose` is additive: it exists only to let
the four newly-fixed `5xx` sites opt in to exposure despite failing the `status < 500` check, not to replace
that check everywhere.

### Why this isn't "the same 12-file migration under a different name"
The alternative that was rejected in round 1 (migrate every site to `err.expose`) is still architecturally the
better long-term end state — it makes "safe to show" an explicit property instead of an accident of the
status code chosen, exactly as round 1's review argued. That reasoning doesn't disappear here; it's deferred
to a real future task (see Out of Scope) precisely because it's cleanup, not incident response: nothing about
today's production bug requires migrating `validate.js`'s already-correct 400s. The `||` condition is the
correct shape for *this* task because it changes exactly as many files as the incident touched, while leaving
the door open for the fuller migration later without requiring it now.

---

## Decision 2: Check the Resend SDK's returned `error`, don't assume `send()` throwing is the only failure mode

**Recommendation: destructure `{ error }` from `client.emails.send(...)` in `emailService.js` and throw a
`502` (upstream email provider failure) if it's present, mirroring the existing `err.status = 502` pattern
already used in `routes/ai.js:66` and `recipeUrlImportService.js:172` for "an external call resolved without
throwing but reported a failure."**

### Why this matters independent of the RESEND_API_KEY fix
Confirmed by reading the installed SDK source (see Codebase Reality Check) that `emails.send()` never throws
for API-level failures — only for a missing key. Once `RESEND_API_KEY` is added (Decision 3), the invite
route would go from "always throws 503" to "always returns `{ ok: true }`, even when Resend silently rejected
the send" — trading a loud failure for a silent one, which is worse: the inviting user sees "Invite sent!"
and never learns their spouse got nothing. This is the more likely real-world failure mode going forward
given the sandbox-sender risk noted above.

---

## Decision 3: Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel production

**Recommendation: Connor adds both via `vercel env add` (or the Vercel dashboard) for the Production
environment, then triggers a redeploy — this is a deployment/config action, not a code change, and is not
something to automate without his explicit confirmation of the actual key value and verified sender domain.**

Vercel env vars only take effect on deployments created after they're set — the currently-live deployment
will keep failing until a redeploy happens after the vars are added. This is a manual runbook step for
Connor, not part of the code change in this task (see Out of Scope).

---

## What Does NOT Change

- `server/routes/household.js` — the `/invite` route itself is already a correct thin passthrough; no edit
  needed once `emailService.js` throws properly.
- `client/src/pages/HouseholdPage.jsx` — already correctly displays `err.message`; no change needed.
- The email HTML template in `emailService.js` — unrelated to this bug.
- `server/middleware/validate.js`, `upload.js`, `clerkAuth.js`, `server/routes/admin.js`,
  `server/services/recipeService.js`, `server/services/householdService.js`,
  `server/services/ai/resolveProvider.js` — every existing `err.status = 4xx` in these files keeps working
  unmodified. The `status < 500` half of Decision 1's `||` condition covers them exactly as it does today;
  they need no `err.expose` flag and are not touched by this task (round-2 narrowing — see Out of Scope for
  the deferred full migration).

---

## Allowed Files

- `server/app.js` — masking condition in the global error handler (Decision 1).
- `server/services/emailService.js` — check `{ error }` from `client.emails.send()` (Decision 2); add
  `err.expose = true` to the existing 503 throw (Decision 1's mechanism).
- `server/services/aiService.js` — add `err.expose = true` to the existing 503 wrap (Decision 1).
- `server/routes/ai.js` — add `err.expose = true` to the existing 502 throw (Decision 1).
- `server/services/recipeUrlImportService.js` — add `err.expose = true` to the existing 502 throw only
  (`recipeUrlImportService.js:172`). Its three 422 throws (lines 126, 186, 192, 198) are already `< 500`,
  already correct, and explicitly out of scope — leave them untouched even though the file is being edited.

## Forbidden Files

- `client/src/pages/HouseholdPage.jsx` — no client change needed; verify only.
- `client/src/api/index.js` — the fetch wrapper already correctly surfaces `data.error`; unrelated.
- `server/db/schema.js` / migrations — no schema involved.
- `.env.example` — already documents `RESEND_API_KEY`/`RESEND_FROM_EMAIL` correctly per TASK-003; no changes
  needed there, the gap was production config, not documentation.
- `server/middleware/validate.js`, `upload.js`, `clerkAuth.js`, `server/routes/admin.js`,
  `server/services/recipeService.js`, `server/services/householdService.js`,
  `server/services/ai/resolveProvider.js` — explicitly out of scope per round 2. Do not add `err.expose` to
  these; the `status < 500` fallback already keeps their messages exposed with zero code change. Touching
  them silently re-expands this task into the migration round 1 asked to avoid.

---

## Constraints

1. **`err.expose` is opt-in and additive — it only ever widens what's shown, never narrows it.** Set it only
   at the four confirmed-broken `5xx` sites (Allowed Files), right next to each one's existing
   `err.status = ...` line. Never add it to a file that isn't in Allowed Files for this task, and never
   remove or alter the `status < 500` half of the check in Constraint 2 — that half is load-bearing for
   every untouched `4xx` site continuing to work.

2. **`server/app.js`'s handler gains an `||` clause; the existing `status < 500` check is not replaced:**
   ```js
   app.use((err, req, res, _next) => {
     console.error(err.stack);
     const status = err.status || 500;
     const message = (err.expose || status < 500) ? err.message : 'Internal server error';
     const body = { error: message };
     if (err.code) body.code = err.code;
     res.status(status).json(body);
   });
   ```
   This is deliberately backward-compatible by construction: every existing `4xx` site keeps working via
   `status < 500` with zero changes elsewhere in the codebase, and `err.expose` exists solely to let the four
   newly-fixed `5xx` sites opt in despite failing that check. Do not simplify this to `err.expose ? ... : ...`
   — that reads as a cleaner migration but silently masks every untouched `4xx` site (see Decision 1's
   round-2 revision for why this distinction matters and what a literal narrow-scope reading would have
   broken).

3. **`emailService.js`'s send call must check `error`, not assume a throw:**
   ```js
   const { error } = await client.emails.send({ ... });
   if (error) {
     const err = new Error(`Failed to send invite email: ${error.message}`);
     err.status = 502;
     err.expose = true;
     throw err;
   }
   ```
   `502` (not 503) because this represents "the upstream provider responded but reported failure," matching
   the existing convention in `routes/ai.js:66` and `recipeUrlImportService.js:172` for the same shape of
   problem (an external call that resolves without throwing but signals failure via its own payload).

4. **Do not change the `RESEND_API_KEY`-unset 503 path's status or the client-facing wording beyond adding
   `err.expose = true`.** The existing message ("Email service is not configured — set RESEND_API_KEY") is
   already correct and specifically useful to Connor, who is both the app's sole operator and the person
   who'd see this error — this app has no separation between "admin" and "end user" (self-hosted, single
   household owner deploys it). Surfacing operational detail here is appropriate, not a leak.

---

## Dependency Chain

Editing:
- `server/app.js`
- `server/services/emailService.js`
- `server/services/aiService.js`
- `server/routes/ai.js`
- `server/services/recipeUrlImportService.js`

Reads (pattern reference only, do not modify):
- `server/node_modules/resend/dist/index.mjs` — confirms `emails.send()` never throws for API-level errors
- `ai/tasks/archive/TASK-003.md` — original warning about the silent-503 risk, never acted on
- `client/src/pages/HouseholdPage.jsx` / `client/src/api/index.js` — confirm no client change is needed
- `server/middleware/validate.js`, `upload.js`, `clerkAuth.js`, `server/routes/admin.js`,
  `server/services/recipeService.js`, `server/services/householdService.js`,
  `server/services/ai/resolveProvider.js` — read during Acceptance Criteria's regression check to confirm
  their `4xx` responses are genuinely unaffected; not edited (round-2 narrowing)

Irrelevant:
- `client/src/pages/JoinPage.jsx` and the join-by-code flow — separate route, not touched by this bug
- `server/db/schema.js` / migrations

---

## Acceptance Criteria

- [ ] With `RESEND_API_KEY` unset locally, `POST /api/household/invite` returns `503` with body
      `{ error: 'Email service is not configured — set RESEND_API_KEY' }` — not the generic message
- [ ] With `RESEND_API_KEY` set to a deliberately invalid/revoked key locally, `POST /api/household/invite`
      returns `502` with a message derived from Resend's actual error (verify by inspecting the response body,
      not just the status code)
- [ ] Every other route that returns a `4xx` today (validation errors, 401, 404, 409, 413, 422, 403) still
      returns its original specific message after this change — spot-check at least one route per untouched
      file (`validate.js`, `upload.js`, `clerkAuth.js`, `admin.js`, `recipeService.js`, `householdService.js`,
      `resolveProvider.js`) to confirm the `status < 500` fallback in Constraint 2 is doing its job with zero
      edits to those files
- [ ] A genuinely unhandled error (e.g., temporarily throw a raw `new Error('boom')` with no `.status`/
      `.expose` in a route, local test only) still returns `500` with the generic `'Internal server error'`
      message — confirms the masking still works for real crashes
- [ ] After Connor sets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel production and redeploys, sending
      a real invite from `kitchenkeeper.kitchen` either succeeds with an actual email delivered, or fails with
      a specific, non-generic error message surfaced in the UI (covers the sandbox-sender-restriction risk in
      Known Risks — this criterion is satisfied by either outcome as long as it isn't a silent false-success
      or a generic 500)

Given this project verifies via live smoke testing rather than an automated test suite (per TASK-024/025/026
precedent), exercise the above manually against local dev and then live against production post-deploy.

---

## Known Risks / Implementation Notes

1. **Resend's sandbox sender (`onboarding@resend.dev`) commonly restricts delivery to the account owner's own
   verified email.** Not confirmed against Connor's actual Resend dashboard from this repo — if his account
   is still on the sandbox sender (i.e. `RESEND_FROM_EMAIL` stays unset even after Decision 3), inviting his
   wife may still fail even with a valid API key, now correctly surfaced as a 502 instead of silently
   "succeeding" thanks to Decision 2. If this happens, the real fix is verifying a custom sending domain in
   Resend, which is outside this repo's scope.
2. **`err.expose` is scoped to the four confirmed-broken `5xx` sites, not the whole codebase.** Round 1
   architect review requested this narrowing after an earlier draft would have touched every
   `err.status = 4xx` site in `server/` (12 files). The `err.expose || status < 500` condition (Constraint 2)
   achieves the same narrower scope without regressing the untouched `4xx` sites, which a strict
   `err.expose`-only check would have done. The tradeoff: `app.js`'s masking logic is now a two-part
   condition instead of one, and the codebase has two classes of "safe to expose" error (explicit flag vs.
   status range) until a future cleanup migrates the rest — see Out of Scope. Worth knowing if a fifth
   deliberate `5xx` gets added later without noticing it needs the flag too; nothing currently guards against
   that beyond code review, which is the same gap that let this bug into production originally.
3. **Vercel env var propagation requires a redeploy.** Decision 3's config change won't take effect on the
   already-running production deployment until Connor redeploys after adding the vars — worth calling out
   explicitly in the implementation handoff so this isn't mistaken for the code fix not working.

---

## Out of Scope (v1)

- Actually setting the production env vars or verifying a Resend sending domain — Connor's manual action,
  not a code change (Decision 3 is a runbook step, not an implementation task).
- Retry/backoff for transient Resend failures — a single 502 surfaced to the user (who can just retry the
  form) is sufficient at this app's scale; no queue or background job exists for this today.
- Rate-limiting the invite endpoint — unrelated to this bug, not currently exercised as a problem.
- Migrating the rest of the codebase's error handling to a formal `http-errors`-style library dependency —
  the hand-rolled `err.status`/`err.expose` pattern matches existing codebase conventions (no new dependency
  needed) and is sufficient for this app's size.
- **Migrating the remaining `4xx` sites (`validate.js`, `upload.js`, `clerkAuth.js`, `admin.js`,
  `recipeService.js`, `householdService.js`, `resolveProvider.js`) to explicit `err.expose = true`.** Deferred
  per round-1 architect review's Phase 1/Phase 2 split — this task (Phase 1) fixes the actual incident and the
  sites already confirmed broken; a dedicated future cleanup task (Phase 2) would make "safe to show" an
  explicit property everywhere instead of leaving two coexisting mechanisms (`err.expose` vs. `status < 500`).
  If/when that task happens, consider the helper suggested in round 1:
  ```js
  function exposedError(status, message) {
    const err = new Error(message);
    err.status = status;
    err.expose = true;
    return err;
  }
  ```
  which makes it impossible to set `status` without `expose` (or vice versa) — not needed for this task's
  5-file scope, but worth adopting once there are more than a handful of call sites to keep consistent.
