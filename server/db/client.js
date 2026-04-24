import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path so this works regardless of process CWD (server/ vs project root)
const DB_PATH = path.join(__dirname, '../../kitchen-keeper.db');

const sqlite = new Database(DB_PATH);

// WAL mode: allows concurrent reads while a write is in progress
sqlite.pragma('journal_mode = WAL');

// Enforce FK constraints — SQLite disables them by default
sqlite.pragma('foreign_keys = ON');

// Schema passed to drizzle enables relational query mode for future use
export const db = drizzle(sqlite, { schema });
