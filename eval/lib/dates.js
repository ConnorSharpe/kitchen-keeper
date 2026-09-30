// TASK-069 §2.8: UTC date helpers for eval fixtures (relative-day seeding and ranges).

export const DAY_MS = 86400000;

/** Epoch ms of 00:00Z on the UTC day containing `now`. */
export const utcMidnight = (now) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** ISO timestamp `daysAgo` days before `base`, offset by `hourUtc` hours. */
export const daysAgoAt = (base, daysAgo, hourUtc = 12) =>
  new Date(base - daysAgo * DAY_MS + hourUtc * 3600000).toISOString();

/** Inclusive day range; a key is omitted when its bound is undefined. */
export function rangeFromDaysAgo(base, fromDaysAgo, toDaysAgo) {
  const range = {};
  if (fromDaysAgo !== undefined) range.dateFrom = new Date(base - fromDaysAgo * DAY_MS);
  if (toDaysAgo !== undefined) range.dateTo = new Date(base - toDaysAgo * DAY_MS + DAY_MS);
  return range;
}
