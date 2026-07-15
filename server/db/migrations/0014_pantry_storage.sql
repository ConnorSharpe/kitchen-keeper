-- TASK-031: pantry storage location + FoodKeeper-driven expiry.
-- Additive only — storage_location/pre_freeze_storage_location are nullable, no general backfill.
-- Assumes existing freeze-related data is internally consistent (no isFrozen=false row with a
-- non-null originalExpiryDate) — not verified or repaired by this migration itself.
-- IF NOT EXISTS + statement-breakpoints: this file was hand-applied directly in Neon's SQL Editor
-- (this repo's established practice), but server/db/migrate.js still runs drizzle's migrator on
-- every server boot — it must be able to safely re-attempt this file afterward as a no-op.

ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS storage_location text
  CHECK (storage_location IN ('pantry', 'refrigerator', 'freezer'));
--> statement-breakpoint
ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS pre_freeze_storage_location text
  CHECK (pre_freeze_storage_location IN ('pantry', 'refrigerator', 'freezer'));
--> statement-breakpoint
-- Narrow, fully-determined backfill: an already-frozen item must show as frozen post-migration.
-- Safe to re-run: re-setting already-'freezer' rows to 'freezer' is a no-op.
UPDATE pantry_items SET storage_location = 'freezer' WHERE is_frozen = true;

-- Down migration (if needed):
-- ALTER TABLE pantry_items DROP COLUMN storage_location;
-- ALTER TABLE pantry_items DROP COLUMN pre_freeze_storage_location;
