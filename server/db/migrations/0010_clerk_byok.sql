-- Migration 0010: Add Clerk identity and encrypted OpenAI BYOK key columns
-- Apply manually in Neon SQL Editor. Deploy AFTER this migration, not before.

ALTER TABLE households ADD COLUMN clerk_user_id TEXT UNIQUE;
ALTER TABLE households ADD COLUMN openai_api_key TEXT;   -- AES-256-GCM ciphertext: iv:authTag:encrypted

-- After Clerk setup: link Connor's existing household to his Clerk user ID
-- UPDATE households SET clerk_user_id = '<connor-clerk-user-id>' WHERE id = '<existing-household-id>';

-- Set OWNER_CLERK_ID in Vercel env vars to Connor's Clerk user ID.
-- IMPORTANT: this env var is the ONLY way to grant platform-key access.
-- If OWNER_CLERK_ID is not set before deployment, Connor's household will
-- receive NO_API_KEY errors from all AI endpoints.

-- Verify after applying:
SELECT id, clerk_user_id FROM households;
-- openai_api_key values should look like: hex:hex:hex (not plaintext)
SELECT openai_api_key FROM households WHERE openai_api_key IS NOT NULL;
