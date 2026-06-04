import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import authRouter      from './routes/auth.js';
import pantryRouter    from './routes/pantry.js';
import aiRouter        from './routes/ai.js';
import recipesRouter   from './routes/recipes.js';
import shoppingRouter  from './routes/shopping.js';
import householdRouter from './routes/household.js';

const REQUIRED_ENV = ['GEMINI_API_KEY', 'JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
    }
  }
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Support comma-separated origins so Vercel preview URLs can be added via env var
const corsOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth',      authRouter);
app.use('/api/pantry',    pantryRouter);
app.use('/api/ai',        aiRouter);
app.use('/api/recipes',   recipesRouter);
app.use('/api/shopping',  shoppingRouter);
app.use('/api/household', householdRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler — receives errors from all async routes via express-async-errors
app.use((err, req, res, _next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

export default app;
