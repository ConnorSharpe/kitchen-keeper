import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { clerkMiddleware } from '@clerk/express';
import pantryRouter    from './routes/pantry.js';
import aiRouter        from './routes/ai.js';
import transcribeRouter from './routes/transcribe.js';
import recipesRouter   from './routes/recipes.js';
import shoppingRouter  from './routes/shopping.js';
import householdRouter from './routes/household.js';
import pushRouter      from './routes/push.js';
import dietaryRouter   from './routes/dietary.js';

const REQUIRED_ENV = [
  'CLERK_SECRET_KEY',
  'ENCRYPTION_KEY',
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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
    }
  }
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const corsOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/pantry',    pantryRouter);
app.use('/api/ai',        aiRouter);
app.use('/api/ai/transcribe', transcribeRouter);
app.use('/api/recipes',   recipesRouter);
app.use('/api/shopping',  shoppingRouter);
app.use('/api/household', householdRouter);
app.use('/api/push',     pushRouter);
app.use('/api/dietary',  dietaryRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, _next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  const body = { error: message };
  if (err.code) body.code = err.code;
  res.status(status).json(body);
});

export default app;
