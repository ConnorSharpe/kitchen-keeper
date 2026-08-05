-- TASK-051: remove BYOK (bring-your-own-key) entirely. The platform key
-- (OPENAI_API_KEY) is now the only key the app ever uses; access is gated by
-- the publicAiAccessEnabled toggle (server/middleware/requireAiAccess.js),
-- not per-household keys. Apply manually in Neon SQL Editor.

-- MANDATORY pre-flight check — run this first and confirm the result is empty.
-- If any rows are returned, STOP and tell Connor which household(s) have a
-- stored key before proceeding — this migration is destructive and BYOK is
-- being deleted entirely, not archived.
SELECT id, clerk_user_id FROM households WHERE openai_api_key IS NOT NULL;

-- Only run once the query above returns zero rows.
ALTER TABLE households DROP COLUMN openai_api_key;
