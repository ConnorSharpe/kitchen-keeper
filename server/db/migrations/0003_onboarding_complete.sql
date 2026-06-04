ALTER TABLE "users"
  ADD COLUMN "onboarding_complete" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN users.onboarding_complete IS
  'TRUE = onboarding completed or skipped (modal never shows). '
  'FALSE = show staples checklist on first pantry visit. '
  'New registrations set FALSE explicitly — DEFAULT TRUE protects existing rows only. '
  'Any new user creation path MUST also set this to FALSE.';
