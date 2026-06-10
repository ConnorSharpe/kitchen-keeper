import express from 'express';
import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
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
import { normalizeUnit } from '../utils/foodNormalization.js';
import { getPurineLevel } from '../data/purineIndex.js';
import { getExpiryDays, getExpiryStatus } from '../utils/expiry.js';

const router = express.Router();
router.use(requireAuth);

// POST /api/ai/eat-this-now
router.post('/eat-this-now', async (req, res) => {
  const [allItems, savedRecipes, aiConfig] = await Promise.all([
    pantryService.getAll(req.user.householdId),
    recipeService.getAll(req.user.householdId),
    householdService.getAiConfig(req.user.householdId),
  ]);

  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.eatThisNow(allItems, expiringItems, savedRecipes, aiConfig?.decryptedKey);
  res.json({ suggestions });
});

// POST /api/ai/expand-suggestion
const expandSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500),
});

router.post('/expand-suggestion', validate(expandSchema), async (req, res) => {
  const { name, description } = req.body;
  const [allItems, aiConfig] = await Promise.all([
    pantryService.getAll(req.user.householdId),
    householdService.getAiConfig(req.user.householdId),
  ]);

  const recipe = await aiService.expandSuggestion(name, description, allItems, aiConfig?.decryptedKey);

  if (!recipe) {
    const err = new Error('AI returned an invalid recipe. Please try again.');
    err.status = 502;
    throw err;
  }

  const saved = await recipeService.create(req.user.householdId, { ...recipe, source: 'ai_suggested' });
  res.status(201).json({ recipe: saved });
});

// POST /api/ai/parse-receipt
// Receipt is never persisted — buffer goes directly to Gemini, then discarded.
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

  const base64 = req.file.buffer.toString('base64');
  const rawItems = await aiService.parseReceipt(base64, req.file.mimetype);

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
  const [allItems, aiConfig] = await Promise.all([
    pantryService.getAll(req.user.householdId),
    householdService.getAiConfig(req.user.householdId),
  ]);
  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.suggestRecipes(allItems, expiringItems, aiConfig?.decryptedKey);
  res.json({ suggestions });
});

// POST /api/ai/parse-recipe-image
// The image is uploaded to Vercel Blob for permanent storage after AI parsing.
const parsedRecipeSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  ingredients: z.array(
    z.object({
      name:     z.string().min(1),
      quantity: z.number().nullable().optional(),
      unit:     z.string().nullable().optional(),
    })
  ).default([]),
  steps:    z.array(z.string()).default([]),
  servings: z.coerce.number().int().positive().nullable().optional(),
  prepMins: z.coerce.number().int().nonnegative().nullable().optional(),
  cookMins: z.coerce.number().int().nonnegative().nullable().optional(),
  tags:     z.array(z.string()).default([]),
});

