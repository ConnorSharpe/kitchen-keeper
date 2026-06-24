-- Phase B: set NOT NULL and drop old user_id column.
-- Apply ONLY after Phase A is deployed and verified (null check must return 0).
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM push_subscriptions WHERE household_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'Rows with NULL household_id exist — resolve before applying NOT NULL';
  END IF;
END $$;

ALTER TABLE push_subscriptions ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE push_subscriptions DROP COLUMN user_id;
