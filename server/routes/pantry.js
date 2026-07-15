import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import * as pantryService from '../services/pantryService.js';

const router = express.Router();
router.use(clerkAuth);

const dateField = z.string().datetime().nullable().optional();

const createSchema = z.object({
  name:            z.string().min(1, 'Name is required').max(200),
  category:        z.string().min(1).max(50).default('Other'),
  quantity:        z.coerce.number().positive().default(1),
  unit:            z.string().min(1).max(50).default('item'),
  purchaseDate:    dateField,
  expiryDate:      dateField,
  readyDate:       dateField,
  storageLocation: z.enum(['pantry', 'refrigerator', 'freezer']).nullable().optional(),
  servingsPerPurchaseUnit: z.coerce.number().min(0.1).max(1000).nullable().optional(),
  notes:           z.string().max(500).nullable().optional(),
});

const updateSchema = createSchema.partial();

// splitQuantity is deliberately not z.coerce'd — TASK-032 Constraint 5 requires rejecting
// NaN/Infinity/non-numeric input explicitly rather than relying on implicit JS coercion.
// splitServings (TASK-033) follows the same rule for the same reason. Exactly one of the two
// must be present — enforced via an explicit .refine(), not an implicit truthy check (Constraint 6).
const splitSchema = z.object({
  splitQuantity:   z.number().finite().positive().optional(),
  splitServings:   z.number().finite().positive().optional(),
  storageLocation: z.enum(['pantry', 'refrigerator', 'freezer']),
}).refine(
  (body) => (body.splitQuantity != null) !== (body.splitServings != null),
  { message: 'Provide exactly one of splitQuantity or splitServings' },
);

// source is 'manual' iff the request body explicitly supplied expiryDate — TASK-031 Decision 1's
// presence-check rule, reusing the same omitted-vs-explicit mechanism TASK-027 established.
function expirySource(body) {
  return 'expiryDate' in body ? 'manual' : 'ai_estimate';
}

function ownershipError(result, res) {
  if (result.status === 'not_found') return res.status(404).json({ error: 'Item not found' });
  if (result.status === 'forbidden')  return res.status(403).json({ error: 'Forbidden' });
  return null;
}

// GET /api/pantry?expiring=7
router.get('/', async (req, res) => {
  const expiringWithin = req.query.expiring != null ? Number(req.query.expiring) : undefined;
  const items = await pantryService.getAll(req.user.householdId, { expiringWithin });
  res.json({ items });
});

// GET /api/pantry/waste-saved?since=ISO_DATE
// Must be before /:id routes to prevent "waste-saved" being captured as :id
router.get('/waste-saved', async (req, res) => {
  const count = await pantryService.getWasteSaved(req.user.householdId, req.query.since);
  res.json({ count });
});

// POST /api/pantry
router.post('/', validate(createSchema), async (req, res) => {
  const item = await pantryService.create(req.user.householdId, req.body, expirySource(req.body));
  res.status(201).json({ item });
});

// POST /api/pantry/bulk
const bulkCreateSchema = z.object({
  items: z.array(createSchema).min(1).max(100),
});

router.post('/bulk', validate(bulkCreateSchema), async (req, res) => {
  const items = await pantryService.bulkCreate(req.user.householdId, req.body.items);
  res.status(201).json({ items });
});

// PATCH /api/pantry/:id
router.patch('/:id', validate(updateSchema), async (req, res) => {
  const result = await pantryService.update(req.user.householdId, Number(req.params.id), req.body);
  if (ownershipError(result, res)) return;
  res.json({ item: result.item });
});

// PATCH /api/pantry/:id/use
router.patch('/:id/use', async (req, res) => {
  const result = await pantryService.markUsed(req.user.householdId, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ ok: true });
});

// PATCH /api/pantry/:id/freeze
router.patch('/:id/freeze', async (req, res) => {
  const result = await pantryService.toggleFreeze(req.user.householdId, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ item: result.item });
});

// POST /api/pantry/:id/split
// 404 covers both "doesn't exist" and "belongs to another household" (not distinguished, per
// TASK-032's API spec); 400 covers "exists and owned, but splitQuantity exceeds quantity".
router.post('/:id/split', validate(splitSchema), async (req, res) => {
  const result = await pantryService.splitItem(req.user.householdId, Number(req.params.id), req.body);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Item not found' });
  if (result.status === 'invalid_quantity') {
    return res.status(400).json({ error: 'Split quantity exceeds available quantity' });
  }
  if (result.status === 'no_servings_configured') {
    return res.status(400).json({ error: 'This item has no servings-per-unit value set' });
  }
  res.json({ original: result.original, created: result.created });
});

// DELETE /api/pantry/:id
router.delete('/:id', async (req, res) => {
  const result = await pantryService.remove(req.user.householdId, Number(req.params.id));
  if (ownershipError(result, res)) return;
  res.json({ ok: true });
});

export default router;
