# Task

TASK-064 follow-up — investigating whether iOS PWA sign-in can drop from two taps to one. On-device
verification (this session) confirmed TASK-064's mechanism itself works as designed (see
[archive/TASK-064-implementation.md](archive/TASK-064-implementation.md)): sign-out self-repairs invisibly
(one tap), sign-in shows an explicit re-prompt after an interrupting reload (still two taps, by deliberate
design — spec §3.3 rejected auto-retry). This session is testing a specific hypothesis for why the sign-in
redirect gets interrupted at all, before committing to a larger fix.

# Current Status

**Hypothesis under test**: WebKit's transient user-activation window (~1s after a tap — see
[WebKit's own writeup](https://webkit.org/blog/13862/the-user-activation-api/)) expires before Clerk's own
async round-trip (creating the sign-in attempt, fetching the OAuth authorize URL) completes and calls
`window.location.href =`. A captured real repro showed a ~1.8s gap between the tap and the interrupting
reload — past that ~1s window. If the redirect fires after activation has expired, iOS's standalone-PWA
navigation policy may no longer trust it as user-initiated, producing the observed bounce-back-to-`/` reload
instead of a real navigation to Google. This would also explain the field-documented "first attempt fails,
retry succeeds" pattern (warm connection on retry → faster round-trip → still inside the window). Sourced
from: [WebKitErrorDomain 102 reports](https://github.com/pwa-builder/PWABuilder/issues/5115),
[Apple Developer Forums #649699](https://developer.apple.com/forums/thread/649699) — this is a known,
long-standing, still-unresolved iOS/WebKit limitation, not unique to this app or to Clerk.

**Shipped this session (diagnostic only, no behavior change)**: timing instrumentation to confirm or refute
the hypothesis before designing a fix.
- `client/src/lib/authTransition.js` — `oauth-marker-installed` log now includes `perfNowMs`
  (`performance.now()` at the moment of the Google-button tap). Synchronous read, doesn't change the
  synchronous-only click-listener contract (spec §3.5).
- `client/src/lib/lifecycleLog.js` — `lifecycle-pagehide` log now includes, when debug mode is enabled,
  `perfNowMs` plus Resource Timing entries for any request whose URL matches `/clerk/i` (host+pathname only,
  query strings stripped in case of tokens), each with `startMs`/`durationMs`/`responseEndMs`. Captured at
  `pagehide` specifically, since Resource Timing entries for this page load are gone once the interrupting
  reload actually lands. Gated behind `isDebugEnabled()` so it costs real users nothing.

Commit `2af6d6d`, fast-forwarded onto both `staging` and `main`, confirmed deployed and `kitchenkeeper.kitchen`
aliased to the new production deployment (`dpl_5HbzKUKLhRAVykLdRTEckVEBGojc`).

# Files Modified

- `client/src/lib/authTransition.js` — added `perfNowMs` to the existing `oauth-marker-installed` diagnostic.
- `client/src/lib/lifecycleLog.js` — added `captureClerkNetworkTiming()`, wired into the `pagehide` listener.

# Remaining Work

1. **Connor to capture a fresh on-device repro** (enable debug mode, repeat the sign-in tap → reload →
   retry sequence, "Copy all" from the debug panel, same flow as before).
2. **Analyze the captured `lifecycle-pagehide` / `oauth-marker-installed` pairs**: compute
   `responseEndMs - perfNowMs` (tap-to-Clerk-request-finish) for both the failing first attempt and the
   succeeding retry. If the failing attempt's value is consistently ≥~1000ms and the succeeding retry's is
   consistently <~1000ms, that's strong confirmation. If both are far above or far below ~1000ms regardless
   of outcome, the activation-expiry theory is likely wrong and shouldn't be pursued further.
3. **If confirmed**: the fix candidates discussed (not yet started) are (a) `<link rel="preconnect">` to
   Clerk's Frontend API domain to shrink the round-trip below the activation window — cheap, low-risk,
   worth trying first; (b) eagerly pre-fetching the OAuth authorize URL on `/sign-in` mount via Clerk's
   custom OAuth flow, so the actual redirect can fire synchronously inside the click handler — the more
   complete fix, but requires moving off Clerk's default hosted button, larger scope.
4. **If refuted**: fall back to the smaller, already-identified friction fix — the interrupting reload lands
   at `/` (the PWA's `start_url`), not `/sign-in` as spec §3.3 assumed, so the recovery toast currently fires
   on the wrong page and costs an extra "Log in" tap to get back to the Google button. Routing the recovery
   flow back to `/sign-in` directly would cut that tap regardless of the activation-expiry theory's outcome.

# Known Risks / Open Questions

- The activation-expiry theory is a hypothesis backed by timing correlation and general WebKit documentation,
  not yet confirmed against this app's actual Clerk request timing — do not treat it as fact until the
  captured data in Remaining Work #2 supports it.
- Same-session OAuth cancellation remains a documented, unsolved gap (spec §3.3, carried forward).
- Keyboard/assistive-tech sign-in activation remains uncovered (carried forward, not regressed).

# Verification Results

- `npm run lint`: PASS. `npm run build`: PASS (pre-existing >500kB chunk warning, unrelated).
- `node --test "src/lib/authTransition.test.js"` (client): PASS 18/18, unaffected by the diagnostic addition.
- No test suite exists for `lifecycleLog.js` (pre-existing state, not introduced this session).
- Deploy confirmed live via `vercel ls`/`vercel inspect`: both `staging` Preview and `production` deployments
  `Ready`; `kitchenkeeper.kitchen` alias confirmed pointing at the new production deployment ID.
- On-device verification of the timing capture itself: **not yet performed** — this is diagnostic
  instrumentation; its own correctness will be confirmed by whether Connor's next capture actually contains
  the new fields, at the same time as it answers the underlying hypothesis question.

# Recommended Next Action

Connor: reproduce the sign-in double-tap on-device with debug mode on, copy the log, and share it. That
single capture both validates this instrumentation and (per Remaining Work #2) answers whether the
activation-expiry theory holds — no further code changes needed until that data comes back.

# Context Notes

- branch: `staging` (working tree here; `main` fast-forwarded to the same commit `2af6d6d` and pushed, then
  checked back out to `staging`). No dev server started — this is server-agnostic client instrumentation, no
  new UI surface. No migration/schema work — `MIGRATION_LEDGER.md` doesn't exist in this repo (no
  multi-environment schema-lineage concern here beyond the existing per-environment Neon branches, which this
  task doesn't touch).
- Left uncommitted/untouched, pre-existing and unrelated to this task: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed this session either.

# PowerShell Merge Block

Not applicable this session — commits were made directly on `staging`/`main` (no worktree, no feature branch),
matching the pattern already established for TASK-064's own implementation session.

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
