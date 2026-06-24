# TASK-019 — Fix: Clarification Confirmation Drops Tool Call

**Status:** IMPLEMENTED — Awaiting manual verification  
**Author:** ConnorSharpe + Claude Sonnet 4.6  
**Date:** 2026-06-23  
**Priority:** Medium

---

## Goal

When the agent asks "Did you mean X?" and the user confirms (e.g. "yes"), the agent must follow through with the tool call on the clarified item. Currently it treats the confirmation as a plain conversation turn and drifts — offering recipe suggestions instead of completing the original action.

---

## Reproduction

1. Add "Spam Musubi" to pantry
2. Say "I ate the spam"
3. Agent responds: "I don't see Spam in your pantry — did you mean Spam Musubi?"
4. User says "yes"
5. **Bug:** Agent skips `consume_pantry_item` and suggests recipes instead
6. **Expected:** Agent immediately calls `consume_pantry_item` on Spam Musubi

Saying "I ate the spam musubi" explicitly works correctly — the bug is specific to the post-clarification confirmation path.

---

## Round 1 Architect Feedback Summary

The architect's review raised five concerns. Each is addressed below with codebase evidence.

---

## Root Cause Investigation (Codebase Evidence)

The architect correctly flagged that the original spec stated root cause with too much confidence. The following questions have been answered by reading the actual code:

### 1. What conversation history is sent on the confirmation turn?

`chatService.getHistory(householdId, 20)` is called fresh on every request (`server/routes/ai.js:193`). It returns the 20 most recent messages ordered oldest-first from Neon. The clarification exchange (assistant asking "Did you mean Spam Musubi?") **is persisted and included** in the history on the confirmation turn — `chatService.savePair` writes both user and assistant messages after every turn.

**Conclusion:** History is intact. Truncation is not the cause.

### 2. Is the pantry context reloaded?

Yes — `pantryService.getAll(householdId)` is called fresh on every request (`server/routes/ai.js:190`). The pantry summary injected into the system prompt is always current.

**Conclusion:** Pantry context is not stale between turns.

### 3. Is tool-calling available on the follow-up turn?

Yes — `PANTRY_TOOLS` is passed to every `startChatSession` call unconditionally (`aiService.js:438`). The `OpenAIProvider` passes `tools` to every `chat.completions.create` call as long as `session.tools.length > 0` (`openaiProvider.js:31`).

**Conclusion:** Tools are available on the confirmation turn. This is not a tool-schema availability issue.

### 4. Is there already a "continue previous action" instruction in the prompt?

No — the existing ambiguity rule terminates at "ask for clarification before calling" with no follow-through instruction. There is nothing in the system prompt that tells the model what to do after clarification is resolved.

**Conclusion:** The gap in the prompt is confirmed as the **likely root cause**. The model receives a bare "yes" in a context where the prior assistant turn asked a clarification question, and with no follow-through rule it drifts to the next most plausible response.

### 5. Context window compression or intent classification drift?

With a 20-message history limit and `gpt-4o-mini`'s 128k context window, there is no compression occurring for a typical session. Intent classification drift is possible but secondary — the more likely explanation is the missing follow-through instruction, given that explicit naming ("I ate the spam musubi") resolves correctly.

---

## Likely Root Cause

The system prompt has an ambiguity rule that asks for clarification but no rule covering the follow-through turn. The model receives a "yes" confirmation with no instruction to connect it back to the pending action, so it drifts.

This is stated as **likely** rather than certain — a prompt-level fix may not cover all edge cases (e.g. very long sessions, unusual confirmation phrasing). The deterministic alternative is documented below.

---

## Architecture Decision: Prompt vs. State-Based Fix

### Prompt-level fix (chosen for TASK-019)

**Pros:**
- Narrow change, low risk
- No schema or API changes
- Solves the observed failure mode

**Cons:**
- Non-deterministic — relies on model following instructions
- Vulnerable to long-session drift (mitigated: 20-message history cap)
- Not testable with unit tests

### State-based fix (deferred)

A `pendingAction` object stored server-side (e.g. in session or DB):

```js
pendingAction = {
  tool: 'consume_pantry_item',
  itemId: '123',
  awaitingClarification: true,
}
```

When the user confirms, the server executes the tool call directly without involving the model.

**Pros:** Deterministic, testable, model-independent  
**Cons:** Requires persistent state, expiration handling, clarification lifecycle management

**Decision:** Prompt-level fix for TASK-019. State-based approach deferred as a hardening option if the prompt fix proves insufficient after testing.

---

## Proposed Fix (Revised per Round 1 Feedback)

**Persistence instruction removed from this task** per architect recommendation. Only the narrowly-scoped clarification follow-through rule is added.

Modify the existing ambiguity rule in `server/services/aiService.js` (~line 425):

**Before:**
```
- Name is ambiguous (multiple pantry items match) → ask for clarification before calling.
```

**After:**
```
- Name is ambiguous (multiple pantry items match) → ask for clarification before calling.
  If a clarification question has been asked and the user provides a direct confirmation
  ("yes", "correct", "that one", "yeah"), treat the clarification as resolved and
  immediately continue the action that required clarification.
  Do not restart the conversation, suggest recipes, or change tasks until the
  requested action is completed.
```

This is the architect's own suggested wording from Round 1, anchored to conversational state rather than vaguely referencing an "originally intended tool."

---

## Allowed Files

- `server/services/aiService.js` — system prompt only (~3 lines changed)

## Forbidden Files

- All other files — this is a prompt-only fix

---

## Constraints

1. No code logic changes — system prompt text only
2. The ambiguity rule must still require clarification before acting — only the follow-through is new
3. Persistence instruction is explicitly out of scope for this task

---

## Acceptance Criteria

### Positive path
- [ ] "I ate the spam" → agent asks "Did you mean Spam Musubi?" → user says "yes" → `consume_pantry_item` fires on Spam Musubi
- [ ] "I ate the spam" → agent asks → user says "yeah that one" → tool fires correctly
- [ ] Explicit "I ate the spam musubi" continues to work as before
- [ ] Genuinely ambiguous input (multiple plausible matches) still triggers clarification before acting

### Negative path (added per Round 1 feedback)
- [ ] "I ate the spam" → agent asks → user says "no" → no tool call; agent asks for correct item
- [ ] "I ate the spam" → agent asks → user says "actually the canned spam" → agent continues clarifying; no consume call on Spam Musubi
- [ ] Exactly one `consume_pantry_item` call fires on confirmation — no duplicate execution

### Non-regression
- [ ] Agent does not chain unsolicited tool calls after the fix
- [ ] Persistence (completing multi-step actions) is not affected

---

## Architect Questions for Round 2

1. The codebase evidence confirms history is intact and tools are available on every turn. Does this change the confidence level in the prompt-only fix?
2. The architect's own wording from Round 1 is used verbatim — is this acceptable or does it need refinement?
3. Is there any risk the "treat the clarification as resolved" phrasing causes the model to misinterpret a user topic change (e.g. "yes, and also can you...") as a pure confirmation?

---

## Dependency Chain

Editing:
- `server/services/aiService.js`

Irrelevant (do not open):
- `server/services/ai/*`
- `server/routes/ai.js`
- `client/*`
- `server/db/*`

---

## Reference

- [GPT-4.1 Prompting Guide — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)
- [A practical guide to building agents — OpenAI](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
