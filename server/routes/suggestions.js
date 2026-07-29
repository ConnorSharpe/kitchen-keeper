import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import { createRateLimiter } from '../middleware/createRateLimiter.js';
import * as suggestionService from '../services/suggestionService.js';

const router = express.Router();
router.use(clerkAuth);

// Authenticated-only endpoint (every caller has a known clerkUserId) — a per-user limit is
// sufficient; no honeypot/CAPTCHA needed, unlike a public-facing form.
const suggestionRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: 'Too many suggestions submitted. Please try again in a bit.',
});

const suggestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

// POST /api/suggestions — fire-and-forget, same response shape as clientErrors.js. Insert failures
// propagate via express-async-errors (see server/app.js) to the standard 500 error handler; no
// try/catch needed here, matching every other route in this codebase.
router.post(
  '/',
  suggestionRateLimit,
  validate(suggestSchema),
  async (req, res) => {
    await suggestionService.submitSuggestion({
      householdId: req.user.householdId,
      clerkUserId: req.user.id,
      message: req.body.message,
    });
    res.status(204).end();
  }
);

export default router;
