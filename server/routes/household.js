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

  const aiPreview = await householdService.getAiKeyPreview(
    req.user.householdId
  );

  res.json({
    household: {
      id: household.id,
      name: household.name,
      joinCode: household.joinCode,
      maskedKey: aiPreview.maskedKey,
    },
    viewerIsOwner: req.user.id === process.env.OWNER_CLERK_ID,
  });
});

// PATCH /api/household — rename the household. No role check beyond the router's
// existing clerkAuth: any authenticated member may rename it (collaborative metadata,
// not owner-managed configuration — see TASK-040 spec Part B for the full survey of
// this app's permission model backing that decision).
const updateNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

router.patch('/', validate(updateNameSchema), async (req, res) => {
  await householdService.updateName(req.user.householdId, req.body.name);
  res.json({ ok: true });
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

// POST /api/household/invite — send join link via email
const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
});

router.post('/invite', validate(inviteSchema), async (req, res) => {
  const household = await householdService.getById(req.user.householdId);
  if (!household) return res.status(404).json({ error: 'Household not found' });

  await sendHouseholdInvite({
    toEmail: req.body.email,
    householdName: household.name,
    joinCode: household.joinCode,
  });

  res.json({ ok: true });
});

// POST /api/household/join — join an existing household via join code.
// clerkAuth fires getOrCreate, which may create an empty household H1 for brand-new users.
// On success, H1 is deleted and the user becomes a member of the target household.
const joinSchema = z.object({
  code: z.string().min(1),
});

router.post('/join', validate(joinSchema), async (req, res) => {
  const result = await householdService.joinByCode(
    req.user.id,
    req.user.householdId,
    req.body.code
  );
  res.json(result);
});

export default router;
