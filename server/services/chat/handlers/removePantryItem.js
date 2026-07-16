import { z } from 'zod';
import * as pantryService from '../../pantryService.js';

const removeSchema = z.object({ id: z.coerce.number().int().positive() });

export async function removePantryItem(args, ctx) {
  let parsed;
  try {
    parsed = removeSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid data: ${e.message}` };
  }

  try {
    await pantryService.remove(ctx.householdId, parsed.id);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Item not found or could not be removed.' };
  }
}
