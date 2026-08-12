# Task

TASK-065 — iOS PWA sign-in: preconnect to Google's OAuth endpoint. Implementation of the architect-approved
spec ([TASK-065-spec.md](../tasks/TASK-065-spec.md), DRAFT-3, round-2 review ~9.3/10 APPROVE WITH MINOR
CHANGE).

# Current Status

Code implemented, both scoped routes wired, `lint`/`build` green. Two items the spec explicitly called out as
needing human input before/during implementation were raised with Connor this session and resolved:

1. **`/sign-up`'s OAuth destination** (spec §2.2's implementation-time gate) — the spec's own curl-based
   verification technique (used successfully for `/sign-in` during spec-drafting) is blocked by Clerk's
   bot-protection on `/sign-up` specifically. Resolved this session: with Connor's permission, signed out of
   his live production session in a Chrome tab, clicked "Continue with Google" on `/sign-up`, and the
   resulting tab landed on a Google sign-in page — Connor confirmed this directly. **Gate satisfied**:
   `/sign-up` shares `/sign-in`'s `accounts.google.com` destination, so it's in scope per §2.2 (not deferred
   to a follow-up).
2. **The ~20-cycle manual on-device sampling ask** (spec §5 criterion 4 / §7) — not yet actually performed;
   this requires Connor's physical iPhone in standalone-PWA mode (WebKit's transient-activation window is
   iOS/WebKit-specific — desktop Chrome automation can't reproduce the mechanism being measured, confirmed
   with Connor this session). Remains outstanding, see Remaining Work.

**One verification gap, explicitly skipped at Connor's instruction**: §6-A's live DOM check (confirming the
`<link rel="preconnect">` tag actually lands in `document.head` at runtime) was not completed. The Chrome
extension used for browser automation this session blocks navigation to `localhost` entirely
("Navigation to this domain is not allowed") pending what looks like a one-time site-access grant on Connor's
end — not attempted further per his explicit "skip it, note it in the handoff." Confidence in the
implementation itself is based on code review (`lint`/`build` pass; the logic is a standard
`useLayoutEffect` doing plain DOM `querySelector`/`createElement`/`appendChild`, no framework-specific
gotchas) rather than an observed runtime DOM check.

# Files Modified

