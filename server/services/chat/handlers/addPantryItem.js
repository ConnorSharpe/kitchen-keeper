import { z } from 'zod';
import * as pantryService from '../../pantryService.js';
import { getDefaultStorageLocation } from '../../../utils/pantryDefaults.js';

const addItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().min(1).max(50).default('item'),
  category: z
    .enum([
      'Produce',
      'Dairy',
      'Meat',
      'Seafood',
      'Bakery',
      'Frozen',
      'Pantry',
      'Beverages',
      'Condiments',
      'Other',
    ])
    .default('Other'),
  shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
  storageLocation: z
    .enum(['pantry', 'refrigerator', 'freezer'])
    .nullable()
    .optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function addPantryItem(args, ctx) {
  let parsed;
  try {
    parsed = addItemSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid item data: ${e.message}` };
  }

  let expiryDate = null;
  if (parsed.shelfLifeDays != null) {
    const expiry = new Date();
    expiry.setUTCHours(0, 0, 0, 0);
    expiry.setUTCDate(expiry.getUTCDate() + parsed.shelfLifeDays);
    expiryDate = expiry.toISOString();
  }

  try {
    const item = await pantryService.create(
      ctx.householdId,
      {
        name: parsed.name,
        quantity: parsed.quantity,
        unit: parsed.unit,
        category: parsed.category,
        purchaseDate: new Date().toISOString(),
        expiryDate,
        storageLocation:
          parsed.storageLocation ?? getDefaultStorageLocation(parsed.category),
        notes: parsed.notes ?? null,
      },
      'ai_estimate'
    ); // shelfLifeDays is AI-reasoned, not human-typed — subject to FoodKeeper override
    return { ok: true, item };
  } catch {
    return { ok: false, error: 'Failed to save item to pantry.' };
  }
}
