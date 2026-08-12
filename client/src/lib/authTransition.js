// TASK-064 — see ai/tasks/TASK-064-spec.md Section 3.1. Persistence for auth transitions that can
// be interrupted by the uncommanded WebKit-level reload documented in Section 2 (a resolved
// signOut() promise, or a tapped OAuth button, is not proof the transition survived). Pure
// read/write/clear/expiry functions + the click listener that writes the OAuth marker — kept
// separate from lifecycleLog.js's diagnostic-only logging so a future "strip debug logging"
// cleanup can't delete load-bearing recovery behavior by mistake. Decision logic for what to DO
// with a marker (Rules 1/2) lives in useAuthRecovery.js, not here.
import { logEvent } from './debugLog.js';

export const SIGNOUT_KEY = 'kk_pending_signout';
export const OAUTH_KEY = 'kk_pending_oauth';
export const SCHEMA_VERSION = 1;

// Provisional (spec Section 8) — a garbage-collection safety bound, not proof of causal
// relationship between a reload and any given marker.
export const PENDING_ACTION_MAX_AGE_MS = 5000;

// Google button's actual clickable ancestor carries both a social-button class and the
// `__google` provider suffix (spec Section 3.5) — matched via closest() because the captured
// click target was a child <span>, not the button itself. Class-based, not prefix-only, so
// Apple/GitHub/etc. buttons never match.
const GOOGLE_BUTTON_SELECTOR =
  '[class*="cl-socialButtonsBlockButton"][class*="__google"]';

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Best-effort only — persistence failures must never block the real auth action (Section 3.1's
// persistence-failure contract covers writes as well as reads).
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable/full — this transition simply won't be recoverable if interrupted */
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* unavailable — nothing to clear */
  }
}

function parseSignoutMarker(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed?.version !== SCHEMA_VERSION) return null;
  if (typeof parsed.startedAt !== 'number') return null;
  if (parsed.attempt !== 0 && parsed.attempt !== 1) return null;
  if (parsed.sessionId !== null && typeof parsed.sessionId !== 'string') return null;
  if (parsed.attemptStartedAt !== null && typeof parsed.attemptStartedAt !== 'number') {
    return null;
  }
  return {
    version: SCHEMA_VERSION,
    sessionId: parsed.sessionId,
    startedAt: parsed.startedAt,
    attempt: parsed.attempt,
    attemptStartedAt: parsed.attemptStartedAt,
  };
}

function parseOauthMarker(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed?.version !== SCHEMA_VERSION) return null;
  if (typeof parsed.startedAt !== 'number') return null;
  return { version: SCHEMA_VERSION, startedAt: parsed.startedAt };
}

// --- kk_pending_signout ------------------------------------------------------------------

export function readSignoutMarker() {
  const raw = safeGetItem(SIGNOUT_KEY);
  if (!raw) return null;
  const marker = parseSignoutMarker(raw);
  if (!marker) {
    // Malformed/unversioned/invalid — fail closed: treat as absent, clear it.
    safeRemoveItem(SIGNOUT_KEY);
    return null;
  }
  return marker;
}

// Written the instant a sign-out transition begins; retained through signOut() resolving or
// throwing (clearing it early was DRAFT-1's bug — see spec Section 3.1).
export function writeSignoutMarker(sessionId, now = Date.now()) {
  const marker = {
    version: SCHEMA_VERSION,
    sessionId: sessionId ?? null,
    startedAt: now,
    attempt: 0,
    attemptStartedAt: null,
  };
  safeSetItem(SIGNOUT_KEY, JSON.stringify(marker));
  return marker;
}

// Pure — returns the marker with attempt moved 0 -> 1. Caller persists via
// persistSignoutMarker(); monotonic, never called on an already-attempt:1 marker.
export function markSignoutAttempt(marker, now = Date.now()) {
  return { ...marker, attempt: 1, attemptStartedAt: now };
}

export function persistSignoutMarker(marker) {
  safeSetItem(SIGNOUT_KEY, JSON.stringify(marker));
}

export function clearSignoutMarker() {
  safeRemoveItem(SIGNOUT_KEY);
}

// attempt:0 is checked against startedAt; attempt:1 (found already-set on a later boot) is
// checked against attemptStartedAt. The attempt:1 check never causes a second retry — attempt:1
// is unconditionally exhausted regardless of age — it only decides whether a stale exhausted
// message is still worth surfacing (spec Section 3.1).
export function isSignoutMarkerExpired(marker, now = Date.now()) {
  if (marker.attempt === 0) {
    return now - marker.startedAt > PENDING_ACTION_MAX_AGE_MS;
  }
  const anchor = marker.attemptStartedAt ?? marker.startedAt;
  return now - anchor > PENDING_ACTION_MAX_AGE_MS;
}

// --- kk_pending_oauth ----------------------------------------------------------------------

export function readOauthMarker() {
  const raw = safeGetItem(OAUTH_KEY);
  if (!raw) return null;
  const marker = parseOauthMarker(raw);
  if (!marker) {
    safeRemoveItem(OAUTH_KEY);
    return null;
  }
  return marker;
}

export function writeOauthMarker(now = Date.now()) {
  const marker = { version: SCHEMA_VERSION, startedAt: now };
  safeSetItem(OAUTH_KEY, JSON.stringify(marker));
  return marker;
}

export function clearOauthMarker() {
  safeRemoveItem(OAUTH_KEY);
}

export function isOauthMarkerExpired(marker, now = Date.now()) {
  return now - marker.startedAt > PENDING_ACTION_MAX_AGE_MS;
}

// --- Production click listener (spec Section 3.5) -----------------------------------------

// Separate from lifecycleLog.js's diagnostic installClickLogging() — this one performs real
// production auth-recovery behavior (writes the marker Rule 2/sign-in recovery reads), not just
// observation. Synchronous only: event -> cheap selector match -> best-effort synchronous write
// -> return. Never awaits anything before the user's own click finishes propagating, so it can
// never delay or interfere with Clerk's own handler for the same click.
//
// Pointer/click activation is the only currently instrumented path — keyboard/assistive-tech
// activation of the Google button isn't covered (known follow-up, spec Section 3.5/8). This does
// not regress those paths; it simply doesn't yet extend recovery coverage to them.
//
// If Clerk's markup changes in a future SDK upgrade and the selector stops matching, the failure
// mode is "no marker gets written, sign-in interruptions go back to being silently unrecoverable"
// — a regression to pre-TASK-064 behavior, not a new failure mode. oauth-marker-installed fires on
// every successful match so a real capture shows whether this instrumentation itself is firing.
export function installOauthMarkerListener() {
  document.addEventListener(
    'click',
    (e) => {
      const match = e.target?.closest?.(GOOGLE_BUTTON_SELECTOR);
      if (!match) return;
      writeOauthMarker();
      logEvent('oauth-marker-installed', {});
    },
    { capture: true }
  );
}
