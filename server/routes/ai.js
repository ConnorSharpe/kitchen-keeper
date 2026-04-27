import express from 'express';
import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import * as pantryService from '../services/pantryService.js';
import * as recipeService from '../services/recipeService.js';
import * as chatService from '../services/chatService.js';
import * as aiService from '../services/aiService.js';
import { getExpiryDays, getExpiryStatus } from '../utils/expiry.js';

const router = express.Router();
router.use(requireAuth);

// POST /api/ai/eat-this-now
router.post('/eat-this-now', async (req, res) => {
  const [allItems, savedRecipes] = await Promise.all([
    pantryService.getAll(req.user.id),
    recipeService.getAll(req.user.id),
  ]);

  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.eatThisNow(allItems, expiringItems, savedRecipes);
  res.json({ suggestions });
});

// POST /api/ai/expand-suggestion
const expandSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500),
});

router.post('/expand-suggestion', validate(expandSchema), async (req, res) => {
  const { name, description } = req.body;
  const allItems = await pantryService.getAll(req.user.id);

  const recipe = await aiService.expandSuggestion(name, description, allItems);

  if (!recipe) {
    const err = new Error('AI returned an invalid recipe. Please try again.');
    err.status = 502;
    throw err;
  }

  const saved = await recipeService.create(req.user.id, { ...recipe, source: 'ai_suggested' });
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
  const allItems = await pantryService.getAll(req.user.id);
  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.suggestRecipes(expiringItems);
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

  const saved = await recipeService.create(req.user.id, {
    ...validated,
    source:   'upload',
    imageUrl: url,
  });

  res.status(201).json({ recipe: saved });
});

// GET /api/ai/chat/history
router.get('/chat/history', async (req, res) => {
  const messages = await chatService.getHistory(req.user.id, 50);
  res.json({ messages });
});

// POST /api/ai/chat
const chatMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

router.post('/chat', validate(chatMessageSchema), async (req, res) => {
  const { message } = req.body;
  const userId = req.user.id;

  const [allItems, allRecipes, history] = await Promise.all([
    pantryService.getAll(userId),
    recipeService.getAll(userId),
    chatService.getHistory(userId, 20),
  ]);

  const pantrySummary = allItems.map((i) => ({
    name:   i.name,
    qty:    `${i.quantity} ${i.unit}`,
    status: getExpiryStatus(i.expiryDate),
    frozen: i.isFrozen,
  }));

  // tags is already parsed to an array by recipeService.getAll()
  const recipeSummary = allRecipes.map((r) => ({
    id:   r.id,
    name: r.name,
    tags: r.tags ?? [],
  }));

  const reply = await aiService.chat(pantrySummary, recipeSummary, history, message);

  await chatService.savePair(userId, message, reply);
  await chatService.trimHistory(userId, 50);

  res.json({ reply });
});

export default router;