router.post('/parse-recipe-image', upload.single('recipe'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const base64 = req.file.buffer.toString('base64');
  const raw = await aiService.parseRecipeImage(base64, req.file.mimetype);

  if (!raw) {
    const err = new Error('AI could not parse the recipe image. Please try again.');
    err.status = 502;
    throw err;
  }

  let validated;
  try {
    validated = parsedRecipeSchema.parse(raw);
  } catch {
    return res.status(422).json({ error: 'Recipe image could not be parsed into a valid recipe.' });
  }

  // Upload to Vercel Blob — the full URL is stored in the DB and used directly by the client
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const { url } = await put(`${uuidv4()}${ext}`, req.file.buffer, { access: 'public' });

  const saved = await recipeService.create(req.user.householdId, {
    ...validated,
    source:   'upload',
    imageUrl: url,
  });

  res.status(201).json({ recipe: saved });
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

      // Name resolution
      const lowerTarget = itemName.toLowerCase();

      // Step 2a: exact case-insensitive matches
      const exactMatches = allItems.filter((i) => i.name.toLowerCase() === lowerTarget);
      let item;
      if (exactMatches.length > 1) {
        return { ok: false, error: `Ambiguous: ${exactMatches.map((i) => i.name).join(', ')}. Ask user to clarify.` };
      } else if (exactMatches.length === 1) {
        item = exactMatches[0];
      } else {
        // Step 2b: itemName is substring of pantry name (min 4 chars)
        const bMatches = lowerTarget.length >= 4
          ? allItems.filter((i) => i.name.toLowerCase().includes(lowerTarget))
          : [];
        // Step 2c: pantry name is substring of itemName (min 4 chars)
        const cMatches = allItems.filter((i) => i.name.length >= 4 && lowerTarget.includes(i.name.toLowerCase()));
        const combined = [...new Set([...bMatches, ...cMatches])];

        if (combined.length === 0) return { ok: false, error: 'Item not found. Ask user which item they mean.' };
        if (combined.length > 1)  return { ok: false, error: `Ambiguous: ${combined.map((i) => i.name).join(', ')}. Ask user to clarify.` };
        item = combined[0];
      }

      // Unit mismatch detection
      const normalizedInputUnit  = unit ? normalizeUnit(unit) : '';
      const normalizedPantryUnit = item.unit ? normalizeUnit(item.unit) : '';
      const unitMismatch = !!(normalizedInputUnit && normalizedPantryUnit && normalizedInputUnit !== normalizedPantryUnit);

      // Server-side skip-deduction rule (ADR-007)
      const serverSkip    = (item.category === 'Condiments' && fullyConsumed !== true);
      const effectiveSkip = serverSkip || unitMismatch || (skipDeduction === true && !serverSkip && !unitMismatch);
      const skipReason    = effectiveSkip
        ? (unitMismatch ? 'unit_mismatch' : serverSkip ? 'condiment' : 'advisory')
        : null;

      // Compute remaining (Invariant 1: quantity ≥ 0)
      let remaining;
      if (fullyConsumed) {
        remaining = 0;
      } else {
        remaining = item.quantity - (amountConsumed ?? 0);
        remaining = Math.max(0, remaining);
      }

      // Apply pantry mutation
      if (!effectiveSkip) {
        if (remaining === 0) {
          await pantryService.markUsed(householdId, item.id);
        } else {
          await pantryService.update(householdId, item.id, { quantity: remaining });
        }
      }

      // Expiry status
      const status = getExpiryStatus(item.expiryDate);
      const wasExpiring = ['warning', 'critical', 'expired'].includes(status);

      // Log the meal
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

      const dietaryProfile = await dietaryService.getProfile(householdId);

      // Get raw candidates from Gemini (2 calls: search grounding + JSON format)
      const candidates = await aiService.suggestRecipes(allItems, expiringItems, aiConfig?.decryptedKey);

      // Score and annotate each candidate
      const scored = candidates.map((candidate) => {
        const { overlapScore, matchedIngredients, unmatchedIngredients } =
          recipeScorer.score(candidate, allItems);
        const { allergyNote, healthNote } =
          recipeScorer.annotateHealth(candidate, dietaryProfile ?? { conditions: [], allergies: [] });
        return { ...candidate, overlapScore, matchedIngredients, unmatchedIngredients, allergyNote, healthNote };
      });

      // Auto-select strategy
      let effectiveStrategy = requestedStrategy;
      if (requestedStrategy === 'any') {
        const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
        const recent72h = await mealLogService.getRecentSince(householdId, cutoff72h);
        const highCount = recent72h.filter((m) => m.purineLevel === 'high').length;
        const medCount  = recent72h.filter((m) => m.purineLevel === 'medium').length;
        const isHighPurine = highCount >= 2 || (highCount + medCount) >= 4;

        if (isHighPurine)            effectiveStrategy = 'dietary_safe';
        else if (expiringItems.length > 0) effectiveStrategy = 'expiring_first';
        else                         effectiveStrategy = 'pantry_overlap';
      }

      // Sort
      const expiringNames = new Set(expiringItems.map((i) => i.name.toLowerCase()));
      const sorted = [...scored].sort((a, b) => {
        if (effectiveStrategy === 'expiring_first') {
          const aExp = (a.matchedIngredients || []).some((n) => expiringNames.has(n.toLowerCase()));
          const bExp = (b.matchedIngredients || []).some((n) => expiringNames.has(n.toLowerCase()));
          if (aExp && !bExp) return -1;
          if (!aExp && bExp) return 1;
        }
        if (effectiveStrategy === 'dietary_safe') {
          const aScore = (a.allergyNote ? -10 : 0) + (a.healthNote ? -2 : 0) + (a.overlapScore ?? 0);
          const bScore = (b.allergyNote ? -10 : 0) + (b.healthNote ? -2 : 0) + (b.overlapScore ?? 0);
          return bScore - aScore;
        }
        return (b.overlapScore ?? 0) - (a.overlapScore ?? 0);
      });

      recipeSuggestions = sorted.slice(0, 5);
      return { ok: true, suggestions: recipeSuggestions, strategy: effectiveStrategy };
    },

    save_recipe: async (args) => {
      const saveSchema = z.object({
        name:        z.string().min(1).max(200),
        description: z.string().max(500),
      });

      let parsed;
      try { parsed = saveSchema.parse(args); }
      catch (e) { return { ok: false, error: `Invalid data: ${e.message}` }; }

      const full = await aiService.expandSuggestion(parsed.name, parsed.description, allItems, aiConfig?.decryptedKey);
      if (!full) return { ok: false, error: 'AI could not expand the recipe. Try again.' };

      const saved = await recipeService.create(householdId, { ...full, source: 'agent_saved' });
      return { ok: true, recipe: { id: saved.id, name: saved.name } };
    },
  };

  const aiConfig = await householdService.getAiConfig(householdId);
  const { reply, itemsAdded } = await aiService.chat(
    pantrySummary, recipeSummary, history, message, toolHandlers, dietaryContext, aiConfig
  );

  await chatService.savePair(householdId, message, reply);
  await chatService.trimHistory(householdId, 50);

  res.json({ reply, itemsAdded, recipeSuggestions });
});

export default router;
