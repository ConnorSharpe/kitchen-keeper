// Local dev entry point — runs migrations then starts the HTTP server.
// For Vercel, use api/index.js instead.
import './db/migrate.js'; // top-level await suspends until migration completes
import app from './app.js';

app.listen(process.env.PORT || 3001);
