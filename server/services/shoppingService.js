import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  shoppingLists,
  shoppingListItems,
  recipes,
  pantryItems,
} from '../db/schema.js';

function parseJSON(str, fallback = []) {
  try {
    return JSON.parse(str ?? '[]');
  } catch {
    return fallback;
  }
}

export async function getAll(householdId) {
  return db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.householdId, householdId))
    .orderBy(desc(shoppingLists.createdAt));
}

// Verifies ownership, then returns items ordered by sortOrder.
export async function getItems(householdId, listId) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const items = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.sortOrder);
  return { status: 'ok', items };
}

// Ownership verified via join through shoppingLists — a guessed item ID returns 404.
export async function toggleItem(householdId, listId, itemId) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const [item] = await db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        eq(shoppingListItems.listId, listId)
      )
    );
  if (!item) return { status: 'not_found' };

  await db
    .update(shoppingListItems)
    .set({ isChecked: !item.isChecked })
    .where(eq(shoppingListItems.id, itemId));

  const [updated] = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId));
  return { status: 'ok', item: updated };
}

// Ownership verified via join through shoppingLists — a guessed item ID returns 404.
// Editing is the manual resolution the mismatch warning exists to prompt, so it
// unconditionally clears hasUnitMismatch (see TASK-027 spec, Decision: Edit Clears hasUnitMismatch).
export async function updateItem(householdId, listId, itemId, data) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const [item] = await db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        eq(shoppingListItems.listId, listId)
      )
    );
  if (!item) return { status: 'not_found' };

  await db
    .update(shoppingListItems)
    .set({ ...data, hasUnitMismatch: false })
    .where(eq(shoppingListItems.id, itemId));

  const [updated] = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId));
  return { status: 'ok', item: updated };
}

// Ownership verified via join through shoppingLists — a guessed item ID returns 404.
export async function deleteItem(householdId, listId, itemId) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const [item] = await db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        eq(shoppingListItems.listId, listId)
      )
    );
  if (!item) return { status: 'not_found' };

  await db.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId));
  return { status: 'ok' };
}

// CASCADE on shoppingLists → shoppingListItems handles item cleanup.
export async function deleteList(householdId, listId) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  await db.delete(shoppingLists).where(eq(shoppingLists.id, listId));
  return { status: 'ok' };
}

export async function addManualItem(householdId, listId, itemData) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const existing = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));
  const maxSort = existing.reduce((m, i) => Math.max(m, i.sortOrder), -1);

  const [newItem] = await db
    .insert(shoppingListItems)
    .values({
      listId,
      ingredientName: itemData.ingredientName,
      quantity: itemData.quantity ?? null,
      unit: itemData.unit ?? null,
      sortOrder: maxSort + 1,
      hasUnitMismatch: false,
    })
    .returning();

  return { status: 'ok', item: newItem };
}

