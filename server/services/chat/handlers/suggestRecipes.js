import * as recipeSearchService from '../../recipeSearchService.js';

// Thin tool-plumbing wrapper (D-A2) — scoring/tiering/annotation domain logic
// lives in recipeSearchService.suggestForChat(). Writes the full annotated
// suggestions into ctx.result for the /chat route to persist (D-A1: preserves
// the pre-extraction closure-mutation pattern via an explicit mutable holder).
export async function suggestRecipes(args, ctx) {
  const result = await recipeSearchService.suggestForChat(args, ctx);
  ctx.result.recipeSuggestions = result.recipeSuggestions;
  return {
    ok: true,
    suggestions: result.suggestions,
    strategy: result.strategy,
  };
}
