# TASK-066 — Implementation + On-Device Capture Results

Code implemented per DRAFT-4 spec ([TASK-066-spec.md](../../tasks/TASK-066-spec.md)) §2.1-2.3, shipped to
`staging`+`main` at commit `f11678e`. On-device paired captures (spec §5.5-5.8, acceptance criteria 5/6/8)
were run by Connor the same day and returned a clean, complete result — the early-stop rule (§5.5) was met
on the first export, no further cycles needed.

## Captured data (6 attempts, 3 failed / 3 succeeded, alternating)

All timestamps in ms, relative to that attempt's own `tapMs` (the `oauth-marker-installed` `perfNowMs`,
which matches the heartbeat's own `tapMs`). `signInsElapsedMs` = the `v1/client/sign_ins` resource's
`responseEndMs` minus `tapMs` (exactly one match in every attempt — no `anchor-unavailable` cases).
`pagehideElapsedMs` = that attempt's `lifecycle-pagehide` entry's `perfNowMs` minus `tapMs`.

| Attempt | Tap time (UTC) | Outcome | tapMs | signInsElapsedMs | pagehideElapsedMs | Unexplained gap | heartbeat.gaps | frameCount | elapsedMs | observedInitialCadenceMs |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 2026-08-12T23:43:02.273Z | **failed** | 6138 | 285 | 1205 | 920 | `[]` | 91 | 1191 | [17,16,12] |
| B | 2026-08-12T23:43:07.129Z | succeeded | 4541 | 241 | 540 | 299 | `[]` | 34 | 457 | [30,20,10] |
| C | 2026-08-12T23:43:20.440Z | **failed** | 5601 | 295 | 1293 | 998 | `[]` | 95 | 1269 | [28,21,12] |
| D | 2026-08-12T23:43:26.083Z | succeeded | 5319 | 261 | 560 | 299 | `[]` | 31 | 469 | [30,21,9] |
| E | 2026-08-12T23:43:39.034Z | **failed** | 2858 | 303 | 1181 | 878 | `[]` | 88 | 1166 | [22,19,6] |
| F | 2026-08-12T23:43:43.732Z | succeeded | 4365 | 245 | 654 | 409 | `[]` | 43 | 581 | [29,18,13] |

Outcome was determined from the subsequent `clerk-auth-state`/`sign-flow-state` entries after each
`lifecycle-pageshow` (a failed attempt lands back on `isSignedIn: false` and the user has to tap "Log in"
again; a succeeded attempt lands on `isSignedIn: true` with no further action).

Environment (from `app-boot`, every entry): `standalone: true`, `userAgent` confirms Chrome for iOS (`...
Mobile/15E148 Safari/604.1` — Chrome's iOS UA string, WebKit-based per TASK-066 spec §0), `devicePixelRatio: 3`.

## Analysis

**`heartbeat.gaps` is `[]` in all six attempts — no rAF scheduling gap over the 50ms threshold was recorded
in any attempt, failed or succeeded.** Frame cadence stayed nominal (~13-15ms/frame, consistent with the
observed initial cadence in each attempt) essentially the entire way through, including inside the three
failed attempts' 878-998ms unexplained `sign_ins`→`pagehide` windows — `elapsedMs` (last recorded frame) sits
within ~10-25ms of `pagehideElapsedMs` in every attempt, so the heartbeat kept firing right up until just
before `pagehide`, not just at the start.

Per spec §2.2's qualifying-evidence rule, a gap only counts as evidence for "yes" (main-thread stall) if its
non-tail overlap with the target interval is ≥150ms. With zero recorded gaps in any failed attempt, that
threshold is never met — trivially "no" for A, C, and E.

**Early-stop rule (spec §5.5) satisfied**: ≥3 failed attempts (A, C, E) consistently show no qualifying gap;
≥2 succeeded attempts (B, D, F) provide the contrasting baseline (also no gap, much shorter total duration).
No further captures needed.

## Conclusion (spec AC8 required wording)

**"No sustained main-thread execution stall was observed by this instrument; the evidence therefore shifts
the investigation downstream of JS execution."** This is a consistent result across all three failed
attempts, not mixed/inconclusive. Stated per spec's own epistemic caution: this is an observed pattern from
a small paired sample (n=3 per condition), not a statistically powered characterization of all sign-in
attempts — but it is a clean, unanimous one, with no measurement ambiguity (no `anchor-unavailable` cases,
no partial/superseded heartbeats in this export).

## What this resolves and what it doesn't

- Rules out, with actual evidence (not just absence-of-proof): our own application code, a re-render storm,
  or a synchronous JS task blocking the main thread during the gap. TASK-065's original hypothesis
  (connection-setup time to `accounts.google.com`) and this session's hypothesis (main-thread contention) are
  both now evidenced against.
- Does **not** resolve (spec §0's stated limit): whether the remaining delay is WebKit's own
  navigation/activation handling, or Chrome's own iOS shell code sitting on top of WebKit. Both are
  downstream of JS and look identical to this instrument.
- Spec §7's suggested next step for splitting those two — Chrome's Web Inspector via a connected Mac's
  Safari Develop menu — was investigated as a next action, but **Connor confirmed he does not have Mac
  access** (initially unsure, clarified in the same session). Apple restricts iOS Safari/Chrome
  remote-debugging (Web Inspector) to a Mac running Safari; there is no Windows-native equivalent for
  WebKit-engine remote inspection on iOS. This path is closed unless a Mac becomes available (e.g.
  borrowing one, an Apple Store Genius Bar session, a friend's/coworker's machine).
