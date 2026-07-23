# Task

Audit session, not an implementation session. Connor asked Claude to review the whole project for
public-launch readiness — security flaws exploitable from either the app or the repo, friction once real
users start using it, and whether Android users are actually shut out of installing the app (they aren't).
Findings were verified directly (code reading, `npm audit` across all three workspaces, a full git-history
secret scan, and a live console check against production `kitchenkeeper.kitchen`), not assumed, and backed
by web research where relevant. Connor then asked for a spec addressing every "needs action" and "friction"
finding, which went through two rounds of the usual GPT-architect-review workflow to approval.

# Current Status

**Spec approved, zero implementation code touched this session.** `ai/tasks/TASK-042-spec.md` is at
DRAFT-3, **APPROVED FOR IMPLEMENTATION**, after two review rounds (9.7/10 → 9.95/10). Ready for the next
implementation session to pick up.

TASK-042 bundles seven parts, split into two completion tiers so physical-device/dashboard-access
availability doesn't block the code-level work:

- **Implementation Complete** (no hardware/dashboard dependency):
  - Part A — pin exact dependency versions (not `npm audit fix`) via direct-dependency bumps plus a new
    `overrides` block for transitive packages, verified against a real `npm audit fix --dry-run` run in both
    `server/` and `client/` this session (confirmed via `git status` that the dry run touched nothing).
  - Part B — remove six dead dependencies (`@clerk/nextjs`, `@clerk/react`, `jsonwebtoken`, `bcrypt`, `uuid`,
    `cookie-parser`) and the deprecated `server/middleware/auth.js`, all proven dead via grep (static and
    dynamic imports both checked).
  - Part C — rate-limit `/api/household/join` via a new shared `createRateLimiter()` factory, refactoring
    `aiRateLimit.js` to use it too (behavior-preserving; `aiRateLimitKeyGenerator.js` and its test untouched).
  - Part E — README accuracy pass (stale JWT-auth description, dead `INVITE_CODE` references).
  - Part F — structured request-ID/timing diagnostics around the intermittent `GET /api/household/members`
    500 first flagged in TASK-041's handoff (observability only, not a speculative fix — it's never been
    reproduced).
- **Release Validation Complete** (needs Connor + physical hardware, tracked separately so it doesn't block
  Implementation Complete):
  - Part D — confirm two external prerequisites first flagged by TASK-037 and never confirmed done since:
    Clerk Dashboard sign-up posture (email verification / bot protection / waitlist), and OpenAI org billing
    switched to prepaid credits with auto-recharge off before `public_ai_access_enabled` is ever flipped
    `true` in production.
  - Part G — real-device verification: iOS camera-picker fix (TASK-041 Known Risk, still open), full
    11-step tour walked on an actual mobile viewport (also still open from TASK-041), and an actual Android
    "Add to Home Screen" install completed on a physical device.

Explicitly out of scope (documented in the spec, not forgotten): upgrading `@vercel/blob` (0.27.3 → 2.6.1)
and `drizzle-orm` (0.29.5 → 0.45.2) — both fix real vulnerabilities but are semver-major jumps into the
storage/DB layers actively used in production, deliberately left for their own follow-up task rather than
bundled into a dependency-cleanup task.

# Files Created / Changed (this session)

- **New**: `ai/tasks/TASK-042-spec.md` (DRAFT-3, approved).
- **Modified**: `ai/handoffs/CURRENT_STATE.md` (this file).
- No application code, dependencies, or lockfiles touched — the `npm audit fix --dry-run` runs used to
  derive Part A's exact version targets were confirmed via `git status` to have modified nothing.

# Decisions Made

- Spec bundles seven parts under one task number rather than splitting into several, matching TASK-041's
  precedent for a single session-driven audit with one shared motivation.
- Major/breaking dependency upgrades (`@vercel/blob`, `drizzle-orm`, `drizzle-kit`, `vite`) deliberately kept
  out of this spec's scope — see TASK-042-spec.md's own Out of Scope section for the full reasoning.
- Two open decisions were left for Connor rather than guessed at during spec-writing (see TASK-042-spec.md's
  "Decisions Needed From Connor"): the registration posture to configure in Clerk Dashboard (Part D), and
  whether the join-code rate limit's starting threshold (10 attempts / 15 min / user) needs adjusting.
- README's Live Demo line intentionally keeps stating whether sign-up is currently gated (now: "Sign-up is
  currently unrestricted — create an account via the link above") rather than being genericized to only
  "Authentication is provided by Clerk" — the Tech Stack table's Auth row already covers the Clerk mention;
  the Live Demo section's job is telling a visitor whether the link actually gets them in.

# Known Risks

Carried forward from the spec (not re-verified this session, since nothing was implemented):

- `overrides` pin a dependency floor, not a permanent fixture — Part A documents a removal check to run the
  next time a direct dependency naturally clears the pinned version, so these don't accumulate indefinitely.
- Part C's refactor touches already-shipped, working code (`aiRateLimit.js`), not just additive new code —
  low risk (mechanical extraction, no logic change), but its own verification step (AI rate-limiting behavior
  unchanged post-refactor) needs to actually run, not be assumed from the diff looking simple.
- Part D cannot ship unilaterally — it needs Connor's direct access to the Clerk and OpenAI dashboards.
  "Ready to go public" as a whole claim depends on it even though it doesn't block Implementation Complete.
- Part G's iOS camera-picker fix and full-mobile-tour walkthrough have been open since TASK-041 with no
  physical device available in either session — still unverified.
- Part F adds logging, not a fix, for the `household/members` 500 — if it recurs, diagnosing and fixing it
  is separate follow-up work, not something TASK-042 itself resolves.

# Files Required Next

None beyond what TASK-042-spec.md itself specifies — an implementation session should work Parts A/B/C/E/F
in order (each is independently verifiable per the spec's Verification Steps), then track Parts D/G
separately per the spec's Completion Criteria split.

# Recommended Next Action

Start an implementation session against `ai/tasks/TASK-042-spec.md`. Parts A through F have no external
dependency and can ship in one pass; Parts D and G should be explicitly called out as still-open
"Release Validation" items in that session's own handoff if they aren't completed alongside the code, rather
than being silently dropped the way TASK-037's equivalent prerequisites were.

# Context Notes

- branch: `staging`.
- worktree: none.
- `.claude/settings.local.json` continues to have pre-existing local uncommitted changes (permission-prompt
  settings) unrelated to this or any prior session's work — left as-is, not part of this session's commit,
  same note carried in every handoff since TASK-040.
- Production (`kitchenkeeper.kitchen`) was read-only inspected this session (manifest/service-worker/HTTPS
  check via browser console) — nothing was deployed or changed.
