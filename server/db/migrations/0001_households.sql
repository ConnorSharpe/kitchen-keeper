-- Migration: introduce households table and re-scope all data from user → household
-- Run this in the Neon SQL Editor (drizzle migrate is incompatible with neon-http driver).

-- 1. Create households table
CREATE TABLE "households" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "join_code" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "households_join_code_unique" UNIQUE("join_code")
);

-- 2. Add household_id column to users (nullable until data is backfilled)
ALTER TABLE "users" ADD COLUMN "household_id" integer REFERENCES "households"("id");

-- 3. For each existing user create a dedicated household and link them
DO $$
DECLARE
  u RECORD;
  h_id integer;
BEGIN
  FOR u IN SELECT id, name, created_at FROM users LOOP
    INSERT INTO households (name, join_code, created_at)
    VALUES (
      u.name || '''s Household',
      upper(substring(md5(random()::text) from 1 for 8)),
      u.created_at
    )
    RETURNING id INTO h_id;

    UPDATE users SET household_id = h_id WHERE id = u.id;
  END LOOP;
END $$;

-- 4. Make users.household_id NOT NULL now that every user has one
ALTER TABLE "users" ALTER COLUMN "household_id" SET NOT NULL;

-- 5. Migrate pantry_items: add household_id, back-fill from users, drop user_id
ALTER TABLE "pantry_items" ADD COLUMN "household_id" integer;
UPDATE "pantry_items"
  SET "household_id" = (SELECT "household_id" FROM "users" WHERE "users"."id" = "pantry_items"."user_id");
ALTER TABLE "pantry_items" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "pantry_items"
  ADD CONSTRAINT "pantry_items_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;
ALTER TABLE "pantry_items" DROP CONSTRAINT "pantry_items_user_id_users_id_fk";
ALTER TABLE "pantry_items" DROP COLUMN "user_id";

-- 6. Migrate recipes
ALTER TABLE "recipes" ADD COLUMN "household_id" integer;
UPDATE "recipes"
  SET "household_id" = (SELECT "household_id" FROM "users" WHERE "users"."id" = "recipes"."user_id");
ALTER TABLE "recipes" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;
ALTER TABLE "recipes" DROP CONSTRAINT "recipes_user_id_users_id_fk";
ALTER TABLE "recipes" DROP COLUMN "user_id";

-- 7. Migrate shopping_lists
ALTER TABLE "shopping_lists" ADD COLUMN "household_id" integer;
UPDATE "shopping_lists"
  SET "household_id" = (SELECT "household_id" FROM "users" WHERE "users"."id" = "shopping_lists"."user_id");
ALTER TABLE "shopping_lists" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "shopping_lists"
  ADD CONSTRAINT "shopping_lists_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;
ALTER TABLE "shopping_lists" DROP CONSTRAINT "shopping_lists_user_id_users_id_fk";
ALTER TABLE "shopping_lists" DROP COLUMN "user_id";

-- 8. Migrate chat_messages
ALTER TABLE "chat_messages" ADD COLUMN "household_id" integer;
UPDATE "chat_messages"
  SET "household_id" = (SELECT "household_id" FROM "users" WHERE "users"."id" = "chat_messages"."user_id");
ALTER TABLE "chat_messages" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_user_id_users_id_fk";
ALTER TABLE "chat_messages" DROP COLUMN "user_id";
