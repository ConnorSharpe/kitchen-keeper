import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as recipeService from '../services/recipeService.js';

const router = express.Router();
router.use(requireAuth);

const ingredientSchema = z.object({
  name:     z.string().min(1),
  quantity: z.coerce.number().nullable().optional(),
  unit:     z.string().nullable().optional(),
});

const sourceUrlSchema = z
  .string()
  .url()
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

const createSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  source:      z.enum(['upload', 'ai_suggested', 'web_suggested', 'manual']).optional(),
  sourceUrl:   sourceUrlSchema,
  imageUrl:    z.string().nullable().optional(),
  ingredients: z.array(ingredientSchema).default([]),
  steps:       z.array(z.string()).default([]),
  servings:    z.coerce.number().int().positive().nullable().optional(),
  prepMins:    z.coerce.number().int().nonnegative().nullable().optional(),
  cookMins:    z.coerce.number().int().nonnegative().nullable().optional(),
  tags:        z.array(z.string()).default([]),
});

const updateSchema = createSchema.partial();

// GET /api/recipes
router.get('/', async (req, res) => {
  const list = await recipeService.getAll(req.user.householdId);
  res.json({ recipes: list });
});

// POST /api/recipes
router.post('/', validate(createSchema), async (req, res) => {
  const recipe = await recipeService.create(req.user.householdId, req.body);
  res.status(201).json({ recipe });
});

// PATCH /api/recipes/:id
router.patch('/:id', validate(updateSchema), async (req, res) => {
  const id = Number(req.params.id);
  const result = await recipeService.update(req.user.householdId, id, req.body);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (result.status === 'forbidden')  return res.status(403).json({ error: 'Forbidden' });
  res.json({ recipe: result.recipe });
});

// DELETE /api/recipes/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const result = await recipeService.remove(req.user.householdId, id);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (result.status === 'forbidden')  return res.status(403).json({ error: 'Forbidden' });
  res.status(204).end();
});

// PATCH /api/recipes/:id/favorite
router.patch('/:id/favorite', async (req, res) => {
  const id = Number(req.params.id);
  const result = await recipeService.toggleFavorite(req.user.householdId, id);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (result.status === 'forbidden')  return res.status(403).json({ error: 'Forbidden' });
  res.json({ recipe: result.recipe });
});

export default router;
