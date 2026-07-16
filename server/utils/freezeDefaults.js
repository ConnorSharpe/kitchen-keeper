// Extension days added ON TOP of the item's current expiry date when frozen.
// Spec section 6.3 — static fallback used when AI is unavailable.
export const FREEZE_EXTENSION_DAYS = {
  Produce: 90,
  Dairy: 30,
  Meat: 120,
  Seafood: 90,
  Bakery: 60,
  Frozen: 0, // already frozen — no additional extension
  Pantry: 180,
  Beverages: 30,
  Condiments: 60,
  Other: 60,
};

// Returns { additionalDays, newExpiryDate, notes: null }.
// notes is null here — AI enrichment fills it in Phase 5+.
// Extension is calculated from currentExpiryDate (or now if not set).
export function getStaticFreezeExtension(category, currentExpiryDate) {
  const days = FREEZE_EXTENSION_DAYS[category] ?? 60;
  const base = currentExpiryDate ? new Date(currentExpiryDate) : new Date();
  const newExpiry = new Date(base.getTime() + days * 86400000);
  return {
    additionalDays: days,
    newExpiryDate: newExpiry.toISOString(),
    notes: null,
  };
}
