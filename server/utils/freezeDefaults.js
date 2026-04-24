// Static freeze-duration lookup used when AI is unavailable.
// Durations are conservative estimates based on FDA food storage guidelines.
const FREEZE_DEFAULTS = {
  'Meat':        { months: 4, tip: 'Wrap tightly to prevent freezer burn. Thaw in the fridge overnight.' },
  'Poultry':     { months: 9, tip: 'Best used within 9 months. Thaw in the fridge before cooking.' },
  'Fish':        { months: 3, tip: 'Use within 3 months for best quality. Never thaw at room temperature.' },
  'Seafood':     { months: 3, tip: 'Freeze in an airtight bag. Thaw in the fridge or under cold running water.' },
  'Dairy':       { months: 3, tip: 'Freeze in small portions. Texture may change — best used in cooked dishes after thawing.' },
  'Eggs':        { months: 1, tip: 'Do not freeze in the shell. Beat, pour into an ice cube tray, then bag.' },
  'Vegetables':  { months: 8, tip: 'Blanch for 1–2 minutes before freezing to preserve colour and texture.' },
  'Fruit':       { months: 6, tip: 'Freeze in a single layer on a tray first to prevent clumping.' },
  'Bread':       { months: 3, tip: 'Slice before freezing for easy portioning. Toasts well directly from frozen.' },
  'Baked Goods': { months: 3, tip: 'Wrap pieces individually. Thaw at room temperature for a few hours.' },
  'Leftovers':   { months: 3, tip: 'Cool completely before freezing. Portion into meal-sized amounts.' },
  'Soup':        { months: 3, tip: 'Leave headspace in the container — liquid expands when frozen.' },
  'Other':       { months: 3, tip: 'Store in an airtight container and label clearly with the freeze date.' },
};

export function getFreezeDefault(category) {
  return FREEZE_DEFAULTS[category] ?? FREEZE_DEFAULTS['Other'];
}

// Returns a new ISO expiry date calculated from the freeze date, not the original expiry.
// Freezing resets the clock — the new expiry is freeze date + freeze duration.
export function getExtendedExpiryDate(frozenAt, category) {
  const { months } = getFreezeDefault(category);
  const base = new Date(frozenAt ?? new Date().toISOString());
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString();
}
