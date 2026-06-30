import express from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import * as householdService from '../services/householdService.js';
import * as pantryService from '../services/pantryService.js';
import * as recipeService from '../services/recipeService.js';
import * as chatService from '../services/chatService.js';
import * as aiService from '../services/aiService.js';
import * as mealLogService from '../services/mealLogService.js';
import * as dietaryService from '../services/dietaryService.js';
import * as recipeScorer from '../utils/recipeScorer.js';
import { normalizeFood, stripIngredientPrefix, normalizeUnit } from '../utils/foodNormalization.js';
import { getPurineLevel } from '../data/purineIndex.js';
import { getExpiryDays, getExpiryStatus } from '../utils/expiry.js';
const router = express.Router();
router.use(clerkAuth);

// Builds a Set of dedup keys from previously shown recipe suggestions in chat history.
// Key format: `${source}:${sourceId}` when available, normalized name as fallback.
// Handles old history rows that pre-date the sourceId field gracefully.
function extractSuggestedRecipeKeys(history) {
  const keys = new Set();
  for (const msg of history) {
    for (const s of msg.metadata?.recipeSuggestions ?? []) {
      if (s.source && s.sourceId) {
        keys.add(`${s.source}:${s.sourceId}`);
      } else if (s.name) {
        keys.add(s.name.toLowerCase().trim());
      }
    }
  }
  return keys;
}

// POST /api/ai/eat-this-now
router.post('/eat-this-now', async (req, res) => {
  const requestId = randomUUID().split('-')[0];
  const [allItems, savedRecipes] = await Promise.all([
    pantryService.getAll(req.user.householdId),
    recipeService.getAll(req.user.householdId),
  ]);

  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.eatThisNow(allItems, expiringItems, savedRecipes, requestId);
  res.json({ suggestions });
});

// POST /api/ai/expand-suggestion
const expandSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500),
});

router.post('/expand-suggestion', validate(expandSchema), async (req, res) => {
  const requestId = randomUUID().split('-')[0];
  const { name, description } = req.body;
  const allItems = await pantryService.getAll(req.user.householdId);

  const recipe = await aiService.expandSuggestion(name, description, allItems, requestId);

  if (!recipe) {
    const err = new Error('AI returned an invalid recipe. Please try again.');
    err.status = 502;
    throw err;
  }

  const saved = await recipeService.create(req.user.householdId, { ...recipe, source: 'ai_suggested' });
  res.status(201).json({ recipe: saved });
});

// POST /api/ai/parse-receipt
// Receipt is never persisted — buffer goes directly to Groq vision, then discarded.
const dateField = z.string().datetime().nullable().optional();

const candidateItemSchema = z.object({
  name:         z.string().min(1).max(200),
  category:     z.string().min(1).max(50).default('Other'),
  quantity:     z.coerce.number().positive().default(1),
  unit:         z.string().min(1).max(50).default('item'),
  purchaseDate: dateField,
  expiryDate:   dateField,
  notes:        z.string().max(500).nullable().optional(),
});

