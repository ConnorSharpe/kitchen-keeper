# Task

Production support investigation: Connor's father John Sharpe signed up as a real public user and
reported the in-app AI chat ("the agent") erroring. No prior spec — a live bug report, triaged and fixed
directly against production.

# Current Status

**Root-caused and fixed. Code unchanged this session — the fix was a production configuration value, not
a deploy.** This handoff (plus the correction to stale TASK-048/047 status below) is the only thing being
committed this session.

## What was done this session

- Traced the bug through the code without guessing: `client/src/pages/ChatPage.jsx`'s `send()` catches any
  `/api/ai/chat` failure and toasts `err.message` — `client/src/api/index.js`'s `request()` throws
  `Error(data.error)` for any non-2xx response with a plain-string `error` body.
- `server/routes/ai.js`'s `POST /chat` has no local try/catch; errors bubble to `server/app.js`'s global
  error handler (`express-async-errors` catches the rejected promise), which exposes `err.message` whenever
  `status < 500` — so a 403 always reaches the user verbatim.
- `server/services/ai/resolveProvider.js` throws `NoApiKeyError` (403, code `NO_API_KEY`, message "Please
  add your OpenAI API key in Settings to use AI features.") whenever the requesting household is not owned
  by `OWNER_CLERK_ID`, has no BYOK OpenAI key of its own, and the platform-wide `publicAiAccessEnabled` flag
  is off.
- **Confirmed against the live production DB** (queried directly via `@neondatabase/serverless`, read-only
  first): household 28 ("LA Sharpe's", created 2026-07-28) is owned by a different Clerk user than
  `OWNER_CLERK_ID`, has no `openai_api_key`, and `platform_settings.public_ai_access_enabled` was `false`.
  This reproduces the exact reported symptom deterministically — every chat message from that household
  would 403.
- This is precisely the still-open risk from TASK-037 (see [[project_go_public_readiness]]): public
  sign-ups have no working path to AI chat without either a BYOK key or the platform toggle enabled, and
  neither Clerk sign-up hardening nor OpenAI prepaid billing were ever confirmed before TASK-048 shipped a
  public landing page inviting exactly this kind of sign-up.
- Asked Connor how to fix it (global toggle vs. per-household key vs. do nothing) rather than assuming —
  he chose the global toggle.
- **Applied the fix directly to production**: `UPDATE platform_settings SET public_ai_access_enabled =
  true ...` via the same effect as the existing `PATCH /api/admin/platform-settings` endpoint (chose direct
  SQL over minting an owner session token to hit the gated admin route).
- Verified the write hit the correct database, not a stale one — a fresh `vercel env pull` returned an
  empty `DATABASE_URL`, which was concerning right after today's earlier Neon 3-branch split
  ([[feedback_dev_db_is_shared]]). Diffed Neon hostnames instead of trusting the pull: the cached
  `.env.vercel`'s host (`ep-misty-hill-ak264gcz`) differs from the new `local`/`staging` branch host
  (`ep-icy-rice-akewupba` used in `server/.env.local`/root `.env`), consistent with that memory's note that
  production was left untouched during the split. The blank fresh-pull value is Vercel treating
  `DATABASE_URL` as write-only/"sensitive" now, not a rotation — noted in memory so it isn't re-alarmed on
  next look.
- Corrected this handoff's own stale status: the prior version of this file (as of commit `96c671e`)
  described TASK-048 as "spec approved, implementation NOT STARTED." That was true only at that commit —
  `git log` shows TASK-048 was implemented and committed at `7506748`, and TASK-047 (previously "awaiting
  Connor's review before commit") was committed at `f9eed51`. Both are live in the current codebase; this
  handoff was simply never updated after those landed. See "Prior Handoffs" below for what those sessions
  actually did.

# Decisions Made

- Diagnosed by tracing actual code paths and querying the live production DB read-only first, rather than
  guessing from symptoms alone or asking Connor to reproduce/screenshot before any investigation happened.
- Did not silently pick a fix — the choice between "enable public AI access," "just fix John's household,"
  or "do nothing" has real billing/product implications, so it was posed to Connor directly
  ([[project_go_public_readiness]] already flagged this exact tradeoff as unresolved).
- Verified the database identity (hostname diff) before trusting a production write, rather than assuming
  a cached env file was still accurate immediately after unrelated infra changes elsewhere in the project.

# Known Risks

- **`publicAiAccessEnabled` is now `true` in production, and OpenAI prepaid billing / auto-recharge-off was
  never confirmed set up** (TASK-037 prerequisite #2, still open — see [[project_go_public_readiness]] for
  the full update). Anonymous public sign-ups can now spend against Connor's own `OPENAI_API_KEY`, rate
  limited only by `aiRateLimitMax` (currently 20). This is the single most important carry-forward item.
- TASK-037 prerequisite #1 (Clerk Dashboard sign-up hardening — email verification, bot/CAPTCHA, invite-only
  mode) is also still unconfirmed.
- Carried from prior handoffs, still accurate: SPA client-side rendering means non-JS crawlers won't see
  landing-page copy on first paint (accepted, not solved). `.claude/settings.local.json`'s pre-existing
  local diff remains uncommitted, unrelated to any of this.

# Context Notes

- branch: `staging`, being fast-forwarded to `main` (production) this session per Connor's explicit request
  — this handoff commit is the only code-repo change; the actual bug fix was a direct production DB write
  made earlier in the session, already live before this push.
- No dev servers were started this session — investigation used direct DB queries and code reading, not a
  running app instance.

# Recommended Next Action

1. **Ask Connor to confirm OpenAI billing is actually capped** (prepaid credits, auto-recharge off) now
   that public AI access is live — do not treat this as done without his explicit confirmation.
2. Revisit Clerk Dashboard sign-up settings (prerequisite #1) before treating the app as fully
   "go-public ready."
3. No other TASK-048/047 follow-up needed — both are implemented, committed, and live.

---

# Prior Handoff (TASK-048 spec + implementation, now superseded above)

Spec-drafting session for `ai/tasks/TASK-048-spec.md` — a public landing page shown to signed-out visitors
at `/`, with "Create account" and "Log in" buttons, per two rounds of GPT architect review (9.7/10 →
10/10). Design: `client/src/pages/LandingPage.jsx` (new, static, copy from README, links to `/sign-up` /
`/sign-in`, never imports `AppLayout`/`PantryProvider`); `client/src/App.jsx`'s `PrivateRoute` gained an
optional `publicHomeElement` prop rather than hardcoding the landing page import; one additive `<meta
name="description">` in `client/index.html`. Declined the architect's suggested `RootPage` restructuring
with a concrete codebase-specific counter-argument (`AppLayout`/`PantryProvider`/`Outlet` coupling) — agreed
correct in round 2. **Implemented and committed in a later session (`7506748`)** — this file previously
described it as not-yet-implemented; that was stale as of the correction above. Full design detail
preserved in `ai/tasks/TASK-048-spec.md` and this file's git history as of the spec-approval commit
(`96c671e`) if ever needed again.

# Prior-Prior Handoff (TASK-047 implementation session)

Private, owner-only "Suggest an Improvement" feedback box on the Dashboard. Two rounds of GPT architect
review (9.6/10 → 9.9/10 APPROVED) before implementation, plus two scope questions resolved directly with
Connor (no read UI — DB-only; fire-and-forget submitter UX). **Implemented, live-verified, and committed in
a later session (`f9eed51`)** — this file previously described it as awaiting Connor's review before
commit; that was stale as of the correction above. Full detail in git history as of the TASK-047
implementation session if ever needed again.

# Prior-Prior-Prior Handoff (TASK-046 implementation session)

Fixed two pre-existing onboarding-tour completion bugs (`StaplesChecklist` not appearing after the last
step; desktop tour sometimes not starting), both root-caused via `driver.js`'s bundled source and fixed in
`client/src/components/onboarding/productTour.js` (a `finished` idempotency guard called before
`driverObj.destroy()` at all five end-of-tour call sites, and swapping a `requestAnimationFrame` gate for a
plain `setTimeout`). Live-verified, committed and pushed to `staging` and fast-forwarded to `main`
(production). Full detail in git history / the TASK-046 spec if ever needed again.
