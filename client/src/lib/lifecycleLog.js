import { logEvent, isDebugEnabled } from './debugLog.js';
import { GOOGLE_BUTTON_SELECTOR } from './authTransition.js';

// TASK-064 follow-up: testing whether the uncommanded reload correlates with Clerk's own
// pre-redirect network round-trip outlasting WebKit's ~1s transient user-activation window
// (see ai/handoffs/CURRENT_STATE.md). Diagnostic only, gated the same as logEvent() so it never
// runs extra work for a real user unless the DebugPanel is explicitly enabled. Captured at
// pagehide, not at click time, because performance entries for this page load are gone once the
// interrupting reload actually lands. Path only (no query string) is logged, in case a Clerk
// request URL ever carries a token in its query params.
function captureClerkNetworkTiming() {
  try {
    const entries = performance
      .getEntriesByType('resource')
      .filter((entry) => /clerk/i.test(entry.name))
      .slice(-10)
      .map((entry) => {
        let label = entry.name.slice(0, 60);
        try {
          const u = new URL(entry.name);
          label = (u.host + u.pathname).slice(0, 60);
        } catch {
          /* keep the truncated raw name */
        }
        return {
          name: label,
          startMs: Math.round(entry.startTime),
          durationMs: Math.round(entry.duration),
          responseEndMs: Math.round(entry.responseEnd),
        };
      });
    return { clerkRequests: entries, perfNowMs: Math.round(performance.now()) };
  } catch {
    return {};
  }
}

// TASK-066: main-thread rAF heartbeat, diagnostic-only (spec ai/tasks/TASK-066-spec.md §2.1-2.3).
// Distinguishes whether the unexplained sign_ins->pagehide gap (TASK-065 §0) is spent on this
// thread (a stall shows up in rAF cadence) or downstream of it. Module-scoped state, not
// component state, since it has to survive across the tap -> rAF loop -> pagehide lifecycle and
// be reachable from a second, independent tap.
let activeHeartbeat = null;
let heartbeatListenerInstalled = false;

const HEARTBEAT_GAP_THRESHOLD_MS = 50;
const HEARTBEAT_SAFETY_CEILING_MS = 5000;
const HEARTBEAT_CADENCE_FRAME_COUNT = 3;

function teardownHeartbeat(hb) {
  if (hb.rafId !== null) cancelAnimationFrame(hb.rafId);
  if (hb.timeoutId !== null) clearTimeout(hb.timeoutId);
  hb.rafId = null;
  hb.timeoutId = null;
}

function heartbeatSummary(hb) {
  return {
    tapMs: Math.round(hb.tapMs),
    frameCount: hb.frameCount,
    elapsedMs: Math.round((hb.lastFrameMs ?? hb.tapMs) - hb.tapMs),
    gaps: hb.gaps,
    observedInitialCadenceMs: hb.cadence,
  };
}

// Terminal states are mutually exclusive (spec §2.1, formalized round-3 review): once a heartbeat
// reaches any one of completed/superseded/timed-out, none of the others can subsequently fire for
// it. finalizeHeartbeat() is the single gate all three paths go through, so a heartbeat already
// finalized (e.g. superseded, then the safety timer it should have cleared fires anyway on some
// odd platform timing) can never be finalized a second time.
function finalizeHeartbeat(hb, state) {
  if (hb.state !== 'active') return;
  teardownHeartbeat(hb);
  hb.state = state;
  // 'completed' is folded into the existing lifecycle-pagehide entry by the pagehide handler
  // itself (spec §2.1 item 5), not logged separately here.
  if (state === 'superseded' || state === 'timed-out') {
    logEvent(`heartbeat-${state}`, heartbeatSummary(hb));
  }
}

function scheduleHeartbeatFrame(hb) {
  hb.rafId = requestAnimationFrame((frameMs) => onHeartbeatFrame(hb, frameMs));
}

function onHeartbeatFrame(hb, frameMs) {
  try {
    hb.frameCount += 1;
    const prevMs = hb.lastFrameMs;
    // Checkpoint-zero (spec §2.1 item 2, round-3 review P0): the first callback has no previous
    // frame, so treat tapMs itself as frame zero rather than leaving the first gap undefined —
    // otherwise a stall occurring immediately after tap (main thread stalls, rAF only fires once
    // freed) would be invisible to this instrument.
    const startMs = prevMs === null ? 0 : prevMs - hb.tapMs;
    const gapMs = prevMs === null ? frameMs - hb.tapMs : frameMs - prevMs;
    if (hb.cadence.length < HEARTBEAT_CADENCE_FRAME_COUNT) {
      hb.cadence.push(Math.round(gapMs));
    }
    if (gapMs > HEARTBEAT_GAP_THRESHOLD_MS) {
      hb.gaps.push({ startMs: Math.round(startMs), gapMs: Math.round(gapMs) });
    }
    hb.lastFrameMs = frameMs;
  } catch {
    /* diagnostic-only; must never break the page */
  }
  if (hb.state === 'active') scheduleHeartbeatFrame(hb);
}

function startHeartbeat(tapMs) {
  const hb = {
    tapMs,
    rafId: null,
    timeoutId: null,
    frameCount: 0,
    lastFrameMs: null,
    gaps: [],
    cadence: [],
    state: 'active',
  };
  scheduleHeartbeatFrame(hb);
  hb.timeoutId = setTimeout(
    () => finalizeHeartbeat(hb, 'timed-out'),
    HEARTBEAT_SAFETY_CEILING_MS
  );
  return hb;
}

