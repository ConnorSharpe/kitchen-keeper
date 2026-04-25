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

// GET /api/shopping — list all shopping lists for the authenticated user
router.get('/', (req, res) => {
  const lists = shoppingService.getAll(req.user.id);
  res.json({ lists });
});

// POST /api/shopping/build — aggregate ingredients from recipes and persist as a new list
router.post('/build', validate(buildSchema), (req, res) => {
  const { name, recipeIds } = req.body;
  const result = shoppingService.buildFromRecipes(req.user.id, name, recipeIds);
  if (result.status === 'invalid_recipes') {
    return res.status(400).json({ error: 'One or more recipe IDs are invalid or do not belong to you.' });
  }
  res.status(201).json({ list: result.list, items: result.items, warnings: result.warnings });
});

// GET /api/shopping/:id/items — items for a specific list (ownership verified inside service)
router.get('/:id/items', (req, res) => {
  const listId = Number(req.params.id);
  const result = shoppingService.getItems(req.user.id, listId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.json({ items: result.items });
});

// PATCH /api/shopping/:id/items/:itemId/check — toggle isChecked (ownership via join)
router.patch('/:id/items/:itemId/check', (req, res) => {
  const listId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const result = shoppingService.toggleItem(req.user.id, listId, itemId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.json({ item: result.item });
});

// POST /api/shopping/:id/items — add a manual item to an existing list
router.post('/:id/items', validate(manualItemSchema), (req, res) => {
  const listId = Number(req.params.id);
  const result = shoppingService.addManualItem(req.user.id, listId, req.body);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.status(201).json({ item: result.item });
});

// DELETE /api/shopping/:id — delete list (CASCADE handles items)
router.delete('/:id', (req, res) => {
  const listId = Number(req.params.id);
  const result = shoppingService.deleteList(req.user.id, listId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
