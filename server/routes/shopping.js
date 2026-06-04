import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as shoppingService from '../services/shoppingService.js';

const router = express.Router();
router.use(requireAuth);

const buildSchema = z.object({
  name:      z.string().min(1).max(200),
  recipeIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one recipe'),
});

const manualItemSchema = z.object({
  ingredientName: z.string().min(1).max(200),
  quantity:       z.coerce.number().positive().nullable().optional(),
  unit:           z.string().max(50).nullable().optional(),
});

// GET /api/shopping
router.get('/', async (req, res) => {
  const lists = await shoppingService.getAll(req.user.householdId);
  res.json({ lists });
});

// POST /api/shopping/build
router.post('/build', validate(buildSchema), async (req, res) => {
  const { name, recipeIds } = req.body;
  const result = await shoppingService.buildFromRecipes(req.user.householdId, name, recipeIds);
  if (result.status === 'invalid_recipes') {
    return res.status(400).json({ error: 'One or more recipe IDs are invalid or do not belong to you.' });
  }
  res.status(201).json({ list: result.list, items: result.items, warnings: result.warnings });
});

// GET /api/shopping/:id/items
router.get('/:id/items', async (req, res) => {
  const listId = Number(req.params.id);
  const result = await shoppingService.getItems(req.user.householdId, listId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.json({ items: result.items });
});

// PATCH /api/shopping/:id/items/:itemId/check
router.patch('/:id/items/:itemId/check', async (req, res) => {
  const listId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const result = await shoppingService.toggleItem(req.user.householdId, listId, itemId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.json({ item: result.item });
});

// POST /api/shopping/:id/items
router.post('/:id/items', validate(manualItemSchema), async (req, res) => {
  const listId = Number(req.params.id);
  const result = await shoppingService.addManualItem(req.user.householdId, listId, req.body);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.status(201).json({ item: result.item });
});

// DELETE /api/shopping/:id
router.delete('/:id', async (req, res) => {
  const listId = Number(req.params.id);
  const result = await shoppingService.deleteList(req.user.householdId, listId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
