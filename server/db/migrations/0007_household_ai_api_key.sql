-- Forward migration
ALTER TABLE households ADD COLUMN ai_provider TEXT;
ALTER TABLE households ADD COLUMN ai_api_key TEXT;

-- Rollback (run manually if needed — do NOT run automatically)
-- ALTER TABLE households DROP COLUMN ai_api_key;
-- ALTER TABLE households DROP COLUMN ai_provider;
