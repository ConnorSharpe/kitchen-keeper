// TASK-068: migrated from the closed double-sign-in investigation's localStorage-backed,
// opt-in debug log to Sentry Logs. Public API preserved — every existing logEvent(tag, data)
// call site compiles and runs with zero changes. See ai/tasks/TASK-068-spec.md Section 2.3/2.3a.
import { safeSentryLog } from '../instrument.js';

const MAX_TAG_LENGTH = 100;
const MAX_STRING_LENGTH = 500;
const INVALID_TAG_PLACEHOLDER = 'invalid-tag';

// Mechanical "plain object" definition (spec §2.3a) — Date, Map, Set, class instances, Error,
// arrays, and functions all fail this check and are treated like any other non-plain value.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Deliberately non-recursive: inspects data's own top-level keys only, never descends into a
// value that is itself an object. This is what makes "never throws for ordinary values and
// plain data objects" true by construction — nothing ever traverses into a nested value, so a
// circular reference inside one is never a traversal hazard.
export function validateTelemetryShape(tag, data) {
  const safeTag =
    typeof tag === 'string' ? tag.slice(0, MAX_TAG_LENGTH) : INVALID_TAG_PLACEHOLDER;

  const safeData = {};
  const source = isPlainObject(data) ? data : {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    const type = typeof value;
    if (type === 'string') {
      safeData[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (type === 'number' || type === 'boolean' || value === null || value === undefined) {
      safeData[key] = value;
    }
    // Every other value type (nested object, array, function, Error instance, etc.) is dropped
    // — not forwarded in any form, not descended into.
  }

  return { tag: safeTag, data: safeData };
}

// No-op gating removed (TASK-068) — nothing about sending to Sentry is user-visible, so there's
// no remaining reason to gate this client-side. Safe to call unconditionally from hot paths.
export function logEvent(tag, data) {
  const shaped = validateTelemetryShape(tag, data);
  safeSentryLog(shaped.tag, shaped.data);
}

// Relocated from the now-removed oauthReturn.js (TASK-063) — still needed by main.jsx's
// app-boot diagnostic log, independent of the OAuth-return heuristic that used to live there.
// Unrelated to this migration (spec §0) — not itself a logEvent()/debug-log concern.
export function isStandalonePwa() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
