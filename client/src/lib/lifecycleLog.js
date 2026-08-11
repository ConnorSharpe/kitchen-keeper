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
