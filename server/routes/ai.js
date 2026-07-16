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
import * as dietaryService from '../services/dietaryService.js';
import * as recipeBlocklistService from '../services/recipeBlocklistService.js';
import * as recipeSearchService from '../services/recipeSearchService.js';
import { createToolHandlers } from '../services/chat/createToolHandlers.js';
import { getExpiryDays, getExpiryStatus } from '../../shared/expiry.js';
import { getDefaultStorageLocation } from '../../shared/pantryDefaults.js';
const router = express.Router();
router.use(clerkAuth);

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

  const suggestions = await aiService.eatThisNow(
    allItems,
    expiringItems,
    savedRecipes,
    requestId
  );
  res.json({ suggestions });
});

// POST /api/ai/expand-suggestion
const expandSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500),
});

router.post('/expand-suggestion', validate(expandSchema), async (req, res) => {
  const requestId = randomUUID().split('-')[0];
  const { name, description } = req.body;
  const allItems = await pantryService.getAll(req.user.householdId);

  const recipe = await aiService.expandSuggestion(
    name,
    description,
    allItems,
    requestId
  );

  if (!recipe) {
    const err = new Error('AI returned an invalid recipe. Please try again.');
    err.status = 502;
    throw err;
  }

  const saved = await recipeService.create(req.user.householdId, {
    ...recipe,
    source: 'ai_suggested',
  });
  res.status(201).json({ recipe: saved });
});

// POST /api/ai/parse-receipt
// Receipt is never persisted — buffer goes directly to Groq vision, then discarded.
const dateField = z.string().datetime().nullable().optional();

const candidateItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50).default('Other'),
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().min(1).max(50).default('item'),
  purchaseDate: dateField,
  expiryDate: dateField,
  storageLocation: z
    .enum(['pantry', 'refrigerator', 'freezer'])
    .nullable()
    .optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.post('/parse-receipt', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const requestId = randomUUID().split('-')[0];
  const base64 = req.file.buffer.toString('base64');
  const rawItems = await aiService.parseReceipt(
    base64,
    req.file.mimetype,
    requestId
  );

  const candidates = rawItems
    .map((item) => {
      try {
        const category = item.category || 'Other';
        return candidateItemSchema.parse({
          name: item.name,
          category,
          quantity: item.quantity ?? 1,
          unit: item.unit || 'item',
          purchaseDate: new Date().toISOString(),
          expiryDate:
            item.estimatedExpiryDays != null
              ? new Date(
                  Date.now() + item.estimatedExpiryDays * 86_400_000
                ).toISOString()
              : null,
          storageLocation: getDefaultStorageLocation(category),
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

  const [rawSuggestions, blockedKeys] = await Promise.all([
    aiService.suggestRecipes(allItems, expiringItems),
    recipeBlocklistService.getBlockedKeys(req.user.householdId),
  ]);
  const suggestions = rawSuggestions.filter(
    (s) => !blockedKeys.has(recipeSearchService.deriveRecipeKey(s))
  );
  res.json({ suggestions });
});

// POST /api/ai/parse-recipe-image
// Extracts recipe data from an uploaded image using AI.
// Returns { recipe: extractedJson } — does NOT save. The client reviews and saves separately.

const TAG_ALLOWED = z.enum([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'dessert',
  'drink',
  'italian',
  'mexican',
  'asian',
  'american',
  'mediterranean',
  'indian',
  'french',
  'thai',
  'japanese',
  'greek',
  'chinese',
  'vegetarian',
  'vegan',
  'gluten-free',
  'dairy-free',
  'low-carb',
  'keto',
  'paleo',
  'quick',
  'easy',
  'slow-cooker',
  'one-pot',
  'meal-prep',
  'freezer-friendly',
]);

const fractionalQuantity = z
  .union([
    z.number(),
    z.string().transform((s) => {
      const unicodeMap = {
        '½': 0.5,
        '⅓': 0.333,
        '¼': 0.25,
        '¾': 0.75,
        '⅔': 0.667,
        '⅛': 0.125,
        '⅜': 0.375,
        '⅝': 0.625,
        '⅞': 0.875,
      };
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
  ])
  .transform((v) => (typeof v === 'number' && isFinite(v) ? v : null));

const parsedRecipeSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: fractionalQuantity,
        unit: z.string().nullable().optional(),
      })
    )
    .default([]),
  steps: z.array(z.string()).default([]),
  servings: z.coerce.number().int().positive().nullable().optional(),
  prepMins: z.coerce.number().int().nonnegative().nullable().optional(),
  cookMins: z.coerce.number().int().nonnegative().nullable().optional(),
  tags: z
    .array(z.string())
    .default([])
    .transform((arr) =>
      arr
        .map((t) => t.toLowerCase().trim())
        .filter((t) => TAG_ALLOWED.options.includes(t))
    ),
});

router.post(
  '/parse-recipe-image',
  upload.single('recipe'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res
        .status(415)
        .json({ error: 'Unsupported file type. Please upload an image.' });
    }

    const requestId = randomUUID().split('-')[0];
    const base64 = req.file.buffer.toString('base64');

    let raw;
    try {
      raw = await Promise.race([
        aiService.parseRecipeImage(base64, req.file.mimetype, requestId),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error('AI extraction timed out. Please try again.'),
                  { status: 504 }
                )
              ),
            40000
          )
        ),
      ]);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }

    if (!raw) {
      return res.status(502).json({
        error: 'AI could not parse the recipe image. Please try again.',
      });
    }

    let validated;
    try {
      validated = parsedRecipeSchema.parse(raw);
    } catch {
      return res.status(422).json({
        error: 'Recipe image could not be parsed into a valid recipe.',
      });
    }

    res.json({ recipe: validated });
  }
);

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
    id: i.id,
    name: i.name,
    category: i.category,
    qty: `${i.quantity} ${i.unit}`,
    status: getExpiryStatus(i.expiryDate),
    frozen: i.storageLocation === 'freezer',
  }));

  // tags is already parsed to an array by recipeService.getAll()
  const recipeSummary = allRecipes.map((r) => ({
    id: r.id,
    name: r.name,
    tags: r.tags ?? [],
  }));

  const dietaryContext = await dietaryService.buildDietaryContext(householdId);

  const ctx = {
    householdId,
    history,
    allItems,
    expiringItems,
    allRecipes,
    requestId,
    result: { recipeSuggestions: [] },
  };
  const toolHandlers = createToolHandlers(ctx);

  const aiConfig = await householdService.getAiConfig(householdId);
  const { reply, itemsAdded } = await aiService.chat(
    pantrySummary,
    recipeSummary,
    history,
    message,
    toolHandlers,
    dietaryContext,
    aiConfig,
    requestId
  );

  await chatService.savePair(
    householdId,
    message,
    reply,
    ctx.result.recipeSuggestions.length > 0
      ? { version: 1, recipeSuggestions: ctx.result.recipeSuggestions }
      : null
  );
  await chatService.trimHistory(householdId, 50);

  res.json({
    reply,
    itemsAdded,
    recipeSuggestions: ctx.result.recipeSuggestions,
  });
});

export default router;