router.post('/parse-receipt', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const requestId = randomUUID().split('-')[0];
  const base64 = req.file.buffer.toString('base64');
  const rawItems = await aiService.parseReceipt(base64, req.file.mimetype, requestId);

  const candidates = rawItems
    .map((item) => {
      try {
        return candidateItemSchema.parse({
          name:         item.name,
          category:     item.category || 'Other',
          quantity:     item.quantity  ?? 1,
          unit:         item.unit      || 'item',
          purchaseDate: new Date().toISOString(),
          expiryDate:   item.estimatedExpiryDays != null
            ? new Date(Date.now() + item.estimatedExpiryDays * 86_400_000).toISOString()
            : null,
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  res.json({ candidates, skipped: rawItems.length - candidates.length });
});

// POST /api/ai/suggest-recipes
router.post('/suggest-recipes', async (req, res) => {
  const allItems = await pantryService.getAll(req.user.householdId);
  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.suggestRecipes(allItems, expiringItems);
  res.json({ suggestions });
});

// POST /api/ai/parse-recipe-image
// Extracts recipe data from an uploaded image using AI.
// Returns { recipe: extractedJson } — does NOT save. The client reviews and saves separately.

const TAG_ALLOWED = z.enum([
  'breakfast','lunch','dinner','snack','dessert','drink',
  'italian','mexican','asian','american','mediterranean','indian','french','thai','japanese','greek','chinese',
  'vegetarian','vegan','gluten-free','dairy-free','low-carb','keto','paleo',
  'quick','easy','slow-cooker','one-pot','meal-prep','freezer-friendly',
]);

const fractionalQuantity = z.union([
  z.number(),
  z.string().transform((s) => {
    const unicodeMap = { '½':0.5,'⅓':0.333,'¼':0.25,'¾':0.75,'⅔':0.667,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875 };
    const trimmed = s.trim();
    if (unicodeMap[trimmed] !== undefined) return unicodeMap[trimmed];
    const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const simple = trimmed.match(/^(\d+)\/(\d+)$/);
    if (simple) return Number(simple[1]) / Number(simple[2]);
    const n = parseFloat(trimmed);
    return isNaN(n) ? null : n;
  }),
  z.null(),
  z.undefined(),
]).transform((v) => (typeof v === 'number' && isFinite(v) ? v : null));

const parsedRecipeSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  ingredients: z.array(
    z.object({
      name:     z.string().min(1),
      quantity: fractionalQuantity,
      unit:     z.string().nullable().optional(),
    })
  ).default([]),
  steps:    z.array(z.string()).default([]),
  servings: z.coerce.number().int().positive().nullable().optional(),
  prepMins: z.coerce.number().int().nonnegative().nullable().optional(),
  cookMins: z.coerce.number().int().nonnegative().nullable().optional(),
  tags:     z.array(z.string()).default([]).transform(arr =>
    arr.map(t => t.toLowerCase().trim()).filter(t => TAG_ALLOWED.options.includes(t))
  ),
});

router.post('/parse-recipe-image', upload.single('recipe'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(415).json({ error: 'Unsupported file type. Please upload an image.' });
  }

  const requestId = randomUUID().split('-')[0];
  const base64 = req.file.buffer.toString('base64');

  let raw;
  try {
    raw = await Promise.race([
      aiService.parseRecipeImage(base64, req.file.mimetype, requestId),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('AI extraction timed out. Please try again.'), { status: 504 })), 40000)
      ),
    ]);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }

  if (!raw) {
    return res.status(502).json({ error: 'AI could not parse the recipe image. Please try again.' });
  }

  let validated;
  try {
    validated = parsedRecipeSchema.parse(raw);
  } catch {
    return res.status(422).json({ error: 'Recipe image could not be parsed into a valid recipe.' });
  }

  res.json({ recipe: validated });
});

// GET /api/ai/chat/history
router.get('/chat/history', async (req, res) => {
  const messages = await chatService.getHistory(req.user.householdId, 50);
  res.json({ messages });
});

// POST /api/ai/chat
const chatMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

