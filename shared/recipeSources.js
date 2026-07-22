// Canonical list of valid `recipes.source` values, shared by client and server — no DB/Express/React
// dependency. Single source of truth for the server's save-validation enum, so a new source value
// added on the client (e.g. a new import path) can't silently fail to save because the server's
// schema wasn't updated to match (see TASK-038's `url_import` — this was exactly that bug).
export const RECIPE_SOURCES = [
  'upload',
  'ai_suggested',
  'web_suggested',
  'manual',
  'url_import',
];
