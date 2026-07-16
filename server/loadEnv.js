// Loads server/.env.local explicitly (not the default root .env) — the per-service secrets file.
// Must be imported first in index.js, before db/migrate.js or db/client.js read process.env.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local'),
});
