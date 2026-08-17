import 'dotenv/config';
import { captureExceptionSafely, flush } from './instrument.js';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { clerkMiddleware } from '@clerk/express';
import pantryRouter from './routes/pantry.js';
import aiRouter from './routes/ai.js';
import transcribeRouter from './routes/transcribe.js';
import recipesRouter from './routes/recipes.js';
import shoppingRouter from './routes/shopping.js';
import householdRouter from './routes/household.js';
import pushRouter from './routes/push.js';
import dietaryRouter from './routes/dietary.js';
import adminRouter from './routes/admin.js';
import onboardingRouter from './routes/onboarding.js';
import clientErrorsRouter from './routes/clientErrors.js';
import suggestionsRouter from './routes/suggestions.js';

const REQUIRED_ENV = [
  'CLERK_SECRET_KEY',
  'OWNER_CLERK_ID',
  'OPENAI_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = express();

app.use(clerkMiddleware());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const corsOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/pantry', pantryRouter);
app.use('/api/ai', aiRouter);
app.use('/api/ai/transcribe', transcribeRouter);
app.use('/api/recipes', recipesRouter);
app.use('/api/shopping', shoppingRouter);
app.use('/api/household', householdRouter);
app.use('/api/push', pushRouter);
app.use('/api/dietary', dietaryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/client-errors', clientErrorsRouter);
app.use('/api/suggestions', suggestionsRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// TEMPORARY — TASK-068 spec §6 step I (N=10 serverless burst delivery test). Reverted immediately
// after use. Accepts an index so each of the 10 requests produces a distinguishable event.
app.get('/api/__task068_burst_test/:n', (req) => {
  throw new Error(`TASK-068 burst test event ${req.params.n}/10`);
});

app.use(async (err, req, res, _next) => {
  console.error(err.stack);
  captureExceptionSafely(err);
  // Bounded wait so an already-degraded error response doesn't incur unbounded extra latency —
  // see instrument.js's flush() for why this call exists here, not inside captureExceptionSafely().
  await flush(2000);
  const status = err.status || 500;
  const message = (err.expose || status < 500) ? err.message : 'Internal server error';
  const body = { error: message };
  if (err.code) body.code = err.code;
  res.status(status).json(body);
});

export default app;
