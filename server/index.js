// Local dev entry point — runs migrations then starts the HTTP server.
// For Vercel, use api/index.js instead.
import './loadEnv.js'; // must be first — loads env before db/migrate.js and db/client.js read process.env
import './db/migrate.js'; // top-level await suspends until migration completes
import app from './app.js';

app.listen(process.env.PORT || 3001);
