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
}
