import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  serial,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const households = pgTable('households', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  conditions: text('conditions').notNull().default('[]'),
  allergies: text('allergies').notNull().default('[]'),
  foodPreferences: text('food_preferences').notNull().default('[]'),
  aiProvider: text('ai_provider'), // deprecated — kept for schema compat; unused after TASK-016B
  aiApiKey: text('ai_api_key'), // deprecated — kept for schema compat; unused after TASK-016B
  clerkUserId: text('clerk_user_id').unique(),
  openaiApiKey: text('openai_api_key'), // AES-256-GCM ciphertext: iv:authTag:encrypted
});

export const pantryItems = pgTable('pantry_items', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull().default('Other'),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('item'),
  purchaseDate: text('purchase_date'),
  expiryDate: text('expiry_date'),
  readyDate: text('ready_date'),
  isFrozen: boolean('is_frozen').notNull().default(false), // deprecated as of TASK-031 — kept for schema compat, use storageLocation === 'freezer' instead
  frozenAt: text('frozen_at'),
  originalExpiryDate: text('original_expiry_date'),
  freezeNotes: text('freeze_notes'),
  storageLocation: text('storage_location'), // 'pantry' | 'refrigerator' | 'freezer' | null
  preFreezeStorageLocation: text('pre_freeze_storage_location'), // snapshotted on freeze, restored+cleared on thaw
  servingsPerPurchaseUnit: real('servings_per_purchase_unit'), // null unless user sets it manually; bounded 0.1-1000 at API layer (TASK-033)
  notes: text('notes'),
  consumedAt: text('consumed_at'),
  wasExpiring: boolean('was_expiring'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const recipes = pgTable('recipes', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  source: text('source'),
  sourceUrl: text('source_url'),
  imageUrl: text('image_url'), // full Vercel Blob URL for uploaded images
  ingredients: text('ingredients').notNull(), // JSON: [{name, quantity, unit}]
  steps: text('steps').notNull(), // JSON: string[]
  servings: integer('servings').default(2),
  prepMins: integer('prep_mins'),
  cookMins: integer('cook_mins'),
  tags: text('tags'), // JSON: string[]
  isFavorite: boolean('is_favorite').notNull().default(false),
  savedAt: text('saved_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const shoppingLists = pgTable('shopping_lists', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Ownership verified via join through shoppingLists — no userId column by design
export const shoppingListItems = pgTable('shopping_list_items', {
  id: serial('id').primaryKey(),
  listId: integer('list_id')
    .notNull()
    .references(() => shoppingLists.id, { onDelete: 'cascade' }),
  ingredientName: text('ingredient_name').notNull(),
  quantity: real('quantity'),
  unit: text('unit'),
  isChecked: boolean('is_checked').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  hasUnitMismatch: boolean('has_unit_mismatch').notNull().default(false),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const householdMembers = pgTable('household_members', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  role: text('role').notNull().default('member'),
  joinedAt: text('joined_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const onboardingFlowEnum = pgEnum('onboarding_flow', [
  'new_household',
  'joined',
]);

export const userOnboarding = pgTable('user_onboarding', {
  clerkUserId: text('clerk_user_id').primaryKey(),
  flow: onboardingFlowEnum('flow').notNull(),
  complete: boolean('complete').notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  metadata: jsonb('metadata'), // { version: 1, recipeSuggestions: [...] } | null
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const recipeBlocklist = pgTable('recipe_blocklist', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), // 'saved' | 'spoonacular' | 'mealdb'
  sourceId: text('source_id').notNull(), // recipes.id (as string) when source='saved'; API's own id otherwise
  name: text('name').notNull(), // display snapshot only — not used for matching
  blockedAt: text('blocked_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey(),
  publicAiAccessEnabled: boolean('public_ai_access_enabled')
    .notNull()
    .default(false),
  aiRateLimitMax: integer('ai_rate_limit_max').notNull().default(20),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedByClerkId: text('updated_by_clerk_id'),
});

export const mealLogs = pgTable('meal_logs', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  pantryItemId: integer('pantry_item_id').references(() => pantryItems.id, {
    onDelete: 'set null',
  }),
  itemName: text('item_name').notNull(),
  category: text('category').notNull().default('Other'),
  purineLevel: text('purine_level').notNull().default('medium'),
  wasExpiring: boolean('was_expiring'),
  quantityBefore: real('quantity_before'),
  quantityAfter: real('quantity_after'),
  loggedAt: text('logged_at').notNull(),
  source: text('source').notNull().default('agent'),
});
