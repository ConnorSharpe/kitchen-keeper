// Vite proxies /api to http://localhost:3001 — no base URL needed.
// Auth: Clerk Bearer token injected from window.Clerk (set by ClerkProvider in main.jsx).

import { logEvent } from '../lib/debugLog.js';

async function getClerkToken() {
  return window.Clerk?.session?.getToken() ?? null;
}

let refreshPromise = null;

// Single-flight: N concurrent 401s trigger exactly one forced network refresh, not N.
function forceRefreshToken() {
  if (!refreshPromise) {
    refreshPromise = window.Clerk.session
      .getToken({ skipCache: true })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

let redirecting = false;

// Dedup: if many callers' retries all still 401, redirect exactly once.
function redirectToSignIn() {
  if (redirecting || window.location.pathname.startsWith('/sign-in')) return;
  redirecting = true;
  window.location.href = '/sign-in';
}

// Owns token acquisition, the 401 retry-with-forced-refresh, and the redirect
// decision. Callers only handle their own response body (JSON vs. stream).
async function authorizedFetch(path, opts = {}) {
  const token = await getClerkToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(path, { ...opts, headers });
  if (res.status !== 401) return res;

  logEvent('auth-fetch-401', { path, hadToken: !!token });

  // Forced refresh itself throwing (network error, not a 401) is not evidence of an
  // invalid session — propagate that error normally, do not redirect. TASK-063: this used to
  // fail silently from the diagnostic log's perspective (no event on either success or
  // rethrow), which was masking whether window.Clerk.session goes null mid-flight during the
  // double-sign-in repro. Log the failure explicitly, then keep the original behavior exactly.
  let freshToken;
  try {
    freshToken = await forceRefreshToken();
  } catch (err) {
    logEvent('auth-fetch-refresh-threw', {
      path,
      message: err?.message,
      hadClerkSession: !!window.Clerk?.session,
    });
    throw err;
  }

  // No token at all means Clerk has nothing to give us — a retry would just send an
  // unauthenticated request guaranteed to 401 again. Skip the pointless round-trip and
  // go straight to the same outcome a second 401 would produce.
  if (!freshToken) {
    logEvent('auth-fetch-redirect', { path, reason: 'no-fresh-token' });
    redirectToSignIn();
    throw new Error('Session expired');
  }

  const retryHeaders = { ...(opts.headers || {}), Authorization: `Bearer ${freshToken}` };
  res = await fetch(path, { ...opts, headers: retryHeaders });

  if (res.status === 401) {
    logEvent('auth-fetch-redirect', { path, reason: 'retry-still-401' });
    redirectToSignIn();
    throw new Error('Session expired');
  }
  logEvent('auth-fetch-retry-succeeded', { path });
  return res;
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: {},
  };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await authorizedFetch(path, opts);

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    // validate.js middleware sends Zod errors as an object: { fieldErrors, formErrors }
    if (typeof data.error === 'object' && data.error !== null) {
      const err = new Error('Please fix the highlighted fields.');
      err.status = res.status;
      err.fieldErrors = data.error.fieldErrors ?? {};
      err.formErrors = data.error.formErrors ?? [];
      throw err;
    }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code ?? null;
    throw err;
  }

  return data;
}

// Owns framing only — JSON.parse is the caller's responsibility. Exported
// separately so it's unit-testable without a real fetch or valid JSON.
export function splitNdjsonLines(buffer, onLine) {
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line) onLine(line);
  }
  return buffer;
}

async function postStream(path, body, { onToken, signal } = {}) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };

  const res = await authorizedFetch(path, opts);

  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* no body */
    }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = splitNdjsonLines(buffer + decoder.decode(value, { stream: true }), (line) => {
      const evt = JSON.parse(line);
      if (evt.type === 'token') onToken(evt.delta);
      else if (evt.type === 'done') donePayload = evt;
      else if (evt.type === 'error') throw new Error(evt.message);
    });
  }

  if (!donePayload) throw new Error('Connection closed before the response finished.');
  return donePayload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  postStream,
};
