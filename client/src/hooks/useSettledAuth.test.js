import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settledAuthReducer,
  initialSettledAuthState,
  computeSettlement,
  SETTLE_QUIET_MS,
  SETTLE_MAX_MS,
} from './useSettledAuth.js';

// --- settledAuthReducer: explicit loading -> settling -> settled state machine -------------

test('reducer starts in loading with isSignedIn undefined', () => {
  assert.equal(initialSettledAuthState.status, 'loading');
  assert.equal(initialSettledAuthState.isSignedIn, undefined);
});

test('reducer moves loading -> settling on ENTER_SETTLING, publicly exposing isSignedIn undefined', () => {
  const state = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  assert.equal(state.status, 'settling');
  assert.equal(state.isSignedIn, undefined);
  assert.equal(state.settleInitialIsSignedIn, false);
});

test('reducer ignores a second ENTER_SETTLING once already settling', () => {
  const settling = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  const again = settledAuthReducer(settling, { type: 'ENTER_SETTLING', value: true });
  assert.deepEqual(again, settling);
});

test('reducer moves settling -> settled on SETTLE, publishing the settled value and diagnostics', () => {
  const settling = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  const settled = settledAuthReducer(settling, {
    type: 'SETTLE',
    value: true,
    elapsedMs: 742,
    reason: 'stable',
  });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.isSignedIn, true);
  assert.equal(settled.settleFinalIsSignedIn, true);
  assert.equal(settled.settleElapsedMs, 742);
  assert.equal(settled.settleReason, 'stable');
  assert.equal(settled.settleInitialIsSignedIn, false); // preserved from ENTER_SETTLING
});

test('reducer ignores SETTLE while still loading (no settling entered yet)', () => {
  const state = settledAuthReducer(initialSettledAuthState, {
    type: 'SETTLE',
    value: true,
    elapsedMs: 100,
    reason: 'stable',
  });
  assert.deepEqual(state, initialSettledAuthState);
});

test('settled is terminal: a second SETTLE after settling is ignored (Section 3.1.1)', () => {
  const settling = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  const settled = settledAuthReducer(settling, {
    type: 'SETTLE',
    value: false,
    elapsedMs: 400,
    reason: 'stable',
  });
  const secondSettle = settledAuthReducer(settled, {
    type: 'SETTLE',
    value: true,
    elapsedMs: 1900,
    reason: 'timeout',
  });
  assert.deepEqual(secondSettle, settled);
});

test('reducer ignores SIGNED_IN_CHANGED while settling — only timers settle it (Section 3.1.2)', () => {
  const settling = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  const stillSettling = settledAuthReducer(settling, {
    type: 'SIGNED_IN_CHANGED',
    value: true,
  });
  assert.deepEqual(stillSettling, settling);
});

test('post-settlement SIGNED_IN_CHANGED passes through immediately, unbuffered (criteria 3/4)', () => {
  const settling = settledAuthReducer(initialSettledAuthState, {
    type: 'ENTER_SETTLING',
    value: false,
  });
  const settled = settledAuthReducer(settling, {
    type: 'SETTLE',
    value: false,
    elapsedMs: 400,
    reason: 'stable',
  });
  const signedIn = settledAuthReducer(settled, { type: 'SIGNED_IN_CHANGED', value: true });
  assert.equal(signedIn.status, 'settled');
  assert.equal(signedIn.isSignedIn, true);
  // Diagnostics from the original settlement are untouched by a later passthrough change.
  assert.equal(signedIn.settleFinalIsSignedIn, false);
  assert.equal(signedIn.settleReason, 'stable');

  const signedOut = settledAuthReducer(signedIn, { type: 'SIGNED_IN_CHANGED', value: false });
  assert.equal(signedOut.isSignedIn, false);
});

// --- computeSettlement: pure model of the settling->settled timing algorithm ---------------
// Traces mirror Acceptance Criterion 2 (TASK-063-spec.md Section 6) exactly.

test('computeSettlement: false -> true (stable) settles on true once quiet', () => {
  const result = computeSettlement([{ tMs: 0, value: false }]);
  assert.deepEqual(result, { elapsedMs: SETTLE_QUIET_MS, reason: 'stable', value: false });
});

