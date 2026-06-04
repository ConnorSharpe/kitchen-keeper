import express from 'express';
import { z } from 'zod';
import * as householdService from '../services/householdService.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendHouseholdInvite } from '../services/emailService.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/household — household info + join code
router.get('/', async (req, res) => {
  const household = await householdService.getById(req.user.householdId);
  if (!household) return res.status(404).json({ error: 'Household not found' });

  res.json({
    household: {
      id:       household.id,
      name:     household.name,
      joinCode: household.joinCode,
    },
  });
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
