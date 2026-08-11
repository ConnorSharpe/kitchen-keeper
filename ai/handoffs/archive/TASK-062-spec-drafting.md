# Task

TASK-062 spec drafting — iOS standalone PWA Google OAuth sign-in requires a duplicate manual "Log in" tap.
Reported by Connor with screenshots; investigated, spec'd, and taken through four rounds of architect review
this session. No implementation performed — spec-drafting only.

# Current Status

**[TASK-062-spec.md](../../tasks/TASK-062-spec.md) is DRAFT-4, APPROVED FOR IMPLEMENTATION (9.5/10, pending
Connor's own final sign-off).** Ready for the next session to implement.

Diagnosis: not the same bug as TASK-061 (already-authenticated session race). This is the *initial* OAuth
redirect round-trip failing to resolve into a signed-in render, specific to the installed iOS PWA
(`display-mode: standalone`) — Google's OAuth policy forces the round-trip out of the standalone webview,
and the returning `/` load renders `LandingPage` even though the session was genuinely created (proven by an
immediate, credential-free success on a second manual attempt).

Fix strategy (see spec Section 3 for full detail): detect a candidate OAuth return via a passive
`document.referrer` check (no lifecycle heuristic — that was DRAFT-1's rejected approach), gate the
corrective action on `standalone` display-mode + Clerk `isLoaded === true` + `isSignedIn === false`, then
force exactly one `window.location.reload()` at `/` (never re-entering `/sign-in`). Loop-safety is an
explicit `sessionStorage` marker, structurally independent of whatever `document.referrer` does across a
reload (this was DRAFT-3's required correction).

**The one genuinely open empirical question, and it is a blocking implementation prerequisite, not
optional**: Section 3.1's expected OAuth callback path (`/sign-in/sso-callback`) is confirmed as far as
static analysis of this repo allows (`@clerk/clerk-react@5.61.8`'s real router-integration props —
`routerPush`/`routerReplace` — are unwired in `main.jsx`; `@clerk/shared`'s own type comments describe
`/sso-callback` as Clerk's convention) but **cannot be fully confirmed from source** — the code that actually
executes OAuth (`@clerk/clerk-js`) hot-loads from Clerk's CDN at runtime and isn't in `node_modules`. Section
7's first verification step is therefore a **blocking prerequisite**: capture the real on-device navigation
sequence (URL/referrer/display-mode/Clerk state at each step of an actual Google sign-in on the affected iOS
PWA build) before writing the detector. **If that capture doesn't support a referrer-based detector at all,
implementation must stop and return with a DRAFT-5 redesign — do not substitute a `beforeunload`/`pagehide`
lifecycle heuristic to keep moving.** This was explicitly re-affirmed in every review round from DRAFT-1
onward; DRAFT-1 was rejected specifically for that kind of heuristic.

# Files Modified

- `ai/tasks/TASK-062-spec.md` — new file, this session's entire deliverable (spec only, DRAFT-1 → DRAFT-4).
- `ai/handoffs/archive/TASK-059-smoke-tests-resumed.md` — new file, archived the prior CURRENT_STATE.md
  content (TASK-059 resumed smoke-test session) per Size Discipline before overwriting this file.
- `ai/handoffs/CURRENT_STATE.md` — this file (at the time).
- No application code touched this session (spec-drafting only, per this project's spec+review workflow —
  implementation is a separate, later session per Connor's usual pattern, same as TASK-057/TASK-061).

# Decisions Made

- Spec-only session, no implementation — matches this project's established spec+architect-review workflow.
- Rejected DRAFT-1's `beforeunload`/`pagehide` lifecycle-flag detection in favor of passive
  `document.referrer` checking.
- Rejected DRAFT-1/DRAFT-2's `sessionStorage`-flag fallback as a standing implementation-time option (removed
  entirely in DRAFT-3/confirmed in DRAFT-4) — if referrer detection doesn't pan out on-device, the spec
  requires stopping for a DRAFT-5 redesign rather than quietly reaching for a lifecycle heuristic.
- Verified Clerk version/API claims against the actual installed `node_modules` package rather than relying
  on documentation paraphrase alone (DRAFT-4).
- Kept the fix's file scope to `App.jsx` (+ maybe one small file) and explicitly forbade
  `client/src/api/index.js` and all of `server/*`.

# Known Risks / Open Questions (at handoff time)

- The core open question was Section 7's on-device capture. Everything else in the spec was settled pending
  that one empirical check.
- Carried forward, unrelated: TASK-058/TASK-060 still just named placeholders; TASK-054's
  `consume_pantry_item`-on-truncated-item gap; Clerk Dashboard sign-up/bot-protection settings unverified;
  two disposable Clerk accounts left in production.

See [archive/TASK-062-implementation.md](TASK-062-implementation.md) for the following session, where Connor
approved implementing provisionally (deferring the on-device capture) rather than waiting on it.
