// Canonical list of valid recipe tags, shared by client and server — no DB/Express/React dependency.
// Single source of truth so a tag added on the client's review UI can't silently fail server-side
// validation because the two lists drifted (see shared/recipeSources.js for the same problem's earlier
// occurrence with recipes.source).
export const RECIPE_TAGS = [
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink',
  'italian', 'mexican', 'asian', 'american', 'mediterranean', 'indian', 'french', 'thai', 'japanese', 'greek', 'chinese',
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'low-carb', 'keto', 'paleo',
  'quick', 'easy', 'slow-cooker', 'one-pot', 'meal-prep', 'freezer-friendly',
];
