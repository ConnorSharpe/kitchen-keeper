// Pure expiry-day math shared by client and server (TASK-036 Part B) — no DB/Express/React
// dependency. UI-specific formatting (row/badge classes, labels) stays in client/src/utils/expiry.js.

/**
 * Compares at UTC day granularity to avoid timezone-shift bugs.
 * Returns null if no expiry date is set.
 * Returns 0 if expiry is today, negative if already expired.
 */
export function getExpiryDays(expiryDateStr) {
  if (!expiryDateStr) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(expiryDateStr);
  expiry.setUTCHours(0, 0, 0, 0);
  return Math.round((expiry - today) / (1000 * 60 * 60 * 24));
}

export function getExpiryStatus(expiryDateStr) {
  const days = getExpiryDays(expiryDateStr);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 7) return 'warning';
  return 'ok';
}

function isExpiringWithin(item, withinDays) {
  const days = getExpiryDays(item.expiryDate);
  return days !== null && days >= 0 && days <= withinDays;
}

export function getExpiringItems(items, withinDays = 7) {
  return items.filter((item) => isExpiringWithin(item, withinDays));
}
