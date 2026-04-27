import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

// DATABASE_URL is set by Vercel (Neon integration) or manually in .env for local dev
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
