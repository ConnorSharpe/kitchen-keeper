-- TASK-033: servings-per-purchase-unit tracking (conversion metadata only, never replaces quantity).
-- Additive only — nullable, no backfill (manual-only field, never inferred).
-- IF NOT EXISTS + statement-breakpoint: hand-applied directly in Neon's SQL Editor (this repo's
-- established practice), but server/db/migrate.js still runs drizzle's migrator on every server
-- boot — it must be able to safely re-attempt this file afterward as a no-op.

ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS servings_per_purchase_unit real;

-- Down migration (if needed):
-- ALTER TABLE pantry_items DROP COLUMN servings_per_purchase_unit;
