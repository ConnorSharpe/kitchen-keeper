import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSignoutRecovery, decideSigninRecovery } from './useAuthRecovery.js';

// These exercise the pure Rule 2 (sign-out) / Section 3.3 (sign-in) decision logic in isolation.
// Rule 1 (continuously-reactive raw-state clearing) and the actual signOut() repair call are
// real React effects in useAuthRecovery() itself — this codebase's plain `node:test` setup has
// no jsdom/@testing-library (see routeDecision.test.js's same constraint), so those are verified
// by on-device testing (spec Section 7) rather than here. What's covered here is everything the
// decision layer can get wrong on its own.

const markerA = (overrides = {}) => ({
  version: 1,
  sessionId: 'sess_A',
  startedAt: 1000,
  attempt: 0,
  attemptStartedAt: null,
  ...overrides,
});

// --- sign-out: no marker / expired attempt:0 -------------------------------------------------

test('boot + no marker -> pass-through, no state change, no added render', () => {
  assert.deepEqual(
    decideSignoutRecovery({ marker: null, isSignedIn: true, currentSessionId: 'sess_A' }),
    { action: 'none' }
  );
});

test('boot + expired attempt:0 marker -> cleared silently, no recovery action, regardless of isSignedIn', () => {
  const marker = markerA();
  const now = 1000 + 5000 + 1;
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_A', now }),
    { action: 'clear' }
  );
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: false, currentSessionId: 'sess_A', now }),
    { action: 'clear' }
  );
});

// --- sign-out: isSignedIn false -------------------------------------------------------------

test('boot + isSignedIn:false + attempt:0 marker -> cleared, no message', () => {
  assert.deepEqual(
    decideSignoutRecovery({
      marker: markerA(),
      isSignedIn: false,
      currentSessionId: 'sess_A',
      now: 1200,
    }),
    { action: 'clear' }
  );
});

// --- sign-out: null sessionId never repaired --------------------------------------------------

test('a signed-in session with a null-sessionId marker is never repaired', () => {
  const marker = markerA({ sessionId: null });
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: null, now: 1200 }),
    { action: 'clear' }
  );
  // Even if currentSessionId also happens to be null — must not satisfy via null===null.
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_B', now: 1200 }),
    { action: 'clear' }
  );
});

// --- sign-out marker cannot undo a later legitimate sign-in (P0, backstop variant) -----------

test('sign-out marker cannot cause a later legitimate sign-in to be automatically undone: session-ID backstop', () => {
  // Marker written for session A; Rule 1 hasn't fired; user signs into session B; boot settles
  // isSignedIn:true with session B's ID. Must clear silently, never repair against session B.
  const marker = markerA({ sessionId: 'sess_A' });
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_B', now: 1200 }),
    { action: 'clear' }
  );
});

// --- sign-out: repair path -------------------------------------------------------------------

test('an uncommanded reload landing after a not-yet-durable signOut() triggers exactly one automatic repair', () => {
  const marker = markerA({ sessionId: 'sess_A', attempt: 0 });
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_A', now: 1200 }),
    { action: 'repair' }
  );
});

// --- sign-out: repair itself interrupted -> exhausted, never retried -------------------------

test('reload interrupts the repair itself: attempt:1 found on next boot -> cleared, message shown, no second repair attempt', () => {
  const marker = markerA({ sessionId: 'sess_A', attempt: 1, attemptStartedAt: 1500 });
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_A', now: 1600 }),
    { action: 'clear-with-message', messageType: 'signout-exhausted' }
  );
});

test('boot + expired attempt:1 marker (attemptStartedAt beyond max age) -> cleared silently, no message', () => {
  const marker = markerA({ sessionId: 'sess_A', attempt: 1, attemptStartedAt: 1500 });
  const now = 1500 + 5000 + 1;
  assert.deepEqual(
    decideSignoutRecovery({ marker, isSignedIn: true, currentSessionId: 'sess_A', now }),
    { action: 'clear' }
  );
});

test('exhausted attempt:1 marker is never repaired again even if somehow re-evaluated', () => {
  const marker = markerA({ sessionId: 'sess_A', attempt: 1, attemptStartedAt: 1500 });
  const decision = decideSignoutRecovery({
    marker,
    isSignedIn: true,
    currentSessionId: 'sess_A',
    now: 1600,
  });
  assert.notEqual(decision.action, 'repair');
});

// --- sign-in: equivalent set for kk_pending_oauth ---------------------------------------------

test('sign-in: boot + no marker -> pass-through', () => {
  assert.deepEqual(decideSigninRecovery({ marker: null, isSignedIn: true }), { action: 'none' });
});

test('sign-in: expired marker -> cleared, no message', () => {
  const marker = { version: 1, startedAt: 0 };
  assert.deepEqual(
    decideSigninRecovery({ marker, isSignedIn: false, now: 5001 }),
    { action: 'clear' }
  );
});

test('sign-in: successful OAuth round-trip clears the marker silently', () => {
  const marker = { version: 1, startedAt: 0 };
  assert.deepEqual(
    decideSigninRecovery({ marker, isSignedIn: true, now: 100 }),
    { action: 'clear' }
  );
});

test('a Google-button tap followed by an uncommanded reload before OAuth starts produces the "didn\'t complete" message', () => {
  const marker = { version: 1, startedAt: 0 };
  assert.deepEqual(
    decideSigninRecovery({ marker, isSignedIn: false, now: 100 }),
    { action: 'clear-with-message', messageType: 'oauth-incomplete' }
  );
});

test('sign-in decision never returns a navigation-triggering action', () => {
  const marker = { version: 1, startedAt: 0 };
  for (const isSignedIn of [true, false, undefined]) {
    const decision = decideSigninRecovery({ marker, isSignedIn, now: 100 });
    assert.ok(!('navigate' in decision));
  }
});
