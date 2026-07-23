import express from 'express';
import { z } from 'zod';
import * as onboardingService from '../services/onboardingService.js';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();
router.use(clerkAuth);

// GET /api/onboarding — { complete, flow }
router.get('/', async (req, res) => {
  const status = await onboardingService.getStatus(req.user.id);
  res.json(status);
});

// PATCH /api/onboarding — mark complete (only transition this route allows)
const completeSchema = z.object({ complete: z.literal(true) });
router.patch('/', validate(completeSchema), async (req, res) => {
  await onboardingService.markComplete(req.user.id);
  res.json({ complete: true });
});

export default router;
