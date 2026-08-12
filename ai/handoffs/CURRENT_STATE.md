# Task

TASK-064 implementation — iOS PWA double sign-in/sign-out recovery mechanism, per
[TASK-064-spec.md](../tasks/TASK-064-spec.md) DRAFT-6 (approved, ~9.5/10). **Implemented, committed
(`10fff5e`), and deployed to both `staging` and `production` this session, on Connor's explicit instruction —
ahead of the on-device verification this task's own spec calls load-bearing (spec Section 7). That
verification is now the very next step, against a real, already-live environment.**

# Current Status

Marker-based recovery mechanism implemented, surviving the uncommanded WebKit-level reload (spec Section 2)
that can land mid-`signOut()` or mid-Google-sign-in-tap. Sign-out gets a bounded, session-ID-verified
automatic repair (Rule 1 + Rule 2, spec Section 3.2); sign-in gets an explicit re-prompt toast, never
automatic navigation (spec Section 3.3). All 20 acceptance criteria (spec Section 6) verified against the
implementation.

# Files Modified

New:
- `client/src/lib/authTransition.js` — marker read/write/clear/expiry for `kk_pending_signout` +
  `kk_pending_oauth`, fail-closed parsing, plus `installOauthMarkerListener()` (production Google-button click
  listener, separate from `lifecycleLog.js`'s diagnostic-only click logging).
- `client/src/lib/authTransition.test.js` — 18 tests (round-trip, monotonicity, expiry, fail-closed parsing,
  storage-failure-never-blocks).
- `client/src/hooks/useAuthRecovery.js` — `decideSignoutRecovery()`/`decideSigninRecovery()` (pure, exported)
  implementing Rule 1 (continuous raw-`isSignedIn`-false clearing), Rule 2 (bounded, session-ID-verified
  repair), and the sign-in re-prompt table. `useAuthRecovery()` hook wires these up, returns
  `{ recovering, recoveryMessage }`.
- `client/src/hooks/useAuthRecovery.test.js` — 14 tests, all spec Section 7 named regressions incl. both P0
  variants, null-sessionId guard, attempt:1-never-retries.

Modified:
- `client/src/context/AuthContext.jsx` — `logout()` writes the marker before `signOut()`, no longer clears it
  itself (ownership moved to `useAuthRecovery()` — DRAFT-1's original bug, now structurally unrepeatable).
- `client/src/lib/routeDecision.js` + `.test.js` — `resolveRouteDecision()` gains `recovering`; forces
  `render-nothing` even when settled + signed in.
- `client/src/App.jsx` — added `AppRoutes()`, the single call site for `useAuthRecovery()` (see Architecture
  Notes). `PrivateRoute`/`PublicRoute` take `recovering` as a prop, never call the hook. `recoveryMessage`
  surfaced via the existing `Toaster`/`toast()` (no new dependency).
- `client/src/main.jsx` — calls `installOauthMarkerListener()` alongside existing diagnostic installers.

Untouched (forbidden by spec Section 4, confirmed via `git status`): `useSettledAuth.js`, `api/index.js`, all
of `server/*`. No new npm dependencies.

# Files Required Next

None to implement. Next: **on-device verification against the now-live deployments** (see Recommended Next
Action).

# Dependency Chain

Editing: `authTransition.js` (new), `useAuthRecovery.js` (new), `AuthContext.jsx`, `routeDecision.js`,
`App.jsx`, `main.jsx`.
Requires: `@clerk/clerk-react` v5.61.8's `useAuth()` (`sessionId`), `useClerk()` — already installed.
Irrelevant: `api/index.js`, all of `server/*`, `useSettledAuth.js` (read for interface only, never modified).

# Architecture Notes

**Structural gap in the spec, resolved during implementation**: spec Section 3.4 names the single call site
as literally "`App()`," which is impossible — `useSettledAuth()` (which the hook needs) is only provided
inside `<AuthProvider>`'s subtree, so the top-level `App()` function can't call it before `AuthProvider`
mounts. Resolved with `AppRoutes()`, a new component rendered as `AuthProvider`'s child (alongside
`AuthStateLogger`/`SignFlowStateLogger`) that plays `App()`'s structural role: exactly one call site,
`recovering` flows down as a prop, routes never call the hook (acceptance criterion 20 verified against this
actual structure).

Everything else matches the spec directly: `authTransition.js` holds only pure marker functions + the click
listener (kept out of `lifecycleLog.js` so a future "strip debug logging" cleanup can't delete load-bearing
behavior). Decision logic lives in `useAuthRecovery.js` as pure, exported, unit-tested functions, mirroring
this codebase's `routeDecision.js` pattern (no jsdom/@testing-library here — plain `node:test` only).

# Decisions Made

- Google-button click detection uses `click` (capture-phase), not `pointerdown` — satisfies the
  synchronous-only requirement trivially; unrelated to `installClickLogging()`'s diagnostic `pointerdown`.
- Sign-out-exhausted toast copy ("Sign out didn't complete — please try again.") wasn't specified verbatim in
  the spec (only sign-in's was) — chosen to match its tone; trivially changeable.
- Sign-out and sign-in markers are evaluated in one shared post-settle effect (`evaluatedRef` guard) rather
  than two — simpler, spec doesn't require independent gating.

# Remaining Work

1. **On-device verification (mandatory, still outstanding)** — repeated sign-in/sign-out repro on the real
   device against production/staging (both now live, see Verification Results), confirming the repair/message
   actually fires and the symptom is gone. Four prior rounds all had green tests without fixing the real bug;
   this round shipped to production *before* that check, on explicit instruction — the check itself hasn't
   moved, only its order relative to deploy.
2. If on-device verification finds the fix doesn't work (or makes things worse): this commit
   (`10fff5e`) is a single clean fast-forward on both branches, so `git revert 10fff5e` on `staging`,
   re-push, re-fast-forward `main`, is a clean rollback path if needed — not yet required, noted for
   next agent.
3. Unrelated, carried forward: TASK-059's remaining phone-driven checklist rows; two disposable Clerk accounts
   still need manual deletion from production Clerk.

# Known Risks / Open Questions

- Fix reduces but does not mathematically eliminate the symptom (spec Section 8) — a repair could in
  principle be caught by a second unlucky reload; bounded-retry prevents looping, falls through to the
  message path instead.
- Same-session OAuth cancellation remains a documented, unsolved gap (spec Section 3.3).
- Keyboard/assistive-tech sign-in activation is uncovered (doesn't regress it, doesn't extend to it either).
- Fourth fix attempt at the same symptom — on-device evidence, not test-green status, is what's moved this
  forward each round. Not optional here either.

# Verification Results

- `npm run lint` (root): PASS. `npm run build`: PASS (pre-existing >500kB chunk warning, unrelated).
- `npm test` (root, server): PASS — 98/98, unaffected.
- `node --test "src/**/*.test.js"` (client): PASS — **69/69** (35 pre-existing + 18 + 14 + 2 new).
- `client/src/api/index.authRetry.test.js` (TASK-061, criterion 18): re-run individually, PASS — 3/3.
- All 20 spec acceptance criteria checked against the actual implementation.
- Deploy confirmed live via `vercel inspect`/`vercel ls`: `staging` Preview deployment `Ready` (~1 min old at
  confirmation time); `production` deployment `dpl_6EUH2PKa2j9TfbYb7WymvUaTZA6a` `Ready`, and
  `kitchenkeeper.kitchen`'s alias confirmed pointing at that same deployment ID.
- On-device verification: **still not performed** — deployed ahead of it, on Connor's explicit instruction
  (see Task). This remains the load-bearing check regardless of deploy status.

# Recommended Next Action

Connor to run the real repro on-device against the now-live `staging`/`production` deployments (repeated
sign-in/sign-out, watching for the repair/re-prompt toast and confirming the symptom is actually gone). If it
doesn't resolve it, `10fff5e` reverts cleanly (see Remaining Work #2) — this investigation has been burned by
"tests passed, shipped, symptom persisted" three times already (spec Section 0), so treat this deploy as
unconfirmed until that on-device check actually happens, not as done.

# Forbidden Exploration

- `client/src/hooks/useSettledAuth.js` — must not be modified.
- `client/src/api/index.js`, all of `server/*` — unchanged.
- The on-device repro itself — requires Connor on the real device.

# Context Notes

- branch: `staging` (working tree currently here; `main` was fast-forwarded to the same commit `10fff5e` and
  pushed, then checked back out to `staging`). No dev server started (no new UI surface beyond a toast; the
  bug needs a real WebKit reload agent-driven browser tooling can't induce). No worktree used. No
  migration/schema work — `MIGRATION_LEDGER.md` checked at session start, no outstanding ❌ rows, this task
  doesn't touch the database, so Rule 7's migration/code-deploy coupling concern doesn't apply here.
- Left uncommitted/untouched, pre-existing and unrelated to this task: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not part of TASK-064's scope, deliberately not staged or committed this session.

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
- TASK-063 implementation/deploy session through TASK-063 diagnostics follow-up + TASK-064 spec-drafting
  (settling->settled state machine shipped; two more on-device captures isolated sign-in/sign-out as separate
  mechanisms; four architect review rounds converged on DRAFT-6): see
  [archive/TASK-063-064-diagnostics-and-spec.md](archive/TASK-063-064-diagnostics-and-spec.md)
