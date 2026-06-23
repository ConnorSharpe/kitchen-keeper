-- Add metadata column to chat_messages (nullable JSONB; old rows remain NULL)
ALTER TABLE chat_messages
  ADD COLUMN metadata JSONB;

-- Check for duplicate recipes before adding constraint:
-- SELECT household_id, name, COUNT(*) FROM recipes GROUP BY household_id, name HAVING COUNT(*) > 1;
-- Must return 0 rows. Deduplicate if needed before applying.

-- Add unique constraint to recipes (enables safe re-save of history-loaded cards)
ALTER TABLE recipes
  ADD CONSTRAINT recipes_household_name_unique UNIQUE (household_id, name);

-- Down migration (if needed):
-- ALTER TABLE recipes DROP CONSTRAINT recipes_household_name_unique;
-- ALTER TABLE chat_messages DROP COLUMN metadata;
