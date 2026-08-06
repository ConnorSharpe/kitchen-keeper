import { z } from 'zod';
import * as pantryService from '../../pantryService.js';
import { PANTRY_CATEGORIES } from '../../../../shared/pantryCategories.js';

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  quantity: z.coerce.number().min(0).optional(),
  unit: z.string().min(1).max(50).optional(),
  category: z.enum(PANTRY_CATEGORIES).optional(),
  expiryDate: z.string().datetime().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function updatePantryItem(args, ctx) {
  let parsed;
  try {
    parsed = updateSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid data: ${e.message}` };
  }

  const { id, ...fields } = parsed;
  try {
    const item = await pantryService.update(ctx.householdId, id, fields);
    return { ok: true, item };
  } catch {
    return { ok: false, error: 'Item not found or update failed.' };
  }
}
