import { logEvent } from './debugLog.js';

// TASK-063: the double-sign-in repro log showed two unexplained full-page reloads with no
// matching call anywhere in our own code (confirmed by repo-wide grep) — the leading hypothesis
// is iOS backgrounding/reloading the standalone PWA's page. These listeners record every
// visibility/lifecycle transition so the next captured log shows whether a background/foreground
// cycle actually precedes each unexplained reload, instead of guessing.
export function installLifecycleLogging() {
  document.addEventListener('visibilitychange', () => {
    logEvent('lifecycle-visibilitychange', {
      visibilityState: document.visibilityState,
    });
  });

  window.addEventListener('pagehide', (e) => {
    logEvent('lifecycle-pagehide', { persisted: e.persisted });
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
