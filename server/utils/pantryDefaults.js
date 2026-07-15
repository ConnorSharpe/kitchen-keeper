// Sensible default storage location per category — the initial value wherever a storage-location
// field is presented (manual add, receipt review, chat agent). Always user-editable afterward.
export const CATEGORY_STORAGE_DEFAULTS = {
  Frozen:     'freezer',
  Meat:       'refrigerator',
  Seafood:    'refrigerator',
  Dairy:      'refrigerator',
  Produce:    'refrigerator',
  Bakery:     'refrigerator',
  Pantry:     'pantry',
  Beverages:  'pantry',
  Condiments: 'pantry',
  Other:      'pantry',
};

export function getDefaultStorageLocation(category) {
  return CATEGORY_STORAGE_DEFAULTS[category] ?? 'pantry';
}
