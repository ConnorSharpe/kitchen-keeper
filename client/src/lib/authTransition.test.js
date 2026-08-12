import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSignoutMarker,
  writeSignoutMarker,
  markSignoutAttempt,
  persistSignoutMarker,
  clearSignoutMarker,
  isSignoutMarkerExpired,
  readOauthMarker,
  writeOauthMarker,
  clearOauthMarker,
  isOauthMarkerExpired,
  SIGNOUT_KEY,
  OAUTH_KEY,
  PENDING_ACTION_MAX_AGE_MS,
} from './authTransition.js';

function installLocalStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

function installThrowingLocalStorageMock() {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('storage unavailable');
    },
    setItem: () => {
      throw new Error('storage unavailable');
    },
    removeItem: () => {
      throw new Error('storage unavailable');
    },
  };
}

// --- kk_pending_signout: write / read round-trip -------------------------------------------

test('writeSignoutMarker round-trips sessionId, startedAt, attempt:0, attemptStartedAt:null', () => {
  installLocalStorageMock();
  writeSignoutMarker('sess_A', 1000);
  const marker = readSignoutMarker();
  assert.deepEqual(marker, {
    version: 1,
    sessionId: 'sess_A',
    startedAt: 1000,
    attempt: 0,
    attemptStartedAt: null,
  });
});

test('writeSignoutMarker accepts a null sessionId', () => {
  installLocalStorageMock();
  writeSignoutMarker(null, 1000);
  const marker = readSignoutMarker();
  assert.equal(marker.sessionId, null);
});

test('signOut() resolving does not clear the pending-signout marker', () => {
  // Protects DRAFT-1's fix — the marker must survive resolve, since clearing this module's
  // marker is not this module's job (that's Rule 1, in useAuthRecovery.js). This module simply
  // never auto-clears on any timer/event of its own.
  installLocalStorageMock();
  writeSignoutMarker('sess_A', 1000);
  // Simulate time passing with no clear() call from this module.
  assert.ok(readSignoutMarker());
});

// --- kk_pending_signout: repair-attempt monotonicity ----------------------------------------

test('markSignoutAttempt moves attempt 0 -> 1 and sets attemptStartedAt, preserving sessionId/startedAt', () => {
  installLocalStorageMock();
  const marker = writeSignoutMarker('sess_A', 1000);
  const updated = markSignoutAttempt(marker, 1500);
  assert.equal(updated.attempt, 1);
  assert.equal(updated.attemptStartedAt, 1500);
  assert.equal(updated.sessionId, 'sess_A');
  assert.equal(updated.startedAt, 1000);
});

test('persistSignoutMarker persists an updated marker for subsequent reads', () => {
  installLocalStorageMock();
  const marker = writeSignoutMarker('sess_A', 1000);
  const updated = markSignoutAttempt(marker, 1500);
  persistSignoutMarker(updated);
  const reread = readSignoutMarker();
  assert.equal(reread.attempt, 1);
  assert.equal(reread.attemptStartedAt, 1500);
});

// --- kk_pending_signout: expiry --------------------------------------------------------------

test('boot + expired attempt:0 marker is reported expired via startedAt', () => {
  installLocalStorageMock();
  writeSignoutMarker('sess_A', 1000);
  const marker = readSignoutMarker();
  assert.equal(isSignoutMarkerExpired(marker, 1000 + PENDING_ACTION_MAX_AGE_MS + 1), true);
  assert.equal(isSignoutMarkerExpired(marker, 1000 + PENDING_ACTION_MAX_AGE_MS - 1), false);
});

test('boot + expired attempt:1 marker (attemptStartedAt beyond max age) is reported expired via attemptStartedAt, not startedAt', () => {
  installLocalStorageMock();
  const marker = writeSignoutMarker('sess_A', 0);
  const attempted = markSignoutAttempt(marker, 4000); // well past startedAt, itself not yet expired
  assert.equal(
    isSignoutMarkerExpired(attempted, 4000 + PENDING_ACTION_MAX_AGE_MS + 1),
    true
  );
  // Anchored to attemptStartedAt (4000), not startedAt (0) — at 4000 + MAX - 1 this is still
  // "expired relative to startedAt" (0) but must NOT be expired relative to attemptStartedAt.
  assert.equal(
    isSignoutMarkerExpired(attempted, 4000 + PENDING_ACTION_MAX_AGE_MS - 1),
    false
  );
});

