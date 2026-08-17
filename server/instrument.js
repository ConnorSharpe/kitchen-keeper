// TASK-068 — imported second in server/app.js, immediately after 'dotenv/config', and before
// every route import: sibling static imports in one file evaluate in declaration order, so
// process.env.SENTRY_DSN is already populated by the time this file's top-level Sentry.init()
// reads it. app.js is imported by both server/index.js (local dev) and api/index.js
// (staging/production) — see ai/tasks/TASK-068-spec.md Section 1's "Two server entry points".
import * as Sentry from '@sentry/node';

// Sentry.init() itself failing must not prevent the server from starting — this file is imported
// second in app.js, so an uncaught throw here would abort app.js's module evaluation before the
// Express app is ever created/exported (spec §2.4, criterion 1).
try {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
    enableLogs: true,
    // sendDefaultPii is deprecated in the current SDK line; dataCollection is its replacement —
    // same minimal-PII posture (§2.3b): no IP/user info, no request/response bodies collected.
    dataCollection: { userInfo: false, httpBodies: [] },
  });
} catch {
  // Telemetry setup failing must never block the server from starting.
}

// Closed, application-specific parameter shape (spec §2.3b) — not a generic Sentry
// extra/contexts passthrough a caller could stuff arbitrary data into. Every application-
// triggered capture call goes through this; Sentry.init() above is the one exempt direct call.
// Fire-and-forget: MUST NOT throw synchronously or return a rejected Promise to its caller,
// under any failure mode (SDK throws, rejects, isn't initialized, DSN missing).
// Bounded wait for queued events to send before a Vercel Function suspends between invocations
// (spec §2.0 decision table: Vercel's Node runtime disables callbackWaitsForEmptyEventLoop, so
// delivery isn't guaranteed without this). Called by the request lifecycle (app.js's error
// middleware), never from inside captureExceptionSafely() itself — flushing is a property of
// when a request ends, not of the capture call, so future callers of captureExceptionSafely()
// don't unknowingly inherit a blocking wait.
export function flush(timeoutMs) {
  return Sentry.flush(timeoutMs);
}

export function captureExceptionSafely(
  error,
  { clientContext, requestId, deploy, householdId, userId } = {}
) {
  try {
    const contexts = {};
    if (clientContext) {
      contexts.client = {
        originalStack: clientContext.originalStack,
        componentStack: clientContext.componentStack,
      };
    }
    const tags = {};
    if (requestId !== undefined) tags.requestId = requestId;
    if (deploy !== undefined) tags.deploy = deploy;
    if (householdId !== undefined) tags.householdId = householdId;
    if (userId !== undefined) tags.userId = userId;

    const result = Sentry.captureException(error, { contexts, tags });
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Telemetry failure must never be fatal or alter application control flow.
  }
}
