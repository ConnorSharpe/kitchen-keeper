import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as dietaryService from '../services/dietaryService.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/dietary
router.get('/', async (req, res) => {
  const profile = await dietaryService.getProfile(req.user.householdId);
  const { conditions = [], allergies = [], foodPreferences = [] } = profile ?? {};
  res.json({ conditions, allergies, foodPreferences });
});

// PATCH /api/dietary
const patchDietarySchema = z.object({
  conditions:       z.array(z.string().min(1).max(100)).max(20).optional(),
  allergies:        z.array(z.string().min(1).max(100)).max(20).optional(),
  foodPreferences:  z.array(z.string().min(1).max(100)).max(20).optional(),
});

router.patch('/', validate(patchDietarySchema), async (req, res) => {
  await dietaryService.updateProfile(req.user.householdId, req.body);
  res.json({ ok: true });
});

export default router;
