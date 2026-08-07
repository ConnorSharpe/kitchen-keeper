// Client-only UI helpers layered on top of shared/expiry.js's calculation logic (TASK-036 Part B).
import { getExpiryDays, getExpiryStatus } from '@shared/expiry.js';

export { getExpiryDays, getExpiryStatus };

// Returns days until readyDate. Positive = not yet ready. 0 = ready today. null = no readyDate.
export function getRipeningDays(readyDateStr) {
  if (!readyDateStr) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const ready = new Date(readyDateStr);
  ready.setUTCHours(0, 0, 0, 0);
  return Math.round((ready - today) / (1000 * 60 * 60 * 24));
}

// True only when readyDate is strictly in the future (> 0 days).
export function isRipening(readyDateStr) {
  const days = getRipeningDays(readyDateStr);
  return days !== null && days > 0;
}

// Returns effective temporal state of a pantry item in priority order.
// TASK-031: storageLocation === 'freezer' is the source of truth, not the deprecated isFrozen.
export function getRipeningState(item) {
  if (item.storageLocation === 'freezer') return 'frozen';
  if (isRipening(item.readyDate)) return 'ripening';
  return 'ready';
}

// Returns Tailwind classes for row/badge coloring.
// Row washes use the semantic status background token at low opacity (no dedicated shared class
// exists for a row-level tint, Section 3) rather than a raw hue. 'ripening' is intentionally left as
// a raw Tailwind class (TASK-057 Section 2.2 — no scaffold depicts this status, nothing to retint from).
export function getExpiryRowClass(status) {
  switch (status) {
    case 'expired':
      return 'bg-status-critical-bg/30';
    case 'critical':
      return 'bg-status-critical-bg/30';
    case 'warning':
      return 'bg-status-warning-bg/30';
    case 'ripening':
      return 'bg-purple-50';
    default:
      return '';
  }
}

export function getExpiryBadgeClass(status) {
  switch (status) {
    case 'expired':
      return 'badge-status-critical';
    case 'critical':
      return 'badge-status-critical';
    case 'warning':
      return 'badge-status-warning';
    case 'ok':
      return 'badge-status-ok';
    case 'ripening':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-500';
  }
}

export function getExpiryLabel(expiryDateStr) {
  const days = getExpiryDays(expiryDateStr);
  if (days === null) return '—';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days}d`;
}
