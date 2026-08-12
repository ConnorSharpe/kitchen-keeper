# Task

TASK-066 — Main-thread rAF heartbeat diagnostic: **complete, conclusive result.** See
[archive/TASK-066-implementation.md](archive/TASK-066-implementation.md) for the full implementation and
on-device capture write-up.

# Current Status

Code shipped to `staging`/`main` (commit `f11678e`), diagnostic-only and debug-gated (no behavior change for
real users). Connor ran the on-device paired captures the same day and got a clean, unanimous result on the
first export — the spec's early-stop rule was satisfied immediately, no further cycles needed.

**Conclusion**: across 3 failed + 3 succeeded sign-in attempts, the rAF heartbeat recorded **zero** scheduling
gaps over 50ms in any attempt — including inside the three failed attempts' 878-998ms unexplained
`sign_ins`→`pagehide` windows. Per spec's required wording: *"no sustained main-thread execution stall was
observed by this instrument; the evidence therefore shifts the investigation downstream of JS execution."*
Our own code, a re-render storm, and a blocking JS task are now evidenced against, not just unproven.

# Remaining Work

The diagnostic instrument's job is done. What's left is a decision, not code:

1. **Splitting WebKit-proper from Chrome's own iOS shell code** (spec §0/§7's stated residual limit — this
   instrument can't tell the two apart, both are downstream of JS). The suggested next diagnostic — Chrome's
   Web Inspector via a Mac's Safari Develop menu — is **blocked**: Connor confirmed he does not have Mac
   access (Windows only), and Apple restricts iOS Safari/Chrome remote debugging to a Mac; there's no
   Windows-native substitute.
2. Given that block, the practical options are: (a) borrow/access a Mac somewhere (friend, coworker, Apple
   Store) for a one-off Web Inspector session, or (b) treat this task's finding as the practical stopping
   point — TASK-064's two-tap recovery mechanism already mitigates the user-facing symptom regardless of root
   cause, and further root-causing a downstream WebKit/Chrome-shell behavior we can't fix in our own code has
   diminishing return. **Not decided yet — Connor's call, not made this session.**
3. §6-A (whether TASK-065's preconnect `<link>` lands in the DOM in production) remains unconfirmed, separate
   from this task, not blocking.

# Known Risks / Open Questions

- No regression risk: TASK-064's recovery mechanism is untouched; this diagnostic is debug-gated and
  failure-isolated from all real click/pagehide handling, and stays in the codebase as a diagnostic-only
  extension (no follow-up code work required to consider TASK-066 itself closed).
- If TASK-066 is picked back up later purely to close the WebKit-vs-Chrome-shell gap, that requires Mac
  access first — don't re-scope code work before that's resolved.

# Recommended Next Action

Await Connor's decision on Mac access vs. accepting the current finding. No code or further on-device
capture work is queued until that's decided.

# Context Notes

- branch: `staging` and `main` both at commit `f11678e`.
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Pre-existing, unrelated to this task (carried forward, untouched): `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed by this task's sessions.
- context pressure: low
- token usage concerns: none

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
- TASK-064 follow-up (timing diagnostics, confirmed the WebKit activation-expiry hypothesis with paired
  on-device data, feeding directly into TASK-065): see
  [archive/TASK-064-followup-timing-diagnostics.md](archive/TASK-064-followup-timing-diagnostics.md)
- TASK-065 implementation/deploy (preconnect hint shipped to `/sign-in` and `/sign-up`): see
  [archive/TASK-065-implementation.md](archive/TASK-065-implementation.md)
- TASK-065 post-deploy negative signal + TASK-066 diagnosis handoff: see
  [archive/TASK-065-negative-signal.md](archive/TASK-065-negative-signal.md)
- TASK-066 implementation + on-device capture results (conclusive: no main-thread stall observed): see
  [archive/TASK-066-implementation.md](archive/TASK-066-implementation.md)
