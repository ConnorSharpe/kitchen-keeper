// Canonical list of valid pantry categories, shared by client and server — no DB/Express/React
// dependency. Single source of truth for the AI tool schemas, the receipt-parsing schema, and both
// pantry-item chat handlers, matching the pattern already established by shared/recipeSources.js and
// shared/recipeTags.js.
export const PANTRY_CATEGORIES = [
  'Produce', 'Dairy', 'Meat', 'Seafood', 'Bakery',
  'Frozen', 'Pantry', 'Beverages', 'Condiments', 'Other',
];
