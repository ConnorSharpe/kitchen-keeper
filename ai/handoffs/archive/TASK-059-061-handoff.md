# Task

TASK-059 production smoke test (session 1 of N — handed off mid-checklist) + TASK-061 spec drafting
(auth session-race bug found during that smoke test). Two other agents will pick this up next: one to
implement TASK-061, one to continue the TASK-059 checklist. Neither has started yet as of this handoff.

# Current Status

**TASK-059 (production smoke test):** only the checks that don't require a login are done — PF-1–3
(pre-flight), SEC-1, SEC-5 (unauthenticated 401 checks), VIS-1 (`orange-` regression grep) — all ✅, logged
in [TASK-059-smoke-tests.md](../../tasks/TASK-059-smoke-tests.md)'s Results table. Every other row (AUTH,
ONB, HH, DASH, PANTRY, REC, SHOP, CHAT, DIET, PUSH, VIS-2–5, most of ERR) is still ⬜ — Connor was going to
run the full user-facing walkthrough on his phone with a disposable test account, separately from this
agent's API-level checks (ADMIN-*, remaining SEC-*, ERR-1/ERR-4), but that got interrupted when Connor's own
sign-in attempt reproduced a real bug instead of just being test setup.

**TASK-061 (auth bug, found and spec'd mid-smoke-test):** DRAFT-3, architect-approved (9.7/10), pending
Connor's own final sign-off before implementation per [TASK-061-spec.md](../../tasks/TASK-061-spec.md). Two
issues, both client-only: (A) `/sign-in`/`/sign-up` had no guard bouncing an already-signed-in user away —
fixed already, uncommitted. (B) the real root cause — `api/index.js` treats any single 401 from the
eager-mount concurrent-request burst as full session expiry and hard-redirects, discarding a dozen other
requests that succeeded in the same burst. Fix B (`authorizedFetch()` with single-flight forced-refresh +
redirect dedup) is fully designed in the spec but not yet implemented as of this handoff.

# Files Modified (as of this handoff)

- `client/src/App.jsx` — uncommitted. Added `PublicRoute` helper, wraps `/sign-in/*` and `/sign-up/*`.
- `ai/tasks/TASK-059-smoke-tests.md` — Results table updated with 4 completed rows.
- `ai/tasks/TASK-061-spec.md` — new file. DRAFT-3, approved, not yet implemented (Section 3.2 only).
- `ai/handoffs/archive/TASK-057-implementation.md` — new file, archived prior CURRENT_STATE.md content.
- `.claude/settings.local.json` — pre-existing modification, untouched by this session.

# Decisions Made

- TASK-061 covers exactly two issues (routing guard + redirect race) and nothing else found during the
  TASK-059 session — deliberately kept narrow across three architect review rounds.
- Route-based code-splitting and server-side Clerk clock-skew tuning both explicitly deferred (spec Section
  5), not silently dropped. No task number assigned to the code-splitting follow-up (058 and 060 already
  reserved for Shopping mobile layout and the CRUD-modal migration — do not reuse either).

# Known Risks / Open Questions (as of this handoff)

- The session-race bug (TASK-061) is a real, live production bug affecting any real user's sign-in — found
  incidentally, not from a user report.
- Carried forward, unrelated: TASK-058/TASK-060 still just named placeholders; TASK-054's
  `consume_pantry_item`-on-truncated-item gap; OpenAI billing confirmation — see
  [archive/TASK-057-implementation.md](TASK-057-implementation.md) and `project_go_public_readiness` memory.

**Superseded by:** TASK-061 Section 3.2 was implemented, tested, and live-verified in the next session — see
current [CURRENT_STATE.md](../CURRENT_STATE.md).
