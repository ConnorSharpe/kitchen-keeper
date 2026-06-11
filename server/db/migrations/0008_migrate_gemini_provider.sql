-- TASK-014: NULL out any rows where ai_provider = 'gemini'.
-- Gemini BYOK is removed; these keys are invalid post-migration.
-- NULL resolves to the platform Groq default in resolveProvider.
--
-- Apply manually in Neon SQL Editor BEFORE deploying the application.
-- DO NOT run via node server/db/migrate.js against production.
--
-- Verify after applying:
--   SELECT count(*) FROM households WHERE ai_provider = 'gemini';
--   -- must return 0

UPDATE households
SET ai_provider = NULL,
    ai_api_key  = NULL
WHERE ai_provider = 'gemini';
