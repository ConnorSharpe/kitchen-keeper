-- Migration 0017: Add platform_settings — single-row config table for the
-- public AI access toggle and rate-limit tuning (TASK-037). Apply manually
-- in Neon SQL Editor. Deploy AFTER this migration, not before — server code
-- in this task queries this table on every AI request (through a 5s cache);
-- deploying first would 500 every AI call.
--
-- Singleton enforcement: PRIMARY KEY(id) + CHECK(id = 1) together are
-- sufficient — any insert with id != 1 violates the CHECK, and any insert
-- with id = 1 once the seed row exists violates the PRIMARY KEY's uniqueness.
-- No second row is possible. See this task's Verification Steps for a live
-- check that proves this.

CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_ai_access_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_rate_limit_max INTEGER NOT NULL DEFAULT 20,
  updated_at TEXT NOT NULL,
  updated_by_clerk_id TEXT
);

-- Seed the single settings row. Starts disabled — today's "BYOK required for
-- everyone but the owner" behavior is unchanged until the owner explicitly
-- flips this via the new admin toggle.
INSERT INTO platform_settings (id, public_ai_access_enabled, ai_rate_limit_max, updated_at)
VALUES (1, false, 20, now()::text);

-- Verify after applying:
-- SELECT * FROM platform_settings;
-- This should fail (violates CHECK(id = 1)):
-- INSERT INTO platform_settings (id, public_ai_access_enabled, updated_at) VALUES (2, true, now()::text);
