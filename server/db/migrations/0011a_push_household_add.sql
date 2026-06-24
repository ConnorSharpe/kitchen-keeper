-- Phase A: add nullable household_id column and backfill from users table.
-- Deploy new application code AFTER this migration, before applying Phase B.
ALTER TABLE push_subscriptions
  ADD COLUMN household_id INTEGER REFERENCES households(id) ON DELETE CASCADE;

UPDATE push_subscriptions ps
SET household_id = u.household_id
FROM users u
WHERE u.id = ps.user_id;

-- Pre-finalization check (run manually before applying Phase B):
-- SELECT COUNT(*) FROM push_subscriptions WHERE household_id IS NULL;
-- If non-zero, orphaned rows exist: DELETE FROM push_subscriptions WHERE household_id IS NULL;
