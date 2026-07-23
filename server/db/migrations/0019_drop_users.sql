-- TASK-040 Part E: drop the vestigial pre-Clerk `users` table (passwordHash,
-- onboardingComplete) — confirmed zero references anywhere in server/ (from(users)/
-- insert(users)/update(users)), superseded by user_onboarding (0018) + Clerk auth.

DROP TABLE "users";
