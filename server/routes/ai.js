import fs from 'fs';
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import * as pantryService from '../services/pantryService.js';
import * as recipeService from '../services/recipeService.js';
import * as aiService from '../services/aiService.js';
import { getExpiryDays } from '../utils/expiry.js';

const router = express.Router();
router.use(requireAuth);

// POST /api/ai/eat-this-now
// Fetches the user's full pantry + saved recipes, then asks AI for 2-3 meal suggestions
// that prioritise expiring ingredients.
router.post('/eat-this-now', async (req, res) => {
  const allItems = pantryService.getAll(req.user.id);
  const savedRecipes = recipeService.getAll(req.user.id);

  // Only surface items that expire within the next 7 days (not already expired)
  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });

  const suggestions = await aiService.eatThisNow(allItems, expiringItems, savedRecipes);
  res.json({ suggestions });
});

// POST /api/ai/expand-suggestion
// Turns a brief suggestion (name + description) into a full saved recipe.
const expandSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500),
});

router.post('/expand-suggestion', validate(expandSchema), async (req, res) => {
  const { name, description } = req.body;
  const allItems = pantryService.getAll(req.user.id);

  const recipe = await aiService.expandSuggestion(name, description, allItems);

  if (!recipe) {
    // AI returned unparseable JSON — surface as 502 (upstream failure, not client error)
    const err = new Error('AI returned an invalid recipe. Please try again.');
    err.status = 502;
    throw err;
  }

  const saved = recipeService.create(req.user.id, { ...recipe, source: 'ai_suggested' });
  res.status(201).json({ recipe: saved });
});

// POST /api/ai/parse-receipt
// Step 1 of the receipt flow: parse image, validate items, return candidates to client.
// Does NOT insert into the database — the client previews and confirms first.
// The receipt file is always deleted in the finally block (privacy-sensitive).
//
// Zod schema for a single candidate item — mirrors the pantry createSchema so the
// same Zod rules apply to both manual adds and receipt-scanned additions.
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

  const filePath = req.file.path;

  try {
    // Use async read — never block the event loop with readFileSync
    const imageBuffer = await fs.promises.readFile(filePath);
    const base64 = imageBuffer.toString('base64');

    const rawItems = await aiService.parseReceipt(base64, req.file.mimetype);

    // Validate each AI-returned item against the pantry schema.
    // Invalid items are silently skipped — skipped count tells the client how many were lost.
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
  } finally {
    // Always delete receipt — never persisted, privacy-sensitive
    fs.promises.unlink(filePath).catch((e) =>
      console.error('[parse-receipt] Receipt unlink failed:', e.message)
    );
  }
});

// POST /api/ai/parse-recipe-image
// Parses a recipe image (card, book page, etc.) and saves it to the recipes table.
// The image file is retained in /uploads and served statically — NOT deleted.
//
// Zod schema for the parsed recipe — coerces nullable fields from AI output.
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

  // Read file async — do NOT use readFileSync in an async route
  const imageBuffer = await fs.promises.readFile(req.file.path);
  const base64 = imageBuffer.toString('base64');

  const raw = await aiService.parseRecipeImage(base64, req.file.mimetype);

  if (!raw) {
    // AI returned malformed JSON — delete the orphaned image and surface as 502
    fs.promises.unlink(req.file.path).catch((e) =>
      console.error('[parse-recipe-image] Orphaned image unlink failed:', e.message)
    );
    const err = new Error('AI could not parse the recipe image. Please try again.');
    err.status = 502;
    throw err;
  }

  let validated;
  try {
    validated = parsedRecipeSchema.parse(raw);
  } catch {
    // Structurally invalid even after AI returned something — clean up and reject
    fs.promises.unlink(req.file.path).catch((e) =>
      console.error('[parse-recipe-image] Invalid recipe image unlink failed:', e.message)
    );
    return res.status(422).json({ error: 'Recipe image could not be parsed into a valid recipe.' });
  }

  // imageUrl stores only the filename — /uploads is served statically by Express
  const saved = recipeService.create(req.user.id, {
    ...validated,
    source:   'upload',
    imageUrl: req.file.filename,
  });

  res.status(201).json({ recipe: saved });
});

export default router;
