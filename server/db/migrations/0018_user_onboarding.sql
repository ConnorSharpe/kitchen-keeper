-- TASK-040 Part A: per-user onboarding state, keyed by Clerk user ID (not household ID) —
-- a household owner lives in households.clerkUserId while a member lives in
-- householdMembers.clerkUserId, so a per-user table avoids that asymmetry.
-- Renumbered 0018 (not 0017) — 0017_platform_settings.sql already occupies that slot on disk
-- (see ai/tasks/TASK-040-spec.md Known Risks re: that file's own missing journal entry).

CREATE TYPE "onboarding_flow" AS ENUM ('new_household', 'joined');
--> statement-breakpoint

CREATE TABLE "user_onboarding" (
  "clerk_user_id" text PRIMARY KEY,
  "flow" "onboarding_flow" NOT NULL,
  "complete" boolean NOT NULL DEFAULT false,
  "created_at" text NOT NULL DEFAULT now()::text,
  "completed_at" text
);
--> statement-breakpoint

COMMENT ON TABLE user_onboarding IS
  'One row per Clerk user, created the moment their household membership is first established '
  '(householdService.createHousehold or joinByCode). Absence of a row means the user predates this '
  'feature - treated as already-onboarded (see onboardingService.getStatus), matching this codebase''s '
  'existing convention of never retroactively onboarding pre-existing users (see 0003_onboarding_complete.sql). '
  'Once complete=true, the row is frozen - flow and completed_at are never rewritten again '
  '(see onboardingService.upsertFlow / markComplete).';
--> statement-breakpoint

COMMENT ON COLUMN user_onboarding.flow IS
  '''new_household'' or ''joined'' - decides which welcome copy shows and whether the staples checklist '
  'step runs. Set at row creation and may be overwritten exactly once while complete=false: a brand-new '
  'signup always auto-creates a disposable household first (clerkAuth -> getOrCreate), so if that same '
  'user then joins a household via a code, joinByCode overwrites flow to ''joined'' after the fact.';

-- Down migration (if needed):
-- DROP TABLE user_onboarding;
-- DROP TYPE onboarding_flow;
