import express from 'express';
import { z } from 'zod';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { validate } from '../middleware/validate.js';
import { generateRequestId } from '../utils/requestId.js';

const router = express.Router();
router.use(clerkAuth);

const reportSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  // Informational only — bounded, never parsed or relied on for logic.
  userAgent: z.string().max(500).optional(),
});

// POST /api/client-errors — fire-and-forget report from ErrorBoundary.componentDidCatch.
router.post('/', validate(reportSchema), async (req, res) => {
  const requestId = generateRequestId(); // matches household.js's /members convention
  // Vercel auto-populates this for Git-connected deployments, but whether it's
  // actually exposed to the runtime depends on the project's "Automatically
  // expose System Environment Variables" setting — falls back to 'unknown'
  // rather than breaking the log line if absent.
  const deploy = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown';
  console.error(
    `[kitchen-keeper] request_id=${requestId} client_error deploy=${deploy} ` +
      `householdId=${req.user.householdId} userId=${req.user.id} url=${req.body.url ?? 'n/a'} ` +
      `message=${req.body.message}\n` +
      `componentStack=${req.body.componentStack ?? 'n/a'}\nstack=${req.body.stack ?? 'n/a'}`
  );
  res.status(204).end();
});

export default router;
