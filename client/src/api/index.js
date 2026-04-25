// Vite proxies /api and /uploads to http://localhost:3001 — no base URL needed.
// All requests include credentials so the httpOnly cookie is sent automatically.

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);

  // Mid-session 401: redirect to login. Skip if already on /login to avoid
  // redirect loops during the initial auth check on mount.
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
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
    throw err;
  }

  return data;
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path)        => request('DELETE', path),
};
