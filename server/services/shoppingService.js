import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { shoppingLists, shoppingListItems, recipes, pantryItems } from '../db/schema.js';

function parseJSON(str, fallback = []) {
  try {
    return JSON.parse(str ?? '[]');
  } catch {
    return fallback;
  }
}

export function getAll(userId) {
  return db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.userId, userId))
    .orderBy(desc(shoppingLists.createdAt))
    .all();
}

// Verifies ownership, then returns items ordered by sortOrder.
export function getItems(userId, listId) {
  const list = db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .get();
  if (!list) return { status: 'not_found' };

  const items = db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.sortOrder)
    .all();
  return { status: 'ok', items };
}

// Ownership verified via join through shoppingLists — never by item ID alone (spec §6.4).
// Any user guessing an item ID gets 404, not the item.
export function toggleItem(userId, listId, itemId) {
  const list = db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .get();
  if (!list) return { status: 'not_found' };

  const item = db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
    .get();
  if (!item) return { status: 'not_found' };

  db.update(shoppingListItems)
    .set({ isChecked: !item.isChecked })
    .where(eq(shoppingListItems.id, itemId))
    .run();

  return {
    status: 'ok',
    item: db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId)).get(),
  };
}

// CASCADE on shoppingLists → shoppingListItems handles item cleanup.
export function deleteList(userId, listId) {
  const list = db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .get();
  if (!list) return { status: 'not_found' };

  db.delete(shoppingLists).where(eq(shoppingLists.id, listId)).run();
  return { status: 'ok' };
}

export function addManualItem(userId, listId, itemData) {
  const list = db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .get();
  if (!list) return { status: 'not_found' };

  const existing = db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .all();
  const maxSort = existing.reduce((m, i) => Math.max(m, i.sortOrder), -1);

  const newItem = db
    .insert(shoppingListItems)
    .values({
      listId,
      ingredientName: itemData.ingredientName,
      quantity: itemData.quantity ?? null,
      unit: itemData.unit ?? null,
      sortOrder: maxSort + 1,
      hasUnitMismatch: false,
    })
    .returning()
    .get();

  return { status: 'ok', item: newItem };
}

// Full build logic: aggregate → deduplicate → pantry cross-reference → persist atomically.
export function buildFromRecipes(userId, name, recipeIds) {
  // 1. Fetch requested recipes — every one must belong to this user.
  const recipeRows = recipeIds.map((id) => {
    const r = db.select().from(recipes).where(eq(recipes.id, id)).get();
    return r && r.userId === userId ? r : null;
  });
  if (recipeRows.some((r) => r === null)) return { status: 'invalid_recipes' };

  // 2. Aggregate by lowercase name.
  // Map<lowercaseName, { ingredientName, quantity, unit, hasUnitMismatch }>
  const ingredientMap = new Map();
  for (const recipe of recipeRows) {
    for (const ing of parseJSON(recipe.ingredients)) {
      const key = (ing.name ?? '').trim().toLowerCase();
      if (!key) continue;

      if (ingredientMap.has(key)) {
        const entry = ingredientMap.get(key);
        if (entry.unit !== (ing.unit ?? null)) {
          // Conflicting units — flag mismatch; don't attempt to add quantities.
          entry.hasUnitMismatch = true;
        } else {
          entry.quantity = (entry.quantity ?? 0) + (ing.quantity ?? 0);
        }
      } else {
        ingredientMap.set(key, {
          ingredientName: ing.name,
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          hasUnitMismatch: false,
        });
      }
    }
  }

  // 3. Cross-reference active pantry — skip items already stocked, reduce shortfalls.
  // Only active items count (consumedAt IS NULL).
  const activePantry = db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.userId, userId), isNull(pantryItems.consumedAt)))
    .all();

  // Aggregate pantry quantities by lowercase name (sum when units match).
  const pantryMap = new Map();
  for (const p of activePantry) {
    const key = p.name.trim().toLowerCase();
    const existing = pantryMap.get(key);
    if (existing && existing.unit === p.unit) {
      existing.quantity += p.quantity ?? 0;
    } else if (!existing) {
      pantryMap.set(key, { quantity: p.quantity ?? 0, unit: p.unit });
    }
  }

  const needed = [];
  for (const [key, entry] of ingredientMap) {
    // Skip pantry cross-reference for mismatched-unit items — true quantity is unknown.
    if (!entry.hasUnitMismatch && entry.quantity !== null) {
      const inPantry = pantryMap.get(key);
      if (inPantry && inPantry.unit === entry.unit) {
        if (inPantry.quantity >= entry.quantity) continue; // fully stocked — omit
        entry.quantity = entry.quantity - inPantry.quantity; // need only the shortfall
      }
    }
    needed.push(entry);
  }

  // 4. Persist list + all items atomically — partial lists must not exist.
  const result = db.transaction(() => {
    const list = db
      .insert(shoppingLists)
      .values({ userId, name, updatedAt: new Date().toISOString() })
      .returning()
      .get();

    const items = needed.map((ing, idx) =>
      db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
          sortOrder: idx,
          hasUnitMismatch: ing.hasUnitMismatch,
        })
        .returning()
        .get()
    );

    return { list, items };
  });

  const warnings = needed.filter((i) => i.hasUnitMismatch).map((i) => i.ingredientName);
  return { status: 'ok', list: result.list, items: result.items, warnings };
}