test('computeSettlement: true -> false (stable) settles on false once quiet — the 1261ms real case (finding 6)', () => {
  const result = computeSettlement([{ tMs: 0, value: true }]);
  assert.deepEqual(result, { elapsedMs: SETTLE_QUIET_MS, reason: 'stable', value: true });
});

test('computeSettlement: true -> false -> true resets the quiet timer on each change, ultimately settles true', () => {
  const samples = [
    { tMs: 0, value: true },
    { tMs: 100, value: false },
    { tMs: 250, value: true },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'stable');
  assert.equal(result.value, true);
  assert.equal(result.elapsedMs, 250 + SETTLE_QUIET_MS);
});

test('computeSettlement: false -> true -> false resets the quiet timer on each change, ultimately settles false', () => {
  const samples = [
    { tMs: 0, value: false },
    { tMs: 120, value: true },
    { tMs: 300, value: false },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'stable');
  assert.equal(result.value, false);
  assert.equal(result.elapsedMs, 300 + SETTLE_QUIET_MS);
});

test('computeSettlement: debounce-reset oscillation with the last flip to true at ~1500ms settles stable just under the 2000ms ceiling', () => {
  // Each change lands well inside the previous one's 400ms quiet window, so none of the earlier
  // values ever goes quiet on its own — only the final flip at 1500ms does, right up against the
  // boundary (per review point 2/12: 1500 + 400 = 1900, still under SETTLE_MAX_MS).
  const samples = [
    { tMs: 0, value: false },
    { tMs: 300, value: true },
    { tMs: 600, value: false },
    { tMs: 900, value: true },
    { tMs: 1200, value: false },
    { tMs: 1500, value: true },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'stable');
  assert.equal(result.value, true);
  assert.equal(result.elapsedMs, 1500 + SETTLE_QUIET_MS); // 1900, under the 2000ms ceiling
});

test('computeSettlement: same debounce-reset oscillation but the last flip to true lands at ~1900ms — its quiet deadline would exceed the ceiling, so the ceiling fires instead, but still reports the already-updated value (boundary)', () => {
  const samples = [
    { tMs: 0, value: false },
    { tMs: 300, value: true },
    { tMs: 600, value: false },
    { tMs: 900, value: true },
    { tMs: 1200, value: false },
    { tMs: 1500, value: true },
    { tMs: 1800, value: false },
    { tMs: 1900, value: true },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'timeout');
  assert.equal(result.value, true); // still the latest value at the ceiling — no directional bias
  assert.equal(result.elapsedMs, SETTLE_MAX_MS);
});

test('computeSettlement: a value that never stabilizes settles at exactly SETTLE_MAX_MS on the current raw value (no hang)', () => {
  const samples = [
    { tMs: 0, value: false },
    { tMs: 350, value: true },
    { tMs: 700, value: false },
    { tMs: 1050, value: true },
    { tMs: 1400, value: false },
    { tMs: 1750, value: true },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'timeout');
  assert.equal(result.elapsedMs, SETTLE_MAX_MS);
  assert.equal(result.value, true); // whatever was current when the ceiling fired
});

test('computeSettlement: isSignedIn undefined never satisfies the quiet window on its own (Section 3.1.2)', () => {
  const samples = [
    { tMs: 0, value: undefined },
    { tMs: 1000, value: undefined },
  ];
  const result = computeSettlement(samples);
  // Nothing boolean ever arrived, so only the ceiling can settle it — on whatever the last
  // observed value was (undefined here), per Section 3.1.2's "no special branch" rule.
  assert.equal(result.reason, 'timeout');
  assert.equal(result.elapsedMs, SETTLE_MAX_MS);
  assert.equal(result.value, undefined);
});

test('computeSettlement: undefined interleaved with a boolean does not itself break the quiet window', () => {
  const samples = [
    { tMs: 0, value: undefined },
    { tMs: 50, value: true },
  ];
  const result = computeSettlement(samples);
  assert.equal(result.reason, 'stable');
  assert.equal(result.value, true);
  assert.equal(result.elapsedMs, 50 + SETTLE_QUIET_MS);
});
