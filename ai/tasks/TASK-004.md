# TASK-004 — Chat Tool-Calling: Add to Pantry via Conversation

Version: DRAFT-3 — IMPLEMENTATION-READY
Status: Approved by architect (2 review rounds). Ready to implement.

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not ready | Initial design — 3 must-fixes, 4 should-fixes |
| DRAFT-2 | Approved with minor revisions | Must-fixes applied: multi-item determinism, server-side expiry, empty-reply handling; should-fixes applied |
| DRAFT-3 | Approved | Minor #1: UTC-midnight normalization aligned; Minor #2: loop-exhaustion behavior specified; nice-improvements incorporated |

---

# Goal

Enable the AI chat assistant to add items to the household pantry mid-conversation
via Gemini function-calling. The user says something like:

> "add leftover pad thai, 2 servings, good for 3 days"

Gemini calls `add_pantry_item`, the server executes the DB write, Gemini confirms in
natural language, and the client shows a subtle "Added to pantry" indicator.

No modal. No client-side confirmation step. One conversational turn.

---

# Allowed Files

- `server/services/aiService.js`
- `server/routes/ai.js`
- `client/src/pages/ChatPage.jsx`

---

# Forbidden Files

- `server/db/schema.js` — no schema migration required
- `server/services/pantryService.js` — no changes; called from route, not from aiService
- `server/services/chatService.js` — no changes
- `server/services/householdService.js`
- `server/routes/auth.js`
- `server/routes/household.js`
- All other client pages and components

---

# Constraints

1. **aiService.js must remain free of direct DB / service imports.**
   Tool execution happens in the route. aiService receives a `toolHandlers` callback map.

2. **No schema migration.** All fields map to existing `pantryItems` columns.

3. **No client-side confirmation flow.** Gemini's natural-language reply is the
   confirmation. A lightweight "Added to pantry" chip in the UI is sufficient.

4. **Scope: `add_pantry_item` only.** `remove_pantry_item`, `update_pantry_item`, and
   `mark_item_used` are deferred — item identification for those operations introduces
   ambiguity that warrants a separate task.

5. **Preserve the existing chat route response contract as a superset:**
   `{ reply: string }` → `{ reply: string, itemsAdded: PantryItem[] }`.
   The client handles an empty `itemsAdded` array when no tool was called.

6. **Gemini model stays `gemini-2.0-flash`.** No model change.

7. **Zod validation on all AI-provided tool args** before any DB write. Invalid args
   return an error `functionResponse` so Gemini can recover gracefully without a 500.

8. **Dispatch loop MUST terminate after a maximum of 5 tool-response cycles.**
   This is a hard requirement. The guard must be in code. Loop-exhaustion behavior
   is explicitly specified — see section 1e.

9. **Expiry date computation is server-side only.**
   The tool schema accepts `shelfLifeDays` (integer, ≥ 0) — not an ISO date string.
   The route converts it to UTC midnight ISO using the same day-granularity logic as
   `server/utils/expiry.js`. The model never produces date strings.

10. **Pantry summary is always rebuilt from DB at the start of each request.**
    This is already how the route works (`pantryService.getAll` on every POST /api/ai/chat).
    After a tool-call adds an item, the very next chat turn will include that item in
    the pantry context. No additional state management is required.

---

# Dependency Chain

Editing:
- `server/services/aiService.js`
- `server/routes/ai.js`
- `client/src/pages/ChatPage.jsx`

Requires (read-only, no changes):
- `server/services/pantryService.js` — `create(householdId, data)` is the write target
- `server/db/schema.js` — `pantryItems` column reference
- `server/utils/expiry.js` — confirms UTC-day granularity pattern to follow

Irrelevant:
- `server/services/chatService.js`
- `server/services/householdService.js`
- `server/services/recipeService.js`
- `server/routes/auth.js`
- `server/routes/household.js`
- `client/src/*` (except `ChatPage.jsx`)

---

# Implementation Plan

## 1. `server/services/aiService.js` — Modify `chat()`

### 1a. Tool declaration (Gemini FunctionDeclaration format)

