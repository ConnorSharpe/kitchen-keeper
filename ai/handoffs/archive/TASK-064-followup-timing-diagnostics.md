# Task

TASK-064 follow-up — investigating whether iOS PWA sign-in can drop from two taps to one. On-device
verification (this session) confirmed TASK-064's mechanism itself works as designed (see
[TASK-064-implementation.md](TASK-064-implementation.md)): sign-out self-repairs invisibly
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

# Outcome (superseded by TASK-065)

The hypothesis was confirmed with real paired same-code timing data in the very next session — see
[TASK-065's spec](../../tasks/TASK-065-spec.md) §0 for the full before/after capture analysis (554ms success
vs. 1708ms failure, splitting cleanly either side of WebKit's ~1s activation window) and CURRENT_STATE.md for
the resulting implementation.

# Known Risks / Open Questions (carried into TASK-065)

- Same-session OAuth cancellation remains a documented, unsolved gap (spec §3.3, carried forward).
- Keyboard/assistive-tech sign-in activation remains uncovered (carried forward, not regressed).

# Verification Results

- `npm run lint`: PASS. `npm run build`: PASS (pre-existing >500kB chunk warning, unrelated).
- `node --test "src/lib/authTransition.test.js"` (client): PASS 18/18, unaffected by the diagnostic addition.
- No test suite exists for `lifecycleLog.js` (pre-existing state, not introduced this session).
- Deploy confirmed live via `vercel ls`/`vercel inspect`: both `staging` Preview and `production` deployments
  `Ready`; `kitchenkeeper.kitchen` alias confirmed pointing at the new production deployment ID.

# Context Notes

- branch: `staging` (commits made directly on `staging`/`main`, no worktree, no feature branch, matching the
  pattern established for TASK-064's own implementation session).
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
