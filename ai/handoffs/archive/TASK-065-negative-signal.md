# Task

TASK-065 — iOS PWA sign-in: preconnect to Google's OAuth endpoint. Code shipped to `staging`/`main`
(commit `7492198`) — see [TASK-065-implementation.md](TASK-065-implementation.md) for the
full implementation write-up. **This session's finding: early post-deploy data suggests the fix may not be
working.** Connor wants to pause the on-device grind and have the next agent find a more concrete diagnostic
path before continuing.

# Current Status

Connor did a quick manual check (sign out → sign in, a few cycles) rather than the full ~20-cycle protocol,
specifically to see if the interruption still happens at all post-deploy. **It still happened** — one failed
attempt (bounced to `/`, required a retry), one succeeded, captured via the existing debug-mode instrumentation
(shipped in the TASK-064-followup session, unchanged by this task).

**The numbers, compared directly against the pre-fix baseline from spec §0** (same breakdown: tap →
`sign_ins` response → `pagehide`/redirect):

| | Tap→`sign_ins` response | `sign_ins` response→`pagehide` (the gap preconnect targets) | Tap→`pagehide` | Outcome |
|---|---|---|---|---|
| Post-fix attempt 1 (2026-08-12 ~21:44) | 365ms | **1172ms** | 1537ms | failed |
| Post-fix attempt 2 (2026-08-12 ~21:44) | 207ms | **283ms** | 490ms | succeeded |
| Pre-fix baseline (spec §0, captured 2026-08-12 ~20:18) | 473ms | **1235ms** | 1708ms | failed |
| Pre-fix baseline (spec §0, captured 2026-08-12 ~20:18) | 269ms | **285ms** | 554ms | succeeded |

**The middle column — the unexplained gap between Clerk's `sign_ins` response and the actual
`pagehide`/redirect — is the specific thing a working preconnect hint to `accounts.google.com` should shrink,
since that's the leg where a cold connection would show up. It's essentially unchanged: 1172ms vs. 1235ms on
the failed side, 283ms vs. 285ms on the succeeded side.** Both post-fix captures do carry the new diagnostic
fields (so this isn't the stale-bundle problem found earlier in the investigation — Connor was running the
current, fixed code).

**Caveat, stated plainly**: this is n=1 additional pair, not the ~10-per-condition target in spec §5
criterion 4. It is not a statistically rigorous result. But it's also not nothing — landing within ~5% of the
pre-fix baseline on both sides, right after shipping a change specifically meant to move the failed-side
number, is a real early signal, not noise in a random direction.

# Interpretation

This is consistent with two of the possibilities spec §7 already named for a negative result:
1. Connection-setup time to `accounts.google.com` was never the dominant contributor to the gap (the
   original root-causing in §0 item 7 flagged this as genuinely possible — main-thread contention or WebKit
   navigation negotiation were the two alternative explanations, and neither was ruled out at spec-writing
   time).
2. WebKit declined to meaningfully honor the preconnect hint (spec §6-B: preconnect is a hint, not a
   guarantee; the HTML spec explicitly permits a partial handshake or a full skip under resource
   constraints).

Spec §6-B's own suggested check — a Mac + Safari Web Inspector session against the connected iPhone,
watching the Network panel for connection activity to `accounts.google.com` prior to the OAuth tap — was
never performed (no Mac/Safari Web Inspector setup available this session) and would be the fastest way to
tell these two apart: if WebKit visibly isn't even attempting the connection, the hint itself needs
troubleshooting (placement, timing, whether React is actually committing it before the tap); if it's
attempting the connection and the gap still doesn't shrink, the gap almost certainly isn't connection-setup
time at all, and root-causing needs to go back to main-thread-contention/navigation-negotiation territory
that spec §0 item 7 identified but couldn't diagnose (WebKit has no Long Tasks API, confirmed via MDN
browser-compat-data during spec-drafting).

# Remaining Work (at the time this was archived)

1. **Reconsider the diagnostic approach before collecting more raw cycles.** Grinding through the full
   ~20-cycle protocol (spec §5 criterion 4) without first knowing *why* the gap didn't move risks spending a
   lot of Connor's manual effort confirming a negative result whose cause is still unknown. Candidates worth
   evaluating: (a) the Web Inspector connection-activity check above (§6-B) — cheap, direct evidence, but
   needs a Mac; (b) a `PerformanceObserver`/other JS-visible signal for whether the browser actually opened a
   connection to `accounts.google.com` before the tap (i.e. a code-level equivalent of §6-B — hasn't been
   scoped or evaluated for feasibility); (c) re-examine whether the hint is even reaching `document.head` at
   the right time in production — the §6-A live-DOM check was skipped in the implementation session (Chrome
   extension blocked `localhost`) and has still never been directly observed, so a working hint is an
   assumption based on code review, not confirmed fact.
2. **`/sign-up` gate and implementation details**: already resolved/shipped, see the archived write-up. Not
   open questions.
3. Full ~20-cycle on-device comparison (spec §5 criterion 4): not started; hold per Connor's request to step
   back first.

**Resolution**: candidate (b) above became TASK-066 — a `requestAnimationFrame`-based main-thread heartbeat,
the code-level diagnostic this section was speculating about. See CURRENT_STATE.md for its implementation
status.

# Known Risks / Open Questions

- **The core premise of this task may be wrong** — see Interpretation above. Not confirmed either way at n=1,
  but worth treating as a live possibility rather than assuming the fix works and only the measurement is
  incomplete.
- The §6-A live-DOM check has never been performed at any point in this task (implementation session or
  since) — it remains genuinely unconfirmed that the `<link>` tag is landing in the DOM at all in production,
  which would be a much simpler explanation for a null result than either of the Interpretation section's
  theories.
- No regression risk either way — TASK-064's two-tap recovery mechanism is untouched and remains the
  fallback regardless of whether this fix helps (spec §2.3, §7).

# Context Notes

- branch: `staging` and `main` both at commit `7492198` (plus follow-up doc commit `afa35bc` on `staging`
  only — handoff-only, not yet fast-forwarded to `main`; low urgency, docs-only).
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
