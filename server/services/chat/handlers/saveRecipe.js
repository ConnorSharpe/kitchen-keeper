import { z } from 'zod';
import * as aiService from '../../aiService.js';
import * as recipeService from '../../recipeService.js';

const saveSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500),
});

export async function saveRecipe(args, ctx) {
  let parsed;
  try {
    parsed = saveSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid data: ${e.message}` };
  }

  const full = await aiService.expandSuggestion(
    parsed.name,
    parsed.description,
    ctx.allItems,
    ctx.requestId
  );
  if (!full)
    return {
      ok: false,
      error: 'AI could not expand the recipe. Try again.',
    };

  const saved = await recipeService.createOrIgnore(ctx.householdId, {
    ...full,
    source: 'agent_saved',
  });
  const name = saved?.name ?? parsed.name;
  return { ok: true, recipe: { id: saved?.id, name } };
}
