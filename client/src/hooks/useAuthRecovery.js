// TASK-064 — see ai/tasks/TASK-064-spec.md Section 3.2-3.4. Recovers from the uncommanded
// WebKit-level reload (Section 2) landing mid-sign-out or mid-sign-in, using the markers written
// by authTransition.js. Two independent, complementary rules for sign-out (3.2); an explicit
// re-prompt, never automatic navigation, for sign-in (3.3).
//
// Pure decision functions (decideSignoutRecovery/decideSigninRecovery) are exported and
// unit-tested independently of React, same pattern as routeDecision.js — this codebase's plain
// `node:test` setup has no jsdom/@testing-library, so hook side effects themselves aren't
// exercised here; only the decision logic they call is.
import { useEffect, useRef, useState } from 'react';
import { useAuth as useClerkAuth, useClerk } from '@clerk/clerk-react';
import { useSettledAuth } from './useSettledAuth.js';
import { logEvent } from '../lib/debugLog.js';
import {
  readSignoutMarker,
  clearSignoutMarker,
  markSignoutAttempt,
  persistSignoutMarker,
  isSignoutMarkerExpired,
  readOauthMarker,
  clearOauthMarker,
  isOauthMarkerExpired,
} from '../lib/authTransition.js';

const SIGNOUT_EXHAUSTED_MESSAGE = "Sign out didn't complete — please try again.";
const OAUTH_INCOMPLETE_MESSAGE = "Sign-in didn't complete — tap to try again";

// Section 3.2 Rule 2's branching, as a pure function of already-read state. `now` is injectable
// for tests; real callers never pass it.
export function decideSignoutRecovery({ marker, isSignedIn, currentSessionId, now = Date.now() }) {
  if (!marker) return { action: 'none' };

  // Expiry (via startedAt, attempt:0 case) is checked before anything else — an expired
  // attempt:0 marker is dropped silently regardless of current auth state.
  if (marker.attempt === 0 && isSignoutMarkerExpired(marker, now)) {
    return { action: 'clear' };
  }

  if (isSignedIn === false) {
    // Rule 1 (continuously reactive, in the hook below) has very likely already cleared this —
    // harmless no-op if somehow not yet.
    return { action: 'clear' };
  }

  if (isSignedIn !== true) {
    // Should not be reached — callers only invoke this strictly after settlement — but fail
    // closed on an unknown state rather than repairing against it.
    return { action: 'none' };
  }

  if (marker.sessionId === null) {
    // Never eligible for automatic repair, unconditionally — nothing to verify a match against,
    // and a null===null coincidence must not be treated as "same session" (spec Section 3.2).
    return { action: 'clear' };
  }

  if (marker.sessionId !== currentSessionId) {
    // Not evidence the original sign-out failed — a genuinely different (newer) session.
    return { action: 'clear' };
  }

  if (marker.attempt === 0) {
    return { action: 'repair' };
  }

  // attempt === 1: exhausted, regardless of elapsed time — a prior repair was attempted,
  // possibly interrupted before Rule 1 could clear it. Age only decides whether the stale
  // exhausted-repair message is still worth surfacing, never whether to retry.
  if (isSignoutMarkerExpired(marker, now)) {
    return { action: 'clear' };
  }
  return { action: 'clear-with-message', messageType: 'signout-exhausted' };
}

// Section 3.3's table, as a pure function.
export function decideSigninRecovery({ marker, isSignedIn, now = Date.now() }) {
  if (!marker) return { action: 'none' };
  if (isOauthMarkerExpired(marker, now)) return { action: 'clear' };
  if (isSignedIn === true) return { action: 'clear' };
  if (isSignedIn === false) {
    return { action: 'clear-with-message', messageType: 'oauth-incomplete' };
  }
  return { action: 'none' };
}

export function useAuthRecovery() {
  const { status: settledStatus, isSignedIn: settledIsSignedIn } = useSettledAuth();
  const { isSignedIn: rawIsSignedIn, sessionId: currentSessionId } = useClerkAuth();
  const { signOut } = useClerk();
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const evaluatedRef = useRef(false);

  // Rule 1 — fast path, continuously reactive, independent of settling/which boot/session wrote
  // the marker: raw isSignedIn === false means there is no active session in this runtime, so a
  // pending sign-out marker's job is done.
  useEffect(() => {
    if (rawIsSignedIn !== false) return;
    if (readSignoutMarker()) {
      clearSignoutMarker();
    }
  }, [rawIsSignedIn]);

  // Rule 2 (sign-out) + Section 3.3 (sign-in) — evaluated once per mount, strictly after
  // useSettledAuth() reaches 'settled' (never modifies that hook/reducer/timers).
  useEffect(() => {
    if (settledStatus !== 'settled') return;
    if (evaluatedRef.current) return;
    evaluatedRef.current = true;

    const signoutMarker = readSignoutMarker();
    const signoutDecision = decideSignoutRecovery({
      marker: signoutMarker,
      isSignedIn: settledIsSignedIn,
      currentSessionId,
    });

    switch (signoutDecision.action) {
      case 'clear':
        clearSignoutMarker();
        break;
      case 'clear-with-message':
        clearSignoutMarker();
        setRecoveryMessage({ type: signoutDecision.messageType, text: SIGNOUT_EXHAUSTED_MESSAGE });
        break;
      case 'repair': {
        const updated = markSignoutAttempt(signoutMarker);
        persistSignoutMarker(updated);
        setRecovering(true);
        logEvent('signout-repair-attempt', { sessionId: currentSessionId });
        signOut()
          .catch(() => {
            /* Rule 1/next-boot Rule 2 handle any further outcome; nothing else to do here */
          })
          .finally(() => setRecovering(false));
        break;
      }
      default:
        break;
    }

    const oauthMarker = readOauthMarker();
    const oauthDecision = decideSigninRecovery({
      marker: oauthMarker,
      isSignedIn: settledIsSignedIn,
    });

    switch (oauthDecision.action) {
      case 'clear':
        clearOauthMarker();
        break;
      case 'clear-with-message':
        clearOauthMarker();
        setRecoveryMessage({ type: oauthDecision.messageType, text: OAUTH_INCOMPLETE_MESSAGE });
        break;
      default:
        break;
    }
  }, [settledStatus, settledIsSignedIn, currentSessionId, signOut]);

  return { recovering, recoveryMessage };
}
