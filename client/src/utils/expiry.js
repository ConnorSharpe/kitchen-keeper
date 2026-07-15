// Mirror of server/utils/expiry.js — UTC day-granularity so client and server agree.
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
  if (days < 0)  return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 7) return 'warning';
  return 'ok';
}

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
export function getExpiryRowClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-50';
    case 'critical': return 'bg-red-50';
    case 'warning':  return 'bg-amber-50';
    case 'ripening': return 'bg-purple-50';
    default:         return '';
  }
}

export function getExpiryBadgeClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-100 text-red-700';
    case 'critical': return 'bg-red-100 text-red-600';
    case 'warning':  return 'bg-amber-100 text-amber-700';
    case 'ok':       return 'bg-green-100 text-green-700';
    case 'ripening': return 'bg-purple-100 text-purple-700';
    default:         return 'bg-gray-100 text-gray-500';
  }
}

export function getExpiryLabel(expiryDateStr) {
  const days = getExpiryDays(expiryDateStr);
  if (days === null) return '—';
  if (days < 0)  return `${Math.abs(days)}d ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days}d`;
}