// Capture-phase click listener, separate from authTransition.js's production marker-writing
// listener (spec §1 — this file stays diagnostic-only). A second tap while a heartbeat is
// already active does not discard it (spec §2.1 item 4, round-1 review P1-5): TASK-064's own
// recovery flow is "tap, fail, tap again," exactly the case most likely to produce a real
// stall capture, so the superseded attempt's partial data is preserved via finalizeHeartbeat()
// rather than silently overwritten.
function installMainThreadHeartbeat() {
  if (heartbeatListenerInstalled) return;
  heartbeatListenerInstalled = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!isDebugEnabled()) return;
      try {
        if (!e.target?.closest?.(GOOGLE_BUTTON_SELECTOR)) return;
        const tapMs = performance.now();
        if (activeHeartbeat && activeHeartbeat.state === 'active') {
          finalizeHeartbeat(activeHeartbeat, 'superseded');
        }
        activeHeartbeat = startHeartbeat(tapMs);
      } catch {
        /* diagnostic-only; must never block the Google button's own click handler */
      }
    },
    { capture: true }
  );
}

// TASK-063: the double-sign-in repro log showed two unexplained full-page reloads with no
// matching call anywhere in our own code (confirmed by repo-wide grep) — the leading hypothesis
// is iOS backgrounding/reloading the standalone PWA's page. These listeners record every
// visibility/lifecycle transition so the next captured log shows whether a background/foreground
// cycle actually precedes each unexplained reload, instead of guessing.
export function installLifecycleLogging() {
  installMainThreadHeartbeat();

  document.addEventListener('visibilitychange', () => {
    logEvent('lifecycle-visibilitychange', {
      visibilityState: document.visibilityState,
    });
  });

  window.addEventListener('pagehide', (e) => {
    // TASK-066 §2.1 item 5: fold the active heartbeat's accumulated data into this same entry
    // as a 'completed' record, rather than a separate log call — pagehide is its normal,
    // expected terminal path (as opposed to 'superseded'/'timed-out', which are logged from
    // finalizeHeartbeat() itself since they don't coincide with a pagehide event).
    let heartbeat;
    try {
      if (isDebugEnabled() && activeHeartbeat && activeHeartbeat.state === 'active') {
        finalizeHeartbeat(activeHeartbeat, 'completed');
        heartbeat = heartbeatSummary(activeHeartbeat);
      }
    } catch {
      /* diagnostic-only; must never block real pagehide handling */
    }
    logEvent('lifecycle-pagehide', {
      persisted: e.persisted,
      ...(isDebugEnabled() ? captureClerkNetworkTiming() : {}),
      ...(heartbeat ? { heartbeat } : {}),
    });
  });

  window.addEventListener('pageshow', (e) => {
    logEvent('lifecycle-pageshow', { persisted: e.persisted });
  });

  window.addEventListener('freeze', () => {
    logEvent('lifecycle-freeze', {});
  });

  window.addEventListener('resume', () => {
    logEvent('lifecycle-resume', {});
  });

  // TASK-063 (follow-up): logout() previously had no try/catch, so a thrown/rejected signOut()
  // would have been an invisible unhandled rejection -- the same blind spot TASK-061 already
  // found once with forceRefreshToken(). This is a global backstop independent of any one call
  // site, in case something else in Clerk's own SDK (e.g. the OAuth continuation) rejects
  // silently too.
  window.addEventListener('unhandledrejection', (e) => {
    logEvent('unhandled-rejection', {
      message: e.reason?.message || String(e.reason),
    });
  });
}

// TASK-063 (follow-up): a real on-device repro showed a sign-in round-trip landing on `/sign-up`
// with no matching entry in the `clerk-auth-state` log at all -- meaning whatever routed there
// didn't go through React Router's `useLocation()` (which we already log on every change). This
// watches the URL directly, independent of any router, so the next capture shows every navigation
// regardless of what triggered it.
// TASK-063 (follow-up): a real on-device repro showed a tap on Clerk's own "Continue with
// Google" button producing zero trace anywhere in the diagnostics -- no state change, no
// reload, nothing -- for ~3s before a second tap actually triggered the OAuth flow. We have no
// visibility into Clerk's own hosted button internals, so this instead watches at the DOM level,
// capture-phase (before anything can stopPropagation), to answer a narrower question: does the
// tap even reach the page as a click at all, and what element receives it?
export function installClickLogging() {
  function describeTarget(e) {
    const target = e.target;
    return {
      tag: target?.tagName,
      id: target?.id || undefined,
      className:
        typeof target?.className === 'string'
          ? target.className.slice(0, 80)
          : undefined,
      text: target?.textContent?.trim().slice(0, 40),
      isTrusted: e.isTrusted,
    };
  }

  // pointerdown fires on touch contact even if the browser never promotes it to a click (e.g.
  // something intercepts/cancels it) -- logging both tells us whether a "lost" tap never reached
  // the page at all, versus reached it but didn't turn into a click.
  document.addEventListener(
    'pointerdown',
    (e) => logEvent('pointerdown', describeTarget(e)),
    { capture: true }
  );

  document.addEventListener('click', (e) => logEvent('click', describeTarget(e)), {
    capture: true,
  });
}

export function installUrlChangeLogging() {
  function logUrl(source) {
    logEvent('url-change', {
      source,
      pathname: window.location.pathname,
      href: window.location.href,
    });
  }

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    logUrl('pushState');
  };

  history.replaceState = function (...args) {
    originalReplaceState(...args);
    logUrl('replaceState');
  };

  window.addEventListener('popstate', () => logUrl('popstate'));
}
