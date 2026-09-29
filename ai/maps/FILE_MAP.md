# File Map

Logical map; consult before searching. Paths are relative to the repo root.

# Deploy / entry
ENTRY:  api/index.js (Vercel), server/index.js (local), server/app.js (Express app, route mounting)
CONFIG: vercel.json (rewrites, cron, maxDuration), drizzle.config.js, .env.example, server/loadEnv.js
OBS:    server/instrument.js, client/src/instrument.js (Sentry)

# Database
SCHEMA:     server/db/schema.js
CLIENT:     server/db/client.js (neon-http drizzle instance)
MIGRATIONS: server/db/migrations/*.sql, server/db/migrations/meta/_journal.json, server/db/migrate.js
LEDGER:     ai/migrations/MIGRATION_LEDGER.md

# Auth / tenancy / access
CORE:   server/middleware/clerkAuth.js, server/services/householdService.js
AI GATE: server/middleware/requireAiAccess.js, server/middleware/aiRateLimit.js,
         server/services/platformSettingsService.js
TESTS:  server/middleware/*.test.js

# AI chat agent
ROUTE:    server/routes/ai.js (POST /chat, GET /chat/history, plus single-shot AI routes)
CORE:     server/services/aiService.js (chat(), PANTRY_TOOLS, context caps, structured-output helpers)
PROVIDER: server/services/ai/providerInterface.js, openaiProvider.js, resolveProvider.js
TOOLS:    server/services/chat/createToolHandlers.js, server/services/chat/handlers/*.js
HISTORY:  server/services/chatService.js
CONTEXT:  server/services/dietaryService.js
TESTS:    server/services/aiService.contextCap.test.js, aiService.schemas.test.js
CLIENT:   client/src/pages/ChatPage.jsx, client/src/components/chat/*, client/src/api/index.js (NDJSON)

# Pantry
ROUTE: server/routes/pantry.js
CORE:  server/services/pantryService.js, shelfLifeService.js, server/utils/freezeDefaults.js
SHARED: shared/expiry.js, shared/pantryDefaults.js, shared/pantryCategories.js
TESTS: server/services/pantryService.test.js, shared/*.test.js
CLIENT: client/src/pages/PantryPage.jsx, client/src/components/pantry/*, hooks/usePantry.js

# Recipes
ROUTE: server/routes/recipes.js
CORE:  server/services/recipeService.js, recipeSearchService.js (Spoonacular/MealDB + scoring),
       recipeUrlImportService.js, recipeBlocklistService.js, server/utils/recipeScorer.js
FOOD:  server/utils/foodNormalization.js (normalizeFood, foodsMatch)
TESTS: server/services/recipeService.test.js, recipeUrlImportService.test.js, server/utils/*.test.js
CLIENT: client/src/pages/RecipesPage.jsx, client/src/components/recipes/*

# Meal logs
CORE: server/services/mealLogService.js (written by consume_pantry_item)

# Shopping / household / onboarding / push / feedback
ROUTES: server/routes/shopping.js, household.js, onboarding.js, push.js, suggestions.js, dietary.js
CORE:   server/services/shoppingService.js, householdService.js, onboardingService.js,
        pushService.js, suggestionService.js, dietaryService.js

# Client shell
ENTRY: client/src/main.jsx, client/src/App.jsx
STATE: client/src/context/AuthContext.jsx, PantryContext.jsx
LIB:   client/src/lib/* (auth transition, routing, telemetry)

# Process docs
ai/handoffs/CURRENT_STATE.md, ai/handoffs/CONVENTIONS.md, ai/tasks/TASK-*-spec.md
