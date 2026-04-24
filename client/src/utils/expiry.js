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

// Returns Tailwind classes for row/badge coloring.
export function getExpiryRowClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-50';
    case 'critical': return 'bg-red-50';
    case 'warning':  return 'bg-amber-50';
    default:         return '';
  }
}

export function getExpiryBadgeClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-100 text-red-700';
    case 'critical': return 'bg-red-100 text-red-600';
    case 'warning':  return 'bg-amber-100 text-amber-700';
    case 'ok':       return 'bg-green-100 text-green-700';
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