```js
const PANTRY_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'add_pantry_item',
        description:
          'Add a single item to the household pantry. ' +
          'Call this once per item. ' +
          'When multiple pantry items are mentioned, call this function once for each item separately. ' +
          'Never combine multiple items into a single call.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Item name (e.g. "Pad Thai leftovers", "whole milk")',
            },
            quantity: {
              type: 'number',
              description: 'Numeric quantity. Default 1 if not specified.',
            },
            unit: {
              type: 'string',
              description: 'Unit of measure (e.g. "serving", "item", "cup", "litre"). Default "item".',
            },
            category: {
              type: 'string',
              enum: ['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other'],
              description: 'Best-fit category. Default "Other".',
            },
            shelfLifeDays: {
              type: 'integer',
              description:
                'How many days from today until this item expires or should be used. ' +
                'Convert relative phrases like "good for 3 days", "expires next week", or ' +
                '"use today" (= 0) to a non-negative integer. ' +
                'Omit entirely if the user does not mention an expiry or shelf life.',
            },
            notes: {
              type: 'string',
              description: 'Optional free-text notes from the user.',
            },
          },
          required: ['name'],
        },
      },
    ],
  },
];
```

**Key design decisions:**
- `shelfLifeDays` (integer, ≥ 0) replaces `expiryDate` (string). Route does date arithmetic.
- `shelfLifeDays: 0` is valid — "expires today" / "use today".
- The function description explicitly instructs Gemini to call once per item (two signals:
  function description + system prompt augmentation below).

### 1b. System prompt augmentation for multi-item behavior

Add to the existing system prompt in `chat()`, after the saved-recipes section:

```js
`\nWhen the user asks to add multiple pantry items in one message, ` +
`call add_pantry_item once for each item separately. ` +
`Do not combine items into a single call.`
```

### 1c. Change `chat()` signature

```js
// Before:
export async function chat(pantrySummary, recipeSummary, history, userMessage)

// After:
export async function chat(pantrySummary, recipeSummary, history, userMessage, toolHandlers = {})
```

`toolHandlers` shape:
```js
{
  add_pantry_item: async (args) => { ok: true, item: PantryItem }
                                  | { ok: false, error: string }
}
```

### 1d. Change model construction

```js
// Before: textModel(systemPrompt, 1500)
// After:
const model = genAI.getGenerativeModel({
  model: MODEL,
  systemInstruction: systemPrompt,
  tools: PANTRY_TOOLS,
  generationConfig: { maxOutputTokens: 1500 },
});
```

Note: `tools` and `responseMimeType: 'application/json'` cannot be combined in one
Gemini call. The chat function uses plain-text output — this is correct and unchanged.

### 1e. Dispatch loop (replaces the single sendMessage call)

```js
let result = await chatSession.sendMessage(userMessage);
const itemsAdded = [];
let toolFailureCount = 0;
let iterations = 0;
const MAX_TOOL_ITERATIONS = 5;

while (result.functionCalls()?.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
  iterations++;
  const functionResponseParts = [];

  for (const call of result.functionCalls()) {
    const handler = toolHandlers[call.name];
    let responseContent;

    if (!handler) {
      toolFailureCount++;
      responseContent = { success: false, error: `Unknown tool: ${call.name}` };
    } else {
      const outcome = await handler(call.args);
      if (outcome.ok) {
        itemsAdded.push(outcome.item);
        responseContent = { success: true, item: { id: outcome.item.id, name: outcome.item.name } };
      } else {
        toolFailureCount++;
        responseContent = { success: false, error: outcome.error };
      }
    }

    functionResponseParts.push({
      functionResponse: { name: call.name, response: responseContent },
    });
  }

  result = await chatSession.sendMessage(functionResponseParts);
}

// Loop-exhaustion guard: if the loop terminated because iterations hit the cap
// (not because Gemini stopped calling tools), return a safe fallback rather than
// attempting to read text from a tool-call-only response.
if (iterations >= MAX_TOOL_ITERATIONS && result.functionCalls()?.length > 0) {
  console.warn('[aiService] Tool loop exhausted after', MAX_TOOL_ITERATIONS, 'iterations');
  return {
    reply: "I couldn't complete that request — please try again or be more specific.",
    itemsAdded,
  };
}
```

