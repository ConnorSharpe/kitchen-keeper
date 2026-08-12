# Task

TASK-065 — iOS PWA sign-in: preconnect to Google's OAuth endpoint. Implementation of the architect-approved
spec ([TASK-065-spec.md](../../tasks/TASK-065-spec.md), DRAFT-3, round-2 review ~9.3/10 APPROVE WITH MINOR
CHANGE).

# What Shipped

- `client/src/components/PreconnectGoogleOAuth.jsx` (new) — wrapper component; on mount (`useLayoutEffect`,
  not a DOM mutation during render — spec §2.2's round-2 correction), injects
  `<link rel="preconnect" href="https://accounts.google.com">` (no `crossorigin` — spec §2.1's credentialed-
  connection rationale) into `document.head` if not already present; removes it on unmount only if this
  instance created it (dedupes against Strict Mode's dev-mode double-invocation).
- `client/src/App.jsx` — wraps `<SignIn>` (`/sign-in/*` route) and `<SignUp>` (`/sign-up/*` route) elements in
  `<PreconnectGoogleOAuth>`, inside the existing `<PublicRoute>` wrapper (so the hint only fires once
  `PublicRoute` actually decides to render the public auth form, not during a redirect-away decision for an
  already-authenticated user — matches spec §2.2's "unsolicited connection cost" concern for the common
  already-signed-in launch case). Placement inside `<PublicRoute>` was a judgment call, not explicitly
  specified by the spec — the spec only required the hint fire "as early as reasonably possible... before the
  Google OAuth control becomes interactive" (§2.2).

# Decisions Made

- No `crossorigin` attribute on the `<link>` — spec §2.1, verified against the HTML Standard's own preconnect
  algorithm during spec-drafting (credentialed by default, matching a normal top-level OAuth navigation).
- `/sign-up` is in scope (not deferred) — spec §2.2's implementation-time gate was satisfied this session via
  a live browser check: with Connor's permission, signed out of his live production session in a Chrome tab,
  clicked "Continue with Google" on `/sign-up`, and the resulting tab landed on a Google sign-in page —
  Connor confirmed this directly. (Clerk's own bot-protection blocks the curl-based technique used for
  `/sign-in` during spec-drafting, so this needed a real browser click instead.)
- Cleanup on unmount (`link.remove()`) — not explicitly required by the spec, chosen to cleanly satisfy
  acceptance criterion 2 ("no other route's rendered output or behavior changes") and dedupe correctly under
  Strict Mode.

# Dependency Chain

Editing: `client/src/App.jsx`, `client/src/components/PreconnectGoogleOAuth.jsx`.
Requires: Clerk's `<SignIn>`/`<SignUp>` (`@clerk/clerk-react`) — unchanged.
Irrelevant (spec §3 Forbidden list, not touched): `client/src/lib/authTransition.js`,
`client/src/hooks/useAuthRecovery.js`, `client/src/lib/routeDecision.js`, `client/src/context/AuthContext.jsx`,
`client/src/lib/lifecycleLog.js`, all of `server/*`.

# Verification Results

- `npm run lint` (root, `eslint .`): PASS.
- `npm run build` (root → `vite build` in `client/`): PASS. Pre-existing >500kB chunk warning, unrelated.
- **Live DOM check (§6-A): not performed.** The Chrome extension used for browser automation this session
  blocks navigation to `localhost` entirely ("Navigation to this domain is not allowed"), pending what looks
  like a one-time site-access grant on Connor's end. Skipped at Connor's explicit instruction ("skip it, note
  it in the handoff"). Confidence in the implementation is based on code review only (the logic is a standard
  `useLayoutEffect` doing plain DOM `querySelector`/`createElement`/`appendChild`, no framework-specific
  gotchas), not an observed runtime DOM check.
- Deployed: commit `7492198` pushed to `staging`, then fast-forwarded to `main` (production) at Connor's
  explicit request. Follow-up commit `afa35bc` recorded the push in the handoff. Per this guide's Rule 8, no
  deploy-platform polling was done after either push.

# Known Risks Carried Forward

- Preconnect is a hint, not a guarantee — WebKit may not honor it (spec §7, §6-B).
- `/sign-up`'s destination confirmation used a live browser click, not the more rigorous curl-based technique
  — a real but lower-severity verification gap than the original spec's item 8 gap it resolves.
- Connor was signed out of his live `kitchenkeeper.kitchen` session during the `/sign-up` gate check (with his
  permission) and needed to sign back in.

See [CURRENT_STATE.md](../CURRENT_STATE.md) for what happened next (post-deploy diagnostic findings).