- `client/src/components/PreconnectGoogleOAuth.jsx` (new) — wrapper component; on mount (`useLayoutEffect`,
  not a DOM mutation during render — spec §2.2's round-2 correction), injects
  `<link rel="preconnect" href="https://accounts.google.com">` (no `crossorigin` — spec §2.1's credentialed-
  connection rationale) into `document.head` if not already present; removes it on unmount only if this
  instance created it (dedupes against Strict Mode's dev-mode double-invocation).
- `client/src/App.jsx` — wraps `<SignIn>` (`/sign-in/*` route) and `<SignUp>` (`/sign-up/*` route) elements in
  `<PreconnectGoogleOAuth>`, inside the existing `<PublicRoute>` wrapper (so the hint only fires once
  `PublicRoute` actually decides to render the public auth form, not during a redirect-away decision for an
  already-authenticated user — matches spec §2.2's "unsolicited connection cost" concern for the common
  already-signed-in launch case).

# Files Required Next

None to implement further — remaining work is verification only (see below), not code changes, unless the
on-device timing comparison (§5 criterion 4) surfaces something the spec didn't anticipate.

# Files Already Reviewed

- `client/src/App.jsx` (full file, route structure, `PublicRoute`/`PrivateRoute` wrappers, TASK-063/064
  diagnostic components) — reviewed before editing to place the wrapper correctly relative to `PublicRoute`.
- `ai/tasks/TASK-065-spec.md` (full spec, both architect review rounds) — authoritative source for this
  implementation; no deviations from its Allowed/Forbidden file lists (§3) or acceptance criteria (§5).

# Dependency Chain

Editing:
- `client/src/App.jsx`
- `client/src/components/PreconnectGoogleOAuth.jsx`

Requires:
- Clerk's `<SignIn>`/`<SignUp>` components already imported in `App.jsx` (`@clerk/clerk-react`) — unchanged.

Irrelevant:
- `client/src/lib/authTransition.js`, `client/src/hooks/useAuthRecovery.js`,
  `client/src/lib/routeDecision.js`, `client/src/context/AuthContext.jsx`, `client/src/lib/lifecycleLog.js`,
  all of `server/*` — spec §3's explicit Forbidden list; not touched, matches TASK-064's recovery mechanism
  staying untouched per spec §2.3.

# Architecture Notes

- No new route-level wrapper component existed before this task (spec §1); `PreconnectGoogleOAuth` is the
  first one, scoped narrowly (children pass-through, single responsibility: the resource hint).
- Placement inside `<PublicRoute>` rather than outside it was a judgment call not explicitly specified by the
  spec — the spec only required the hint fire "as early as reasonably possible after the auth route becomes
  active, and before the Google OAuth control becomes interactive" (§2.2). Placing it inside means an
  already-authenticated user hitting `/sign-in`/`/sign-up` (who `PublicRoute` immediately redirects away
  from) never triggers the connection at all — directly serving §2.2's stated concern about unsolicited
  connection cost for the common already-signed-in case.

# Decisions Made

- No `crossorigin` attribute on the `<link>` — spec §2.1, verified against the HTML Standard's own preconnect
  algorithm during spec-drafting (credentialed by default, matching a normal top-level OAuth navigation).
- `/sign-up` is in scope (not deferred) — the implementation-time gate (§2.2) was satisfied this session via
  a live browser check, described above.
- Cleanup on unmount (`link.remove()`) — not explicitly required by the spec, but chosen to cleanly satisfy
  acceptance criterion 2 ("no other route's rendered output or behavior changes") when navigating away from
  the auth routes, and to dedupe correctly under Strict Mode.

# Remaining Work

1. **Connor: perform the ~20-cycle paired before/after on-device timing comparison** (spec §5 criterion 4) —
   alternating baseline/treatment attempts, force-quit/relaunch discipline, discard incomplete captures, using
   the existing debug-mode instrumentation from the TASK-064-followup session (still shipped, untouched).
   Compare against this investigation's baseline numbers (554ms success / 1708ms failure) — see spec §0 for
   full methodology and what counts as a meaningful result either direction.
2. **Optional, not blocking**: if/when Connor grants the Chrome extension access to `localhost`, a quick
   live-DOM check (`document.head.querySelectorAll('link[rel="preconnect"]')` on `/sign-in` and `/sign-up`,
   confirming absence elsewhere) would close the one skipped verification step (§6-A). Not required to ship —
   code review plus green `lint`/`build` is the current basis for confidence.
3. **Not yet pushed** — this session's changes are committed to the working tree but not yet committed/pushed
   to `staging`. See PowerShell Merge Block below; awaiting Connor's go-ahead per this agent's standing policy
   of confirming before pushing shared branches.

# Known Risks / Open Questions

- Spec §7, carried forward: preconnect is a hint, not a guarantee — actual WebKit/iOS honoring of it is
  unverified on-device (§6-B, genuinely optional per the spec, not attempted this session — no iOS device
  access).
- Spec §7, carried forward: absence of measurable timing improvement (Remaining Work #1) wouldn't
  definitively rule out connection-setup time as a contributor — WebKit could simply decline to honor the
  hint. Either outcome is a valid, useful finding per spec §0's confidence calibration.
- The skipped §6-A live-DOM check (see Current Status) is a real, if low-severity, verification gap — flagged
  explicitly rather than silently treated as done.
- Connor was signed out of his live `kitchenkeeper.kitchen` session during the `/sign-up` gate check this
  session (with his permission) — he'll need to sign back in if he hasn't already.

# Verification Results

- `npm run lint` (root, `eslint .`): PASS.
- `npm run build` (root → `vite build` in `client/`): PASS. Pre-existing >500kB chunk warning, unrelated to
  this change (same warning noted in prior handoffs).
- Live DOM check (§6-A): **not performed** — see Current Status/Known Risks.
- On-device timing comparison (§5 criterion 4 / §6-C): **not performed** — Remaining Work #1, Connor's to do.
- `/sign-up` destination gate (§2.2): confirmed via live browser check this session (see Current Status).

# Recommended Next Action

Confirm with Connor whether to commit/push these changes to `staging` now (see PowerShell Merge Block) — no
migration/schema involved, no `MIGRATION_LEDGER.md` concern, so this is a plain code push once approved. After
that, the ball is in Connor's court for the on-device timing comparison (Remaining Work #1); no further code
changes are anticipated unless that data surfaces something unexpected.

# Context Notes

- branch: `staging` (working tree here, matching the pattern established for TASK-064's own implementation
  session — no worktree, no feature branch).
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Left uncommitted/untouched, pre-existing and unrelated to this task (carried forward from the prior
  session's handoff, still true): `.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md` (both
  modified), `ai/handoffs/archive/TASK-061-implementation.md` (untracked) — not staged or committed this
  session either.
- Local dev server (client on `:5173`, server on `:3001`) was started for verification purposes this session
  and has been stopped; nothing left running.

# PowerShell Merge Block

Not applicable in the worktree sense — no worktree or feature branch was used, matching TASK-064's own
pattern of committing directly on `staging`. Suggested commit (not yet run, pending Connor's go-ahead):

```powershell
git add client/src/App.jsx client/src/components/PreconnectGoogleOAuth.jsx ai/handoffs/CURRENT_STATE.md ai/handoffs/archive/TASK-064-followup-timing-diagnostics.md
git commit -m "TASK-065: add scoped Google OAuth preconnect hint to /sign-in and /sign-up"
```

---

## Archived History

- TASK-047 through TASK-053: see [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054: see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055: see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056: see [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting: see [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation: see [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting: see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy: see [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke-test session: see
  [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting: see [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy: see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
- TASK-063 implementation/deploy through TASK-064 spec-drafting: see
  [archive/TASK-063-064-diagnostics-and-spec.md](archive/TASK-063-064-diagnostics-and-spec.md)
- TASK-064 implementation/deploy (marker-based recovery mechanism, on-device verification confirmed working
  as designed): see [archive/TASK-064-implementation.md](archive/TASK-064-implementation.md)
- TASK-064 follow-up (timing diagnostics, confirmed the WebKit activation-expiry hypothesis with paired
  on-device data, feeding directly into TASK-065): see
  [archive/TASK-064-followup-timing-diagnostics.md](archive/TASK-064-followup-timing-diagnostics.md)
