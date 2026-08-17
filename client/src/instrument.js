// TASK-068 — must be the first import in main.jsx (not merely textually first among
// statements): ES module static imports evaluate their full subgraph in declaration order, so
// this file's Sentry.init() call completes before App.jsx's import graph begins evaluating.
// See ai/tasks/TASK-068-spec.md Section 2.0's decision table for why this replaces the spec's
// originally-proposed separate <script> tag.
import * as Sentry from '@sentry/react';

Sentry.init({
  // Optional chaining: import.meta.env only exists under Vite's own transform (dev/build) — a
  // plain Node context (e.g. this project's node:test suite, which has no Vite transform) would
  // otherwise throw here at module-evaluation time reading .env off undefined.
  dsn: import.meta.env?.VITE_SENTRY_DSN,
  environment: import.meta.env?.VITE_SENTRY_ENVIRONMENT,
  release: import.meta.env?.VITE_SENTRY_RELEASE,
  enableLogs: true,
  // sendDefaultPii is deprecated in the current SDK line; dataCollection is its replacement.
  // This preserves the same minimal-PII posture (§2.3b): no IP/user info, no request/response
  // bodies collected automatically.
  dataCollection: { userInfo: false, httpBodies: [] },
});

// All application-triggered log calls go through this — fire-and-forget, must never throw or
// reject to its caller under any failure mode (uninitialized SDK, missing DSN, SDK throwing).
export function safeSentryLog(tag, data) {
  try {
    const result = Sentry.logger.info(tag, data);
    // Sentry.logger.info() may return a Promise that rejects — absorb that too, not just a
    // synchronous throw, per this wrapper's never-throw/never-reject-to-caller contract.
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Telemetry failure must never be fatal or alter application control flow.
  }
}
