-- TASK-047: private, owner-only "suggest an improvement" feedback box.
-- New, empty table — no backfill. IF NOT EXISTS + statement-breakpoint, hand-applied directly in
-- Neon's SQL Editor (staging first, then production per CONVENTIONS.md's canonical migration order),
-- but server/db/migrate.js still runs drizzle's migrator on every server boot — must be a safe no-op
-- if re-attempted afterward.

CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_suggestions_clerk_user_id ON suggestions (clerk_user_id);

-- Down migration (if needed):
-- DROP TABLE suggestions;
