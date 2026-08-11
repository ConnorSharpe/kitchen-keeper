# Task

TASK-061 implementation (auth session-race bug, Section 3.2) — the fix that was spec'd and
architect-approved (9.7/10) in the prior session. Connor's instruction to "implement the latest spec" is
treated as the final sign-off the spec was pending.

# Current Status

**TASK-061: both fixes now implemented, tested, and live-verified. Not yet committed or deployed.**

- Section 3.1 (`PublicRoute` guard in `App.jsx`) was already in the working tree from the prior session,
  unchanged this session.
- Section 3.2 (`authorizedFetch()` in `client/src/api/index.js`) implemented this session, verbatim per the
  spec's code sketch: single-flight forced-refresh (`forceRefreshToken()`), redirect-dedup
  (`redirectToSignIn()`), and the retry-once-then-redirect policy, shared by both `request()` and
  `postStream()` (previously duplicated 401-handling logic in each).
- New unit test file `client/src/api/index.authRetry.test.js` (3 tests) directly exercises the spec's
  Section 7 adversarial scenario (mocked `fetch`/`window.Clerk`, no real auth needed): single 401 → retry
  succeeds; 5 concurrent 401s → exactly 1 forced-refresh call; 5 concurrent callers both-attempts-401 →
  exactly 1 redirect. All pass.
- **Live browser verification (not just unit tests):** started local dev servers (client :5183, server
  :3001); the dev browser already had a persisted Clerk session, so page load reproduced the real
  concurrent-mount burst — network log shows 3 rounds of concurrent 401s across `/api/onboarding`,
  `/api/ai/chat/history`, `/api/recipes`, `/api/pantry`, `/api/pantry/waste-saved`, followed by a clean 200
  round. **The app did not redirect to `/sign-in`** — it rendered its full authenticated state (Dashboard/
  Pantry/Recipes/Shopping/Household nav, Sign out button all present). This is the exact bug from the spec's
  RCA, reproduced live and resolved by the fix, not a synthetic test. Dev servers stopped cleanly afterward.

# Files Modified

- `client/src/api/index.js` — added `forceRefreshToken()`, `redirectToSignIn()`, `authorizedFetch()`;
  `request()` and `postStream()` now both call `authorizedFetch()` instead of duplicating 401-handling.
  Uncommitted.
- `client/src/api/index.authRetry.test.js` — new file, 3 tests covering single-flight refresh and
  redirect-dedup under concurrent 401s. Uncommitted.
- `client/src/App.jsx` — carried over from prior session (Section 3.1, `PublicRoute`), still uncommitted.
- `ai/handoffs/archive/TASK-059-061-handoff.md` — new file, archived the prior CURRENT_STATE.md content
  (TASK-059 mid-checklist + TASK-061 spec-drafting) per Size Discipline before overwriting this file.
- `ai/handoffs/CURRENT_STATE.md` — this file.

# Files Required Next

- None to implement. Remaining work is commit + deploy + post-deploy verification (see below).

# Files Already Reviewed

`client/src/api/index.js`, `client/src/App.jsx`, `ai/tasks/TASK-061-spec.md`,
`ai/migrations/MIGRATION_LEDGER.md` (confirmed no outstanding ❌ rows — irrelevant anyway, this is a
client-only change with no migration).

# Dependency Chain

Editing: `client/src/api/index.js`, `client/src/api/index.authRetry.test.js` (new).
Requires: `window.Clerk` global (unchanged, set by `ClerkProvider` in `main.jsx`).
Irrelevant: all of `server/*` — TASK-061 is explicitly client-only per its own Forbidden Files list.

# Architecture Notes

See [TASK-061-spec.md](../tasks/TASK-061-spec.md) Sections 1–3 for the full RCA and design — unchanged by
this session, implemented as designed with no deviations. The one open question from spec Section 8 (whether
`getToken({ skipCache: true })` reliably resolves outside the race window under real load) is now answered
empirically, not just in theory: the live browser verification above is exactly that condition occurring
naturally, and the fix held.

# Decisions Made

- Implemented Section 3.2 verbatim per the spec's code sketch — no deviations, no additional scope.
- Added a unit test file rather than relying solely on a live Clerk sign-in for verification, since signing
  in with real credentials is a standing human-only action (per the smoke-test protocol's Forbidden
  Exploration rule) — the mocked test exercises the same concurrency guarantees deterministically. The live
  browser check (an already-persisted dev session, no credential entry by the agent) supplemented this with
  real-world confirmation.
- Did not commit or deploy — pushing to shared branches/environments requires the user's explicit go-ahead
  per standing operating rules; asked before proceeding rather than assuming "implement the spec" also meant
  "ship it."

# Remaining Work

1. Commit (needs Connor's go-ahead — not yet given).
2. Deploy per CONVENTIONS.md's canonical order (local → staging → production); client-only change, no
   migration, `MIGRATION_LEDGER.md` does not apply.
3. Post-deploy: re-run TASK-059's AUTH-1–5 and ERR-4, plus TASK-061's own adversarial concurrent-401 test
   (spec Section 7) against the deployed environment.
4. Resume the rest of TASK-059's checklist (ONB, HH, DASH, PANTRY, REC, SHOP, CHAT, DIET, PUSH, VIS-2–5,
   remaining ERR, ADMIN-*, remaining SEC-*) — see that file's Results table for exact status per row.
5. TASK-059 §15 Cleanup still not reached — no `ZZSMOKE-` data exists yet, nothing to clean up yet.

# Known Risks / Open Questions

- **The fix is implemented and verified but not deployed.** Production is still running the old
  hard-redirect code and is still affected by the live session-race bug until this ships — this is the same
  standing risk noted in the prior handoff, now closer to resolved but not yet actually resolved in
  production. Not a migration, so `MIGRATION_LEDGER.md` doesn't formally apply, but the same spirit as Rule 7
  applies: don't let "implemented" get mistaken for "shipped."
- Carried forward, unrelated to this session: TASK-058/TASK-060 still just named placeholders, not drafted;
  TASK-054's `consume_pantry_item`-on-truncated-item gap; OpenAI billing confirmation — see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md) and `project_go_public_readiness`
  memory.

# Verification Results

- `npm run build` (client): clean.
- `npm run lint` (root, eslint .): clean.
- `npm test` (root: shared + server, 98 tests): all pass.
- `npm test` (client: 7 tests, including 3 new): all pass.
- Live browser verification: real concurrent-401 burst reproduced and resolved, no redirect, full
  authenticated app rendered — see Current Status above.
- TASK-061 acceptance criteria (spec Section 6): 1–5 verified (unit tests + live check); 6 (build/lint/test
  green) verified.

# Recommended Next Action

Ask Connor whether to commit now, and if so, whether to proceed through the local → staging → production
deploy sequence in this session or hand off. Do not commit or push without that answer.

# Forbidden Exploration

- `server/*` for TASK-061 (client-only per its Forbidden Files).
- Any TASK-059 row requiring account creation/credential entry — must be human-driven, not agent-driven;
  standing operating rule, not specific to this session.

# Context Notes

- branch: `staging`.
- Dev servers (`server` on 3001, `client` on 5183) were started/stopped once this session for live
  verification; both stopped cleanly, none left running.
- No worktree was used.

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