### 1f. Empty-reply and failure-aware fallback

After the dispatch loop (when the loop exited normally):

```js
const replyText = result.response.text()?.trim();

// Gemini may return empty text after a tool sequence. Fall back to a generated reply.
const reply = replyText || _buildFallbackReply(itemsAdded, toolFailureCount);

return { reply, itemsAdded };
```

Helper (private, not exported):

```js
function _buildFallbackReply(itemsAdded, failureCount) {
  if (itemsAdded.length === 0 && failureCount > 0) {
    return "I couldn't add those items to your pantry — could you try rephrasing?";
  }
  if (itemsAdded.length === 0) {
    return 'Done.';
  }
  const names = itemsAdded.map((i) => i.name).join(', ');
  return `Added to your pantry: ${names}.`;
}
```

This handles three cases explicitly:
- Some items added: lists them
- No items added but failures occurred: surfaces the failure
- No items, no failures: neutral "Done."

### 1g. Updated return type

`chat()` returns `{ reply: string, itemsAdded: PantryItem[] }` instead of a plain string.

---

## 2. `server/routes/ai.js` — Update POST /api/ai/chat

### 2a. Build the toolHandlers object

Inside the route handler, after `householdId` is available:

```js
const toolHandlers = {
  add_pantry_item: async (args) => {
    const addItemSchema = z.object({
      name:          z.string().min(1).max(200),
      quantity:      z.coerce.number().positive().default(1),
      unit:          z.string().min(1).max(50).default('item'),
      category:      z
        .enum(['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other'])
        .default('Other'),
      shelfLifeDays: z.coerce.number().int().nonnegative().optional(), // ≥ 0; 0 = expires today
      notes:         z.string().max(500).nullable().optional(),
    });

    let parsed;
    try {
      parsed = addItemSchema.parse(args);
    } catch (e) {
      return { ok: false, error: `Invalid item data: ${e.message}` };
    }

    // Server-side expiry computation: UTC midnight + shelfLifeDays, matching expiry.js convention.
    // expiry.js compares at UTC day granularity (setUTCHours(0,0,0,0)), so we normalize here too.
    let expiryDate = null;
    if (parsed.shelfLifeDays != null) {
      const expiry = new Date();
      expiry.setUTCHours(0, 0, 0, 0);
      expiry.setUTCDate(expiry.getUTCDate() + parsed.shelfLifeDays);
      expiryDate = expiry.toISOString();
    }

    try {
      const item = await pantryService.create(householdId, {
        name:         parsed.name,
        quantity:     parsed.quantity,
        unit:         parsed.unit,
        category:     parsed.category,
        purchaseDate: new Date().toISOString(),
        expiryDate,
        notes:        parsed.notes ?? null,
      });
      return { ok: true, item };
    } catch {
      return { ok: false, error: 'Failed to save item to pantry.' };
    }
  },
};
```

### 2b. Call aiService.chat with toolHandlers

```js
// Before:
const reply = await aiService.chat(pantrySummary, recipeSummary, history, message);
await chatService.savePair(householdId, message, reply);
await chatService.trimHistory(householdId, 50);
res.json({ reply });

// After:
const { reply, itemsAdded } = await aiService.chat(
  pantrySummary, recipeSummary, history, message, toolHandlers
);
await chatService.savePair(householdId, message, reply);
await chatService.trimHistory(householdId, 50);
res.json({ reply, itemsAdded });
```

`chatService.savePair` stores only the user message and final text reply.
Tool call intermediates are never persisted to `chat_messages`.

No other endpoints change.

---

## 3. `client/src/pages/ChatPage.jsx` — Add item-added feedback

### 3a. Handle `itemsAdded` in the response handler

Attach `itemsAdded` to the assistant message stored in local state:

```js
{ role: 'assistant', content: reply, itemsAdded: itemsAdded ?? [] }
```

