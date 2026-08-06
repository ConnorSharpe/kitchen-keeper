// Vite proxies /api to http://localhost:3001 — no base URL needed.
// Auth: Clerk Bearer token injected from window.Clerk (set by ClerkProvider in main.jsx).

async function getClerkToken() {
  return window.Clerk?.session?.getToken() ?? null;
}

async function request(method, path, body) {
  const token = await getClerkToken();
  const opts = {
    method,
    headers: {},
  };

  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);

  // Mid-session 401: redirect to sign-in. Skip if already on /sign-in to avoid redirect loops.
  if (res.status === 401 && !window.location.pathname.startsWith('/sign-in')) {
    window.location.href = '/sign-in';
    throw new Error('Session expired');
  }

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
  const token = await getClerkToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && !window.location.pathname.startsWith('/sign-in')) {
    window.location.href = '/sign-in';
    throw new Error('Session expired');
  }
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