// Aggregates ingredients across recipes by lowercase-trimmed name, flagging unit
// disagreements rather than guessing. Private: encodes matching assumptions specific
// to this file's callers (see TASK-049 D-6).
function aggregateIngredients(recipeRows) {
  const ingredientMap = new Map();
  for (const recipe of recipeRows) {
    for (const ing of parseJSON(recipe.ingredients)) {
      const key = (ing.name ?? '').trim().toLowerCase();
      if (!key) continue;

      if (ingredientMap.has(key)) {
        const entry = ingredientMap.get(key);
        if (entry.unit !== (ing.unit ?? null)) {
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
  return [...ingredientMap.values()];
}

// Cross-references active (non-consumed) pantry stock — reduces shortfalls in place,
// drops entries the pantry fully covers. Private, mirrors aggregateIngredients (D-6).
async function subtractPantry(householdId, entries) {
  const activePantry = await db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, householdId),
        isNull(pantryItems.consumedAt)
      )
    );

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
  for (const entry of entries) {
    const key = entry.ingredientName.trim().toLowerCase();
    if (!entry.hasUnitMismatch && entry.quantity !== null) {
      const inPantry = pantryMap.get(key);
      if (inPantry && inPantry.unit === entry.unit) {
        if (inPantry.quantity >= entry.quantity) continue;
        entry.quantity = entry.quantity - inPantry.quantity;
      }
    }
    needed.push(entry);
  }
  return needed;
}

// Cross-references the list's own existing *unchecked* items, so adding a recipe on
// top of an item already on the list produces one shortfall row instead of a
// duplicate. Checked rows are excluded entirely — isChecked is a workflow-completion
// marker, never synced to pantryItems (see toggleItem), so a checked row can be stale
// and must not silently suppress a genuinely-needed new ingredient (TASK-049 D-2).
// Never mutates existingItems — only the new entry's quantity is reduced or dropped.
function subtractExistingListItems(existingItems, entries) {
  const unchecked = existingItems.filter((it) => !it.isChecked);
  const listMap = new Map();
  for (const it of unchecked) {
    const key = it.ingredientName.trim().toLowerCase();
    const cur = listMap.get(key);
    if (cur && cur.unit === it.unit) {
      cur.quantity = (cur.quantity ?? 0) + (it.quantity ?? 0);
    } else if (!cur) {
      listMap.set(key, { quantity: it.quantity, unit: it.unit });
    }
  }
  const result = [];
  for (const entry of entries) {
    const key = entry.ingredientName.trim().toLowerCase();
    if (!entry.hasUnitMismatch && entry.quantity !== null) {
      const onList = listMap.get(key);
      if (onList && onList.unit === entry.unit && onList.quantity !== null) {
        if (onList.quantity >= entry.quantity) continue; // list already covers it — drop entirely
        entry.quantity = entry.quantity - onList.quantity; // insert only the shortfall
      }
    }
    result.push(entry);
  }
  return result;
}

// Full build: aggregate ingredients → deduplicate → pantry cross-reference → persist atomically.
export async function buildFromRecipes(householdId, name, recipeIds) {
  // Every recipe must belong to this user
  const recipeRows = await Promise.all(
    recipeIds.map(async (id) => {
      const [r] = await db.select().from(recipes).where(eq(recipes.id, id));
      return r && r.householdId === householdId ? r : null;
    })
  );
  if (recipeRows.some((r) => r === null)) return { status: 'invalid_recipes' };

  const entries = aggregateIngredients(recipeRows);
  const needed = await subtractPantry(householdId, entries);

  // Persist list, then items — no db.transaction() (drizzle-orm/neon-http has no
  // interactive transaction support; TASK-035 Part A1). The list insert and the
  // bulk items insert are each a single atomic Postgres statement on their own.
  const [list] = await db
    .insert(shoppingLists)
    .values({ householdId, name, updatedAt: new Date().toISOString() })
    .returning();

  let items = [];
  if (needed.length > 0) {
    try {
      items = await db
        .insert(shoppingListItems)
        .values(
          needed.map((ing, idx) => ({
            listId: list.id,
            ingredientName: ing.ingredientName,
            quantity: ing.quantity,
            unit: ing.unit,
            sortOrder: idx,
            hasUnitMismatch: ing.hasUnitMismatch,
          }))
        )
        .returning();
    } catch (err) {
      try {
        await db.delete(shoppingLists).where(eq(shoppingLists.id, list.id));
      } catch (cleanupErr) {
        console.error(
          `[kitchen-keeper] function=shoppingService orphaned_list_id=${list.id} reason=compensating_delete_failed`,
          cleanupErr.message
        );
      }
      return { status: 'error', error: err.message };
    }
  }

  const warnings = needed
    .filter((i) => i.hasUnitMismatch)
    .map((i) => i.ingredientName);
  return { status: 'ok', list, items, warnings };
}

// Adds selected recipes' ingredients to a list that already exists — aggregates,
// cross-references pantry, then cross-references the list's own unchecked items
// (never mutating them), and inserts only the shortfall. Returns just the newly
// inserted items (see TASK-049 Design section 3).
export async function addRecipesToList(householdId, listId, recipeIds) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );
  if (!list) return { status: 'not_found' };

  const recipeRows = await Promise.all(
    recipeIds.map(async (id) => {
      const [r] = await db.select().from(recipes).where(eq(recipes.id, id));
      return r && r.householdId === householdId ? r : null;
    })
  );
  if (recipeRows.some((r) => r === null)) return { status: 'invalid_recipes' };

  const entries = aggregateIngredients(recipeRows);
  const afterPantry = await subtractPantry(householdId, entries);

  const existingItems = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));

  const needed = subtractExistingListItems(existingItems, afterPantry);

  // sortOrder continues from the full existing set (checked + unchecked) — checked
  // rows still occupy sort positions even though they're excluded from coverage above.
  const maxSort = existingItems.reduce((m, i) => Math.max(m, i.sortOrder), -1);

  let items = [];
  if (needed.length > 0) {
    items = await db
      .insert(shoppingListItems)
      .values(
        needed.map((ing, idx) => ({
          listId,
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
          sortOrder: maxSort + 1 + idx,
          hasUnitMismatch: ing.hasUnitMismatch,
        }))
      )
      .returning();
  }

  const warnings = needed
    .filter((i) => i.hasUnitMismatch)
    .map((i) => i.ingredientName);
  return { status: 'ok', items, warnings };
}
