CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "pantry_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "category" text DEFAULT 'Other' NOT NULL,
  "quantity" real DEFAULT 1 NOT NULL,
  "unit" text DEFAULT 'item' NOT NULL,
  "purchase_date" text,
  "expiry_date" text,
  "is_frozen" boolean DEFAULT false NOT NULL,
  "frozen_at" text,
  "original_expiry_date" text,
  "freeze_notes" text,
  "notes" text,
  "consumed_at" text,
  "was_expiring" boolean,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "recipes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "source" text,
  "source_url" text,
  "image_url" text,
  "ingredients" text NOT NULL,
  "steps" text NOT NULL,
  "servings" integer DEFAULT 2,
  "prep_mins" integer,
  "cook_mins" integer,
  "tags" text,
  "is_favorite" boolean DEFAULT false NOT NULL,
  "saved_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "shopping_lists" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "shopping_list_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "list_id" integer NOT NULL,
  "ingredient_name" text NOT NULL,
  "quantity" real,
  "unit" text,
  "is_checked" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "has_unit_mismatch" boolean DEFAULT false NOT NULL
);

CREATE TABLE "chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" text NOT NULL
);

ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "shopping_lists"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
