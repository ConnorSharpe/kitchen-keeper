import 'dotenv/config';           // MUST be first — loads .env before anything reads env vars
import 'express-async-errors';    // MUST be before express — patches router at load time
import './db/migrate.js';         // runs synchronously; server won't reach route mounting until DB is migrated
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import authRouter    from './routes/auth.js';
import pantryRouter   from './routes/pantry.js';
import aiRouter       from './routes/ai.js';
import recipesRouter  from './routes/recipes.js';
import shoppingRouter from './routes/shopping.js';

// Validate required env vars at startup — fail fast, not mid-request
const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = express();

// Helmet with permissive img-src — recipe images may come from external domains
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
    }
  }
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Only serve recipe images — receipts are deleted after processing
app.use('/uploads', express.static('uploads'));

app.use('/api/auth',     authRouter);
app.use('/api/pantry',   pantryRouter);
app.use('/api/ai',       aiRouter);
app.use('/api/recipes',  recipesRouter);
app.use('/api/shopping', shoppingRouter);

// Health check — useful for smoke testing and cold-start verification
// If the server is reachable and migrations ran at startup, the DB is connected.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', db: 'connected' });
});

// Global error handler — receives errors from all async routes via express-async-errors
app.use((err, req, res, _next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

app.listen(process.env.PORT || 3001, () =>
  console.log(`🍳 Kitchen Keeper server running on port ${process.env.PORT || 3001}`)
);
