# Task

TASK-063 implementation — iOS PWA double sign-in/sign-out: don't trust Clerk's first post-mount reading
(`loading -> settling -> settled` state machine), per [TASK-063-spec.md](../tasks/TASK-063-spec.md) DRAFT-3
(approved for implementation, architect review round 3).

# Current Status

Implemented DRAFT-3 in full per Section 3 and self-checked line-by-line against the Section 9 Final
Acceptance Checklist (all code-side items ✅; the two deployment-verification-gate items are explicitly
**not done** — see Remaining Work). **Not committed, not deployed** — this session only implemented and
verified locally; the user did not ask for a commit/push, unlike the TASK-061/062 sessions.

`OAuthReturnGuard` and `client/src/lib/oauthReturn.js` are fully removed (TASK-062's fix never actually fired
in any of TASK-063's three real repro captures, per spec Section 0 — confirmed dead code, not a regression).
Replaced by `SettledAuthProvider`/`useSettledAuth()` — a shared `loading -> settling -> settled` state
machine — and `PrivateRoute`/`PublicRoute` now branch on a pure, independently-tested routing-decision
function instead of Clerk's `<SignedIn>`/`<SignedOut>` directly.

One implementation deviation from the spec's literal file list, necessary and confirmed by direct
measurement: `resolveRouteDecision()` could **not** stay inside `App.jsx` as spec Section 3.2 suggested,
because this codebase's client tests run via plain `node --test` (no loader/transform), which cannot resolve
`.jsx` files at all — confirmed directly (`ERR_UNKNOWN_FILE_EXTENSION`, thrown before any parsing). Extracted
to `client/src/lib/routeDecision.js` (plain `.js`, no JSX) instead; `App.jsx` imports it. Same constraint
didn't apply to `useSettledAuth.js` since it was already specified as `.js` and avoids JSX syntax internally
(uses `createElement` directly for its one `Provider` element).

# Files Modified

- `client/src/hooks/useSettledAuth.js` — new. `SettledAuthProvider`, `useSettledAuth()`, exported pure
  `settledAuthReducer()` (explicit state transitions) and `computeSettlement()` (pure model of the
  settling-timing algorithm, used only for exhaustive unit testing — the real provider reacts to events via
  actual `setTimeout`s, which a pure function evaluating an already-known trace can't do). `SETTLE_QUIET_MS`
  = 400, `SETTLE_MAX_MS` = 2000 (both provisional per spec).
- `client/src/hooks/useSettledAuth.test.js` — new. 19 tests: reducer transitions + terminal/passthrough
  behavior, and every `computeSettlement` trace from Acceptance Criterion 2 (including both ~1500ms/~1900ms
  debounce-reset boundary cases).
- `client/src/lib/routeDecision.js` — new. `resolveRouteDecision()`, extracted out of `App.jsx` for the
  reason above.
- `client/src/lib/routeDecision.test.js` — new. 8 tests covering Acceptance Criterion 6, including both
  `PrivateRoute`- and `PublicRoute`-shaped calls (PublicRoute inverts the result at its own call site, per
  spec Section 3.2).
- `client/src/App.jsx` — `PrivateRoute`/`PublicRoute` now call `useSettledAuth()` + `resolveRouteDecision()`;
  `OAuthReturnGuard` and its `oauthReturn.js` imports removed; `AuthStateLogger` untouched (still reads raw
  Clerk `useAuth()`, diagnostic-only, comment updated to no longer reference the removed guard).
- `client/src/context/AuthContext.jsx` — mounts `SettledAuthProvider` inside `AuthProvider`, wrapping
  `children`. Resulting order: `ClerkProvider` (main.jsx, unchanged) → `AuthProvider` → `SettledAuthProvider`
  → rest of the app, exactly as spec Section 4 required.
- `client/src/lib/debugLog.js` — gained `isStandalonePwa()`, relocated from the deleted `oauthReturn.js`
  (still needed by `main.jsx`'s `app-boot` diagnostic).
- `client/src/main.jsx` — imports `isStandalonePwa` from `debugLog.js` instead of the deleted file.
- `client/src/lib/oauthReturn.js` — deleted.
- `ai/handoffs/archive/TASK-062-implementation.md` — new, archived TASK-062's full write-up per Size
  Discipline (superseded by this session; also records that `OAuthReturnGuard` turned out to be dead code).
- `ai/handoffs/CURRENT_STATE.md` — this file.

# Files Required Next

- None to implement further. Next session's job (or later this session, if the user asks): review the diff,
  commit, then handle deployment + the Section 9 deployment-verification gates (see Remaining Work).

# Files Already Reviewed

`client/src/App.jsx`, `client/src/context/AuthContext.jsx`, `client/src/lib/oauthReturn.js`,
`client/src/lib/debugLog.js`, `client/src/main.jsx`, `client/src/api/index.ndjson.test.js` and
`index.authRetry.test.js` (existing test-style precedent), `client/package.json` / root `package.json` (test
scripts — confirmed root `npm test` does **not** run any client tests, same gap noted in TASK-062's handoff;
client tests only run via `node --test` inside `client/`), `client/vite.config.js` (confirmed no `.js`→JSX
loader override, which is why plain `.js` files in this codebase must avoid JSX syntax to stay importable by
`node --test`).

# Dependency Chain

Editing: `client/src/hooks/useSettledAuth.js` (new), `client/src/lib/routeDecision.js` (new), `client/src/App.jsx`,
`client/src/context/AuthContext.jsx`, `client/src/lib/debugLog.js`, `client/src/main.jsx`.
Requires: Clerk's `useAuth()` (`isLoaded`/`isSignedIn`) via `@clerk/clerk-react` (no new dependency, already
installed).
Irrelevant: `client/src/api/index.js` and all of `server/*` — explicitly forbidden by TASK-063's own Files
section (TASK-061's surface; confirmed untouched, its `authRetry` test suite still green).

# Architecture Notes

`useSettledAuth.js` splits into two independently-testable pure pieces plus a thin React adapter:
`settledAuthReducer()` (explicit `loading`/`settling`/`settled` transitions, no timers/Clerk knowledge) and
`computeSettlement()` (a pure model of the debounce/ceiling timing algorithm, fed a complete trace — used
only by tests, since the real provider must react online to events it doesn't yet know the future of).
`SettledAuthProvider` wires both to real Clerk state + real `setTimeout`s: a `rawRef` holds the latest Clerk
`isSignedIn`, updated synchronously every render (never read from a timer-closure, per spec Section 3.1.2's
hard requirement); the quiet timer clears and reschedules on every render where `isSignedIn` is a defined
boolean; the max-deadline timer is armed exactly once, the first time `settling` is entered, and never reset.

`resolveRouteDecision()` lives in its own plain-`.js` file specifically so it stays importable by this
codebase's `node --test`-only setup (see Current Status for why `.jsx` files can't be).

# Decisions Made

- Extracted `resolveRouteDecision()` to `client/src/lib/routeDecision.js` instead of keeping it in `App.jsx`
  as spec Section 3.2 suggested — confirmed necessary by direct measurement (`node --test` throws
  `ERR_UNKNOWN_FILE_EXTENSION` on `.jsx`), not a stylistic preference. Spec explicitly left the exact
  shape/location as "implementation's call."
- Added `computeSettlement()` as a second pure function alongside the reducer, purely to make the timing
  algorithm (debounce resets, max-ceiling boundary behavior) exhaustively testable without fake-timer or DOM
  infrastructure — the real provider's `setTimeout`-based implementation is a separate (structurally
  matching) implementation of the same rules, since a pure function can't react to not-yet-known future
  events the way the real hook must. Documented this split explicitly in the file so it doesn't read as
  redundant or drift silently.
- Did not add any new test infrastructure (no `@testing-library/react`, no `jsdom`) — matches spec Section 7's
  explicit instruction and this codebase's existing plain-`node:test` precedent.
- Left `AuthStateLogger` untouched per spec (still reads raw Clerk `useAuth()` for diagnostic comparison
  against the new settled snapshot) — only updated its comment, which referenced the now-removed guard.

# Remaining Work

1. **Not committed or deployed this session** — the user asked to implement the spec, not to ship it; commit
   is the user's call. `git status` currently shows the file set under Files Modified as unstaged changes.
2. **Section 9's two deployment-verification-gate checklist items are still fully pending, same as TASK-062's
   deferred on-device step was**: after this ships, perform the real iOS PWA repro (sign in, sign out, no
   other screens — Connor's existing recipe) with debug logging enabled, confirm the captured log shows
   `settling`→`settled` suppressing the previously-visible raw `clerk-auth-state` flips, and record the real
   `settleElapsedMs`/`settleReason`/`navigationType`/`settleInitialIsSignedIn`/`settleFinalIsSignedIn`
   distribution — the first real data toward validating or retuning `SETTLE_QUIET_MS`/`SETTLE_MAX_MS`.
   **TASK-063 is not "done" until this runs**, per the spec's own framing (approval covers the
   architecture/spec, not a confirmed fix).
3. Unrelated, carried forward: TASK-059's remaining phone-driven checklist rows (AUTH-1–5, ONB, HH, DASH,
   PANTRY, REC, SHOP, CHAT, DIET, PUSH, VIS-2–5, ERR-2/3/5) still pending a human pass; two disposable Clerk
   accounts (`+zzsmokeB@gmail.com`, `+zzsmokeC@gmail.com`) still need manual deletion from production Clerk;
   Section 2 finding 7 (unhandled `forceRefreshToken()` rejection) still not addressed by any spec, per
   TASK-063 Section 8.

# Known Risks / Open Questions

- **Whether `SETTLE_MAX_MS = 2000` is safe against real-world slow OAuth/session-restoration latency remains
  genuinely unresolved** — per spec Section 8, this is an empirical question no unit test can answer. The
  boundary tests in `useSettledAuth.test.js` prove the debounce-reset mechanic behaves correctly right up to
  the ceiling; they don't and can't prove 2000ms is long enough under real degraded network conditions.
- **This is the third fix attempt at the same user-facing symptom (TASK-061, TASK-062, TASK-063)** — the
  first two both shipped green-tested and the bug persisted; per spec Section 0, both were independently
  confirmed from real captured logs not to be the mechanism (TASK-061's retry logic engaged correctly every
  time; TASK-062's guard never fired even during an actual successful sign-in). Worth treating "tests pass"
  as necessary but not sufficient evidence again this time — the deployment-verification gates (Remaining
  Work #2) are load-bearing, not optional polish.
- Every mount now incurs some settlement latency (up to `SETTLE_QUIET_MS`, or up to `SETTLE_MAX_MS` if never
  quiet) — an accepted, spec-acknowledged UX cost, not a regression; `navigationType` + `settleElapsedMs`
  diagnostics exist specifically so this is measurable from real usage once shipped.
- Pre-existing, unrelated, untouched working-tree modifications remain (`.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md`) — not part of this change.
- Carried forward, unrelated: TASK-058/TASK-060 still placeholders; TASK-054's `consume_pantry_item`-on-
  truncated-item gap; Clerk Dashboard sign-up/bot-protection settings unverified.

# Verification Results

- `npm run lint` (root, `eslint .`): PASS, no warnings/errors.
- `npm run build` (root → `client`): PASS, `vite build` succeeded (pre-existing >500kB chunk-size warning,
  unrelated to this change).
- `npm test` (root): PASS — 98/98 tests (shared + server only; root script does not include client tests,
  same pre-existing gap noted in TASK-062's handoff).
- `node --test "src/**/*.test.js"` (client, run directly — root `npm test` doesn't cover this): PASS — 35/35,
  including the pre-existing `index.authRetry.test.js` (TASK-061's regression suite, confirmed still green
  and unmodified) and `index.ndjson.test.js`.
- Device-side verification (spec Section 7 / Section 9's deployment gates): **NOT RUN** — requires a human on
  the real installed iOS PWA; see Remaining Work #2.

# Recommended Next Action

Review the diff (`git status`/`git diff`), and if it looks good, commit and deploy per the user's normal
staging → production flow. No migration is involved, so `MIGRATION_LEDGER.md` needs no new row (confirmed:
"None currently open" at session start, and this change touches no schema). After deploying, perform the
real on-device repro (Remaining Work #2) before treating TASK-063 as solved, not just shipped.

# Forbidden Exploration

- `client/src/api/index.js` and all of `server/*` — explicitly forbidden by TASK-063's own Files section.
- Any TASK-059 row requiring account creation/credential entry, and the on-device repro itself — both
  require a human on a real device, not agent-driven browser tooling; standing project rule.

# Context Notes

- branch: `staging` (working tree only — nothing committed this session).
- No dev servers started this session; verification was build/lint/test only, not a live browser session.
- No worktree used.
- Session followed the AI Development Agent Efficiency Guide's orientation protocol (read `CURRENT_STATE.md`,
  `TASK-063-spec.md`, `MIGRATION_LEDGER.md` — confirmed no outstanding gaps and not applicable to this
  client-only change).

---

## Archived History

- TASK-047 through TASK-053 (spec-drafting + TASK-053 streaming implementation session): see
  [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054 (chat context-size cap implementation session): see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055 (post-audit hardening implementation session): see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056 (UI/UX effort-reduction redesign implementation session): see
  [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting session (5 architect review rounds, DRAFT-1 → DRAFT-6 approved): see
  [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation session (Phases 1-3 shipped, judgment calls resolved): see
  [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting session: see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy session (auth session-race fix, shipped to staging + production): see
  [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke-test session (ADMIN/SEC/ERR rows via real browser sessions): see
  [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting session (DRAFT-1 → DRAFT-4 approved, 4 architect review rounds): see
  [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy session (OAuth-return reload guard, shipped to staging + production, later
  found dead code and removed by TASK-063): see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
