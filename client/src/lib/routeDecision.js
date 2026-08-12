// TASK-063 (spec Section 3.2). Extracted out of App.jsx into its own plain .js file — not just
// stylistic: plain `node --test` cannot resolve `.jsx` files at all (confirmed directly; it
// throws ERR_UNKNOWN_FILE_EXTENSION before even parsing), so a function meant to be tested with
// this codebase's existing `node:test`-only setup (no jsdom/@testing-library, see
// routeDecision.test.js) can't live in a file App.jsx's JSX would otherwise force it into.
//
// Pure function of an already-produced auth snapshot — no knowledge of timers, Clerk, or OAuth
// internals (spec's explicit implementation requirement), so it can't drift into a second copy
// of useSettledAuth()'s state machine.
//
// TASK-064 (spec Section 3.4): `recovering` gains a third input, `recovering` — true only while
// useAuthRecovery()'s Rule 2 repair signOut() is actively in flight. The signed-in application
// must not render mid-repair (acceptance criterion 7), so it's checked alongside `status`, not
// layered on top of it.
export function resolveRouteDecision(
  { status, isSignedIn, recovering },
  { hasPublicHome, pathname }
) {
  if (status !== 'settled' || recovering) return 'render-nothing';
  if (isSignedIn) return 'render-children';
  if (hasPublicHome && pathname === '/') return 'render-public-home';
  return 'redirect-to-sign-in';
}
