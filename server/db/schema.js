import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name:         text('name').notNull(),
  createdAt:    text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:    text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const pantryItems = sqliteTable('pantry_items', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  userId:             integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  category:           text('category').notNull().default('Other'),
  quantity:           real('quantity').notNull().default(1),
  unit:               text('unit').notNull().default('item'),
  purchaseDate:       text('purchase_date'),
  expiryDate:         text('expiry_date'),
  isFrozen:           integer('is_frozen', { mode: 'boolean' }).notNull().default(false),
  frozenAt:           text('frozen_at'),
  originalExpiryDate: text('original_expiry_date'),
  freezeNotes:        text('freeze_notes'),   // AI-generated storage tip; static fallback from freezeDefaults.js
  notes:              text('notes'),
  consumedAt:         text('consumed_at'),     // set by PATCH /:id/use
  wasExpiring:        integer('was_expiring', { mode: 'boolean' }), // true if ≤7 days at time of use; drives waste-saved counter
  createdAt:          text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:          text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const recipes = sqliteTable('recipes', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  userId:      integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  description: text('description'),
  source:      text('source'),      // 'upload' | 'ai_suggested' | 'web_suggested' | 'manual'
  sourceUrl:   text('source_url'),
  imageUrl:    text('image_url'),   // relative path under /uploads
  ingredients: text('ingredients').notNull(), // JSON: [{name, quantity, unit}]
  steps:       text('steps').notNull(),       // JSON: string[]
  servings:    integer('servings').default(2),
  prepMins:    integer('prep_mins'),
  cookMins:    integer('cook_mins'),
  tags:        text('tags'),         // JSON: string[]
  isFavorite:  integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  savedAt:     text('saved_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:   text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const shoppingLists = sqliteTable('shopping_lists', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// No userId here — ownership is verified via join through shoppingLists (Phase 8 spec requirement)
export const shoppingListItems = sqliteTable('shopping_list_items', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  listId:         integer('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  ingredientName: text('ingredient_name').notNull(),
  quantity:       real('quantity'),
  unit:           text('unit'),
  isChecked:      integer('is_checked', { mode: 'boolean' }).notNull().default(false),
  sortOrder:      integer('sort_order').notNull().default(0),
});

export const chatMessages = sqliteTable('chat_messages', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(), // 'user' | 'assistant'
  content:   text('content').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