### 3b. Render "Added to pantry" chips

Below the assistant message bubble, if `message.itemsAdded?.length > 0`, render
one chip per added item:

```
[ + Pad Thai leftovers added to pantry ]
```

Style: small, muted, non-interactive. Content: `+ {item.name} added to pantry`.

### 3c. No pantry refetch on ChatPage

ChatPage does not need to refetch pantry data. The next visit to PantryPage will
show the new items. The pantry summary is rebuilt from DB on every chat request
anyway (Constraint #10).

---

# Data Flow (end-to-end)

```
User: "add leftover pad thai, 2 servings, good for 3 days"
  │
  ▼
POST /api/ai/chat
  Fetches: allItems, allRecipes, history (from DB on every request)
  Builds:  pantrySummary, recipeSummary, toolHandlers
  │
  ▼
aiService.chat() — startChat with PANTRY_TOOLS + history
  │
  ▼
Gemini → functionCall:
  add_pantry_item({ name: "Pad Thai leftovers", quantity: 2,
                    unit: "serving", category: "Other", shelfLifeDays: 3 })
  │
  ▼
Dispatch loop → toolHandlers.add_pantry_item(args)
  Zod validates args
  expiryDate = UTC midnight + 3 days  (e.g. 2026-06-06T00:00:00.000Z)
  pantryService.create(householdId, { ... expiryDate })
  → { ok: true, item: { id: 42, name: "Pad Thai leftovers", ... } }
  │
  ▼
aiService sends functionResponse: { success: true, item: { id: 42, name: "Pad Thai leftovers" } }
  │
  ▼
Gemini text reply:
  "Done! I've added Pad Thai leftovers (2 servings) to your pantry,
   expiring in 3 days on June 6th."
  │
  ▼
chat() returns: { reply: "Done! ...", itemsAdded: [{ id: 42, name: "Pad Thai leftovers", ... }] }
  │
  ▼
Route: savePair(userMsg, reply) → trimHistory → res.json({ reply, itemsAdded })
  │
  ▼
Client: AI message + chip "[ + Pad Thai leftovers added to pantry ]"
```

---

# Acceptance Criteria

1. **Happy path — single item with shelf life:**
   User: "add leftover chicken, good for 2 days"
   → 1 item in `pantry_items` with `expiryDate` = UTC midnight + 2 days
     (e.g. `2026-06-05T00:00:00.000Z`)
   → AI reply confirms the addition
   → `itemsAdded` contains 1 item
   → Chat history: 1 user row + 1 assistant text row (no tool intermediates)

2. **Happy path — multiple items in one message:**
   User: "add 2 eggs and a carton of milk"
   → 2 separate `pantry_items` rows in DB
   → `itemsAdded` contains 2 items
   → Single AI reply covers both

3. **No tool call — regular question:**
   User: "what should I make for dinner?"
   → No DB write, `itemsAdded` is `[]`, reply is a non-empty string
   → Chat behavior identical to pre-TASK-004

4. **Item with no shelf life specified:**
   User: "add some olive oil"
   → `expiryDate` is `null` in DB
   → No error; item created successfully

5. **Expiry computation matches expiry.js convention:**
   `shelfLifeDays: 3` → `expiryDate` stored as UTC midnight + 3 days
   (i.e. `new Date()` with `setUTCHours(0,0,0,0)` + `setUTCDate(+3)`).
   This is the same granularity used by `getExpiryDays()` in `expiry.js`.
   There is no sub-day time component in the stored date.

6. **"Expires today" is valid:**
   User: "add the leftover soup, use it today"
   → Gemini passes `shelfLifeDays: 0`
   → `expiryDate` = today's UTC midnight date
   → Item created successfully (Zod `nonnegative()` passes 0)

7. **Loop guard is enforced:**
   The dispatch loop terminates after at most 5 iterations. If the loop exits because
   `iterations >= MAX_TOOL_ITERATIONS` and Gemini still returned function calls,
   the route returns:
   `{ reply: "I couldn't complete that request — please try again or be more specific.", itemsAdded }`
   No 500 error. No empty reply.

8. **Unknown tool call does not crash:**
   Gemini calls a function not present in `toolHandlers` → error `functionResponse` sent →
   chat route does not throw → assistant returns a graceful reply.

9. **Invalid tool args do not crash:**
   Gemini passes args that fail Zod validation → handler returns `{ ok: false }` →
   error `functionResponse` sent → Gemini replies gracefully → no 500 returned to client.

10. **Empty Gemini text reply is handled:**
    If `result.response.text()` is empty or whitespace after the dispatch loop,
    `_buildFallbackReply(itemsAdded, toolFailureCount)` produces a non-empty string.
    The client always receives a non-empty `reply`.

11. **Failed-tool fallback reply is accurate:**
    If all tool calls fail (Zod error, DB error, unknown tool) and `itemsAdded` is empty,
    the fallback reply is:
    `"I couldn't add those items to your pantry — could you try rephrasing?"`
    Not `"Done."` (which would be misleading).

12. **Pantry context consistent on next turn:**
    After adding item X in turn N, a question in turn N+1 that references X receives
    a pantry summary containing X. Works because `pantryService.getAll` is called fresh
    on every request — no cache invalidation needed.

13. **Duplicate behavior — insert-always:**
    Two sequential "add milk" messages → two separate `pantry_items` rows.
    `pantryService.create()` always inserts. No upsert, no deduplication.
    This is intentional — separate containers with different purchase dates are valid.

---

# Verification Steps

```
1.  Start dev server (npm run dev)
2.  Log in, navigate to Chat
3.  Type: "add leftover pad thai, 2 servings, good for 3 days"
4.  Confirm: AI reply is non-empty and confirms the addition
5.  Confirm: chip "[ + Pad Thai leftovers added to pantry ]" appears
6.  Navigate to Pantry: item present, expiryDate = today + 3 days (UTC midnight, no time component)
7.  Return to Chat. Type: "what can I make for dinner?"
8.  Confirm: no chip, pantry unchanged
9.  Type: "add 2 eggs and a carton of milk"
10. Confirm: 2 chips, 2 items in DB
11. Type: "add the leftover soup, use it today"
12. Confirm: item created, expiryDate = today (shelfLifeDays: 0 accepted)
13. Type: "add milk" twice → confirm 2 separate milk rows (insert-always)
14. Inspect chat_messages table: only user + assistant text rows, no tool intermediates
15. Check server logs: no unhandled errors across all steps
16. Code review: confirm MAX_TOOL_ITERATIONS constant exists and loop guard is present
17. Code review: confirm shelfLifeDays uses .nonnegative() in Zod schema
18. Code review: confirm expiryDate uses setUTCHours(0,0,0,0) + setUTCDate pattern
```

---

# Known Risks

1. **Multi-item determinism:** Two signals (function description + system prompt) instruct
   Gemini to call once per item. Reliable for `gemini-2.0-flash`. If regression occurs in
   a future model upgrade, the system prompt instruction can be strengthened.

2. **pantryService.create() error surface:** Wrapped in try/catch in the handler.
   Gemini's recovery text quality is model-dependent; acceptable for V1.

3. **`itemsAdded` payload size:** Returns full DB row from `pantryService.create()`.
   Can be slimmed to `{ id, name }` in a later pass if needed.

4. **No undo / remove via chat:** Out of scope. Requires a separate task with fuzzy
   item matching.

---

# Future Refactor Note

The current layering (`route → aiService → route callback`) is acceptable for a
single tool. If future tasks add `remove_pantry_item`, shopping list writes, or
recipe creation tools, extract:

```
server/services/toolOrchestrator.js
```

to own the dispatch loop and handler map, keeping aiService focused on Gemini I/O.
Explicitly not in scope for TASK-004.

---

# Out of Scope (Deferred)

- `remove_pantry_item` — item identification ambiguity (duplicates, fuzzy matching)
- `update_pantry_item` — same
- `mark_item_used` — same
- Shopping list writes via chat
- Recipe creation via chat
- Streaming responses
- Duplicate detection / upsert
