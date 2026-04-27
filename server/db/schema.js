import { pgTable, text, integer, real, boolean, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id:           serial('id').primaryKey(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name:         text('name').notNull(),
  createdAt:    text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:    text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const pantryItems = pgTable('pantry_items', {
  id:                 serial('id').primaryKey(),
  userId:             integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  category:           text('category').notNull().default('Other'),
  quantity:           real('quantity').notNull().default(1),
  unit:               text('unit').notNull().default('item'),
  purchaseDate:       text('purchase_date'),
  expiryDate:         text('expiry_date'),
  isFrozen:           boolean('is_frozen').notNull().default(false),
  frozenAt:           text('frozen_at'),
  originalExpiryDate: text('original_expiry_date'),
  freezeNotes:        text('freeze_notes'),
  notes:              text('notes'),
  consumedAt:         text('consumed_at'),
  wasExpiring:        boolean('was_expiring'),
  createdAt:          text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:          text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const recipes = pgTable('recipes', {
  id:          serial('id').primaryKey(),
  userId:      integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  description: text('description'),
  source:      text('source'),
  sourceUrl:   text('source_url'),
  imageUrl:    text('image_url'),   // full Vercel Blob URL for uploaded images
  ingredients: text('ingredients').notNull(), // JSON: [{name, quantity, unit}]
  steps:       text('steps').notNull(),       // JSON: string[]
  servings:    integer('servings').default(2),
  prepMins:    integer('prep_mins'),
  cookMins:    integer('cook_mins'),
  tags:        text('tags'),                  // JSON: string[]
  isFavorite:  boolean('is_favorite').notNull().default(false),
  savedAt:     text('saved_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:   text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const shoppingLists = pgTable('shopping_lists', {
  id:        serial('id').primaryKey(),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Ownership verified via join through shoppingLists — no userId column by design
export const shoppingListItems = pgTable('shopping_list_items', {
  id:              serial('id').primaryKey(),
  listId:          integer('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  ingredientName:  text('ingredient_name').notNull(),
  quantity:        real('quantity'),
  unit:            text('unit'),
  isChecked:       boolean('is_checked').notNull().default(false),
  sortOrder:       integer('sort_order').notNull().default(0),
  hasUnitMismatch: boolean('has_unit_mismatch').notNull().default(false),
});

export const chatMessages = pgTable('chat_messages', {
  id:        serial('id').primaryKey(),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(), // 'user' | 'assistant'
  content:   text('content').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
