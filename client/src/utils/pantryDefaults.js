// Mirror of server/utils/pantryDefaults.js — sensible default storage location per category,
// used to initialize the storage-location field wherever it's shown. Always user-editable.
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

export const STORAGE_LOCATIONS = ['pantry', 'refrigerator', 'freezer'];

export const STORAGE_LOCATION_LABELS = {
  pantry:      'Pantry',
  refrigerator: 'Fridge',
  freezer:     'Freezer',
};
