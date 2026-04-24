import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as pantryService from '../services/pantryService.js';

const router = express.Router();
router.use(requireAuth);

// z.string().datetime() rejects bare YYYY-MM-DD strings — spec requirement.
// Client must convert date picker output to full ISO before submitting.
const dateField = z.string().datetime().nullable().optional();

const createSchema = z.object({
  name:         z.string().min(1, 'Name is required').max(200),
  category:     z.string().min(1).max(50).default('Other'),
  quantity:     z.coerce.number().positive().default(1),
  unit:         z.string().min(1).max(50).default('item'),
  purchaseDate: dateField,
  expiryDate:   dateField,
  notes:        z.string().max(500).nullable().optional(),
});

// PATCH accepts any subset of create fields
const updateSchema = createSchema.partial();

function ownershipError(result, res) {
  if (result.status === 'not_found') return res.status(404).json({ error: 'Item not found' });
  if (result.status === 'forbidden')  return res.status(403).json({ error: 'Forbidden' });
  return null;
}

// GET /api/pantry?expiring=7
router.get('/', async (req, res) => {
  const expiringWithin = req.query.expiring != null ? Number(req.query.expiring) : undefined;
  const items = pantryService.getAll(req.user.id, { expiringWithin });
  res.json({ items });
});

// GET /api/pantry/waste-saved?since=ISO_DATE
// Must be before /:id routes to prevent "waste-saved" matching as :id
router.get('/waste-saved', async (req, res) => {
  const count = pantryService.getWasteSaved(req.user.id, req.query.since);
  res.json({ count });
});

// POST /api/pantry
router.post('/', validate(createSchema), async (req, res) => {
  const item = pantryService.create(req.user.id, req.body);
  res.status(201).json({ item });
});

// POST /api/pantry/bulk — insert confirmed items from receipt scan preview
// Must be declared before /:id routes to prevent "bulk" being captured as :id
const bulkCreateSchema = z.object({
  items: z.array(createSchema).min(1).max(100),
});

router.post('/bulk', validate(bulkCreateSchema), async (req, res) => {
  const items = pantryService.bulkCreate(req.user.id, req.body.items);
  res.status(201).json({ items });
});

// PATCH /api/pantry/:id
router.patch('/:id', validate(updateSchema), async (req, res) => {
  const result = pantryService.update(req.user.id, Number(req.params.id), req.body);
  if (ownershipError(result, res)) return;
  res.json({ item: result.item });
});

// PATCH /api/pantry/:id/use
router.patch('/:id/use', async (req, res) => {
  const result = pantryService.markUsed(req.user.id, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ ok: true });
});

// PATCH /api/pantry/:id/freeze
router.patch('/:id/freeze', async (req, res) => {
  const result = pantryService.toggleFreeze(req.user.id, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ item: result.item });
});

// DELETE /api/pantry/:id
router.delete('/:id', async (req, res) => {
  const result = pantryService.remove(req.user.id, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ ok: true });
});

export default router;
