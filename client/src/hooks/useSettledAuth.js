// TASK-063 — see ai/tasks/TASK-063-spec.md. Three real production captures showed Clerk's first
// isLoaded===true reading after a fresh mount can be wrong (both on reload and with no reload at
// all — one capture self-corrected 1261ms later with zero navigation events in between). This
// hook replaces trusting that first reading with an explicit loading -> settling -> settled state
// machine, shared by a single provider so every consumer reads the same settled snapshot
// (spec Section 3.1). Kept as a .js file (no JSX) so it stays independently testable with plain
// `node:test` — see useSettledAuth.test.js.
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { logEvent } from '../lib/debugLog.js';

export const SETTLE_QUIET_MS = 400;
export const SETTLE_MAX_MS = 2000;

const SettledAuthContext = createContext(null);

export const initialSettledAuthState = {
  status: 'loading',
  isSignedIn: undefined,
  settleInitialIsSignedIn: undefined,
  settleFinalIsSignedIn: undefined,
  settleElapsedMs: undefined,
  settleReason: undefined,
};

// Pure state-machine transitions (Section 9 checklist: "explicit state, not an inferred boolean
// combination"). No knowledge of timers/Clerk/OAuth here — that lives in the provider below,
// which is the only part of this file that needs a DOM/React runtime to exercise.
export function settledAuthReducer(state, action) {
  switch (action.type) {
    case 'ENTER_SETTLING':
      // First-time-only per mount — settled is terminal (Section 3.1.1), so a stray second
      // ENTER_SETTLING must not restart it.
      if (state.status !== 'loading') return state;
      return { ...state, status: 'settling', settleInitialIsSignedIn: action.value };
    case 'SETTLE':
      if (state.status !== 'settling') return state;
      return {
        ...state,
        status: 'settled',
        isSignedIn: action.value,
        settleFinalIsSignedIn: action.value,
        settleElapsedMs: action.elapsedMs,
        settleReason: action.reason,
      };
    case 'SIGNED_IN_CHANGED':
      // Only meaningful post-settlement — while settling, timers (not raw changes) drive the
      // transition to settled (Section 3.1.2). Post-settlement, this is the unbuffered
      // passthrough required by acceptance criteria 3/4.
      if (state.status !== 'settled') return state;
      return { ...state, isSignedIn: action.value };
    default:
      return state;
  }
}

// Pure model of the settling->settled timing algorithm (Section 3.1.2), independent of React and
// real timers, so every trace in Acceptance Criterion 2 is exhaustively unit-testable without
// fake-timer or DOM infrastructure. `samples` is the chronological list of raw `isSignedIn`
// values observed after entering `settling`: each `{ tMs, value }`, first entry's `tMs` fixed at
// 0 (the instant `settling` was entered). This evaluates one complete, already-known trace; the
// real provider below instead reacts to events as they arrive, via actual `setTimeout`s, which is
// why it can't just call this function directly — but it implements the same rules, checked
// against these traces.
export function computeSettlement(
  samples,
  { quietMs = SETTLE_QUIET_MS, maxMs = SETTLE_MAX_MS } = {}
) {
  for (let i = 0; i < samples.length; i++) {
    const { tMs, value } = samples[i];
    if (typeof value !== 'boolean') continue; // undefined never starts/satisfies the quiet window
    const quietDeadline = tMs + quietMs;
    if (quietDeadline > maxMs) continue; // would fire after the ceiling — the ceiling wins instead
    const next = samples[i + 1];
    if (!next || next.tMs >= quietDeadline) {
      return { elapsedMs: quietDeadline, reason: 'stable', value };
    }
  }
  // Nothing stayed quiet long enough — bounded fallback to whatever was current at the ceiling
  // (Section 3.1.3: not "fail-open", no directional bias).
  const applicable = samples.filter((s) => s.tMs <= maxMs);
  const last = applicable.length ? applicable[applicable.length - 1] : samples[0];
  return { elapsedMs: maxMs, reason: 'timeout', value: last?.value };
}

export function SettledAuthProvider({ children }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [state, dispatch] = useReducer(settledAuthReducer, initialSettledAuthState);

  // Latest raw Clerk value, updated synchronously every render — timers below always read this,
  // never a value captured by the closure that scheduled them (Section 3.1.2's hard requirement).
  const rawRef = useRef(isSignedIn);
  rawRef.current = isSignedIn;

  const enteredSettlingRef = useRef(false);
  const settledRef = useRef(false);
  const settlingStartRef = useRef(null);
  const settleInitialRef = useRef(undefined);
  const quietTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const navigationTypeRef = useRef(
    typeof performance !== 'undefined'
      ? performance.getEntriesByType?.('navigation')?.[0]?.type
      : undefined
  );

  useEffect(() => {
    if (!isLoaded) return;

    if (settledRef.current) {
      // Terminal for this mount (Section 3.1.1) — further changes pass through immediately,
      // unbuffered (criteria 3/4).
      dispatch({ type: 'SIGNED_IN_CHANGED', value: isSignedIn });
      return;
    }

    function settle(reason) {
      if (settledRef.current) return;
      settledRef.current = true;
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      const value = rawRef.current; // always the latest value, read at fire time
      const elapsedMs = Date.now() - settlingStartRef.current;
      dispatch({ type: 'SETTLE', value, elapsedMs, reason });
      logEvent('auth-settled', {
        settleReason: reason,
        settleElapsedMs: elapsedMs,
        settleInitialIsSignedIn: settleInitialRef.current,
        settleFinalIsSignedIn: value,
        navigationType: navigationTypeRef.current,
      });
    }

    if (!enteredSettlingRef.current) {
      enteredSettlingRef.current = true;
      settlingStartRef.current = Date.now();
      settleInitialRef.current = rawRef.current;
      dispatch({ type: 'ENTER_SETTLING', value: rawRef.current });
      // Fixed ceiling, anchored to entry into settling — never reset by subsequent changes.
      maxTimerRef.current = setTimeout(() => settle('timeout'), SETTLE_MAX_MS);
    }

    // isSignedIn === undefined never starts or satisfies the quiet window (Section 3.1.2) — only
    // the max deadline above can settle on it.
    if (typeof isSignedIn === 'boolean') {
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      quietTimerRef.current = setTimeout(() => settle('stable'), SETTLE_QUIET_MS);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(
    () => () => {
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    },
    []
  );

  return createElement(SettledAuthContext.Provider, { value: state }, children);
}

export function useSettledAuth() {
  const ctx = useContext(SettledAuthContext);
  if (!ctx) {
    throw new Error('useSettledAuth must be used within a SettledAuthProvider');
  }
  return ctx;
}
