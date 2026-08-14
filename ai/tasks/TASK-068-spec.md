# TASK-068 — Wire Up Sentry (Errors + Logs); Remove the Closed Investigation's Diagnostic Scaffolding

Version: DRAFT-7 — approved by round-7 architect review (9.8–10/10, APPROVE / READY FOR IMPLEMENTATION).

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🟡 REQUEST CHANGES (8.7/10) | Praised the investigation-scaffolding-vs-durable-diagnostics split, the `logEvent()` API-preserving migration seam, the forbidden-file boundary, and the refusal to assert unverified Sentry SDK/serverless-flush behavior. **Required**: (1) an explicit telemetry data-classification/redaction contract; (2) resolve client Sentry-initialization ordering (ESM hoisting makes "first statement in `main.jsx`" not actually guarantee pre-import initialization); (3) a `logEvent()`-to-structured-log normalization/failure contract; (4) resolve — not just flag — duplicate client-error reporting, plus source-map/release verification. **Claude's assessment**: accepted all four, plus every non-blocking ask. Pushed back on two framings: the server-init "circular constraint" wasn't circular (re-verifying it, however, found DRAFT-1's plan would never have run in production at all — `server/index.js` is local-dev-only, fixed by wiring into `server/app.js` instead); and the duplicate-error concern was narrower than framed, since React error boundaries prevent the same render error from reaching `window.onerror` twice — kept the requested verification step regardless. |
| DRAFT-2 | 🟡 REQUEST CHANGES (9.1/10) | Confirmed the telemetry-boundary framing, the server entry-point fix ("stronger than what I originally requested... I consider this resolved"), and the deletion reasoning for `AuthStateLogger`/`SignFlowStateLogger` as correct. **Required (4 targeted changes)**: (P0-1) don't hard-code the client `<script>`-tag mechanism as a mandatory acceptance criterion when the spec itself says it needs verification — state the architectural property as the requirement, treat the mechanism as implementation-selected; (P0-2) `normalizeTelemetry()` can't semantically distinguish safe operational strings from forbidden application data (a generic recursive serializer can't tell "Authorization: Bearer ..." from an ordinary string) — replace detection-based normalization with a structural allowlist that constrains `data`'s *shape*, not its meaning; (P1-3) route both client and server Sentry calls through an explicit application-level wrapper (`safeSentryLog()`/`captureExceptionSafely()`) so failure-isolation criteria test *our* code's guarantee, not an assumption about the raw SDK's behavior; (P1-4) add a real multi-invocation/burst delivery test for the serverless-flush risk, not one single-error check. Also raised, not in the required list but addressed anyway: soften "Sentry's automatic route/breadcrumb instrumentation" as a deletion justification (the volume/cost argument alone is sufficient and stronger); clarify `isStandalonePwa()` isn't actually migrated; establish which system is authoritative for the now-four environment variables; establish release-identifier ownership explicitly; rename `clientErrors.js`'s attached-context fields so they can't be mistaken for server-side stack data; flagged (as "P0" in-body, though not in the final 4-item list) that free-form `err.message` content is a real residual gap no generic normalizer closes. **Claude's assessment**: accepted all four required changes and every non-blocking one, with one explicit partial-pragmatic call rather than full agreement — see below. |

**Claude's assessment of DRAFT-2's review, in detail**: the P0-2 catch is the most important one in either round — a generic normalizer genuinely cannot tell safe telemetry from sensitive free text, and DRAFT-2's design was importantly wrong to imply it could. Fixed by replacing it with a structural allowlist (§2.3a). On the `err.message` point specifically (raised as "P0" in DRAFT-2's review body, but omitted from that review's own final 4-item required list): the review offered two explicit options — prohibit free-form messages entirely (its stated preference), or permit them without a scrubbing guarantee. This spec takes a middle position, not full agreement with the stated preference: `message`-shaped string values stay permitted (they carry real debugging value and eliminating them would mean touching call sites this spec otherwise avoids touching), but are now subject to the same bounded-length rule every string gets under the new shape allowlist, and §7 states explicitly, as an accepted residual risk rather than a solved problem, that this bounds exposure without semantically scrubbing it. On §12's size-limit concern for `clientErrors.js`'s attached context: already resolved without new code — `clientErrors.js`'s existing `reportSchema` (`zod`) already caps `message`/`stack`/`componentStack` at 2000/8000/8000 chars before this code path ever runs; only the field-renaming half of that ask needed a change (§2.4a).

| DRAFT-3 | 🟢 APPROVE WITH MINOR CHANGES (9.5/10) | Confirmed every P0/P1 from rounds 1-2 resolved (client init ordering, the shape allowlist, both safe wrappers, the `server/app.js` production-entry fix, the burst-delivery test, source maps, duplicate-error verification, the deletion scope and its tightened justification, the `isStandalonePwa()` distinction, `clientErrors.js`'s field naming and already-adequate size limits). Explicitly declined to request another full round. **Six targeted edits requested**: (1) §2.0's verification gate should produce a recorded decision/evidence table, not just "do research first," so a future maintainer can see what was actually chosen and why, not just that a check happened; (2) give `safeSentryLog()`/`captureExceptionSafely()` an explicit never-throw/never-reject contract in words, not just an acceptance criterion implying one; (3) the circular-reference fallback in §2.3a is unnecessary and actually weakens the structural guarantee — a non-recursive validator (inspect only `data`'s own top-level keys, never descend into a value that's itself an object) can't be broken by circularity at all, since nothing ever traverses into it; (4) define the top-level contract for non-object `data` (`undefined` → `{}`, non-object → `{}`, not coerced) and the exact truncation rule (cut to precisely the max length, no ellipsis); (5) make client/server release-identifier equality an explicit byte-for-byte assertion, not "conceptually the same commit," since Sentry's release string isn't inherently identical to a raw git SHA; (6) add a mechanical acceptance criterion + grep list confirming `kk_debug_log`/`kk_debug_enabled`/`isDebugEnabled`/`setDebugEnabled`/`getLog`/`clearLog` are completely gone, not just superseded. Also requested, non-blocking: exempt `Sentry.init()` itself from the "always go through the wrapper" wording (SDK initialization necessarily is a direct call); explicitly guard against a convenience init preset silently enabling tracing/replay/profiling beyond the stated errors+logs scope; note that the shape allowlist governs only application-supplied `logEvent()` data, not Sentry's own automatic contextual metadata (URL, breadcrumbs, etc.); tighten criterion 11's "actionable event" wording to something unambiguous; make criterion 13's burst-test count exact rather than "the expected count." **Claude's assessment**: accepted all six required edits and every non-blocking one, applied as targeted edits rather than a rewrite per the review's own preference. No disagreements this round — every point identified a genuine gap or ambiguity rather than a debatable design choice. |
| DRAFT-4 | 🟡 REQUEST CHANGES (9.2/10) | Confirmed client init ordering, the telemetry allowlist design, the server production-entry fix, byte-for-byte release equality, and the deletion/scope discipline as solid — explicitly "much closer to approval than the earlier drafts." **Two required correctness fixes, not wording polish**: (P1-1) criterion 10 tested the wrong layer — DRAFT-4's failure-isolation test stubbed `safeSentryLog()`/`captureExceptionSafely()` *themselves* to throw, which only proves a caller has its own defensive try/catch, not that the wrapper absorbs a failing underlying SDK call; the real guarantee has to be tested by stubbing the raw Sentry operation (`Sentry.logger.info`/`Sentry.captureException`) to throw/reject and confirming the *real* wrapper absorbs it. (P1-2) `validateTelemetryShape()`'s "never throws on any input shape" claim is stronger than the implementation can actually guarantee — a throwing getter or a Proxy trap on an otherwise-ordinary-looking object could still throw during property enumeration/access, since the function still calls `Object.keys()`/property access even though it doesn't recurse; recommended weakening the claim to "ordinary values and plain data objects" (offered as the preferred fix) over adding defensive try/catch for a threat model (adversarial objects) this codebase's own call sites never produce. **Recommended, non-blocking**: define "plain object" mechanically (`Object.getPrototypeOf(value) === Object.prototype \|\| === null`); make the "errors + logs only" guarantee apply to Sentry's *effective* configuration, not just the literal `Sentry.init()` call as hand-written; add a repo-wide `logEvent(` grep reconciliation against §1's table, not just trust the table stays accurate; add one sentence clarifying the shape allowlist covers application-supplied data only, ownership-wise, not Sentry's own automatically-attached metadata. **Claude's assessment**: accepted both required fixes and all four non-blocking ones, no disagreements — P1-1 in particular was a genuine test-design bug (stubbing the thing under test rather than its dependency), not a debatable call, and independently re-deriving it confirms the review's reasoning exactly. Adopted the review's own stated preference on P1-2 (weaken the claim) rather than the alternative it also offered (defensive catch), for the same reason the review gave: keeps the validator simple and honest about the threat model it actually operates under. |
| DRAFT-5 | 🟡 REQUEST CHANGES (9.1/10) | Confirmed the `logEvent()` structural allowlist and the safe-wrapper failure-isolation design as "now solid" — explicitly not asking for either to be revisited. **Two required (P1) architectural gaps, not wording**: (1) the telemetry safety contract only covers `logEvent()`'s path (`validateTelemetryShape()` → `safeSentryLog()`) — it says nothing about `captureExceptionSafely(error, extra)`'s `extra`/`contexts` parameter (nothing stops a future caller from stuffing arbitrary data into it) or about Sentry's own automatic instrumentation (breadcrumbs, `sendDefaultPii`, XHR/fetch/DOM/console capture) — both are real telemetry surfaces this task introduces that the existing contract doesn't govern; (2) this task adds three new npm packages (`@sentry/react`, `@sentry/node`, `@sentry/vite-plugin`) into a codebase with a well-established, repeatedly-invoked "no new npm dependencies" convention (cited across TASK-001/003/015/021-023/054-057/063-067, with TASK-054 explicitly naming it "the project's established zero-new-dependency convention" and TASK-038's `cheerio` addition as the one prior precedent for an explicitly-declared exception) — the spec never acknowledges it's taking that exception. **Recommended, non-blocking**: resolve the apparent overlap between `@sentry/vite-plugin` and the Vercel integration for source-map/release ownership rather than leaving both conceptually active; narrow `captureExceptionSafely()`'s `extra` contract explicitly rather than leaving it a generic escape hatch (without mandating a bigger named-function refactor); explicitly configure `sendDefaultPii` rather than inheriting whatever the SDK version defaults to; record deployment SHA/environment alongside the burst-delivery test's result; test `environment`/`release` as a joint client+server invariant, not two independently-verified facts; reword the `err.message` residual-risk paragraph to cite the specific evidence (§1's audited call sites) rather than a bare "judged small." **Claude's assessment**: accepted both required gaps and all six non-blocking points, no disagreements. The dependency-policy point in particular is a genuine miss on my part across five drafting rounds — verified directly against the cited task specs before accepting it, not taken on faith, and confirmed the convention is real, repeated, and has an established exception mechanism (TASK-038) this spec should have used from DRAFT-1. |
| DRAFT-6 | 🟡 REQUEST CHANGES (9.2/10) | Confirmed both round-5 gaps genuinely addressed rather than papered over — "the telemetry boundary now covers `logEvent()`, explicit exception context, and SDK-generated context" and "the dependency-policy exception is explicit and justified." **One new P0/P1 architectural gap**: `@sentry/vite-plugin` needs build-time credentials (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`) to actually upload source maps/create releases — the spec's four env vars are all runtime (DSN/environment) and never address where these build-time credentials come from, what Vercel scopes receive them, what token scope is required, or what happens locally when they're absent; without this, criterion 12 (source maps resolve correctly) can fail even though runtime Sentry works perfectly. **Also required**: make `enableLogs: true` a fixed part of both init configs, not just an item to verify — without it, `logEvent()` → `safeSentryLog()` → `Sentry.logger.info()` can complete with no exception while zero logs actually arrive; split criterion 15 into a configuration invariant (no tracing/replay/profiling/metrics *enabled*) and a runtime observation (a quiet test session not producing those events doesn't prove they're disabled — absence of observed traffic isn't proof of disabled capability); make serverless-flush ownership an explicit architecture decision (wrapper stays fire-and-forget; request lifecycle owns a bounded, documented flush) rather than leaving the gap between "wrapper never rejects" and "event is reliably flushed" unaddressed after §2.0's research; make `captureExceptionSafely()`'s `extra` a closed application-specific parameter shape instead of a documented-but-unenforced generic Sentry `contexts` passthrough; specify the Vite plugin's release-ownership config explicitly (`release.name`/`inject`/`create`/`finalize`, artifact path, `.map` cleanup) rather than relying on plugin defaults. **Non-blocking**: pin `@sentry/react`/`@sentry/node` as one compatibility decision (not two independent pins), especially since Logs support is version-gated; reword "exactly three packages" to "exactly three new *direct* dependencies" (transitive additions are expected); add an explicit guarantee that `Sentry.init()` failure can't block app boot/server start; make initialization-ordering proof mechanical and tested against the production build, not dev-server behavior; frame the breadcrumb-body claim as a §2.0 verification result, not a permanent architectural truth; formalize the two-tier (application-controlled vs. SDK-controlled) privacy contract explicitly; broaden criterion 14 to cover the whole migrated subsystem, not just `logEvent()` itself; label the burst test a "delivery smoke test," not a reliability proof. Confirmed the MCP-registration/runtime-architecture separation and the deletion scope as already correct, no changes needed there. **Claude's assessment**: accepted every point, required and non-blocking, no disagreements — the build-time-credentials gap in particular is a plain miss on my part: Sentry bundler plugins needing an auth token to upload artifacts is well-established, unglamorous Sentry-integration knowledge, and I described `@sentry/vite-plugin` as "the sole authoritative mechanism" for three straight drafts without ever specifying what it needs to actually run. |
| DRAFT-7 | 🟢 **APPROVE / READY FOR IMPLEMENTATION (9.8–10/10)** | Confirmed all five required round-6 fixes and all six non-blocking ones as correctly closed: the build-time credentials contract ("the most important addition... without it, the source-map/release story was operationally incomplete even if runtime configuration was correct"), `enableLogs` ("no remaining ambiguity"), the 15a/15b configuration-vs-observation split, flush ownership living in the request lifecycle, `captureExceptionSafely()`'s closed shape, and the explicit SHA-pinned release/artifact-cleanup lifecycle. Explicitly named six points as **now closed, not to be reopened in a future round**: whether `enableLogs` is necessary, who owns `flush()`, whether `captureExceptionSafely()` should accept arbitrary `extra`, whether the Vite plugin is authoritative for source maps, whether build credentials need explicit specification, and whether the burst test demonstrates reliability rather than a smoke-test result. Summarized the seven-round arc as moving from "here's what we intend Sentry to do" to "here are the enforceable contracts and observable criteria that prove it does it." **No further changes requested — approved as implementation-ready.** |

---

## 0. Framing

TASK-067 closed the double-sign-in investigation (see [CURRENT_STATE.md](../handoffs/CURRENT_STATE.md)).
Getting there required TASK-063 through TASK-066 to build device-local, opt-in diagnostic tooling
(`kk_debug_log` + a tap-to-enable `DebugPanel`) because the app had no remote logging and the primary
repro device — an installed iOS PWA — has no remote-debugging path (Apple restricts Web Inspector to a
Mac). That tooling did its job. It also left behind: a permanent, always-mounted, invisible tap-target in
production; several diagnostic-only event listeners installed on every page load; and one shipped fix
(TASK-065's preconnect hint) that its own post-deploy data showed never worked.

A separate audit this session (not itself a spec) walked the repo end-to-end for dead code now that
TASK-067 is shipped, and a follow-up discussion covered what should replace `kk_debug_log` so both Connor
and Claude Code can read captured diagnostics remotely without any user-visible surface. That research
landed on **Sentry** — specifically its Logs product (GA September 2025) alongside its existing error
tracking — because it has an official, cloud-hosted MCP server (`getsentry/sentry-mcp`) purpose-built for
coding agents, meaning Claude Code gets read access without Connor handing out database credentials or a
hand-rolled API token, while Connor gets a normal web dashboard.

**DRAFT-3 added** (round-2 review): a formal pre-implementation verification gate (§2.0, new — mirrors
TASK-067 §6's "Step 0" precedent) consolidating every "confirm against current docs" flag scattered
through DRAFT-2 into one concrete checklist done *before* coding starts, not discovered mid-implementation;
a structural telemetry-shape allowlist replacing the unenforceable generic normalizer (§2.3a); explicit
`safeSentryLog()`/`captureExceptionSafely()` application-level wrapper boundaries (§2.2, §2.4); a
burst/multi-invocation delivery test (§6); and an explicit, evidence-grounded release-identifier mechanism
using the same `VERCEL_GIT_COMMIT_SHA` value `clientErrors.js` already reads (§2.4).

**DRAFT-4 adds** (round-3 review, approved with minor changes): §2.0's verification gate now requires a
filled-in decision/evidence table, not just "research happened" (§2.0); explicit never-throw/never-reject
contracts for both safe wrappers (§2.2, §2.4); a simplified, strictly non-recursive telemetry validator
that makes the circular-reference fallback unnecessary rather than handling it after the fact (§2.3a);
explicit top-level `data`/truncation rules (§2.3a); a byte-for-byte client/server release-equality
requirement instead of "conceptually the same commit" (§2.4, §5, §6); and a mechanical grep-verified
criterion that the old `kk_debug_log` API surface is completely gone (§5, §6).

**DRAFT-5 fixes** (round-4 review): criterion 10 and its verification step now test failure by stubbing
the *underlying Sentry SDK operation*, not the safe wrapper itself, so the guarantee under test is actually
the wrapper's absorption behavior rather than a caller's own incidental try/catch (§2.2, §2.4, §5, §6);
`validateTelemetryShape()`'s "never throws" claim is scoped to ordinary values/plain data objects rather
than claiming a guarantee against adversarial inputs (throwing getters, Proxy traps) it can't actually make
(§2.3a); "plain object" is now defined mechanically; the "errors + logs only" guarantee now covers
Sentry's effective configuration, not just the hand-written `Sentry.init()` call; a repo-wide `logEvent(`
grep reconciliation is added so §1's table can't silently drift out of date (§5, §6).

**DRAFT-6 closes two architectural gaps** (round-5 review): an explicit dependency-policy exception (§2.1a,
new) acknowledging this task adds three npm packages against this project's established no-new-dependency
convention, and why; and a telemetry governance layer beyond `logEvent()` (§2.3b, new) covering
`captureExceptionSafely()`'s narrowed `extra` contract, Sentry's automatic breadcrumb/context scope, and an
explicitly-configured `sendDefaultPii` posture — closing the gap between "the shape allowlist governs
`logEvent()`" and "what else can leave the application via Sentry." Also resolves the
`@sentry/vite-plugin`-vs-Vercel-integration source-map ownership ambiguity, strengthens the joint
client/server `environment`/`release` invariant, and records burst-test deployment context (§2.1, §2.4,
§5, §6).

**DRAFT-7 closes the build-time gap round-6 found**: the Vite plugin's actual operating requirements
(`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` — build-time-only, never shipped to the browser, §2.1a)
were never specified in five prior drafts despite the plugin being named "the sole authoritative mechanism"
for source maps since DRAFT-6. Also makes `enableLogs: true` a fixed part of both `Sentry.init()` configs
rather than an unresolved verification item (§2.2, §2.4); splits the "errors + logs only" criterion into a
configuration invariant and a runtime observation, since a quiet test session proves the latter but not the
former (§5); makes serverless-flush ownership an explicit request-lifecycle responsibility separate from
the wrapper's fire-and-forget contract (§2.4); narrows `captureExceptionSafely()` to a closed
application-specific parameter shape instead of a generic Sentry `extra` passthrough (§2.3b, §2.4); and
specifies the Vite plugin's release-ownership configuration explicitly rather than trusting its defaults
(§2.4).

This task still does the same three things DRAFT-1 described:

1. Wire up Sentry (client + server).
2. Migrate the existing `logEvent()` call sites — several of which are genuinely load-bearing production
   auth diagnostics, not investigation-only — to ship through Sentry instead of `localStorage`, without
   changing their call sites. (DRAFT-3, round-2's point #9: `isStandalonePwa()` is a separate,
   *unchanged* utility that happens to live in the same file — not itself migrated.)
3. Delete the files/components that were purpose-built for the now-closed investigation and provide no
   ongoing value: `DebugPanel.jsx`, `PreconnectGoogleOAuth.jsx`, `lifecycleLog.js`, and `App.jsx`'s two
   diagnostic-only logger components.

Registering the Sentry MCP server for Claude Code is a one-time local config step, not a code change —
out of scope for this diff (§4).

---

## 1. Current State

**The `kk_debug_log` system**, entirely client-side, entirely opt-in:

- [debugLog.js](../../client/src/lib/debugLog.js) — `logEvent(tag, data)` no-ops unless
  `isDebugEnabled()` (a `kk_debug_enabled` flag in `localStorage`); when enabled, appends to a
  200-entry-capped `kk_debug_log` array in `localStorage`. Also exports `isStandalonePwa()`, an unrelated
  utility used once, in `main.jsx` — not part of this migration (§0).
- [DebugPanel.jsx](../../client/src/components/DebugPanel.jsx) — rendered unconditionally in
  [App.jsx:174](../../client/src/App.jsx). A **44×44px invisible `<div>` fixed to the top-left corner of
  every page, for every user, always** (lines 66-76) — 5 taps within 3s toggles `kk_debug_enabled` and
  reveals a log viewer. This is the only way to reach the toggle on an installed iOS PWA (no address bar
  for `?debug=1`).
- [lifecycleLog.js](../../client/src/lib/lifecycleLog.js) — `installLifecycleLogging()`,
  `installClickLogging()`, `installUrlChangeLogging()`, all called unconditionally from
  [main.jsx:14-16](../../client/src/main.jsx), install `click`/`pointerdown`/`visibilitychange`/
  `pagehide`/`pageshow`/`freeze`/`resume`/`unhandledrejection`/`history.pushState`/`popstate` listeners on
  every page load. Also owns TASK-066's `requestAnimationFrame` main-thread heartbeat
  (`installMainThreadHeartbeat`, lines 43-155) — its question ("is there a main-thread stall around the
  Google button tap?") was answered conclusively no; see
  [archive/TASK-066-implementation.md](../handoffs/archive/TASK-066-implementation.md).
- [PreconnectGoogleOAuth.jsx](../../client/src/components/PreconnectGoogleOAuth.jsx) — wraps
  `<SignIn>`/`<SignUp>` in [App.jsx:128-130,138-140](../../client/src/App.jsx). TASK-065's fix. Its own
  post-deploy measurement showed the targeted gap "essentially unchanged" (1172ms vs. 1235ms baseline) —
  see [archive/TASK-065-negative-signal.md](../handoffs/archive/TASK-065-negative-signal.md). It never
  demonstrably helped, and the actual root cause (TASK-067's service-worker fix) had nothing to do with
  connection warmup.
- `AuthStateLogger` ([App.jsx:71-84](../../client/src/App.jsx)) and `SignFlowStateLogger`
  ([App.jsx:91-107](../../client/src/App.jsx)) — TASK-063 diagnostic components, rendered unconditionally
  in `App()`. Both log on every `isLoaded`/`isSignedIn`/route-change transition — the two highest-volume
  `logEvent()` call sites in the app.
- [authTransition.js:194-201](../../client/src/lib/authTransition.js) — the production
  `installOauthMarkerListener()`'s `oauth-marker-installed` log includes a `perfNowMs` field, added as a
  TASK-064-follow-up to test the WebKit transient-activation-window-expiry hypothesis. TASK-067
  superseded that hypothesis entirely.

**Not all `logEvent()` call sites are investigation scaffolding**, and every one has been read in full to
confirm what it actually sends (needed for §2.3a's shape allowlist, not just asserted):

| Call site | Payload | Volume |
|---|---|---|
| [useSettledAuth.js:132](../../client/src/hooks/useSettledAuth.js) `auth-settled` | `settleReason`, `settleElapsedMs`, `settleInitialIsSignedIn`, `settleFinalIsSignedIn`, `navigationType` — all booleans/enums/numbers | once per settle |
| [AuthContext.jsx:76-81](../../client/src/context/AuthContext.jsx) `signout-start/resolved/threw` | `{}` or `{ message: err.message }` | once per logout |
| [api/index.js:43-79](../../client/src/api/index.js) `auth-fetch-*` | `path`, `hadToken`/`hadClerkSession` (booleans), `reason` (enum), occasionally `err.message` | only on a 401 |
| [useAuthRecovery.js:130](../../client/src/hooks/useAuthRecovery.js) `signout-repair-attempt` | `{ sessionId: currentSessionId }` — a Clerk session identifier | rare |
| `App.jsx` `AuthStateLogger`/`SignFlowStateLogger` (deleted, §2.5) | `pathname`, `isLoaded`/`isSignedIn`, sign-in/up `status` enums | every navigation |
| [authTransition.js:194-201](../../client/src/lib/authTransition.js) `oauth-marker-installed` | `perfNowMs` (removed, §2.5) | every Google-button click |

Every value in every row above is a string, boolean, number, or `null`/`undefined` — none is a nested
object or array. This matters directly for §2.3a's design: **the shape allowlist those call sites need to
pass through isn't a hypothetical constraint being imposed on unknown future code — it already matches
every call site that exists today.** The one genuine residual risk is `err.message` string *content*
(§2.3a, §7) — bounded-length free text, not structurally distinguishable from safe text by any normalizer.
`sessionId` is a Clerk session identifier — an opaque correlation value, not a bearer credential (using it
requires Clerk's own secret key) — and is deliberately kept, not redacted, since it's the whole point of
that log line.

**No CSP applies to the client bundle today.** `server/app.js`'s `helmet` CSP
([app.js:37-46](../../server/app.js)) is only set on responses from the Express app, which per
[vercel.json](../../vercel.json)'s rewrites only handles `/api/:path*`. The SPA's `index.html`/JS bundle
is served as a static file directly by Vercel, with no CSP header at all. This means wiring in Sentry's
client SDK needs no CSP changes — flagged as a claim to re-confirm at implementation time (§2.0), not
assumed permanently true.

**Two server entry points, not one.** [server/index.js](../../server/index.js) is explicitly commented
"Local dev entry point ... For Vercel, use `api/index.js` instead" — it imports `loadEnv.js` (loads
`server/.env.local`), then `db/migrate.js`, then `app.js`, then calls `app.listen()`.
[api/index.js](../../api/index.js) — the actual Vercel Function used in staging/production — imports
`server/app.js` directly and never touches `server/index.js` or `loadEnv.js` at all; in that path,
`process.env` is populated entirely by Vercel's own platform-level env var injection, which happens before
the function cold-starts, independent of any `dotenv` call. `server/app.js` itself
([app.js:1](../../server/app.js)) already does its own `import 'dotenv/config'` (loading the root `.env`,
a no-op on Vercel since that file isn't committed), which runs regardless of which of the two entry points
was used. **Any Sentry server-init plan that only touches `server/index.js` never runs in production** —
this is why §2.4 wires `instrument.js` into `app.js` itself, not into `index.js`.

**`clientErrors.js`'s existing `reportSchema` already bounds payload size.** `message` ≤ 2000 chars,
`stack`/`componentStack` ≤ 8000 chars each, enforced by `validate(reportSchema)` (`zod`) before the route
handler runs. Relevant directly to round-2's §12 concern (§2.4a).

**`clientErrors.js` already reads a release identifier.** `process.env.VERCEL_GIT_COMMIT_SHA` (with a
`'unknown'` fallback, since exposure depends on the project's "Automatically expose System Environment
Variables" Vercel setting) — relevant directly to round-2's §7 concern about release-identifier ownership
(§2.4).

**Existing error-reporting path**: `ErrorBoundary.jsx`'s `componentDidCatch` `fetch`es to
`POST /api/client-errors` ([clientErrors.js](../../server/routes/clientErrors.js)), which
`console.error`s the report to Vercel's log stream. `server/app.js`'s generic error middleware
([app.js:72-79](../../server/app.js)) does the same for uncaught server-side errors. Neither is
centralized, searchable, or retained beyond Vercel's own log window. React error boundaries are designed
to swallow the render error inside `componentDidCatch` so it never becomes an uncaught global
error/`unhandledrejection` — meaning this path and Sentry's own automatic global-error capture (§2.2)
mostly cover different error classes (render errors vs. everything else), not the same error twice; see
§2.4a for the full reasoning and the verification step added regardless.

---

## 2.0 Pre-Implementation Verification Gate (DRAFT-3, new — mirrors TASK-067 §6 Step 0)

DRAFT-2 scattered several "confirm against current docs before implementation" flags through the document.
Round-2 review pointed out this leaves genuine ambiguity about which implementation choices are load-bearing
architecture (fixed by this spec) versus which are still open (to be resolved once, deliberately, before
writing code — not discovered ad hoc mid-implementation). This section is that one place. **Implementation
does not begin until every item below is checked against Sentry's current documentation for the exact
`@sentry/react`/`@sentry/node` versions being installed:**

1. **Client initialization mechanism.** Confirm Sentry's current recommended pattern for initializing
   before a Vite-built SPA's own application code evaluates. §2.2 proposes a specific mechanism
   (`instrument.js` loaded via a separate `<script>` tag preceding `main.jsx`'s) as a starting point, not
   a locked decision — if Sentry's current guidance recommends something else (e.g. a Vite plugin, a
   different loader pattern), use that instead. The requirement that's fixed regardless of mechanism:
   Sentry must be initialized before `main.jsx`'s own import graph evaluates, and that guarantee must not
   rest on same-file statement ordering (round-1, round-2 point P0-1).
2. **Logs API surface.** Confirm the exact method/config for the installed SDK versions' structured-logging
   API (`Sentry.logger.info(...)` or current equivalent). **`enableLogs: true` (or the installed version's
   equivalent flag) is now a fixed requirement of both `Sentry.init()` calls, not merely something to
   verify and leave optional (DRAFT-7, round-6's required #2) — confirm the exact flag name/shape for the
   installed SDK version, not whether to include it.**
3. **Server serverless/Vercel behavior — flush ownership (DRAFT-7, expanded per round-6's required #3).**
   Confirm the Node SDK's documented approach for ensuring queued events flush before a Vercel Function
   suspends between invocations. Specifically resolve: does the Vercel integration guarantee delivery
   automatically, or does the SDK require an explicit `Sentry.flush()`/`close()` call? If required, that
   call is made by the **request lifecycle** (the error middleware, after calling
   `captureExceptionSafely()`, before sending the response) — **not** inside `captureExceptionSafely()`
   itself, which must stay fire-and-forget per its own contract (§2.2, §2.4). Record: whether flush is
   required at all, where it's called from, whether the response awaits it, and what timeout bounds it.
4. **Release/source-map wiring — full plugin configuration (DRAFT-7, expanded per round-6's required #4).**
   Confirm `@sentry/vite-plugin`'s current configuration surface for: tying an uploaded source map to a
   release identifier forced to be exactly `process.env.VERCEL_GIT_COMMIT_SHA` (§2.1's
   authoritative-pipeline decision, §2.4's byte-for-byte requirement); the plugin's release-lifecycle
   options (name/inject/create/finalize — §2.4); its artifact/source-map upload path and whether generated
   `.map` files are deleted from the deployed bundle afterward; and whether the Vercel integration performs
   any source-map behavior of its own that needs disabling to keep the plugin the sole pipeline.
5. **Build-time Sentry credentials (DRAFT-7, new — round-6's required #1, the most significant single gap
   this round found).** `@sentry/vite-plugin` needs build-time authorization to upload artifacts and
   create/finalize a release against a specific Sentry org/project — the DSN is deliberately not that
   credential. Confirm and record: the exact env var names the installed plugin version expects (expected
   to be `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` or close equivalents); the minimum auth-token
   scope actually required for source-map upload + release management (not a broader scope than needed);
   which Vercel environment scopes receive the token (Production/Preview — **never exposed to the browser
   bundle**, since unlike the DSN this token *is* a real secret); and the intended behavior when these
   values are absent during a local build — the build must not fail, it should simply skip artifact
   upload/release creation (source maps stay local-only, which is fine for a dev machine).
6. **Package versions and compatibility (DRAFT-7, expanded per round-6's non-blocking #1).** Record the
   exact, pinned version installed for each of the three new packages. `@sentry/react` and `@sentry/node`
   specifically must be pinned as **one compatibility decision, not two independent choices** — confirm
   both support the Logs API from item 2 and record why the chosen pair is compatible (e.g. both on the
   same major/minor line), not just what each individually resolves to. `@sentry/vite-plugin` may track
   its own release cadence independently since it's a build tool, not a runtime SDK peer.

**Decision record (DRAFT-4, new — round-3's P1 #1).** This gate's output is not "research happened," it's
a recorded decision a future maintainer can read without redoing the research. Fill in this table before
writing any implementation code, and keep it in the spec (or a short linked addendum) afterward — §5
criterion 1 requires this table to be populated, not just this checklist to have been mentally worked
through:

| Verification item | Finding | Decision | Evidence/date |
|---|---|---|---|
| Client initialization mechanism | *(to fill in)* | *(to fill in)* | *(to fill in)* |
| Logs API surface + `enableLogs` flag | *(to fill in)* | *(to fill in)* | *(to fill in)* |
| Serverless/Vercel flush ownership | *(to fill in)* | *(to fill in)* | *(to fill in)* |
| Release/source-map plugin configuration | *(to fill in)* | *(to fill in)* | *(to fill in)* |
| Build-time credentials (`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`) | *(to fill in)* | *(to fill in)* | *(to fill in)* |
| Package versions + `@sentry/react`/`@sentry/node` compatibility | *(to fill in)* | *(to fill in)* | *(to fill in)* |

This is a gate, not a formality to skip past — implementation does not begin until every row above is
filled in.

---

## 2. Proposed Change

### 2.1 Add Sentry

**2.1a — Dependency-policy exception, explicitly declared (DRAFT-6, new — round-5's required #2).** This
project has a well-established, repeatedly-invoked "no new npm dependencies" convention — cited explicitly
across many prior task specs (TASK-001, TASK-003, TASK-015, TASK-021 through TASK-023, TASK-054 through
TASK-057, TASK-063 through TASK-067; TASK-054 names it outright as "the project's established
zero-new-dependency convention"). This task does not comply with it by default, and — per the one prior
precedent for an explicit exception (TASK-038's addition of `cheerio`, justified in its own spec as "the
standard, high-adoption choice" rather than a hand-rolled alternative) — that needs to be stated, not
silently done. Stated here: **this task intentionally introduces exactly three new *direct* npm
dependencies** — `@sentry/react`, `@sentry/node`, `@sentry/vite-plugin` (Sentry's official Vercel
integration itself is an account-level connection between Vercel and Sentry, not an installed package — it
doesn't add a fourth). **"Direct," specifically (DRAFT-7, reworded per round-6's non-blocking #2):** `npm
install` will necessarily add transitive dependencies these three packages pull in — that's expected and
not a violation of this exception's scope, which covers *direct* additions to `package.json`. The exception
is architectural, not incidental: remote error/log telemetry that both Connor and Claude Code can access
without either side handling raw credentials (the whole reason this task exists — see §0) cannot be built
through this project's existing dependency-free primitives without effectively recreating a telemetry
platform from scratch, which is a strictly worse outcome than adopting a maintained one. Package versions
must be pinned (not left as unbounded `^`/`latest` ranges); `@sentry/react` and `@sentry/node` specifically
are pinned as **one compatibility decision** (§2.0 item 6, DRAFT-7, round-6's non-blocking #1) — not two
independently-resolved versions — since Sentry's Logs API is version-gated and both packages need to
actually support it. The exact versions installed, and the reasoning for the react/node pairing, are
recorded in §2.0's decision table — Sentry's JS SDK has had materially breaking changes across major
versions (e.g. the v7→v8 line changed internal dependencies), so "whatever `npm install` resolves to today"
is not an acceptable substitute for a recorded decision here.

**Build-time credentials, separate from the four runtime env vars (DRAFT-7, new — round-6's required #1).**
`@sentry/vite-plugin` needs its own build-time authorization to upload source-map artifacts and
create/finalize a release — distinct from, and in addition to, the runtime DSN/environment vars below:

- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (or the installed plugin version's exact equivalents
  — confirm per §2.0 item 5) are **build-time only**: read by `vite.config.js`/the plugin during `npm run
  build`, never bundled into client code, never exposed via a `VITE_`-prefixed name. This is the key
  distinction from `VITE_SENTRY_DSN`, which *is* meant to ship to the browser — these three are not.
- `SENTRY_AUTH_TOKEN` is a real secret (unlike the DSN) and is scoped to the minimum permission actually
  needed for source-map upload + release management, not a broader token. Set in Vercel's
  Production/Preview environment-variable scopes only, alongside the existing `DATABASE_URL`-style
  per-environment convention — never in a client-exposed scope.
- **Local builds without these values present must still succeed** — the plugin skips artifact
  upload/release creation gracefully (source maps stay local, unlinked from any Sentry release) rather than
  failing the build. A missing build-time credential is a degraded-but-working state, not a hard error,
  consistent with this task's general failure-isolation posture (§2.2, §2.4) even though this is a
  build-time rather than a runtime concern.

- Dependencies: `@sentry/react` (`client/package.json`), `@sentry/node` (`server/package.json`),
  `@sentry/vite-plugin` (`client/package.json`, dev dependency, for release/source-map wiring, §2.4) —
  the three packages named in §2.1a, no others.
- New env vars, one shared value per environment mirrored across two names (Vite requires the `VITE_`
  prefix to expose a var to client code, so the same logical value needs both a client and server name):
  - `SENTRY_ENVIRONMENT` (server) / `VITE_SENTRY_ENVIRONMENT` (client) — both set to the identical
    `local` / `staging` / `production` value per the existing environment convention
    ([CONVENTIONS.md](../handoffs/CONVENTIONS.md)). **Authoritative source (DRAFT-3, round-2's point
    #10)**: Vercel's Preview/Production environment-variable scope is the single place each pair is
    edited per deployed environment — set both keys to the same literal value in the same scope at the
    same time, the same way `DATABASE_URL` is already scoped per environment; there is no automatic
    derivation of one from the other, so this is a manual-but-single-edit-point discipline, not a
    two-place risk of drift, as long as both keys are always changed together. Same discipline for local
    dev's `.env.local` files.
  - `VITE_SENTRY_DSN` (client). The browser DSN is intentionally client-visible and is not an
    authentication credential for reading Sentry data — it's only good for submitting events. Any
    server-side Sentry credential (e.g. an org auth token, if one is ever added for API/MCP use) remains a
    real secret, unlike this DSN.
  - `SENTRY_DSN` (server) — also not a credential for reading data, but kept server-side only since
    there's no reason to duplicate it into client config.
  - Add all four, with comments distinguishing the public-DSN case from ordinary secrets, to
    `.env.example`; set real values in `server/.env.local`/`client/.env.local` (gitignored) and Vercel's
    Preview/Production scopes.
- **Code responsibilities vs. integration responsibilities, with one authoritative source-map/release
  pipeline (DRAFT-6, resolved per round-5's P2 #5).** Sentry's official Vercel integration is scoped to
  project/deployment connection and DSN/env var wiring only in this task's design — it does not solve SDK
  initialization, initialization ordering, or serverless event-flush behavior (those remain this task's
  responsibility: §2.2, §2.4, §2.0). **`@sentry/vite-plugin` is the sole authoritative mechanism for
  client-side source-map upload and release creation**, not a second pipeline alongside the Vercel
  integration's own source-map behavior if it has one — because the plugin is the piece that can be
  configured to guarantee the byte-for-byte release-equality requirement (§2.4) against
  `VERCEL_GIT_COMMIT_SHA`, and running two independent upload/release pipelines risks exactly the kind of
  mismatched-release problem that requirement exists to prevent. If §2.0's verification finds the Vercel
  integration also performs source-map upload by default, that behavior is disabled/left unconfigured in
  favor of the plugin, and this decision is recorded in §2.0's decision table, not left implicit.

### 2.2 Client wiring

**Architectural requirement (fixed, not subject to implementation discretion): Sentry must be initialized
before `main.jsx`'s own import graph evaluates, and this guarantee must not rest on same-file statement
ordering** — ES module static imports are hoisted and fully evaluated, in declaration order, before *any*
of the importing module's own top-level statements run, so a `Sentry.init()` call placed textually first
inside `main.jsx` would not actually run before `App.jsx` and its transitive imports evaluate (round-1's
original catch).

**Proposed default mechanism, subject to §2.0 verification (DRAFT-3, round-2's P0-1 — this is now
explicitly a starting point, not a mandatory acceptance criterion):**

- New `client/src/instrument.js` — imports only `@sentry/react` (no app code) and calls `Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.VITE_SENTRY_ENVIRONMENT, release:
  ..., enableLogs: true, sendDefaultPii: false, ... })` (release value per §2.4's mechanism;
  `enableLogs: true` — DRAFT-7, round-6's required #2 — is a fixed part of this config, not an optional
  item left to §2.0 to decide whether to include; exact flag name/shape for the installed SDK version
  still confirmed per §2.0 item 2). **The *effective* Sentry configuration — not merely the fields this
  spec's hand-written `Sentry.init()` call sets explicitly — must not enable `tracesSampleRate`/session
  replay/profiling/any product beyond errors and logs: if §2.0's verification turns up a convenience
  integration/preset (e.g. a default bundled with `@sentry/vite-plugin` or a Vercel-integration default)
  that would enable one of these, configure it off explicitly rather than assuming an absent field means
  it's off.** A convenience preset silently enabling one of these would violate §4's Out of Scope without
  anyone deciding it deliberately. **`Sentry.init()` itself failing (malformed DSN, the instrument module
  failing to load, a thrown SDK initialization error) must not prevent the application from booting and
  rendering (DRAFT-7, new — round-6's non-blocking #3)** — the failure-isolation contract below covers
  every call *after* initialization; this is the one failure mode still outside it, and it needs the same
  answer: non-fatal to the rest of the app.
- `client/index.html`: add `<script type="module" src="/src/instrument.js"></script>` immediately
  **before** the existing `<script type="module" src="/src/main.jsx"></script>` line — separate
  `<script type="module">` tags each resolve their own import graph independently and execute in document
  order, so this guarantees `instrument.js` finishes before `main.jsx` begins loading at all.
- The requirement that actually matters, independent of the mechanism above: **Sentry initialization must
  precede evaluation of application modules capable of generating telemetry.** If §2.0's verification
  finds Sentry's current Vite/SPA guidance recommends a different mechanism, use that instead — the
  two-`<script>`-tag approach is this spec's best current guess at satisfying that requirement, not the
  requirement itself.
- **This must be provable mechanically, against the production build (DRAFT-7, new — round-6's
  non-blocking #4).** `npm run build`'s output, served statically (not the Vite dev server — dev-server
  module loading and generated production HTML aren't necessarily identical), is what's checked: confirm
  `instrument.js`'s script tag (or whatever mechanism §2.0 lands on) is present and ordered correctly in
  the built `index.html`, and that a module `main.jsx` imports can observe Sentry already initialized by
  the time it runs. "It's initialized because the code is textually structured that way" is exactly the
  kind of claim round 1 already showed can't be trusted without checking.

**Safe wrapper boundary and explicit failure contract.** All application-triggered event/log/capture calls
go through one function, `safeSentryLog()`, defined alongside `Sentry.init()` — `Sentry.init()` itself is
necessarily a direct SDK call and is exempt from this rule; everything downstream of initialization is
not. `safeSentryLog()`'s contract, stated explicitly rather than left implicit: **it is fire-and-forget
and MUST NOT throw synchronously or return a rejected Promise to its caller, under any failure mode** — the
underlying SDK call throwing, rejecting, being uninitialized, or missing a configured DSN are all caught
and absorbed *inside the wrapper itself*, never surfaced to whatever called `logEvent()`. Telemetry
failure is non-fatal by construction and must never alter application control flow.

**Testing this contract means stubbing the layer underneath the wrapper, not the wrapper itself (DRAFT-5,
required fix — round-4's P1-1).** DRAFT-4's criterion 10 stubbed `safeSentryLog()` *itself* to throw and
then asserted callers survive — that only proves whatever calls `safeSentryLog()` has its own defensive
try/catch, which isn't the guarantee this wrapper exists to provide, and isn't even the design (callers
are not supposed to need their own try/catch around it). The actual test replaces the *raw Sentry SDK
operation* (`Sentry.logger.info`/equivalent) with one that throws synchronously and, separately, one that
returns a rejected Promise, while leaving the *real* `safeSentryLog()` implementation in place — then
confirms the real wrapper absorbs both failure modes without propagating them. See §5 criterion 10 and §6
step F for the corrected test.

**Duplicate error reporting.** No change proposed to `ErrorBoundary.jsx`'s existing
`POST /api/client-errors` call, and no wrapping of it in Sentry's own `<Sentry.ErrorBoundary>` component
or React-specific error-boundary integration. Reasoning: React error boundaries are specifically designed
to swallow the render error inside `componentDidCatch` so it never reaches
`window.onerror`/`unhandledrejection` — so Sentry's default global auto-capture (which listens for exactly
those two things) should not independently see the same render error a second time. That means this
task's plan — Sentry's automatic global capture for non-render errors (event handlers, async code outside
React's render), plus the existing `ErrorBoundary` → `/api/client-errors` → server-side
`Sentry.captureException` path for render errors (§2.4a) — covers two different error classes, not the
same error twice. This reasoning is the basis for the design, not a substitute for verifying it: §6 adds
an explicit check that a deliberately-thrown render error produces exactly one Sentry event, not two.

### 2.3 Migrate `debugLog.js`

Rewrite [debugLog.js](../../client/src/lib/debugLog.js) so its **existing public API is preserved** —
every current call site (`logEvent(tag, data)`) keeps compiling and running with zero changes.
`isStandalonePwa()` is unchanged and not part of this migration (§0, round-2's point #9).

- `logEvent(tag, data)`: pass through §2.3a's shape allowlist, then forward to `safeSentryLog()` (§2.2).
- No more `isDebugEnabled()` gate — nothing about sending to Sentry is user-visible, so there's no
  remaining reason to gate it client-side.
- Remove `isDebugEnabled()`, `setDebugEnabled()`, `getLog()`, `clearLog()` — only existed to support the
  on-device toggle/viewer, both of which are deleted (§2.5).

**2.3a — Telemetry shape allowlist (DRAFT-3 — replaces DRAFT-2's generic `normalizeTelemetry()`, round-2's
P0-2).** Round-2 correctly identified that a generic recursive serializer cannot semantically distinguish
safe operational data from forbidden application data — nothing about a string's *shape* reveals whether
its *content* is `"retry-still-401"` or an accidentally-embedded auth header. DRAFT-2's design implied
detection it can't actually do. The fix is structural, not semantic: constrain what `data` is allowed to
*be*, so unsafe shapes can't pass through regardless of content, rather than trying to inspect content for
safety.

```text
logEvent(tag, data)
       ↓
validateTelemetryShape(tag, data)
       ↓
safeSentryLog(tag, safeData)
```

**Telemetry contract, stated once and concisely (DRAFT-4, new — round-3's P2 #12, elevating what was
previously only implicit across this section):** `logEvent()` may carry operational identifiers, booleans,
numbers, bounded operational strings, and bounded error-message strings. It must not intentionally carry
request/response bodies, authentication credentials, tokens, cookies, headers, user-entered content,
nested application objects, arrays, or `Error` objects. `validateTelemetryShape()` below enforces the
*shape* half of that contract mechanically; §1's call-site-by-call-site table is what establishes the
*semantic* half holds for every event that exists today.

`validateTelemetryShape()`'s contract — **deliberately non-recursive**: it inspects `data`'s own top-level
enumerable keys only and never descends into any value that is itself an object. This isn't a
simplification that trades away safety — a validator that never traverses into a nested value cannot be
broken by that value being circular, since circularity is only a traversal hazard and no traversal ever
happens. That also means DRAFT-3's `'[unserializable]'` fallback path was solving a problem this design
doesn't have; it's removed, not replaced.

- **"Plain object," defined mechanically (DRAFT-5, new — round-4's P2 #4):** a value counts as a plain
  object if and only if `Object.getPrototypeOf(value) === Object.prototype` or
  `Object.getPrototypeOf(value) === null`. This makes the treatment of `Date`, `Map`, `Set`, class
  instances, `Error`, and functions unambiguous: none of them satisfy this check (their prototype is never
  `Object.prototype`), so each is handled exactly like any other non-plain-object value — replaced with
  `{}` if passed as the whole `data` argument, or dropped if found as one of `data`'s own top-level values.
- `tag`: if not a string, replace with a fixed placeholder (e.g. `'invalid-tag'`); otherwise truncate to
  **exactly** the configured maximum length (e.g. 100 chars) if longer — cut at that length, no `…`
  suffix or other appended marker, since appending anything would exceed the stated maximum.
- `data` **top-level contract**: if `data` is `undefined` or omitted, treat it as `{}`. If `data` is
  anything other than a non-null, non-array plain object per the definition above (a string, a number,
  `null`, an array, an `Error` instance, etc. passed directly as the whole `data` argument), replace the
  entire argument with `{}` — no coercion, no attempt to wrap or preserve it in another form.
- Once `data` is confirmed to be a plain object, each of its **own top-level** values must be one of:
  `string` (truncated to exactly the configured max length, e.g. 500 chars, same no-ellipsis rule as
  `tag`, so `err.message`-shaped values stay useful up to that bound), `number`, `boolean`, `null`, or
  `undefined`. **Every other value type — nested object, array, function, `Error` instance, anything
  else — is dropped from the payload, not forwarded in any form, not descended into**: the key is simply
  omitted from the object handed to `safeSentryLog()`.
- This is verifiably correct against §1's table: every existing call site's payload already fits this
  shape today, so no call site needs to change (confirmed by inspection, not assumed) — and, per §5
  criterion 2, verified by a repo-wide grep, not trusted to stay accurate by inspection alone.
- **Scope of the "never throws" guarantee (DRAFT-5, corrected per round-4's P1-2 — this claim was
  overstated in DRAFT-4).** Because there is no traversal into nested values, the function never throws
  *for ordinary values and plain data objects* — the shapes every real call site in this codebase produces
  (§1's table) and the only shapes this application ever passes to `logEvent()`. This is **not** a claim
  that the function is safe against adversarial inputs: a throwing getter (`{ get x() { throw ... } }`) or
  a `Proxy` with a throwing `ownKeys`/`get`/`getOwnPropertyDescriptor` trap could still cause
  `Object.keys()`/property access itself to throw, since the validator still performs ordinary property
  reads even though it never recurses into their results. This spec deliberately does not defend against
  that threat model — adding a wrapping `try`/`catch` "just in case" would trade the validator's current
  simplicity for defending against inputs no call site in this codebase produces or ever will, which isn't
  a trade worth making (round-4's own stated preference, adopted here rather than the alternative it also
  offered).

**Residual risk this does not close, stated explicitly rather than implied solved:** a bounded-length
string is still just a string — this allowlist stops `data` from carrying rich/nested application content,
but it cannot tell whether the *text inside* a permitted string (chiefly, `err.message`-shaped values)
happens to contain something sensitive. This spec takes a pragmatic middle position rather than eliminating
free-form messages entirely: `message` strings stay permitted (dropping them would mean touching call
sites this spec otherwise avoids touching, and they carry real debugging value), bounded like every other
string. **Accepted specifically because §1's audited call sites are all operational-failure paths — token
refresh failures, sign-out errors, fetch retries — none of which read from or echo user-entered content
(DRAFT-6, reworded per round-5's §10 to cite the specific evidence rather than a bare "judged small")** —
named as an accepted residual risk in §7, not a promise this design doesn't keep.

**2.3b — Telemetry governance beyond `logEvent()` (round-5's required #1, narrowed further in DRAFT-7 per
round-6's required #5).** §2.3a's allowlist governs exactly one of three telemetry surfaces this task
introduces. The other two need their own explicit governance rather than being left to whatever the SDK
defaults to — organized as a two-tier contract (DRAFT-7, round-6's non-blocking #6): what the
**application** controls directly, and what's **SDK-controlled** by explicit configuration rather than
default inheritance.

**Application-controlled:**

- **`logEvent()`'s payload** — §2.3a's mechanically-enforced shape allowlist.
- **`captureExceptionSafely()` takes a closed, application-specific parameter shape, not a generic Sentry
  `extra`/`contexts` passthrough (DRAFT-7, replaces DRAFT-6's documented-but-unenforced convention per
  round-6's required #5).** DRAFT-6's `captureExceptionSafely(error, extra)` let a caller pass any
  Sentry-shaped object as `extra` — nothing enforced the "only these specific fields" convention beyond a
  comment. The stronger design: the wrapper's signature itself only accepts the specific fields this task
  actually needs, and *constructs* the Sentry `contexts`/tags internally —
  `captureExceptionSafely(error, { clientContext, requestId, deploy, householdId, userId })`, where
  `clientContext` (when present) is itself the narrow `{ originalStack, componentStack }` shape from
  `clientErrors.js` (§2.4a), not an arbitrary object. This changes the boundary from "callers promise not
  to misuse a generic escape hatch" to "callers cannot supply arbitrary Sentry context through this
  function's own type signature" — a real API-level guarantee instead of a documented convention. Given
  only two call sites exist (the error middleware, `clientErrors.js`), this costs nothing extra to build
  now rather than deferring it.

**SDK-controlled, set explicitly rather than inherited from defaults:**

- **`sendDefaultPii: false`** in both `Sentry.init()` calls (client and server, §2.2/§2.4) — consistent
  with the minimal-PII posture the application-controlled tier already establishes, and because nothing in
  this app's actual needs (per §1's audit) calls for Sentry's automatic IP-address/cookie capture that
  `sendDefaultPii: true` would add.
- **Automatic breadcrumb/request-context capture stays enabled, scoped to not include request/response
  bodies.** Not proposed to be disabled — doing so would give up real debugging value for a risk this
  app's default breadcrumb shape doesn't necessarily carry. **The invariant, stated as a requirement rather
  than an assumed fact (DRAFT-7, reframed per round-6's non-blocking #5): the effective breadcrumb
  configuration must not transmit request/response bodies.** Whether the installed SDK version's default
  fetch/XHR breadcrumb behavior already satisfies this, or needs a `beforeBreadcrumb` filter to enforce it,
  is a §2.0 verification result to record — not a permanent property of the architecture this document
  asserts in advance, since Sentry's own default integration behavior can change across versions.

**Ownership boundary, stated once:** the application-controlled tier is this task's own guarantee. The
SDK-controlled tier is governed by the explicit configuration set here, not by an implicit trust of
whatever the installed SDK version defaults to — see also §7's ownership note.

- Rewrite [debugLog.test.js](../../client/src/lib/debugLog.test.js) — its three existing tests all assert
  against the removed `localStorage`-backed `getLog`/`clearLog`/`setDebugEnabled` contract and need
  replacing with tests against `validateTelemetryShape()` + `logEvent()`: normal payloads (matching §1's
  table shapes) pass through unchanged; `data` omitted/`undefined` becomes `{}`; a non-object `data`
  (string/array/`Error`) is replaced with `{}`; a nested object/array/function *value inside* `data` is
  dropped, not forwarded, without needing to be traversed (including when that nested value contains a
  circular reference — proving the non-recursive design handles it by construction, not via a fallback
  path); an oversized string is truncated to exactly the configured max length with no appended marker; with
  the *real* `safeSentryLog()` in place but the underlying Sentry SDK log call stubbed to throw
  synchronously and, separately, to return a rejected Promise, a `logEvent()` call still completes without
  throwing or rejecting (failure isolation, §2.2 — testing the wrapper's own absorption, not a caller's
  incidental try/catch). Use the same lightweight stub/mock pattern already used elsewhere in this
  project's plain `node:test` setup, which has no jsdom.

### 2.4 Server wiring

- New `server/instrument.js`, calling `Sentry.init({ dsn: process.env.SENTRY_DSN, environment:
  process.env.SENTRY_ENVIRONMENT, release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown', enableLogs:
  true, sendDefaultPii: false, ... })` — `enableLogs`/`sendDefaultPii` mirror the client config (§2.2,
  §2.3b) for the same reasons; **`Sentry.init()` failing here must not prevent the server from starting**
  (same non-fatal-initialization requirement as the client, DRAFT-7, round-6's non-blocking #3).
- **Release identifier — byte-for-byte equality, not just "the same commit" (DRAFT-4, tightened per
  round-3's P1 #5).** `clientErrors.js` already reads `process.env.VERCEL_GIT_COMMIT_SHA` as its `deploy`
  field ([clientErrors.js:23-27](../../server/routes/clientErrors.js)), with the same "may be `'unknown'`
  depending on the project's 'Automatically expose System Environment Variables' setting" caveat it
  already documents. Reuse that exact value as Sentry's `release` on the server: **`server release ===
  process.env.VERCEL_GIT_COMMIT_SHA`**, not an approximation of it. On the client, the required invariant
  is **`client release === server release`, exactly, not merely "derived from the same commit"** — round-3
  correctly points out Sentry's release string isn't inherently identical to a raw git SHA, so "both sides
  conceptually reference the same deploy" isn't sufficient for the source-map correlation this is actually
  for. Prefer `@sentry/vite-plugin` (§2.1) to establish this automatically if §2.0's verification confirms
  its auto-detected release value is byte-for-byte equal to `VERCEL_GIT_COMMIT_SHA`; if it isn't (e.g. the
  plugin defaults to a different format), configure the release explicitly instead — e.g. by having
  `vite.config.js` read the raw (non-`VITE_`-prefixed) `process.env.VERCEL_GIT_COMMIT_SHA` at build time
  (available there since `vite.config.js` runs in Node with full env access, unlike client bundle code) and
  passing it explicitly as the plugin's/SDK's release value. Either path is acceptable; what's not
  acceptable is shipping without having confirmed which one actually holds — this is one of §2.0's gate
  items and its decision-table row (§2.0) must record which path was taken and why.
- **Plugin release-lifecycle configuration, explicit rather than default-trusted (DRAFT-7, new — round-6's
  required #4).** `@sentry/vite-plugin` has separate release-management responsibilities beyond just
  uploading source maps — release naming, injecting the release identifier into the built bundle, creating
  the release in Sentry, and finalizing it. This task's intended configuration: `release.name` forced to
  `process.env.VERCEL_GIT_COMMIT_SHA` (not the plugin's own auto-detection, given the byte-for-byte
  requirement above); source-map upload enabled for the client build's output directory; generated `.map`
  files not left in the deployed bundle after upload (uploaded, then excluded from what actually ships to
  browsers, consistent with not exposing more of the source than necessary). Exact option names
  (`release.inject`/`create`/`finalize`/equivalent) for the installed plugin version confirmed per §2.0
  item 4, but the *behavior* they need to produce is fixed here, not left to plugin defaults to decide.
- **`server/app.js`**, not `server/index.js` (see §1's "Two server entry points"). **The invariant that
  matters (DRAFT-6, reframed per round-5's §8): environment available → Sentry initialized → route/
  application modules evaluated** — everything else is one way of satisfying it. Concretely: add
  `import './instrument.js';` as the second line, immediately after the existing
  `import 'dotenv/config';` ([app.js:1](../../server/app.js)) and before every route import; sibling
  static imports within a single file evaluate in declaration order, so placing it second guarantees
  `dotenv/config` (or, in the local-dev path, `loadEnv.js` beforehand via `server/index.js`) has already
  populated `process.env.SENTRY_DSN` by the time `instrument.js` reads it. Because `app.js` is imported by
  **both** entry points (`server/index.js` for local dev, `api/index.js` for staging/production), this
  covers production, unlike a plan that only touches `server/index.js`.
- **Safe wrapper boundary and explicit failure contract.** All application-triggered capture calls go
  through one function, `captureExceptionSafely(error, { clientContext, requestId, deploy, householdId,
  userId })` (DRAFT-7: closed application-specific shape, not a generic `extra` passthrough — §2.3b),
  defined in `instrument.js` — `Sentry.init()` itself is exempt (necessarily a direct SDK call); every
  capture downstream of it is not. Never call `Sentry.captureException` directly from `app.js`'s error
  middleware or `clientErrors.js`. `captureExceptionSafely()`'s contract, explicit: **it MUST NOT throw
  synchronously or return a rejected Promise to its caller, under any failure mode** (SDK throws, rejects,
  isn't initialized, DSN missing) — all absorbed inside the wrapper. **Tested by stubbing the raw
  `Sentry.captureException` call to throw and to reject, with the real `captureExceptionSafely()` in place
  — not by stubbing `captureExceptionSafely()` itself, which would only test the error middleware's own
  code, not the wrapper's absorption behavior.** See §5 criterion 10, §6 step F.
- **Flush ownership belongs to the request lifecycle, not the wrapper (DRAFT-7, new — round-6's required
  #3).** If §2.0's verification finds an explicit `Sentry.flush()`/`close()` call is needed to guarantee
  delivery before a Vercel Function suspends, that call is made by the **error middleware itself**, after
  calling `captureExceptionSafely()` and before sending the HTTP response — `await Sentry.flush(timeoutMs)`
  with a short, documented timeout (bounding how much extra latency an already-degraded error response can
  incur), not an unbounded wait. This is deliberately **not** inside `captureExceptionSafely()`, which
  stays fire-and-forget per its own contract above — flushing is a property of *when this particular
  request's lifecycle ends*, not of the capture call itself, and conflating the two would mean every future
  caller of `captureExceptionSafely()` unknowingly inherits a blocking wait it may not want. If §2.0 finds
  the Vercel integration handles this automatically, no explicit flush call is needed and this bullet
  reduces to "no action" — but that finding must be recorded, not assumed.
- `server/app.js`'s final error middleware ([app.js:72-79](../../server/app.js)): add
  `captureExceptionSafely(err)` alongside the existing `console.error(err.stack)` — keep the
  `console.error` too, as a zero-maintenance-cost redundant trail in Vercel's own log stream. If §2.0
  determines an explicit flush is required, this is also where the bounded `await Sentry.flush(timeoutMs)`
  call belongs, per the flush-ownership bullet above — after `captureExceptionSafely()`, before
  `res.status(...).json(...)` sends the response.
- **2.4a — `clientErrors.js`.** Construct an `Error(req.body.message)` (Sentry needs an `Error` object to
  group/fingerprint against) and pass the *original* client-reported stack and componentStack through the
  wrapper's `clientContext` parameter (DRAFT-7: `captureExceptionSafely()`'s closed shape, §2.3b/§2.4) —
  `captureExceptionSafely(err, { clientContext: { originalStack: req.body.stack, componentStack:
  req.body.componentStack }, requestId, deploy, householdId, userId })`. The wrapper, not this call site,
  is responsible for turning `clientContext` into Sentry's `contexts.client.{originalStack,componentStack}`
  shape internally (field names unmistakable as client-reported, not server-side stack data) — exact
  internal API shape to confirm per §2.0. No additional size-limiting needed here — `reportSchema`'s
  existing `zod` bounds (`message` ≤ 2000, `stack`/`componentStack` ≤ 8000 chars) already cap this before
  the handler runs. This is the complete, closed set of fields this call site passes — nothing else, by
  construction of the wrapper's own signature now, not just by documented convention.

### 2.5 Delete: no ongoing value

- **[DebugPanel.jsx](../../client/src/components/DebugPanel.jsx)** — delete file. Remove its import and
  `<DebugPanel />` render from `App.jsx` ([lines 19, 174](../../client/src/App.jsx)).
- **[PreconnectGoogleOAuth.jsx](../../client/src/components/PreconnectGoogleOAuth.jsx)** — delete file.
  Remove its import ([App.jsx:20](../../client/src/App.jsx)) and unwrap `<SignIn>`/`<SignUp>` from it
  directly under `<PublicRoute>` ([App.jsx:126-143](../../client/src/App.jsx)).
- **[lifecycleLog.js](../../client/src/lib/lifecycleLog.js)** — delete file (all diagnostic-only; every
  question it was built to answer is already closed/archived). Remove its import and the three
  `install*Logging()` calls from `main.jsx` ([lines 6-10, 14-16](../../client/src/main.jsx)). Keep
  `installOauthMarkerListener()` — unrelated, production recovery behavior (§2.6).
- **`AuthStateLogger`/`SignFlowStateLogger`** ([App.jsx:71-107](../../client/src/App.jsx)) — delete both.
  Remove their `<AuthStateLogger />`/`<SignFlowStateLogger />` renders
  ([App.jsx:172-173](../../client/src/App.jsx)). **Justification (DRAFT-3, tightened per round-2's point
  #8 — dropped the "Sentry's automatic instrumentation covers this" clause as a supporting reason, since
  it overstated what an errors+logs-only Sentry setup with no performance/tracing product actually
  provides):** they're the two highest-volume `logEvent()` call sites in the app (every navigation), and
  that volume was free when gated behind an opt-in `localStorage` toggle nobody used unless actively
  debugging — it stops being free the moment `logEvent()` becomes unconditional remote telemetry (§2.3).
  That cost argument alone is sufficient. If a future auth incident needs transition-level detail these
  two provided, add a deliberately-scoped event for that investigation rather than reviving always-on
  per-navigation logging.
- **`authTransition.js`**: remove the `perfNowMs` field from the `oauth-marker-installed` `logEvent` call
  ([lines 194-201](../../client/src/lib/authTransition.js)) — TASK-064-follow-up instrumentation for a
  hypothesis TASK-067 superseded. Keep the `oauth-marker-installed` event itself (still useful to confirm
  the recovery-marker listener is firing) and every marker read/write/expiry function untouched (§2.6).
- **`authTransition.js`**: un-export `GOOGLE_BUTTON_SELECTOR` ([line 24](../../client/src/lib/authTransition.js))
  — drop the `export` keyword, make it a module-private `const`. Its only outside consumer was
  `lifecycleLog.js`, which this task deletes; `authTransition.js` itself still uses it internally.
- **`authTransition.js`**'s file-header comment ([lines 1-7](../../client/src/lib/authTransition.js))
  explicitly frames the file in terms of being "kept separate from `lifecycleLog.js`'s diagnostic-only
  logging" — reword once that file no longer exists, so the comment doesn't reference a deleted file.

### 2.6 Explicitly left untouched

`authTransition.js`'s markers (`readSignoutMarker`/`writeSignoutMarker`/etc.) and
`installOauthMarkerListener()`, `useAuthRecovery.js`, `useSettledAuth.js`, `routeDecision.js`,
`client/public/sw.js` — all confirmed load-bearing production behavior, independent of this closed
investigation, both by TASK-067 §0's own conclusion and by this session's audit. No changes proposed to
any of their logic.

---

## 3. Files

**Allowed:**
- `client/package.json`, `server/package.json` (add `@sentry/react`, `@sentry/vite-plugin`,
  `@sentry/node`)
- `client/vite.config.js` (if `@sentry/vite-plugin` requires build-config registration — per §2.0)
- `.env.example`, `server/.env.local`, `client/.env.local` (new env vars — local files are gitignored)
- `client/index.html` (proposed default: new `<script type="module" src="/src/instrument.js">` tag,
  before `main.jsx`'s — subject to §2.0)
- `client/src/instrument.js` (new — proposed default mechanism, subject to §2.0)
- `client/src/main.jsx` (remove `lifecycleLog.js` imports/calls; no longer the Sentry-init site itself)
- `client/src/App.jsx`
- `client/src/lib/debugLog.js`, `client/src/lib/debugLog.test.js`
- `client/src/lib/authTransition.js` (un-export + drop `perfNowMs` + header comment only — no change to
  marker logic)
- `client/src/lib/lifecycleLog.js` (delete)
- `client/src/components/DebugPanel.jsx` (delete)
- `client/src/components/PreconnectGoogleOAuth.jsx` (delete)
- `server/instrument.js` (new)
- `server/app.js` (this, not `server/index.js`, is where `instrument.js` gets imported)
- `server/routes/clientErrors.js`

**Forbidden:**
- `client/src/hooks/useAuthRecovery.js`, `useAuthRecovery.test.js`, `useSettledAuth.js`,
  `useSettledAuth.test.js`, `client/src/lib/routeDecision.js`, `routeDecision.test.js`,
  `client/src/context/AuthContext.jsx`, `client/src/api/index.js` — their existing `logEvent()` call
  sites need no edits; they inherit the new Sentry-backed behavior automatically through `debugLog.js`'s
  unchanged public API.
- `server/index.js` — already correctly loads env before `app.js`; no Sentry-specific change belongs here
  since `app.js` is the shared wiring point.
- `client/public/sw.js` — unrelated (TASK-067).
- `server/db/*` — no schema/migration work; `MIGRATION_LEDGER.md` doesn't apply to this task.
- All recipe/pantry/shopping/household business-logic files — unrelated.

---

## 4. Out of Scope

- Sentry session replay, performance tracing, or profiling — errors + logs only, matching what was
  actually asked for.
- Removing or migrating the ~43 other `console.log`/`console.error`/`console.warn` call sites scattered
  through `server/`, beyond the two touched in §2.4 — a much larger follow-up if ever wanted.
- Registering `getsentry/sentry-mcp` for Claude Code — a one-time local config step (e.g. `claude mcp
  add`), not a repo change; do once a Sentry project/org/DSN exists to point it at, after this task ships.
- A Sentry log-volume/sampling strategy for the free tier — flagged as a risk (§7), not solved here.
- Eliminating `err.message`-shaped free text from `logEvent()` payloads entirely (round-2's "Option A") —
  considered and explicitly not adopted; see §2.3a's residual-risk reasoning.
- A full Phase-A/B/C/D/E document restructure, as round-1 suggested — the substance (foundation → logging
  migration → error migration → cleanup → verification) is accepted and already matches this document's
  section order closely enough that a full renumbering wasn't judged worth the extra diff noise.

---

## 5. Acceptance Criteria

1. Sentry is verifiably initialized before `main.jsx`'s own import graph evaluates, using whichever
   mechanism §2.0's verification confirms is current best practice — not merely inferred from source-file
   statement ordering, and **checked mechanically against the production build, not dev-server behavior**
   (DRAFT-7, round-6's non-blocking #4) — **and §2.0's decision table is fully populated, not left as an
   unfilled checklist.** Server init happens via `server/instrument.js`, imported from `server/app.js`
   immediately after `dotenv/config`, active under **both** `server/index.js` (local) and `api/index.js`
   (staging/production). **`Sentry.init()` failing on either side does not prevent the client from booting
   or the server from starting (DRAFT-7, new — round-6's non-blocking #3).**
2. Every pre-existing `logEvent(tag, data)` call site (listed in §1) compiles and runs with zero changes
   to its own file — only `debugLog.js`'s internals changed underneath them. **A repo-wide grep for
   `logEvent(` across `client/src` is reconciled against §1's table at implementation time (DRAFT-5, new —
   round-4's P2 #2): every match is either in that table or is a new call site added since this spec was
   written, in which case it's added to the table and checked against §2.3a's shape allowlist before this
   criterion is considered met.** §1's table is an audit, not a permanently-accurate index by assumption.
3. `DebugPanel.jsx`, `PreconnectGoogleOAuth.jsx`, `lifecycleLog.js` are deleted; a repo-wide grep confirms
   no remaining import of any of the three.
4. No user-visible debug-log surface remains: specifically, the top-left 44×44px invisible tap-target is
   gone (verified via a DOM query for the removed element, not just visual inspection).
5. A deliberately-thrown client-side error and a deliberately-thrown server-side error each appear in the
   Sentry dashboard, correctly tagged with `environment` (`local`/`staging`/`production`).
6. Triggering a `logEvent()` call (e.g. sign in and let `useSettledAuth` settle, producing `auth-settled`)
   appears in Sentry's Logs view — **with `enableLogs: true` (or the installed SDK version's equivalent)
   confirmed present in the effective configuration first (DRAFT-7, round-6's required #2)**, since without
   it this call chain can complete with no exception thrown while nothing actually arrives in Sentry.
7. `npm run lint`, `npm run build`, and the full test suite (client + server) are green.
8. No CSP-related network errors appear in the browser console when the client SDK sends its first event.
9. **Telemetry shape enforcement.** `validateTelemetryShape()` correctly passes through every payload
   shape in §1's table unchanged; treats missing/non-object `data` as `{}`, using the mechanical
   "plain object" definition (§2.3a, DRAFT-5); drops — without traversing into — a nested object/array/
   function value at the top level of `data`, including one containing a circular reference (proven safe
   by construction, not by a fallback path); truncates an oversized `tag`/string value to exactly the
   configured max length with no appended marker; and **never throws for ordinary values and plain data
   objects — the only shapes any real call site in this codebase produces (DRAFT-5, scope corrected per
   round-4's P1-2; this is not a claim of safety against adversarial inputs like throwing getters or Proxy
   traps, which this design explicitly does not defend against — see §2.3a).**
10. **Failure isolation via the safe wrapper, tested at the correct boundary (DRAFT-5, corrected per
    round-4's P1-1).** With the *real* `safeSentryLog()`/`captureExceptionSafely()` implementations in
    place, and with the *underlying Sentry SDK operation* (`Sentry.logger.info`/equivalent,
    `Sentry.captureException`) stubbed to (a) throw synchronously and, separately, (b) return a rejected
    Promise: a `logEvent()` call and a server error-middleware invocation each complete without throwing,
    without an unhandled rejection, and without altering the outcome of the operation that triggered them
    (e.g. `logout()` still completes normally). **Stubbing the wrapper functions themselves, rather than
    the SDK call underneath them, does not satisfy this criterion** — that would only prove a caller has
    its own defensive try/catch, not that the wrapper absorbs a failing SDK call, which is the actual
    guarantee this criterion exists to verify.
11. **Duplicate-error verification.** A single deliberately-thrown React render error (caught by
    `ErrorBoundary`) produces **exactly one Sentry event attributable to that exception** (via the
    server-side `/api/client-errors` path), with no second event independently generated by the client
    SDK's global error/`unhandledrejection` handlers (DRAFT-4, round-3's P1 #9 — tightened from
    "actionable event," which was ambiguous about whether two differently-fingerprinted events would
    count as one or two).
12. **Source maps and release identity.** A deliberately-triggered client-side exception against a
    production-built (not dev-server) bundle resolves in the Sentry dashboard to original source
    file/line, not minified output, and its release identifier is **byte-for-byte equal** to
    `process.env.VERCEL_GIT_COMMIT_SHA` for that deploy — and the corresponding server-side event for the
    same deploy carries that identical value, not merely one that references the same commit some other
    way (DRAFT-4, round-3's P1 #5; see §2.4).
13. **Serverless delivery under multiple invocations.** Trigger a known batch of **N** server-side errors
    (e.g. N = 10) across separate Vercel Function invocations (not one single error in one invocation) and
    confirm **all N expected events** reach Sentry within an observed delivery window, recorded in the
    implementation notes rather than left as "eventually" (DRAFT-4, round-3's P1 #17 — a specific count is
    unambiguous; "the expected event count" was not).
14. **Old debug API surface completely removed.** A repo-wide grep for `kk_debug_enabled`, `kk_debug_log`,
    `isDebugEnabled`, `setDebugEnabled`, `getLog`, and `clearLog` returns zero matches. **No code anywhere
    in the migrated debug-log subsystem — not just `logEvent()` itself — reads or writes any `kk_debug_*`
    storage key (DRAFT-7, broadened per round-6's §14)**, catching an accidental leftover helper even if
    the main call sites are clean. This makes the retirement of the local diagnostic system a mechanical,
    grep-verifiable fact, not just an inference from "the old functions were deleted in §2.3."
15. **Effective Sentry configuration and observed traffic, checked as two separate things (DRAFT-7, split
    per round-6's required #3 — a runtime observation alone doesn't prove a capability is disabled).**
    - **15a — Configuration invariant:** the effective Sentry configuration (client and server, after any
      bundled integration/preset defaults are accounted for) has no enabled capability that would generate
      tracing/spans/transactions, session replay, profiling, or metrics — checked against configuration,
      not against whether one happened to fire during a test.
    - **15b — Runtime observation:** a controlled test session's observed outbound traffic (or the Sentry
      project's own event breakdown) contains only the event classes 15a's configuration permits — errors
      and logs. 15b alone (a quiet session producing no unwanted event) does not satisfy 15a — the absence
      of a transaction during a short test doesn't prove tracing is disabled, only that none happened to
      fire; both checks are required together.
16. **Telemetry governance beyond `logEvent()` (see §2.3b, DRAFT-7 narrowed).** `captureExceptionSafely()`'s
    signature itself only accepts the closed, application-specific parameter shape (§2.3b, §2.4) — not a
    generic Sentry `extra` object a caller could stuff arbitrary data into. Both `Sentry.init()` calls
    explicitly set `sendDefaultPii: false`. The effective breadcrumb configuration is confirmed, per §2.0's
    verification, not to transmit request/response bodies; if the installed SDK version's default doesn't
    already satisfy that, a `beforeBreadcrumb` filter is in place and this criterion is verified against
    the filtered behavior, not the unfiltered default.
17. **Client/server `environment`/`release` observed as one joint invariant, not two independent facts
    (DRAFT-6, new — round-5's §15).** A single deliberately-triggered pair of events (one client, one
    server, same deploy) shows `client.environment === server.environment` and
    `client.release === server.release === process.env.VERCEL_GIT_COMMIT_SHA` for that deploy, checked
    together against the same pair of events — not `environment` correctness and `release` correctness
    verified separately against different test events (criterion 5 and criterion 12, tied together).
18. **Dependency-policy exception recorded (see §2.1a).** The `package.json`/`client/package.json`/
    `server/package.json` diffs introduce **exactly three new *direct* dependencies** (DRAFT-7, reworded
    per round-6's non-blocking #2) — `@sentry/react`, `@sentry/node`, `@sentry/vite-plugin` — no other
    direct dependency changes; transitive lockfile additions are those induced by installing those three
    and are reconciled against that installation, not evidence of a fourth direct package sneaking in. All
    three are version-pinned (not left on an unbounded range), `@sentry/react`/`@sentry/node` specifically
    pinned as one documented-compatible pair (criterion 22), and the installed versions recorded in §2.0's
    decision table.
19. **Build-time Sentry credentials configured correctly, separate from runtime vars (DRAFT-7, new —
    round-6's required #1; see §2.1a).** `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (or the
    installed plugin's exact equivalents) are present in Vercel's Production/Preview build environment,
    absent from any client-exposed (`VITE_`-prefixed) scope, and confirmed via `npm run build`'s output
    (or Sentry's own release view) to have actually authorized a source-map upload/release creation for
    that build. A local build with these values unset completes successfully (source maps just aren't
    uploaded), not a build failure.
20. **Release-lifecycle plugin configuration matches the documented intent (DRAFT-7, new — round-6's
    required #4; see §2.4).** The built bundle's uploaded source maps are associated with a release whose
    name is exactly `process.env.VERCEL_GIT_COMMIT_SHA` (not the plugin's own auto-detected value, unless
    §2.0 confirmed those are identical), and generated `.map` files are not present in what's actually
    served to browsers post-build.
21. **Serverless flush ownership implemented as decided in §2.0 (DRAFT-7, new — round-6's required #3; see
    §2.4).** If §2.0 determined an explicit flush is required: the error middleware — not
    `captureExceptionSafely()` — calls `await Sentry.flush(timeoutMs)` with the documented bounded timeout,
    after capture and before the response is sent; `captureExceptionSafely()` itself remains fire-and-forget
    per criterion 10, unmodified by this requirement. If §2.0 determined the Vercel integration handles
    delivery automatically, no explicit flush call exists and this criterion is satisfied by that recorded
    finding plus criterion 13's burst-delivery smoke test passing.
22. **`@sentry/react`/`@sentry/node` version compatibility is a documented decision, not two independent
    pins (DRAFT-7, new — round-6's non-blocking #1).** §2.0's decision table records why the specific pair
    of pinned versions is compatible (e.g. same major/minor line) and confirms both support the Logs API
    verified in criterion 6 — not merely what each package independently resolved to.

---

## 6. Verification Steps

**Step 0.** Complete §2.0's pre-implementation verification gate; record findings before proceeding.

**A. Local error capture.** Run both dev servers. Temporarily throw in a component and in a server route,
confirm both land in Sentry, then revert the temporary throws.

**B. Log capture.** Sign in locally, confirm `auth-settled` (and other low-volume call sites) land as
Sentry Logs, correctly tagged.

**C. Deletion verification.** `grep -r` for `DebugPanel`, `PreconnectGoogleOAuth`, `lifecycleLog`,
`installLifecycleLogging`, `installClickLogging`, `installUrlChangeLogging` across `client/src` — zero
remaining references outside the deleted files themselves.

**D. Regression smoke test.** Manually run the actual sign-in flow (desktop Chrome first, per this
project's Rule 9 precedent) to confirm removing `PreconnectGoogleOAuth`/`AuthStateLogger`/
`SignFlowStateLogger` causes no regression.

**E. Telemetry shape check.** Feed `logEvent()`, using only ordinary values and plain data objects (per
criterion 9's scoped guarantee — not adversarial getters/Proxies, which are out of scope by design): an
omitted/`undefined` `data`; a non-object `data` (string/array/`Error`); a `data` whose top-level values
include a nested object, an array, and an object containing a circular reference; and an oversized
`tag`/string value. Confirm the behavior matches criterion 9 exactly — pass-through for safe shapes, `{}`
substitution for non-object `data`, silent drop (no traversal, no throw) for unsafe nested values including
the circular one, exact-length truncation with no appended marker for oversized strings.

**F. Failure-isolation check (DRAFT-5, corrected boundary — round-4's P1-1).** Keep the real
`safeSentryLog()`/`captureExceptionSafely()` implementations. Stub the underlying `Sentry.logger.info`/
equivalent and `Sentry.captureException` calls to throw synchronously; separately, stub them to return a
rejected Promise. In each of the four cases, confirm `logout()` and a triggered `logEvent()` call both
still complete normally from the caller's perspective (criterion 10). Do **not** stub the wrapper functions
themselves for this check — that tests a different, unintended thing.

**F2. Repo-wide `logEvent(` reconciliation (DRAFT-5, new — round-4's P2 #2).** Grep `client/src` for
`logEvent(`; confirm every match is accounted for in §1's table (or, if a new call site was added since
this spec was written, add it to the table and check its payload against §2.3a before treating criterion 2
as met).

**F3. Effective-configuration check, split into two (DRAFT-7, per round-6's required #3).**
- **F3a (criterion 15a):** review the effective `Sentry.init()` configuration (client and server, after
  any bundled integration/preset defaults §2.0 turned up) and confirm no tracing/replay/profiling/metrics
  capability is enabled — a configuration review, not a traffic observation.
- **F3b (criterion 15b):** separately, during a normal test session, inspect outgoing network requests (or
  the Sentry project's own event breakdown) and confirm only error and log events are actually sent. Do
  not treat F3b passing alone as sufficient — a quiet session proves nothing about F3a.

**F4. Telemetry governance check.** Confirm both `Sentry.init()` calls set `sendDefaultPii: false`
explicitly. Trigger `captureExceptionSafely()` from both its call sites (server error middleware,
`clientErrors.js`) using its closed parameter shape (`clientContext`/`requestId`/`deploy`/`householdId`/
`userId` — DRAFT-7, §2.3b) and confirm the resulting Sentry event's context matches exactly that set —
nothing else, and confirm attempting to pass an arbitrary extra field is rejected by the function's own
signature (a type/lint error, or simply not possible to express), not merely by convention. Inspect a
captured fetch/XHR breadcrumb and confirm it contains method/URL/status only, not request/response bodies;
if it does, confirm a `beforeBreadcrumb` filter is in place and re-check against the filtered output
(criterion 16).

**F7. Build-time credentials check (DRAFT-7, new — round-6's required #1).** With
`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` set (Preview/Production build environment), run `npm run
build` and confirm source maps upload and a release is created/finalized in Sentry, named exactly
`process.env.VERCEL_GIT_COMMIT_SHA`. Then with those three values unset, run `npm run build` again locally
and confirm it still completes successfully — source maps simply aren't uploaded (criterion 19).

**F8. Release-lifecycle/artifact check (DRAFT-7, new — round-6's required #4).** After a build with
build-time credentials present, confirm generated `.map` files are not present in the deployed/served
output, and that the release the source maps are associated with matches
`process.env.VERCEL_GIT_COMMIT_SHA` exactly (criterion 20).

**F9. Flush-ownership check (DRAFT-7, new — round-6's required #3).** Per §2.0's recorded finding: if an
explicit flush is required, confirm the error middleware — not `captureExceptionSafely()` — calls
`Sentry.flush()` with the documented bounded timeout, and that `captureExceptionSafely()` itself is
unmodified (still fire-and-forget, criterion 10 still passes). If no explicit flush is required per §2.0,
confirm that finding is recorded and rely on the burst-delivery smoke test (step I) instead (criterion 21).

**F10. Version-compatibility check (DRAFT-7, new — round-6's non-blocking #1).** Confirm §2.0's decision
table states why the pinned `@sentry/react`/`@sentry/node` pair is compatible and both support the Logs
API exercised in step B (criterion 22).

**F11. Init-failure-doesn't-block-boot check (DRAFT-7, new — round-6's non-blocking #3).** Temporarily
break `Sentry.init()` (malformed DSN, or make the instrument module throw) on the client; confirm the app
still boots and renders. Repeat for the server; confirm it still starts and serves requests. Revert the
temporary breakage afterward (criterion 1).

**F12. Mechanical init-ordering proof against the production build (DRAFT-7, new — round-6's non-blocking
#4).** `npm run build`, serve the output statically (not the dev server), and confirm — by inspecting the
built `index.html`'s script ordering and/or a runtime check from a module `main.jsx` imports — that Sentry
is actually initialized before that module runs, not merely textually structured to look that way
(criterion 1).

**F5. Joint environment/release check (DRAFT-6, new — round-5's §15).** From a single deliberate
client+server event pair for the same deploy, confirm `client.environment === server.environment` and
`client.release === server.release === process.env.VERCEL_GIT_COMMIT_SHA`, read off the same pair of
events rather than two separately-verified facts (criterion 17).

**F6. Dependency-policy check (DRAFT-6, new — round-5's required #2).** `git diff` on `package.json`/
`client/package.json`/`server/package.json` shows exactly `@sentry/react`, `@sentry/node`,
`@sentry/vite-plugin` added, each pinned to a specific version; those versions match §2.0's decision table
(criterion 18).

**G. Duplicate-error check.** Deliberately throw inside a React component under `ErrorBoundary`; confirm
exactly one Sentry event results, attributable to that exception, with no independent second event from
the client SDK's global handlers (criterion 11).

**H. Source-map and release check.** Build the client for production (`npm run build`), serve the built
output (not the dev server), trigger a deliberate exception, confirm the Sentry event resolves to original
source location and that its release identifier is byte-for-byte equal to
`process.env.VERCEL_GIT_COMMIT_SHA` for that build, matching the value the corresponding server-side event
for the same deploy carries (criterion 12).

**I. Serverless delivery smoke test (DRAFT-7, relabeled per round-6's §15 — this demonstrates delivery
isn't universally broken under this deployment's flush behavior, not a statistical reliability guarantee).**
Trigger exactly N = 10 separate server-side errors across separate invocations (e.g. separate requests to a
temporarily-added throwing test route, hitting a deployed Preview rather than one warm local process);
confirm all 10 arrive in Sentry, and record the observed delivery window along with the deployment SHA and
environment actually exercised in the implementation notes (criterion 13) — a bare "10/10 delivered"
doesn't say which deployment configuration produced that result.

**J. Old-API removal check (DRAFT-4, new).** Grep the repo for `kk_debug_enabled`, `kk_debug_log`,
`isDebugEnabled`, `setDebugEnabled`, `getLog`, `clearLog`; confirm zero matches (criterion 14).

**K. Build/lint/test.** `npm run lint`, `npm run build`, full test suite (criterion 7).

---

## 7. Known Risks / Open Questions

- **The shape allowlist governs application-supplied data only, not Sentry's own automatic context
  (DRAFT-4, new — round-3's P2 #11).** §2.3a's `validateTelemetryShape()` constrains what `logEvent()`'s
  own `tag`/`data` arguments may contain. It is not a guarantee that the Sentry SDK itself emits no other
  metadata alongside an event — URL, browser/user-agent information, breadcrumbs, request context, and
  similar automatically-attached fields are the SDK's own behavior, outside this allowlist's scope
  entirely. Not proposed to be disabled in this task; named here so the telemetry contract (§2.3a) isn't
  mistaken for a claim about the complete contents of every Sentry event. **Ownership, stated plainly
  (DRAFT-5, new — round-4's P2 #7):** the application guarantees the shape/content constraints for data it
  explicitly submits via `logEvent()`; Sentry SDK-generated metadata remains governed by Sentry's own SDK
  configuration and privacy controls and is not covered by this application-level contract.
- **`err.message` string content is bounded, not scrubbed.** The
  shape allowlist (§2.3a) guarantees `data` can't smuggle nested application content through `logEvent()`,
  but a permitted string's *content* is never semantically inspected. This is a deliberate, stated
  trade-off (§2.3a), not an oversight: eliminating free-form error messages entirely was considered and
  not adopted, because it would require touching call sites this spec otherwise avoids touching and would
  lose real debugging value. **Accepted specifically because §1's table shows every audited call site is
  an operational-failure path (token refresh, sign-out, fetch retry) that never reads from or echoes
  user-entered content (DRAFT-6, reworded per round-5's §10) — evidence, not a general risk judgment.**
- **`captureExceptionSafely()`'s contract is now API-enforced, not just documented (DRAFT-7, resolved per
  round-6's required #5 — previously listed here as a risk in DRAFT-6).** The wrapper's own signature only
  accepts the closed `{ clientContext, requestId, deploy, householdId, userId }` shape (§2.3b, §2.4); a
  caller cannot pass an arbitrary Sentry `extra`/`contexts` object through it. No residual risk from this
  specific gap remains.
- **Exact current Sentry SDK API surface, Vite init mechanism, and serverless flush behavior are gated by
  §2.0, not assumed in this spec's prose.** Every place this document proposes specific method
  names/config (`Sentry.logger.info`, the `<script>`-tag mechanism, the `@sentry/vite-plugin` config
  surface) is a starting point for §2.0's verification, not a locked implementation detail.
- **Log volume / free-tier quota.** `auth-settled` and the `auth-fetch-*`/`signout-*` events are low
  volume, and `AuthStateLogger`/`SignFlowStateLogger` — the highest-volume sites — are deleted (§2.5). No
  sampling strategy is decided for future growth.
- **Duplicate-error reasoning (§2.2) is a design rationale, not a settled fact** — §5 criterion 11 and
  §6-G exist specifically because "React error boundaries prevent this" is being treated as something to
  confirm, not something to trust blindly.
- If, after this ships, a future bug needs the kind of on-device capture `kk_debug_log` provided (e.g. a
  platform with no viable remote-debugging *and* no network connectivity to reach Sentry at the moment of
  interest), that's a real gap this task accepts — Sentry requires a network path to report anything, which
  `localStorage` didn't.

---

## Status

**DRAFT-7 — APPROVED (round-7, 9.8–10/10, APPROVE / READY FOR IMPLEMENTATION). Not yet implemented.**
Seven review rounds closed every architectural gap raised: telemetry data classification, client/server
initialization ordering, the shape-allowlist design, both safe wrappers' failure contracts, the production
server-entry-point fix, byte-for-byte release identity, multi-invocation delivery, the dependency-policy
exception, telemetry governance beyond `logEvent()`, and the Vite plugin's build-time credentials/
release-lifecycle contract. Round-7 explicitly closed six specific questions as not to be reopened (see
review history above). Implementation should proceed in order: **§2.0's pre-implementation verification
gate first** (its decision table must be fully populated — package versions/compatibility, the client init
mechanism, the Logs API + `enableLogs` flag, serverless flush ownership, the Vite plugin's full
configuration surface, and the build-time credential names/scopes — before any code is written), then
§2.1–§2.6 in order, verified against §5/§6. Implementation requires real Sentry account setup (org,
project, DSN, and a scoped auth token) that only Connor can provide — that's the next dependency before
work can start.
