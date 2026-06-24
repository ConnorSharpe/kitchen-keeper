-- Apply this migration BEFORE deploying application code that references household_members.
CREATE TABLE household_members (
  id            SERIAL PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'member',
  joined_at     TEXT NOT NULL
);

-- No seed of existing owners — owners are resolved via households.clerk_user_id
