import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import * as platformSettingsService from '../services/platformSettingsService.js';

const router = express.Router();
router.use(clerkAuth);

function requireOwner(req, res, next) {
  if (req.user.id !== process.env.OWNER_CLERK_ID) {
    const err = new Error('Owner access required');
    err.status = 403;
    return next(err);
  }
  next();
}

router.get('/platform-settings', requireOwner, async (_req, res) => {
  const settings = await platformSettingsService.getPlatformSettings();
  res.json(settings);
});

const patchSchema = z
  .object({
    publicAiAccessEnabled: z.boolean().optional(),
    aiRateLimitMax: z.number().int().min(1).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

router.patch(
  '/platform-settings',
  requireOwner,
  validate(patchSchema),
  async (req, res) => {
    const settings = await platformSettingsService.setPlatformSettings(
      req.body,
      req.user.id
    );
    res.json(settings);
  }
);

export default router;
