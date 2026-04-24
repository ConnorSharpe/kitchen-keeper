import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import { db } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs synchronously at import time — server will not reach route mounting until this completes
migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
