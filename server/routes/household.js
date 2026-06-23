import express from 'express';
import { z } from 'zod';
import * as householdService from '../services/householdService.js';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import { sendHouseholdInvite } from '../services/emailService.js';
import { maskKey } from '../utils/keyEncryption.js';

const router = express.Router();
router.use(clerkAuth);

// GET /api/household — household info + join code + AI key preview
router.get('/', async (req, res) => {
  const household = await householdService.getById(req.user.householdId);
  if (!household) return res.status(404).json({ error: 'Household not found' });

  const aiPreview = await householdService.getAiKeyPreview(req.user.householdId);

  res.json({
    household: {
      id:        household.id,
      name:      household.name,
      joinCode:  household.joinCode,
      maskedKey: aiPreview.maskedKey,
    },
  });
});

// PATCH /api/household/ai-key — set or remove BYOK OpenAI key
const aiKeySchema = z.object({
  key: z.string().min(1).nullable(),
});

router.patch('/ai-key', validate(aiKeySchema), async (req, res) => {
  const { key } = req.body;

  if (key === null) {
    await householdService.removeAiApiKey(req.user.householdId);
    return res.json({ maskedKey: null });
  }

  await householdService.setAiApiKey(req.user.householdId, key);
  res.json({ maskedKey: maskKey(key) });
});

// GET /api/household/members — all users in this household
router.get('/members', async (req, res) => {
  const members = await householdService.getMembers(req.user.householdId);
  res.json({ members });
});

// POST /api/household/invite — send join code via email
const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
});

router.post('/invite', validate(inviteSchema), async (req, res) => {
  const household = await householdService.getById(req.user.householdId);
  if (!household) return res.status(404).json({ error: 'Household not found' });

  await sendHouseholdInvite({
    toEmail:       req.body.email,
    fromName:      req.user.name,
    householdName: household.name,
    joinCode:      household.joinCode,
  });

  res.json({ ok: true });
});

export default router;
