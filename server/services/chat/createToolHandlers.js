import { addPantryItem } from './handlers/addPantryItem.js';
import { updatePantryItem } from './handlers/updatePantryItem.js';
import { removePantryItem } from './handlers/removePantryItem.js';
import { consumePantryItem } from './handlers/consumePantryItem.js';
import { suggestRecipes } from './handlers/suggestRecipes.js';
import { saveRecipe } from './handlers/saveRecipe.js';

// ctx = { householdId, history, allItems, expiringItems, allRecipes, requestId, result }
// `result` is a mutable holder ({ recipeSuggestions: [] }) written by the suggest_recipes
// handler and read by the /chat route after aiService.chat() returns — preserves the
// pre-extraction outer-closure mutation pattern rather than threading an explicit return
// through aiService.chat()'s dispatch loop (TASK-036 D-A1: that loop is out of this task's
// scope to touch).
export function createToolHandlers(ctx) {
  return {
    add_pantry_item: (args) => addPantryItem(args, ctx),
    update_pantry_item: (args) => updatePantryItem(args, ctx),
    remove_pantry_item: (args) => removePantryItem(args, ctx),
    consume_pantry_item: (args) => consumePantryItem(args, ctx),
    suggest_recipes: (args) => suggestRecipes(args, ctx),
    save_recipe: (args) => saveRecipe(args, ctx),
  };
}
