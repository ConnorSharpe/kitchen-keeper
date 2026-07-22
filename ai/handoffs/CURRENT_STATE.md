# Task

TASK-039 — Isolated Staging Environment (Preview DB + Stable Staging URL). **Spec only this session** — [ai/tasks/TASK-039-spec.md](../tasks/TASK-039-spec.md) is DRAFT-3, **APPROVED FOR IMPLEMENTATION** after two rounds of architect review. No implementation has started.

# Current Status

Raised by the user on go-live day (2026-07-22): every environment that could be used for "dev testing" — local dev, every Vercel Preview deployment, and Production — was found to share the exact same Neon database (confirmed by diffing `vercel env pull --environment=production` against `--environment=preview`: byte-identical `DATABASE_URL` host/database in both, and the same host in local `server/.env.local`). The "old Vercel URL" the user asked about is not a separate environment either — `vercel alias ls` showed it's just an alias pointing at the same latest Production deployment.

The spec fixes this and also folds in a second, related request from the same session: switch the default push workflow so day-to-day work goes to a new `staging` branch (deploying to the now-isolated Preview environment) instead of `main` (which deploys straight to Production today — confirmed via `git rev-parse --abbrev-ref @{u}` → `origin/main` on the current checkout).

Two rounds of external architect review both scored highly (9.3/10 → 9.8/10, approved). All feedback was assessed critically before being applied — see the spec's own "Architect Review History" table for exactly what was adopted vs. pushed back on (e.g. declined moving investigation evidence to a separate doc, declined "take a Neon backup before branching" since Neon branching is non-destructive by design).

# Files Modified (this session)

None — no application code touched.

# Files Created (this session)

- `ai/tasks/TASK-039-spec.md` — the full spec, DRAFT-3, approved for implementation.

# Files Required Next

- `ai/tasks/TASK-039-spec.md` — read in full before starting. It is an infrastructure spec (Vercel/Neon/GitHub configuration), not primarily a code-change spec — most of the "implementation" is dashboard/CLI configuration work, plus small edits to `server/.env.local` and `ai/handoffs/` conventions documentation.

# Files Already Reviewed

N/A — this was a spec-drafting session, not a code session. All "current state" claims in the spec were confirmed by direct CLI inspection this session (`git`, `vercel env ls`/`env pull`, `vercel alias ls`, `gh repo view`/`gh api`), not assumed from memory or prior handoffs.

# Dependency Chain

Implementation should follow the spec's own Decisions Needed section first — several of these gate the rest of the work and must not be guessed:

1. **D-1** (Clerk dashboard: Development vs. Production instance) and **D-2** (Neon plan's branch limits/cost) should be checked first — cheap, and their answers shape whether other steps need adjusting.
2. Then Design §1–2 (create the Neon `staging` branch, repoint Preview's connection-target env vars — see the spec's invariant-based requirement, not a hardcoded list).
3. Then Design §3 (create the `staging` git branch, move local tracking to it, confirm Vercel's Production Branch setting stays `main` — D-4).
4. Then Design §4 (repoint local `server/.env.local`) and §5 (document the canonical migration order in `ai/handoffs/` conventions).
5. D-6 (non-Postgres secrets audit) and D-3 (staging data snapshot vs. reseed) can happen in parallel with the above — they don't block the database/branch work.

# Architecture Notes

- The spec's core mechanism: Vercel already scopes env vars per-environment (Production/Preview/Development tags visible in `vercel env ls`) — the fix is entirely about *which* Neon branch each environment's connection-target variables resolve to, not new infrastructure.
- Vercel auto-generates a stable per-branch preview URL already (confirmed with existing evidence: `kitchen-keeper-git-main-connorsharpes-projects.vercel.app` has been stable for 86 days across dozens of `main` deployments) — no manual `vercel alias set` step is needed for `staging`'s URL once the branch is created and deployed once.
- This repo cannot use GitHub branch protection today (private repo, free plan — `gh api repos/.../branches/main/protection` returns 403, requires GitHub Pro or a public repo). The workflow-safety argument for `staging`-as-default rests on habit/discipline, not a GitHub-enforced rule, until/unless that changes.

# Decisions Made

All decisions from both architect-review rounds are recorded in the spec's own "Architect Review History" table and "Decisions Needed" (D-1 through D-6) sections — not duplicated here to avoid drift between the two documents. Notably: Neon branch named `staging` (not `development`) to match the git branch; no per-PR ephemeral branching (one static `staging` branch, appropriate for a solo maintainer); GitHub's default branch stays `main`.

# Remaining Work

1. Full implementation of `ai/tasks/TASK-039-spec.md` — nothing has been built yet, only specced and approved.
2. Resolve D-1 through D-6 (see Dependency Chain) as part of implementation, not deferred further.
3. Update `ai/handoffs/` conventions with the canonical migration order (spec Design §5) once implemented, so it's discoverable for future schema changes.

# Known Risks

Carried from the spec, unchanged — see its own Known Risks section in full. Highlights: no GitHub-enforced guardrail against an accidental direct push to `main`; shared single `staging` branch means concurrent test sessions could clobber each other (acceptable for a solo maintainer today); data/schema drift on `staging` over time if the migration order or a periodic refresh isn't followed; possible shared billing/quota exposure on AI API keys pending D-6.

Separately, still open from prior sessions (unrelated to this task): OpenAI billing has not yet been switched to prepaid credits with auto-recharge off (carried from TASK-037); Clerk key type (test vs. live) could not be confirmed via CLI this session — `vercel env pull` returns `CLERK_SECRET_KEY=""` for both environments (appears marked "Sensitive" in Vercel, blocking plaintext retrieval) — this is exactly D-1, needs manual confirmation in the Clerk dashboard.

# Verification Results

N/A this session — no code was written or tested. The spec itself was validated through two rounds of external architect review (9.3/10, then 9.8/10 after revisions), not automated tests.

# Recommended Next Action

Start implementing `ai/tasks/TASK-039-spec.md`, beginning with D-1 and D-2 (cheap dashboard checks that shape the rest), then Design §1–2 (Neon `staging` branch + Preview env var repoint), verified via the spec's own Verification Steps 1 and 7 (query-based DB confirmation, and an env-var diff against the integration's current output — not a fixed variable-name checklist).

# Forbidden Exploration

- `ai/tasks/archive/` — not relevant.
- No application code (`client/`, `server/` route/component logic) should need to change for this task — it's infrastructure/config, per the spec's Design section. If an agent finds itself editing application logic to implement this, stop and re-check against the spec.

# Context Notes

- branch: `main` (current checkout still tracks `origin/main` — Design §3's branch-workflow change has not been executed yet; that's part of the remaining work, not done)
- worktree: none
- No dev servers were started this session (spec/docs work only).
- This session's only change is documentation (`ai/tasks/TASK-039-spec.md`, this file) — safe to commit/push directly to `main` under the current (still-unchanged) workflow.