router.post('/chat', validate(chatMessageSchema), async (req, res) => {
  const { message } = req.body;
  const householdId = req.user.householdId;
  const requestId = randomUUID().split('-')[0];

  const [allItems, allRecipes, history] = await Promise.all([
    pantryService.getAll(householdId),
    recipeService.getAll(householdId),
    chatService.getHistory(householdId, 20),
  ]);

  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const pantrySummary = allItems.map((i) => ({
    id:       i.id,
    name:     i.name,
    category: i.category,
    qty:      `${i.quantity} ${i.unit}`,
    status:   getExpiryStatus(i.expiryDate),
    frozen:   i.isFrozen,
  }));

  // tags is already parsed to an array by recipeService.getAll()
  const recipeSummary = allRecipes.map((r) => ({
    id:   r.id,
    name: r.name,
    tags: r.tags ?? [],
  }));

  const dietaryContext = await dietaryService.buildDietaryContext(householdId);

  let recipeSuggestions = [];

  const toolHandlers = {
    add_pantry_item: async (args) => {
      const addItemSchema = z.object({
        name:          z.string().min(1).max(200),
        quantity:      z.coerce.number().positive().default(1),
        unit:          z.string().min(1).max(50).default('item'),
        category:      z
          .enum(['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other'])
          .default('Other'),
        shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
        notes:         z.string().max(500).nullable().optional(),
      });

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
        const item = await pantryService.create(householdId, {
          name:         parsed.name,
          quantity:     parsed.quantity,
          unit:         parsed.unit,
          category:     parsed.category,
          purchaseDate: new Date().toISOString(),
          expiryDate,
          notes:        parsed.notes ?? null,
        });
        return { ok: true, item };
      } catch {
        return { ok: false, error: 'Failed to save item to pantry.' };
      }
    },

    update_pantry_item: async (args) => {
      const updateSchema = z.object({
        id:         z.coerce.number().int().positive(),
        name:       z.string().min(1).max(200).optional(),
        quantity:   z.coerce.number().min(0).optional(),
        unit:       z.string().min(1).max(50).optional(),
        category:   z.enum(['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other']).optional(),
        expiryDate: z.string().datetime().optional(),
        notes:      z.string().max(500).nullable().optional(),
      });

      let parsed;
      try { parsed = updateSchema.parse(args); }
      catch (e) { return { ok: false, error: `Invalid data: ${e.message}` }; }

      const { id, ...fields } = parsed;
      try {
        const item = await pantryService.update(householdId, id, fields);
        return { ok: true, item };
      } catch {
        return { ok: false, error: 'Item not found or update failed.' };
      }
    },

    remove_pantry_item: async (args) => {
      const removeSchema = z.object({ id: z.coerce.number().int().positive() });

      let parsed;
      try { parsed = removeSchema.parse(args); }
      catch (e) { return { ok: false, error: `Invalid data: ${e.message}` }; }

      try {
        await pantryService.remove(householdId, parsed.id);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Item not found or could not be removed.' };
      }
    },

    consume_pantry_item: async (args) => {
      const consumeSchema = z.object({
        itemName:       z.string().min(1),
        amountConsumed: z.number().positive().optional(),
        unit:           z.string().optional(),
        fullyConsumed:  z.boolean().optional(),
        skipDeduction:  z.boolean().optional(),
      });

      let parsed;
      try { parsed = consumeSchema.parse(args); }
      catch (e) { return { ok: false, error: `Invalid data: ${e.message}` }; }

      const { itemName, amountConsumed, unit, fullyConsumed, skipDeduction } = parsed;

      const lowerTarget = itemName.toLowerCase();

      const exactMatches = allItems.filter((i) => i.name.toLowerCase() === lowerTarget);
      let item;
      if (exactMatches.length > 1) {
        return { ok: false, error: `Ambiguous: ${exactMatches.map((i) => i.name).join(', ')}. Ask user to clarify.` };
      } else if (exactMatches.length === 1) {
        item = exactMatches[0];
      } else {
        const bMatches = lowerTarget.length >= 4
          ? allItems.filter((i) => i.name.toLowerCase().includes(lowerTarget))
          : [];
        const cMatches = allItems.filter((i) => i.name.length >= 4 && lowerTarget.includes(i.name.toLowerCase()));
        const combined = [...new Set([...bMatches, ...cMatches])];

        if (combined.length === 0) return { ok: false, error: 'Item not found. Ask user which item they mean.' };
        if (combined.length > 1)  return { ok: false, error: `Ambiguous: ${combined.map((i) => i.name).join(', ')}. Ask user to clarify.` };
        item = combined[0];
      }

      const normalizedInputUnit  = unit ? normalizeUnit(unit) : '';
      const normalizedPantryUnit = item.unit ? normalizeUnit(item.unit) : '';
      const unitMismatch = !!(normalizedInputUnit && normalizedPantryUnit && normalizedInputUnit !== normalizedPantryUnit);

      const serverSkip    = (item.category === 'Condiments' && fullyConsumed !== true);
      const effectiveSkip = serverSkip || unitMismatch || (skipDeduction === true && !serverSkip && !unitMismatch);
      const skipReason    = effectiveSkip
        ? (unitMismatch ? 'unit_mismatch' : serverSkip ? 'condiment' : 'advisory')
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
          await pantryService.update(householdId, item.id, { quantity: remaining });
        }
      }

      const status = getExpiryStatus(item.expiryDate);
      const wasExpiring = ['warning', 'critical', 'expired'].includes(status);

      await mealLogService.create({
        householdId,
        pantryItemId:   item.id,
        itemName:       item.name,
        category:       item.category,
        purineLevel:    getPurineLevel(item.name, item.category),
        wasExpiring,
        quantityBefore: item.quantity,
        quantityAfter:  effectiveSkip ? item.quantity : remaining,
        source: 'agent',
      });

      return {
        ok: true,
        item: {
          id:             item.id,
          name:           item.name,
          remaining,
          skipApplied:    effectiveSkip,
          skipReason,
          quantityBefore: item.quantity,
        },
      };
    },

    suggest_recipes: async (args) => {
      const requestedStrategy = args.strategy ?? 'any';

      // Keys for recipes already shown in this session — used to avoid repeating suggestions.
      const shownKeys = extractSuggestedRecipeKeys(history);

      const dietaryProfile = await dietaryService.getProfile(householdId);
      const dp = dietaryProfile ?? { conditions: [], allergies: [] };

      // Step 1: Saved recipe candidates — tag with suggestion origin.
      // Overrides the DB `source` field (which tracks save method) with suggestion origin.
      const savedCandidates = allRecipes.map((r) => ({
        ...r,
        source: 'saved',
        sourceId: String(r.id),
      }));

      // Step 2: API candidates — source/sourceId already added by recipeSearchService mappers.
      const apiRaw = await aiService.suggestRecipes(allItems, expiringItems);

      // Step 3+4: Merge into one pool.
      const allCandidates = [...savedCandidates, ...apiRaw];

      // Step 5: Deduplicate across the full pool before scoring (ID-first, name fallback).
      const seenDedupeKeys = new Set();
      const deduplicated = allCandidates.filter((c) => {
        const key = (c.source && c.sourceId)
          ? `${c.source}:${c.sourceId}`
          : (c.name ?? '').toLowerCase().trim();
        if (seenDedupeKeys.has(key)) return false;
        seenDedupeKeys.add(key);
        return true;
      });

      // Step 6: Remove recipes already shown in this session's history.
      const filtered = deduplicated.filter((c) => {
        const key = (c.source && c.sourceId)
          ? `${c.source}:${c.sourceId}`
          : (c.name ?? '').toLowerCase().trim();
        return !shownKeys.has(key);
      });

      // Determine effective strategy (unchanged logic — needs recent meal log).
      let effectiveStrategy = requestedStrategy;
      if (requestedStrategy === 'any') {
        const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
        const recent72h = await mealLogService.getRecentSince(householdId, cutoff72h);
        const highCount = recent72h.filter((m) => m.purineLevel === 'high').length;
        const medCount  = recent72h.filter((m) => m.purineLevel === 'medium').length;
        const isHighPurine = highCount >= 2 || (highCount + medCount) >= 4;
        if (isHighPurine)                  effectiveStrategy = 'dietary_safe';
        else if (expiringItems.length > 0) effectiveStrategy = 'expiring_first';
        else                               effectiveStrategy = 'pantry_overlap';
      }

      const expiringNames = new Set(expiringItems.map((i) => i.name.toLowerCase()));

      // Steps 7+8: Score candidates and apply saved-source ranking bonus.
      // Saved recipes must meet overlap >= 0.25 AND at least 1 matched ingredient to qualify.
      // API candidates always pass through — ranked by score alone.
      function scoreCandidates(pool) {
        return pool.map((c) => {
          const { overlapScore, matchedIngredients, unmatchedIngredients } = recipeScorer.score(c, allItems);
          const { allergyNote, healthNote } = recipeScorer.annotateHealth(c, dp);
          if (c.source === 'saved' && (overlapScore < 0.25 || matchedIngredients.length < 1)) return null;
          const effectiveScore = overlapScore + (c.source === 'saved' ? 0.2 : 0);
          return { ...c, overlapScore, effectiveScore, matchedIngredients, unmatchedIngredients, allergyNote, healthNote };
        }).filter(Boolean);
      }

      // Step 9: Sort by effective strategy.
      function applyStrategySort(pool) {
        return [...pool].sort((a, b) => {
          if (effectiveStrategy === 'expiring_first') {
            const aExp = (a.matchedIngredients || []).some((n) => expiringNames.has(n.toLowerCase()));
            const bExp = (b.matchedIngredients || []).some((n) => expiringNames.has(n.toLowerCase()));
            if (aExp && !bExp) return -1;
            if (!aExp && bExp) return 1;
          }
          if (effectiveStrategy === 'dietary_safe') {
            const aScore = (a.allergyNote ? -10 : 0) + (a.healthNote ? -2 : 0) + (a.effectiveScore ?? 0);
            const bScore = (b.allergyNote ? -10 : 0) + (b.healthNote ? -2 : 0) + (b.effectiveScore ?? 0);
            return bScore - aScore;
          }
          return (b.effectiveScore ?? 0) - (a.effectiveScore ?? 0);
        });
      }

      // Step 10: Take top 5.
      let topN = applyStrategySort(scoreCandidates(filtered)).slice(0, 5);

      // Step 11: Fallback — if history filter exhausted all candidates, re-run without it.
      if (topN.length === 0) {
        topN = applyStrategySort(scoreCandidates(deduplicated)).slice(0, 5);
      }

      // Build pantry lookup map once — O(1) per ingredient vs. find() in a loop.
      const pantryMap = new Map(
        allItems.map((item) => [normalizeFood(item.name), item])
      );

      // Annotate each ingredient with pantry status. Produces API DTOs from scorer output
      // (scorer domain model is never mutated). unmatchedIngredients is dropped from the DTO.
      // NOTE: annotation uses normalized exact lookup only — not foodsMatch() fuzzy fallback.
      // A scorer fuzzy match may not reflect in the highlight color (intentional v1 constraint).
      const annotated = topN.map((recipe) => {
        const annotatedIngredients = (recipe.ingredients ?? []).map((ing) => {
          let pantryStatus = 'missing';
          let needToBuy;
          try {
            const key = normalizeFood(stripIngredientPrefix(ing.name));
            const pantryItem = pantryMap.get(key);
            if (pantryItem) {
              if (ing.quantity == null || pantryItem.quantity == null) {
                pantryStatus = 'have';
              } else if (normalizeUnit(ing.unit) !== normalizeUnit(pantryItem.unit)) {
                // Unit mismatch → binary fallback. quantity > 0 guard prevents "0 oz milk" showing green.
                pantryStatus = pantryItem.quantity > 0 ? 'have' : 'missing';
              } else if (pantryItem.quantity < ing.quantity) {
                pantryStatus = 'partial';
                needToBuy = ing.quantity - pantryItem.quantity;
              } else {
                pantryStatus = 'have';
              }
            }
          } catch (err) {
            console.warn('[annotatePantryStatus] ingredient annotation failed:', err?.message, ing?.name);
          }
          const result = { ...ing, pantryStatus };
          if (pantryStatus === 'partial' && needToBuy != null && needToBuy > 0) {
            result.needToBuy = needToBuy;
          }
          return result;
        });

        const { unmatchedIngredients: _removed, ...rest } = recipe;
        return { ...rest, ingredients: annotatedIngredients };
      });

      // Full objects saved to metadata and returned to frontend for card rendering.
      recipeSuggestions = annotated;

      // Slim objects returned to model only — model cannot reproduce card detail it never saw.
      const slimForModel = topN.map((s) => ({
        name: s.name,
        shortDescription: s.description ?? '',
        source: s.source,
      }));

      return { ok: true, suggestions: slimForModel, strategy: effectiveStrategy };
    },

    save_recipe: async (args) => {
      const saveSchema = z.object({
        name:        z.string().min(1).max(200),
        description: z.string().max(500),
      });

      let parsed;
      try { parsed = saveSchema.parse(args); }
      catch (e) { return { ok: false, error: `Invalid data: ${e.message}` }; }

      const full = await aiService.expandSuggestion(parsed.name, parsed.description, allItems, requestId);
      if (!full) return { ok: false, error: 'AI could not expand the recipe. Try again.' };

      const saved = await recipeService.createOrIgnore(householdId, { ...full, source: 'agent_saved' });
      const name = saved?.name ?? parsed.name;
      return { ok: true, recipe: { id: saved?.id, name } };
    },
  };

  const aiConfig = await householdService.getAiConfig(householdId);
  const { reply, itemsAdded } = await aiService.chat(
    pantrySummary, recipeSummary, history, message, toolHandlers, dietaryContext, aiConfig, requestId
  );

  await chatService.savePair(
    householdId,
    message,
    reply,
    recipeSuggestions.length > 0 ? { version: 1, recipeSuggestions } : null
  );
  await chatService.trimHistory(householdId, 50);

  res.json({ reply, itemsAdded, recipeSuggestions });
});

export default router;