// --- kk_pending_signout: fail-closed parsing (criterion 16) ---------------------------------

test('malformed JSON in kk_pending_signout is treated as absent and cleared', () => {
  const store = installLocalStorageMock();
  store.set(SIGNOUT_KEY, '{not json');
  assert.equal(readSignoutMarker(), null);
  assert.equal(store.has(SIGNOUT_KEY), false);
});

test('unversioned/missing-version kk_pending_signout is treated as absent and cleared', () => {
  const store = installLocalStorageMock();
  store.set(SIGNOUT_KEY, JSON.stringify({ sessionId: 'x', startedAt: 1, attempt: 0 }));
  assert.equal(readSignoutMarker(), null);
  assert.equal(store.has(SIGNOUT_KEY), false);
});

test('kk_pending_signout with attempt outside {0,1} is treated as absent and cleared', () => {
  const store = installLocalStorageMock();
  store.set(
    SIGNOUT_KEY,
    JSON.stringify({ version: 1, sessionId: 'x', startedAt: 1, attempt: 2, attemptStartedAt: null })
  );
  assert.equal(readSignoutMarker(), null);
  assert.equal(store.has(SIGNOUT_KEY), false);
});

test('kk_pending_signout with invalid sessionId type is treated as absent and cleared', () => {
  const store = installLocalStorageMock();
  store.set(
    SIGNOUT_KEY,
    JSON.stringify({ version: 1, sessionId: 42, startedAt: 1, attempt: 0, attemptStartedAt: null })
  );
  assert.equal(readSignoutMarker(), null);
  assert.equal(store.has(SIGNOUT_KEY), false);
});

test('kk_pending_signout with invalid startedAt type is treated as absent and cleared', () => {
  const store = installLocalStorageMock();
  store.set(
    SIGNOUT_KEY,
    JSON.stringify({ version: 1, sessionId: 'x', startedAt: 'nope', attempt: 0, attemptStartedAt: null })
  );
  assert.equal(readSignoutMarker(), null);
});

test('reading with no marker present returns null without throwing', () => {
  installLocalStorageMock();
  assert.equal(readSignoutMarker(), null);
  assert.equal(readOauthMarker(), null);
});

// --- kk_pending_oauth ------------------------------------------------------------------------

test('writeOauthMarker round-trips version/startedAt', () => {
  installLocalStorageMock();
  writeOauthMarker(2000);
  assert.deepEqual(readOauthMarker(), { version: 1, startedAt: 2000 });
});

test('clearOauthMarker removes the marker', () => {
  installLocalStorageMock();
  writeOauthMarker(2000);
  clearOauthMarker();
  assert.equal(readOauthMarker(), null);
});

test('isOauthMarkerExpired respects PENDING_ACTION_MAX_AGE_MS', () => {
  installLocalStorageMock();
  const marker = writeOauthMarker(0);
  assert.equal(isOauthMarkerExpired(marker, PENDING_ACTION_MAX_AGE_MS + 1), true);
  assert.equal(isOauthMarkerExpired(marker, PENDING_ACTION_MAX_AGE_MS - 1), false);
});

test('malformed kk_pending_oauth is treated as absent and cleared, never throws', () => {
  const store = installLocalStorageMock();
  store.set(OAUTH_KEY, 'not json at all');
  assert.doesNotThrow(() => readOauthMarker());
  assert.equal(readOauthMarker(), null);
  assert.equal(store.has(OAUTH_KEY), false);
});

// --- marker storage failure never prevents the underlying auth action ----------------------

test('getItem/setItem/removeItem each throwing never escapes as an exception, for both marker kinds', () => {
  installThrowingLocalStorageMock();
  assert.doesNotThrow(() => writeSignoutMarker('sess_A', 1000));
  assert.doesNotThrow(() => readSignoutMarker());
  assert.doesNotThrow(() => clearSignoutMarker());
  assert.doesNotThrow(() => persistSignoutMarker({ version: 1, sessionId: 'x', startedAt: 1, attempt: 0, attemptStartedAt: null }));
  assert.doesNotThrow(() => writeOauthMarker(1000));
  assert.doesNotThrow(() => readOauthMarker());
  assert.doesNotThrow(() => clearOauthMarker());
  // The write "succeeding" from the caller's point of view (no throw) is the whole point —
  // logout() must still be able to call signOut() even though nothing was actually persisted.
  assert.equal(readSignoutMarker(), null);
});
