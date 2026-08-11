# Task

TASK-062 spec drafting — iOS standalone PWA Google OAuth sign-in requires a duplicate manual "Log in" tap.
Reported by Connor with screenshots; investigated, spec'd, and taken through four rounds of architect review
this session. No implementation performed — spec-drafting only.

# Current Status

**[TASK-062-spec.md](../tasks/TASK-062-spec.md) is DRAFT-4, APPROVED FOR IMPLEMENTATION (9.5/10, pending
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
- `ai/handoffs/CURRENT_STATE.md` — this file.
- No application code touched this session (spec-drafting only, per this project's spec+review workflow —
  implementation is a separate, later session per Connor's usual pattern, same as TASK-057/TASK-061).

# Files Required Next

For implementation:
- `client/src/App.jsx` — where the detection/guard/reload logic goes (spec Section 4, Allowed Files).
- Possibly a new small file (e.g. `client/src/lib/oauthReturn.js`) if the detection logic is extracted —
  left to implementation, not decided in the spec.
- `client/src/main.jsx` — read-only reference; confirms `ClerkProvider`'s current prop list (no
  `routerPush`/`routerReplace` wired), do not modify (spec Section 5 explicitly defers wiring those props).

# Files Already Reviewed

`client/src/App.jsx`, `client/src/main.jsx`, `client/package.json` (confirmed `@clerk/clerk-react@^5.61.8`),
`client/node_modules/@clerk/shared/dist/types/index.d.mts` (confirmed `ClerkOptionsNavigation`'s actual
`routerPush`/`routerReplace`/`routerDebug` props for this installed version, and `IsomorphicClerkOptions`'s
`clerkJSUrl`/`clerkJSVersion` confirming `@clerk/clerk-js` hot-loads from Clerk's CDN rather than being a
static dependency), `client/public/sw.js` (ruled out as a contributing cause — network-first on navigation),
`vercel.json` (SPA rewrite confirmed not to interfere), `ai/tasks/TASK-061-spec.md` and
`ai/handoffs/archive/TASK-061-implementation.md` (confirmed this is a different bug/mechanism, not a TASK-061
regression).

# Dependency Chain

Editing (next session): `client/src/App.jsx`, possibly one new small client file.
Requires: a real iOS device with the PWA installed for the blocking on-device capture step (Section 7) —
human-driven, not agent-drivable, per this project's standing rule on account/credential-involving browser
testing.
Irrelevant: all of `server/*`, `client/src/api/index.js` (TASK-061's surface — explicitly forbidden in the
spec to avoid mixing failure domains), any database/schema change (none proposed).

# Architecture Notes

See [TASK-062-spec.md](../tasks/TASK-062-spec.md) Sections 1–3 for full RCA and design, and its Architect
Review History table for the reasoning behind each of the four drafts. Key invariant for the implementer:
loop-prevention (Section 3.3) must never depend on `document.referrer`'s behavior across
`window.location.reload()` — that dependency was DRAFT-2's rejected design. The `sessionStorage` marker is
the sole authority, and must not be cleared until the reloaded page's Clerk `isLoaded` has resolved
(DRAFT-3's required correction) — clearing it merely because the marker was observed present at mount would
reopen the loop risk.

# Decisions Made

- Spec-only session, no implementation — matches this project's established spec+architect-review workflow
  (`feedback_spec_workflow` memory); Connor has not yet given the "implement the spec" go-ahead that started
  TASK-061's implementation session.
- Rejected DRAFT-1's `beforeunload`/`pagehide` lifecycle-flag detection in favor of passive
  `document.referrer` checking — a lifecycle event only means "this context is going away," not
  specifically "an OAuth hop started," per architect review.
- Rejected DRAFT-1/DRAFT-2's `sessionStorage`-flag fallback as a standing implementation-time option (removed
  entirely in DRAFT-3/confirmed in DRAFT-4) — if referrer detection doesn't pan out on-device, the spec
  requires stopping for a DRAFT-5 redesign rather than quietly reaching for a lifecycle heuristic.
- Verified Clerk version/API claims against the actual installed `node_modules` package rather than relying
  on documentation paraphrase alone (DRAFT-4) — found `@clerk/clerk-react@5.61.8`'s real router props are
  `routerPush`/`routerReplace` (not the `navigate` prop DRAFT-1–3 referenced), and that `@clerk/clerk-js`
  loads dynamically from Clerk's CDN, which is *why* the callback path can't be fully confirmed from source
  and must be captured on-device before implementation relies on it.
- Kept the fix's file scope to `App.jsx` (+ maybe one small file) and explicitly forbade
  `client/src/api/index.js` and all of `server/*`, to avoid mixing this bug's failure domain with TASK-061's.

# Remaining Work

1. **Implementation session**: perform Section 7's blocking on-device capture first (real iOS device,
   Connor's own hands per the account/credential-entry rule), confirm or redefine the callback-path constant,
   then implement Sections 3.1–3.3 in `App.jsx`.
2. If on-device capture doesn't support a referrer-based detector, return here for a DRAFT-5 spec revision —
   do not implement a lifecycle-heuristic substitute.
3. Once implemented: run the full Verification Steps in spec Section 7 (adversarial cancellation test,
   post-correction navigation test, single-shot guard test, non-standalone regression checks), then follow
   CONVENTIONS.md's canonical local → staging → production order before considering this closed.
4. Unrelated, carried forward from the prior handoff (see archive): TASK-059's remaining phone-driven
   checklist rows (AUTH-1–5, ONB, HH, DASH, PANTRY, REC, SHOP, CHAT, DIET, PUSH, VIS-2–5, ERR-2/3/5) are
   still pending a human pass; two disposable Clerk accounts (`+zzsmokeB@gmail.com`, `+zzsmokeC@gmail.com`)
   still need manual deletion from production Clerk when convenient, low urgency.

# Known Risks / Open Questions

- **The core open question is Section 7's on-device capture — see Current Status.** Everything else in the
  spec is settled pending that one empirical check.
- `.claude/settings.local.json` and `ai/tasks/TASK-059-smoke-tests.md` remain modified in the working tree
  from before this session, untouched and not committed here — pre-existing, unrelated to TASK-062.
- Carried forward, unrelated to this session: TASK-058/TASK-060 still just named placeholders, not drafted;
  TASK-054's `consume_pantry_item`-on-truncated-item gap; Clerk Dashboard sign-up/bot-protection settings
  still unverified; two disposable Clerk accounts left in production (see Remaining Work #4).

# Verification Results

- No code changes this session — nothing to build/lint/test. Spec-only.
- `npm run build`/`npm run lint`/`npm test` will be required verification once TASK-062 is implemented (spec
  Section 6, criterion 8).

# Recommended Next Action

Start a TASK-062 implementation session once Connor gives the go-ahead: begin with Section 7's blocking
on-device capture step before writing any detector code.

# Forbidden Exploration

- `client/src/api/index.js` and all of `server/*` — explicitly forbidden by TASK-062's own Files section, to
  keep this bug's fix isolated from TASK-061's surface.
- Any TASK-059 row requiring account creation/credential entry, and TASK-062's on-device capture step itself
  — both require a human on a real device, not agent-driven browser tooling; standing project rule.

# Context Notes

- branch: `staging` (no code changes, no deploy this session — spec-drafting only).
- No dev servers started this session.
- No worktree used.
- Session included checking the AI Development Agent Efficiency Guide (`Sharpe_AI_Dev_Agent_Efficiency_Guide.md`,
  Rev 7) at Connor's request at session start — informed the spec-drafting workflow but no repo files from
  that guide's structure (e.g. `MIGRATION_LEDGER.md`) needed touching, since TASK-062 has no migration.

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
