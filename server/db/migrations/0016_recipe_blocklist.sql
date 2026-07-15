-- TASK-034 Part D: user-editable "do not suggest" blocklist.
-- New, empty table — no backfill (no prior "do not suggest" state anywhere in this codebase).
-- IF NOT EXISTS + statement-breakpoint: hand-applied directly in Neon's SQL Editor (this repo's
-- established practice), but server/db/migrate.js still runs drizzle's migrator on every server
-- boot — it must be able to safely re-attempt this file afterward as a no-op.

CREATE TABLE IF NOT EXISTS recipe_blocklist (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  blocked_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
--> statement-breakpoint
-- Plain ADD CONSTRAINT has no IF NOT EXISTS form in Postgres — guarded via pg_constraint so this
-- file is a safe no-op if drizzle's migrator re-attempts it after a hand-apply (see note above).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipe_blocklist_unique'
  ) THEN
    ALTER TABLE recipe_blocklist
      ADD CONSTRAINT recipe_blocklist_unique UNIQUE (household_id, source, source_id);
  END IF;
END $$;

-- Down migration (if needed):
-- DROP TABLE recipe_blocklist;
