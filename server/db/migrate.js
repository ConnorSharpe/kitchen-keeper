import { migrate } from 'drizzle-orm/neon-http/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import { db } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Top-level await: importing modules wait for migration to finish before continuing
await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
