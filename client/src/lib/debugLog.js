// TASK-063: diagnostic-only event log for the double-sign-in investigation. Off by default —
// never fires for real users unless explicitly enabled via the DebugPanel's tap gesture.
// Uses localStorage (not sessionStorage) specifically because a cross-context OAuth redirect
// (e.g. an ephemeral browser tab vs. the standalone PWA's own webview) is one of the hypotheses
// under test, and sessionStorage is not guaranteed to survive that; localStorage is a safer bet.
const STORAGE_KEY = 'kk_debug_log';
const ENABLED_KEY = 'kk_debug_enabled';
const MAX_ENTRIES = 200;

export function isDebugEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage unavailable — nothing to persist */
  }
}

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or unavailable — drop silently, this is best-effort diagnostics */
  }
}

// No-ops (and never throws) unless debug mode was explicitly enabled — safe to call
// unconditionally from hot paths like every authorizedFetch() call.
export function logEvent(tag, data) {
  if (!isDebugEnabled()) return;
  const entry = { t: new Date().toISOString(), tag, data };
  try {
    console.debug('[kk-debug]', tag, data);
  } catch {
    /* console unavailable */
  }
  writeLog([...readLog(), entry]);
}

export function getLog() {
  return readLog();
}

export function clearLog() {
  writeLog([]);
}

// Relocated from the now-removed oauthReturn.js (TASK-063) — still needed by main.jsx's
// app-boot diagnostic log, independent of the OAuth-return heuristic that used to live there.
export function isStandalonePwa() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
