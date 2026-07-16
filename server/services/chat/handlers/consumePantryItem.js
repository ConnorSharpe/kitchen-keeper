import { z } from 'zod';
import * as pantryService from '../../pantryService.js';
import * as mealLogService from '../../mealLogService.js';
import { getPurineLevel } from '../../../data/purineIndex.js';
import { getExpiryStatus } from '../../../../shared/expiry.js';
import { normalizeUnit } from '../../../utils/foodNormalization.js';

const consumeSchema = z.object({
  itemName: z.string().min(1),
  amountConsumed: z.number().positive().optional(),
  unit: z.string().optional(),
  fullyConsumed: z.boolean().optional(),
  skipDeduction: z.boolean().optional(),
});

export async function consumePantryItem(args, ctx) {
  let parsed;
  try {
    parsed = consumeSchema.parse(args);
  } catch (e) {
    return { ok: false, error: `Invalid data: ${e.message}` };
  }

  const { itemName, amountConsumed, unit, fullyConsumed, skipDeduction } =
    parsed;
  const { householdId, allItems } = ctx;

  const lowerTarget = itemName.toLowerCase();

  const exactMatches = allItems.filter(
    (i) => i.name.toLowerCase() === lowerTarget
  );
  let item;
  if (exactMatches.length > 1) {
    return {
      ok: false,
      error: `Ambiguous: ${exactMatches.map((i) => i.name).join(', ')}. Ask user to clarify.`,
    };
  } else if (exactMatches.length === 1) {
    item = exactMatches[0];
  } else {
    const bMatches =
      lowerTarget.length >= 4
        ? allItems.filter((i) => i.name.toLowerCase().includes(lowerTarget))
        : [];
    const cMatches = allItems.filter(
      (i) => i.name.length >= 4 && lowerTarget.includes(i.name.toLowerCase())
    );
    const combined = [...new Set([...bMatches, ...cMatches])];

    if (combined.length === 0)
      return {
        ok: false,
        error: 'Item not found. Ask user which item they mean.',
      };
    if (combined.length > 1)
      return {
        ok: false,
        error: `Ambiguous: ${combined.map((i) => i.name).join(', ')}. Ask user to clarify.`,
      };
    item = combined[0];
  }

  const normalizedInputUnit = unit ? normalizeUnit(unit) : '';
  const normalizedPantryUnit = item.unit ? normalizeUnit(item.unit) : '';
  const unitMismatch = !!(
    normalizedInputUnit &&
    normalizedPantryUnit &&
    normalizedInputUnit !== normalizedPantryUnit
  );

  const serverSkip = item.category === 'Condiments' && fullyConsumed !== true;
  const effectiveSkip =
    serverSkip ||
    unitMismatch ||
    (skipDeduction === true && !serverSkip && !unitMismatch);
  const skipReason = effectiveSkip
    ? unitMismatch
      ? 'unit_mismatch'
      : serverSkip
        ? 'condiment'
        : 'advisory'
    : null;

  let remaining;
  if (fullyConsumed) {
    remaining = 0;
  } else {
    remaining = item.quantity - (amountConsumed ?? 0);
    remaining = Math.max(0, remaining);
  }

  if (!effectiveSkip) {
    if (remaining === 0) {
      await pantryService.markUsed(householdId, item.id);
    } else {
      await pantryService.update(householdId, item.id, {
        quantity: remaining,
      });
    }
  }

  const status = getExpiryStatus(item.expiryDate);
  const wasExpiring = ['warning', 'critical', 'expired'].includes(status);

  await mealLogService.create({
    householdId,
    pantryItemId: item.id,
    itemName: item.name,
    category: item.category,
    purineLevel: getPurineLevel(item.name, item.category),
    wasExpiring,
    quantityBefore: item.quantity,
    quantityAfter: effectiveSkip ? item.quantity : remaining,
    source: 'agent',
  });

  return {
    ok: true,
    item: {
      id: item.id,
      name: item.name,
      remaining,
      skipApplied: effectiveSkip,
      skipReason,
      quantityBefore: item.quantity,
    },
  };
}
