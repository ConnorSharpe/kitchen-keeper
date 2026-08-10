# TASK-053 — Streaming Chat Responses

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.4/10 — approve after revisions | Praised the scope discipline (pure transport-layer change), the codebase research depth, the preserved provider-abstraction layering, and evolving `chat()` via optional parameters rather than a parallel `streamChat()`. Five required revisions, assessed individually rather than applied mechanically: (1) requested justification for callback injection (`onToken`) vs. an async-iterable/event-emitter abstraction — **pushed back**: the reviewer's own alternatives carry the identical three event types (token/tool-turn/final-struct) through a different mechanism, and forcing `chat()`'s existing side-effecting return-value shape (`{reply, itemsAdded}` after internal tool execution) into generator semantics is a larger, riskier change to working control flow than one callback parameter — added D-7 documenting this reasoning instead of switching mechanisms; (2) requested an explicit header-flush strategy — **agreed and applied**, `res.flushHeaders()` added (D-8) so the client's `fetch()` promise resolves on connection-established rather than conflating that with first-token latency; (3) requested backpressure be addressed rather than silently ignored — **agreed and applied**, documented as an intentional, reasoned omission (D-9); (4) requested abort semantics be clarified beyond the OpenAI call, specifically around in-flight persistence — **the literal ask (document that persistence isn't cancelled) was agreed and applied, but investigating it surfaced a more serious, previously-unstated bug**: no guard existed against writing to a closed socket after client disconnect, which would throw inside the `catch` block itself with nothing to catch it — fixed with an explicit `clientDisconnected` guard (D-10), not just documented; the reviewer's adjacent suggestion to remove the `req.on('close')` listener was **declined** — no leak exists, the listener is garbage-collected with the request object; (5) asked to revisit D-5 (recipe-card flash), proposing keeping the streamed bubble and rendering cards underneath it — **neither the original recommendation nor the reviewer's alternative was adopted**; tracing the tool-loop's actual turn ordering showed the route already knows, before the first token of a reply streams, whether that reply will end in `suggest_recipes` cards (the tool handler populates `ctx.result.recipeSuggestions` in the turn *before* the text-generating turn) — so the route can simply not forward that one turn's deltas to the client, producing zero flash without reversing TASK-034's established "cards only" convention, which the reviewer's proposed fix would have. Two additional non-blocking suggestions: envelope versioning (`version` field) — **declined**, this is a same-repo, same-deploy client/server pair with no independent third-party consumer, versioning for a hypothetical future consumer is premature per this project's own stated preference against designing for speculative requirements; framing/parsing separation in the NDJSON reader — **agreed and applied** (D-12), `splitNdjsonLines` now owns only line-splitting, the caller owns `JSON.parse`. One further self-initiated addition beyond the review's own list: client-side token batching (D-13) — the reviewer flagged per-token `setState` as a performance concern (Issue 7) without it being in the "required revisions" list; treated as a real issue anyway given this app is a PWA with genuine mobile/iOS usage elsewhere in this same file, and fixed rather than left as a footnote. |

---

## Request

TASK-051's research pass identified 5 findings deferred for future tasks (see
[TASK-051-spec.md](TASK-051-spec.md#related-findings-not-addressed-by-this-task-remaining-5-for-future-task-planning)).
TASK-052 addressed finding #1 (structured outputs). Of the remaining 4, Connor was presented with all 4
and their tradeoffs and picked finding #4 to spec next:

> **No streaming on chat responses.** Every AI call, including chat, is a blocking
> `chat.completions.create`. A latency/UX issue, not a token-cost issue — same total tokens either way.
> Needs new server+client streaming infrastructure, not a small patch.

This spec covers exactly that: converting `POST /api/ai/chat` from one blocking request/response into a
response that streams the assistant's reply text to the browser as OpenAI generates it, while preserving
every other behavior of the endpoint (tool calling, pantry mutations, recipe suggestions, dietary context,
persistence, rate limiting, access gating) unchanged.

---

## Current Behavior (confirmed by reading the code)

**The full round trip is blocking, end to end.** [routes/ai.js:408-478](../../server/routes/ai.js) builds
context (pantry summary, recipe summary, chat history, dietary context) with one `Promise.all`, then
`await`s [`aiService.chat(...)`](../../server/services/aiService.js:854) in full before calling
`res.json({ reply, itemsAdded, recipeSuggestions })` exactly once. The client
([ChatPage.jsx:102-116](../../client/src/pages/ChatPage.jsx)) shows a 3-dot "typing" indicator
(`loading` state) for the entire duration, then replaces it with the complete assistant bubble in one
render — there is no partial/incremental rendering anywhere in the app today, and no SSE/streaming/
`ReadableStream` code exists anywhere in `server/` or `client/src/` outside of `node_modules`.

**`chat()` is a multi-turn tool-calling loop, not a single call.**
[aiService.js:854-1018](../../server/services/aiService.js): it opens a session via
`provider.startChatSession`, then loops `provider.sendMessage(session, message)` →
`provider.extractToolCalls(result)` → (if any) run each tool handler, feed results back via
`provider.buildToolResult`, call `sendMessage` again — up to `MAX_TOOL_ITERATIONS = 5` times — until a turn
comes back with no tool calls, at which point `provider.extractText(result)` is the final reply.
`itemsAdded` (for `add_pantry_item` calls) and `ctx.result.recipeSuggestions` (mutated by
`createToolHandlers.js`'s handlers) accumulate across turns and are only known in full once the loop ends.

**The provider abstraction ([providerInterface.js](../../server/services/ai/providerInterface.js),
implemented once by [openaiProvider.js](../../server/services/ai/openaiProvider.js)) is the only thing
`chat()` talks to** — `startChatSession`, `sendMessage`, `extractToolCalls`, `extractText`,
`buildToolResult`. (`isResponseValid` is declared on the interface and implemented, but grepping the
codebase confirms it is never actually called anywhere today — pre-existing dead code, not touched by
this task.) `sendMessage` ([openaiProvider.js:18-47](../../server/services/ai/openaiProvider.js)) calls
`this.client.chat.completions.create({ model: 'gpt-4o-mini', messages, tools, prompt_cache_key:
'kitchen-keeper-chat-v1' })` (no `stream`), logs `prompt_tokens`/`completion_tokens`/`total_tokens`/
`cached_tokens` from `response.usage` (added in TASK-051), pushes the assistant message onto
`session.messages`, and returns the raw `ChatCompletion` response object.

**`resolveProvider()` ([resolveProvider.js](../../server/services/ai/resolveProvider.js)) is a one-line
wrapper** (`new OpenAIProvider(process.env.OPENAI_API_KEY)`, since TASK-051 removed BYOK) — `OpenAIProvider`
is the only implementation of the interface today.

**The chat endpoint sits behind the same middleware as every other AI route**:
[ai.js:22-23](../../server/routes/ai.js) — `router.use(requireAiAccess)` then `router.use(aiRateLimit)`,
applied once for the whole router. Neither middleware inspects or wraps the response body; both run
before the route handler and either call `next()` or short-circuit with their own (non-streaming) response
— unaffected by anything in this task.

**Deployment shape matters here.** [api/index.js](../../api/index.js) is a 9-line Vercel Function that
lazily imports `server/app.js` (a plain Express app) and calls it directly as `(req, res) => handler(req,
res)` — this is *not* a Next.js API route and *not* an Edge Function; it's Express wrapped as a raw
Node.js Vercel Function. [vercel.json](../../vercel.json) sets `maxDuration: 60` for this one function and
has no other relevant config. `server/app.js` has no `compression` middleware (confirmed by reading it in
full — only `cors`, `helmet`, `morgan`, `express.json`), which removes one common source of
response-buffering. There is no existing precedent anywhere in this app for a chunked/streamed HTTP
response — this is genuinely new infrastructure, not an extension of an existing pattern.

---

## Research

- [OpenAI: Chat Completions streaming events (API reference)](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)
  — confirms the raw wire shape: `delta.content` for text fragments, `delta.tool_calls[].function.arguments`
  as JSON-string fragments keyed by `index` that must be concatenated in order, and `finish_reason` (`stop`
  / `tool_calls` / `length` / `content_filter`) signaling turn completion. A raw per-chunk implementation
  would have to hand-roll all of this itself.
- **The installed `openai` SDK (`^4.104.0`, confirmed exact version in `server/node_modules/openai/package.json`)
  already does this accumulation for us**, via `client.beta.chat.completions.stream(body, options)` →
  returns a `ChatCompletionStream` runner (confirmed by direct inspection of
  `server/node_modules/openai/resources/beta/chat/completions.js` and
  `server/node_modules/openai/lib/ChatCompletionStream.js` — **not** `client.chat.completions.stream()`,
  which is where this method lives in the SDK's current `master`-branch docs/examples for a later major
  version not installed here; using the wrong call path would fail immediately). Key confirmed behaviors,
  read directly from the installed SDK's source rather than assumed from generic docs:
  - `.on('content', (delta, snapshot) => …)` fires once per text-content chunk, in order, exactly the
    per-token stream needed for the browser.
  - `await runner.finalChatCompletion()` resolves to a normal `ChatCompletion` object — same shape
    `sendMessage` returns today. `extractToolCalls`, `extractText`, and `buildToolResult` in
    `openaiProvider.js` need **zero changes**: they already operate on exactly this shape.
  - Tool-call argument fragments are accumulated the same way the raw API requires (concatenated by
    `index`) — `extractToolCalls`'s `JSON.parse(tc.function.arguments)` keeps working unchanged.
  - **Token usage**: passing `stream_options: { include_usage: true }` in the request body causes OpenAI
    to send one final chunk containing `usage` and empty `choices`. Traced through
    `ChatCompletionStream.js`'s internals directly (`_accumulateChatCompletion`'s `const { choices, ...rest
    } = chunk` merges that chunk's `usage` into the running snapshot; `finalizeChatCompletion`'s own
    destructure does not strip `usage` back out) — `finalChatCompletion().usage` **will** be populated,
    the same field `sendMessage`'s current usage log line already reads. This is stronger evidence than
    the SDK's own prose docs, which hedge ("usage is not currently reported with stream") about a
    *different* surface (the `.totalUsage()` helper/event) — not about `finalChatCompletion().usage`
    itself. Still worth one live confirmation (Testing Plan) rather than trusting static reading alone.
  - Abort support: `.stream(body, { signal })` wires a standard `AbortSignal` straight into the underlying
    request exactly like `.create(body, { signal })` does — confirmed in `_createChatCompletion`'s handling
    of `options?.signal`.
- [openai-node `helpers.md`](https://github.com/openai/openai-node/blob/master/helpers.md) (master branch,
  a later SDK version) also documents the same `.stream()`/`ChatCompletionStream` design, plus the
  SDK-recommended pattern for **proxying to a browser**: `stream.toReadableStream()` server-side and
  `ChatCompletionStream.fromReadableStream(res.body)` client-side, both speaking newline-separated JSON
  (NDJSON) — *not* `EventSource`/native SSE framing. This app cannot use native `EventSource` regardless of
  which framing is chosen: `EventSource` only supports `GET` with no custom headers, and every existing
  authenticated request in this app (`client/src/api/index.js`) sends a Clerk Bearer token via a `fetch`
  header — a POST + `fetch` + manual stream-reading is required either way (confirmed by reading
  `client/src/api/index.js` in full).
- **Decision against reusing the SDK's own `ChatCompletionStream.fromReadableStream()` client-side (see
  Design 4)**: it expects the *raw* re-serialized `ChatCompletionChunk` wire shape, which only carries
  per-turn text/tool-call deltas — it has no way to carry this endpoint's own final payload
  (`itemsAdded`, `recipeSuggestions`), and importing the `openai` npm package into the client bundle only
  to reuse ~15 lines of NDJSON-line-buffering logic is a real bundle-size cost for close to zero
  reuse value (confirmed `openai` is not currently a `client/package.json` dependency). A small
  hand-rolled NDJSON reader with an app-specific event envelope (`token` / `done` / `error`) is simpler
  and already matches how this app buffers/parses fetch responses today (`client/src/api/index.js`).
- **Vercel streaming support is real but not documented for this app's exact deployment shape.** Vercel's
  own 2023 platform announcement (["Streaming for serverless Node.js and Edge Runtimes with Vercel
  Functions"](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions))
  states streaming is supported for Node.js (Lambda) functions generally, not just Edge — which is the
  relevant claim, since `api/index.js` is a plain Node.js Vercel Function, not Edge. However, Vercel's
  *current* first-party docs and examples for streaming (`/docs/functions/streaming-functions`, fetched
  directly) are now written entirely around the Web `Response`/`ReadableStream` idiom used by Next.js App
  Router route handlers and the Vercel `ai` SDK's `toTextStreamResponse()` — there is no current official
  example of a raw `(req, res) => {}` Node handler (an Express app wrapped the way this one is) calling
  `res.write()` repeatedly. Community reports of Vercel/Next.js streaming being silently buffered exist,
  but they're specifically about Next.js API routes buffering until the handler returns — a different code
  path than this app's raw Express-on-a-Node-Function shape. **Net: platform-level support almost
  certainly exists, but nothing found confirms this specific `res.write()`-in-an-Express-handler pattern
  works un-buffered end-to-end (through Vercel's Lambda bridge and CDN) on this app's actual deployment** —
  this is the single biggest open risk in this spec (see Known Risks) and needs a live Preview-deployment
  check (Testing Plan), not just local-dev confirmation, before this is considered reliable.

---

## Design

### 1. `providerInterface.js` — declare `streamMessage` alongside `sendMessage`

```js
// Same contract as sendMessage, but invokes onToken(deltaText) synchronously for
// each text fragment as it arrives, before resolving with the final response.
async streamMessage(session, message, onToken) {
  throw new Error('Not implemented');
}
```

`sendMessage` stays exactly as it is — nothing else in the codebase calls it besides `chat()`, and this
task does not require removing the non-streaming path from the interface.

### 2. `openaiProvider.js` — new `streamMessage`, `sendMessage` untouched

```js
async streamMessage(session, message, onToken, { signal } = {}) {
  if (typeof message === 'string') {
    session.messages.push({ role: 'user', content: message });
  } else {
    for (const part of message) session.messages.push(part);
  }

  let response;
  try {
    const stream = this.client.beta.chat.completions.stream(
      {
        model: 'gpt-4o-mini',
        messages: session.messages,
        tools: session.tools?.length ? session.tools : undefined,
        prompt_cache_key: 'kitchen-keeper-chat-v1',
        stream_options: { include_usage: true },
      },
      { signal }
    );
    stream.on('content', (delta) => onToken(delta));
    response = await stream.finalChatCompletion();
  } catch (err) {
    throw new AIProviderError(err.message, err);
  }

  console.log(
    `[kitchen-keeper] request_id=${session.requestId} function=chat model=gpt-4o-mini` +
      ` prompt_tokens=${response.usage?.prompt_tokens} completion_tokens=${response.usage?.completion_tokens}` +
      ` total_tokens=${response.usage?.total_tokens} cached_tokens=${response.usage?.prompt_tokens_details?.cached_tokens ?? 0}`
  );

  session.messages.push(response.choices[0].message);
  return response;
}
```

Identical message-pushing, logging, and return-value shape to `sendMessage` — the only differences are
`client.beta.chat.completions.stream(...)` instead of `.create(...)`, the `onToken` wiring, and an
optional `signal` for cancellation (Design 6). Because `finalChatCompletion()` returns the same
`ChatCompletion` shape `sendMessage` already returns, `extractToolCalls`, `extractText`, and
`buildToolResult` do not need to change at all.

**On intermediate (tool-calling) turns, `onToken` will very rarely fire.** OpenAI's tool-calling turns
typically return `content: null` — no text content deltas are emitted for a turn whose `finish_reason` is
`tool_calls` (confirmed by reading `ChatCompletionStream.js`'s `content` event guard, which only fires
when `choiceSnapshot.message?.content` is truthy). This means the existing multi-turn loop in `chat()`
does not need to know in advance which turn is "the final one" — every turn is streamed identically, and
in practice only the last turn (the one with real text) produces any visible output. The rare edge case
where a model emits both a tool call and narrated text in the same turn is called out in Known Risks
rather than special-cased away, since there is nothing in this app's existing code that handles or even
detects that case today either.

### 3. `aiService.js` — `chat()` gains an `onToken` callback, forwarded to both `sendMessage` call sites

```js
export async function chat(
  pantrySummary,
  recipeSummary,
  history,
  userMessage,
  toolHandlers = {},
  dietaryContext = '',
  requestId = 'n/a',
  onToken = () => {},
  { signal } = {}
) {
  // ...unchanged systemPrompt construction...

  const session = provider.startChatSession({ systemPrompt, tools: PANTRY_TOOLS, history, requestId });

  let result;
  try {
    result = await provider.streamMessage(session, userMessage, onToken, { signal });
  } catch (err) {
    throw wrapAIError(err);
  }

  // ...unchanged tool-call loop, except every provider.sendMessage(session, toolResultParts)
  // becomes provider.streamMessage(session, toolResultParts, onToken, { signal })...
}
```

Everything else in `chat()` — the `MAX_TOOL_ITERATIONS` loop, `itemsAdded`/`toolFailureCount` tracking,
the tool-loop-exhausted early return, the final `console.log` — is unchanged. Two small additions to keep
one invariant true (**the client only ever receives reply text via `onToken`, never duplicated in a final
payload** — see D-2):

- The tool-loop-exhausted branch (`"I couldn't complete that request…"`) now calls `onToken(replyText)`
  once before returning, instead of only returning the string.
- `_buildFallbackReply`'s output (used when `extractText(result)` is empty) is likewise passed through
  `onToken` once before `chat()` returns, at the same point it's computed today.

Both are rare paths (an exhausted tool loop, or a genuinely empty final assistant message) — this is a
one-line addition at each existing return point, not new control flow.

### 4. `routes/ai.js` — `/chat` becomes an NDJSON streaming response

```js
router.post('/chat', validate(chatMessageSchema), async (req, res) => {
  const { message } = req.body;
  const householdId = req.user.householdId;
  const requestId = randomUUID().split('-')[0];

  // ...unchanged Promise.all context-gathering, pantrySummary/recipeSummary/dietaryContext,
  // ctx/toolHandlers construction — all of this happens BEFORE any header is sent, so a
  // failure here still produces a normal JSON error response via the existing error middleware...

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // defensive: prevents reverse-proxy buffering if one sits in front of this response; harmless if none does
  });
  res.flushHeaders(); // send headers now, before waiting on the (typically much slower) first OpenAI token — see D-8

  const abortController = new AbortController();
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
  });

  // Suppresses this one turn's deltas from reaching the client, without changing chat()'s
  // loop or aiService's logic at all — see D-5. ctx.result.recipeSuggestions is populated by
  // the suggest_recipes tool handler in the turn BEFORE the text-generating turn that would
  // stream an intro sentence, so by the time any content delta for that reply exists, this
  // check already reflects the final state for this exchange.
  const onToken = (delta) => {
    if (clientDisconnected || ctx.result.recipeSuggestions.length > 0) return;
    res.write(JSON.stringify({ type: 'token', delta }) + '\n');
    // res.write()'s boolean return (backpressure signal) is intentionally not checked — see D-9.
  };

  try {
    const { reply, itemsAdded } = await aiService.chat(
      pantrySummary, recipeSummary, history, message, toolHandlers,
      dietaryContext, requestId, onToken, { signal: abortController.signal }
    );

    // Persistence is NOT gated by clientDisconnected/abortController — see D-10. A reply that
    // finished generating is still valid chat history worth keeping even if the requesting tab
    // is gone; only the (expensive, slow) OpenAI generation itself is cancellable.
    await chatService.savePair(
      householdId, message, reply,
      ctx.result.recipeSuggestions.length > 0
        ? { version: 1, recipeSuggestions: ctx.result.recipeSuggestions }
        : null
    );
    await chatService.trimHistory(householdId, 50);

    if (!clientDisconnected) {
      res.write(JSON.stringify({
        type: 'done',
        itemsAdded,
        recipeSuggestions: ctx.result.recipeSuggestions,
      }) + '\n');
    }
  } catch (err) {
    console.error(`[kitchen-keeper] request_id=${requestId} function=chat error=${err.message}`);
    if (!clientDisconnected) {
      res.write(JSON.stringify({ type: 'error', message: 'Something went wrong. Please try again.' }) + '\n');
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});
```

`reply` is still computed and still passed to `chatService.savePair` in exactly the same place, in exactly
the same order relative to `trimHistory`, as today — **persistence timing does not change at all**; only
the transport of the reply text to the browser changes from "all at once, after everything else" to
"incrementally, as it's generated." This is why `chat()`'s return value keeps `reply` (Design 3) even
though the client never reads it directly off the final payload — the route still needs the complete
string for `savePair`.

**Every code path once `res.writeHead` has run must resolve inside this same `try`/`catch`/`finally` —
none may reach Express's global error middleware ([app.js:72-79](../../server/app.js)).** That middleware
calls `res.status(status).json(body)`, which throws (`ERR_HTTP_HEADERS_SENT`) once headers have already
been flushed. This is why the route wraps the entire post-`writeHead` body in `try`/`catch` and always
ends with `res.end()` in `finally`, rather than relying on `next(err)` the way every other route in this
file implicitly does via unhandled rejections.

**Ordering is guaranteed by construction, not by the protocol.** `token`/`done`/`error` lines are written
in strict call order because they all happen sequentially on one `await`-driven code path — every
`res.write` for a `token` event happens synchronously inside `onToken`, which is only ever invoked from
inside the single `await aiService.chat(...)` call; the `done` (or `error`) write cannot execute until
that `await` resolves (or rejects), which is after every internal `streamMessage` call — and therefore
every token — has already completed. A single HTTP response body is one ordered byte stream (TCP/HTTP
guarantee), so writes issued in order arrive in order; there is no concurrency or buffering path in this
design that could reorder a `done` ahead of a `token`.

**`clientDisconnected` guards every `res.write`/`res.end` call after the first one, closing a real gap in
DRAFT-1**: without it, a disconnect mid-stream (`req.on('close')`) would still let `onToken` (or the
`catch` block) attempt to `res.write()` on an already-closed socket — which throws — and that throw inside
the `catch` block itself had nothing to catch it, an unhandled rejection in an async Express handler
(this app runs `express@^4.22.2`, confirmed in [server/package.json](../../server/package.json) — Express 4
does not auto-catch async-handler rejections the way Express 5 does). This was found while addressing the
abort-semantics review round — see D-10.

### 5. Client — a small hand-rolled NDJSON reader plus incremental rendering

New function in [client/src/api/index.js](../../client/src/api/index.js), next to the existing `api`
object (same auth-token-attachment logic reused, different return shape — a callback-driven stream rather
than a parsed JSON value, so it is not folded into the uniform `get/post/patch/delete` shape):

```js
// Exported separately so the line-splitting logic is unit-testable without a real fetch or
// any valid JSON. Owns framing only — JSON.parse is the caller's responsibility (D-12).
export function splitNdjsonLines(buffer, onLine) {
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line) onLine(line);
  }
  return buffer; // remainder, held until the next chunk completes it
}

async function postStream(path, body, { onToken, signal } = {}) {
  const token = await getClerkToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal });

  if (res.status === 401 && !window.location.pathname.startsWith('/sign-in')) {
    window.location.href = '/sign-in';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = splitNdjsonLines(buffer + decoder.decode(value, { stream: true }), (line) => {
      const evt = JSON.parse(line);
      if (evt.type === 'token') onToken(evt.delta);
      else if (evt.type === 'done') donePayload = evt;
      else if (evt.type === 'error') throw new Error(evt.message);
    });
  }

  if (!donePayload) throw new Error('Connection closed before the response finished.');
  return donePayload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  postStream,
};
```

[ChatPage.jsx](../../client/src/pages/ChatPage.jsx)'s `send()` changes from one `await api.post(...)` to:

```js
const abortController = new AbortController();
const assistantKey = nextTempId();
setMessages((prev) => [...prev, { key: assistantKey, role: 'assistant', content: '', itemsAdded: [], recipeSuggestions: [] }]);

// Batches incoming deltas into one setState per animation frame instead of one per token —
// see D-13. pending accumulates synchronously; the rAF callback is what actually touches React.
let pending = '';
let flushScheduled = false;
function flush() {
  flushScheduled = false;
  const delta = pending;
  pending = '';
  setMessages((prev) =>
    prev.map((m) => (m.key === assistantKey ? { ...m, content: m.content + delta } : m))
  );
}
function onToken(delta) {
  pending += delta;
  if (!flushScheduled) {
    flushScheduled = true;
    requestAnimationFrame(flush);
  }
}

try {
  const { itemsAdded, recipeSuggestions } = await api.postStream(
    '/api/ai/chat',
    { message: userText },
    { signal: abortController.signal, onToken }
  );
  if (flushScheduled) flush(); // catch any trailing tokens the last rAF hasn't run yet
  setMessages((prev) =>
    prev.map((m) => (m.key === assistantKey ? { ...m, itemsAdded: itemsAdded ?? [], recipeSuggestions: recipeSuggestions ?? [] } : m))
  );
} catch (err) {
  setMessages((prev) => prev.filter((m) => m.key !== tempKey && m.key !== assistantKey));
  setInput(userText);
  toast.error(err.message || 'Failed to send message. Please try again.');
}
```

The existing "typing dots" indicator's visibility condition changes from `loading` to `loading &&
!currentAssistantMessageHasContent` — dots show until the first token of the *final* turn arrives, then
the live bubble takes over, matching the existing `ReactMarkdown` rendering path unchanged. Batching
(D-13) means `ReactMarkdown` re-parses on animation-frame boundaries (at most ~60/sec, in practice far
less since GPT-4o-mini's token rate doesn't sustain 60/sec) instead of once per token — a real reduction
for a device where markdown re-parsing cost, not React's diffing, is the actual expense.

**When a reply is suppressed server-side because it ends in recipe cards (Design 4's route-level `onToken`
check), the client simply never receives any `token` events for that message** — `content` stays `''` the
entire time, so the existing `hasRecipeCards` suppression (unchanged, D-5) hides the empty bubble exactly
as it hides today's non-empty-but-redundant one. No client-side change is needed to make D-5 work; the
suppression is entirely a server-side decision about what to send.

An `AbortController` is created per `send()` call and its `.abort()` is called on component unmount
(matching the existing pattern already used in
[RecipeUpload.jsx](../../client/src/components/recipes/RecipeUpload.jsx) and
[RecipeUrlImport.jsx](../../client/src/components/recipes/RecipeUrlImport.jsx)) — closing the tab or
navigating away mid-stream now actually cancels the in-flight OpenAI call server-side (Design 6), instead
of leaving it running to completion for no one.

### 6. Abandoned-request cleanup: `req.on('close')` → `AbortController` → OpenAI cancellation

Wired in Design 4's route handler and Design 2's `streamMessage`. Today, a user closing the chat mid-reply
still lets the blocking `chat.completions.create` call run to completion server-side (wasted latency, not
cost, since total tokens don't change — but under streaming, a user is more likely to notice and leave
mid-turn precisely because they can already see partial output, so this is worth doing rather than
carrying the same latent behavior forward unexamined). `req.on('close')` fires when the client disconnects
for any reason (navigation, tab close, network drop); the same `AbortController` is threaded through
`aiService.chat` → `provider.streamMessage` → the SDK's own `signal` support (Research).

---

## Decisions

- **D-1: Keep the existing hand-rolled tool-calling loop in `chat()`; do not adopt the SDK's `runTools()`
  automatic tool-execution helper.** `runTools()` executes multiple tool calls **concurrently** by default
  and manages its own message-array mutation — a different concurrency and control-flow contract than this
  app's current sequential `for (const call of toolCalls)` loop, which `createToolHandlers.js`'s handlers
  and the `ctx`-mutation pattern (`ctx.result.recipeSuggestions`, `itemsAdded` tracking) are written
  against. Switching to `runTools()` would be a second, unrelated refactor bundled into a streaming task.
  This task changes only *how* each turn's response is obtained (`streamMessage` vs. `sendMessage`), not
  the loop that drives it.
- **D-2: The client only ever receives reply text via `onToken` events — the final `done` payload never
  repeats it.** Considered, and declined, sending `reply` again in the final payload "just in case" a
  token got dropped — that would create two possible sources of truth for the same text with no defined
  reconciliation rule if they ever disagreed. Design 3's two small additions (streaming the tool-loop-
  exhausted and fallback-reply strings through `onToken` once) exist specifically so this invariant holds
  on every code path, not just the common one.
- **D-3: NDJSON over a plain `fetch` + manual `ReadableStream` read, not native `EventSource`/SSE
  framing.** `EventSource` cannot send the `Authorization: Bearer <token>` header this app's auth model
  requires (Research) — this is not a style preference, it's a hard requirement given how Clerk auth is
  wired into `client/src/api/index.js` today. Given `fetch` is required either way, SSE's main practical
  benefit (native auto-reconnect) doesn't apply, so the simpler NDJSON framing (used by the OpenAI SDK's
  own documented Express-proxy example) was chosen over hand-rolling real `text/event-stream` framing
  (`data: ...\n\n`) for no benefit.
- **D-4: Don't reuse the SDK's `ChatCompletionStream.fromReadableStream()` on the client.** Explained in
  Research — it speaks the raw per-turn `ChatCompletionChunk` shape, has no room for this endpoint's own
  final `itemsAdded`/`recipeSuggestions` payload, and would pull the `openai` npm package into the client
  bundle for minimal reuse. A ~10-line hand-rolled NDJSON buffer (`splitNdjsonLines`, Design 5, D-12) is
  simpler and kept as a standalone, unit-testable pure function rather than inlined into `postStream`
  specifically so it has test coverage (Testing Plan) despite needing no live network call to verify.
- **D-5 (revised in DRAFT-2 — see Architect Review History): recipe-card replies are never streamed to
  the client at all, so there is no flash to reconcile.** DRAFT-1 assumed the client had to choose between
  "stream then retroactively hide" (a brief visible flash) or "buffer this one flow" (loses the streaming
  benefit for one of the app's most common interactions) or "show bubble and cards together" (reverses
  TASK-034's deliberate "cards only" convention — the architect review's proposed alternative). Re-tracing
  the tool loop's actual turn order shows a fourth option that has none of those costs: the
  `suggest_recipes` tool handler populates `ctx.result.recipeSuggestions` in the turn *before* the
  text-generating turn that produces the "one brief introductory sentence" (system prompt requirement) —
  by the time any content delta for that sentence could exist, `ctx.result.recipeSuggestions.length > 0`
  is already true. `ctx` is constructed in `routes/ai.js` and already in scope wherever `onToken` is
  defined there (Design 4), so the route's `onToken` can simply decline to `res.write` that one turn's
  deltas — the client never sees them, `content` stays `''`, and the existing `hasRecipeCards` suppression
  (unchanged) hides the empty bubble exactly as it hides today's redundant one. Every other flow (plain
  chat, pantry mutations) streams normally and identically — this is a one-`if`-statement change confined
  to the route's `onToken`, not a change to `chat()`'s loop, `aiService.js`, or `ChatPage.jsx`'s suppression
  rule. The one still-real gap (Known Risks): the rare case of a single turn emitting both narrated text
  and a tool call in the same turn (already flagged in DRAFT-1) would still leak that turn's text to the
  client before `ctx.result.recipeSuggestions` updates, since the tool handler only runs after that turn
  fully resolves — unchanged from DRAFT-1's assessment, still rare/anomalous rather than the common path.
- **D-6: Chat Completions streaming (`client.beta.chat.completions.stream`), not a migration to OpenAI's
  newer Responses API.** The Responses API's streaming story is more prominent in the SDK's current
  `master`-branch docs (Research), but migrating `chat()`'s tool-calling loop, the provider abstraction,
  and `PANTRY_TOOLS`'s schema format onto a different API surface is a much larger, unrelated change with
  no functional requirement forcing it — Chat Completions streaming is fully sufficient for this task and
  keeps every other file in `Forbidden Files` genuinely untouched. Revisit only if OpenAI deprecates Chat
  Completions (not the case today, and not signaled by anything found in Research).
- **D-7 (added in DRAFT-2, architect review): callback injection (`onToken`), not an async iterable or
  event emitter, is the interface between `chat()` and its caller.** Raised as a "layering leak" concern
  in review — `chat()` gaining a parameter whose only purpose is incremental output does mean `chat()` now
  has *a* streaming-shaped hook, but the callback itself carries only text deltas, never anything
  HTTP/transport-specific (no `res`, no headers, no status codes) — that boundary already holds today.
  The reviewer's suggested alternatives don't remove the hook, they relocate the same three pieces of
  information (per-token deltas, tool-turn boundaries, the final `{reply, itemsAdded}` struct) through a
  different mechanism: an async generator would require `chat()` itself to become `async function*`, and
  since it currently returns a structured result *after* internal side effects (executing tool handlers,
  accumulating `itemsAdded`) rather than a plain value stream, that result would have to be smuggled out
  via a generator's terminal `{done: true, value}` (which a `for await` loop on the caller's side cannot
  see — it would need manual `.next()` calls, discarding the ergonomic win generators are usually chosen
  for) or yielded as a discriminated union indistinguishable in spirit from the current envelope. Given
  `chat()`'s existing, working return-value contract is explicitly preserved elsewhere in this spec
  (Constraints: "external contract changes only by appending two new optional parameters"), a callback is
  the smaller, more targeted change of the two — not a stylistic default, a comparison actually made.
- **D-8 (added in DRAFT-2, architect review): `res.flushHeaders()` is called immediately after
  `res.writeHead`, before `aiService.chat(...)` starts.** Without it, headers may not reach the client
  until the first `res.write()` — which, for this endpoint, can be several seconds after the request
  started (OpenAI's time-to-first-token, not this app's own processing). Flushing immediately lets the
  client's `fetch()` promise resolve on "connection established," a meaningfully earlier and more useful
  signal than "connection established and first token ready" — relevant both for the client (it can show a
  distinct "connected, waiting" vs. "request may have failed to reach the server at all" state, though
  this task doesn't add that UI distinction — see Out of Scope) and for ruling out one class of
  proxy-level timeout on the connection-establishment phase specifically.
- **D-9 (added in DRAFT-2, architect review): `res.write()`'s boolean return value (Node's backpressure
  signal) is intentionally not checked.** Raised in review as an omission rather than a reasoned choice —
  correct that DRAFT-1 didn't state it explicitly. The reasoning: backpressure exists to protect against a
  producer that can generate bytes faster than the socket can drain them. Here the producer is GPT-4o-mini's
  token-generation rate, which is orders of magnitude slower than a TCP socket's drain rate for
  single-digit-KB/sec of text — the same assumption the OpenAI SDK's own documented Express-proxy example
  (`stream-to-client-express.ts`, Research) makes by also not checking `res.write()`'s return value. Stated
  here explicitly rather than left implicit, per the review's ask, not because the underlying risk is
  actually live for this payload shape.
- **D-10 (added in DRAFT-2, architect review): abort only cancels the in-flight OpenAI generation, never
  already-started persistence — and, separately, a `clientDisconnected` guard now prevents writes to a
  closed socket.** These are two different fixes prompted by the same review point. First, by design: once
  `aiService.chat(...)` resolves with a complete `reply`, `chatService.savePair`/`trimHistory` always run,
  regardless of whether the client is still connected — the generated reply is valid conversation history
  worth keeping even if the requesting tab is gone, and there is no reason to cancel a cheap DB write the
  way there is for an expensive, slow, still-running OpenAI call. Second, and more serious: investigating
  this exposed that DRAFT-1 had no guard at all against writing to the response after `req.on('close')`
  fired — `res.write()` on a closed socket throws, and that throw would have occurred inside the route's
  own `catch` block (attempting to write an `error` event) with nothing further to catch it, an unhandled
  rejection in an async Express 4 handler (confirmed `express@^4.22.2` in
  [server/package.json](../../server/package.json) — Express 4, unlike 5, does not auto-catch these).
  Design 4's `clientDisconnected` flag, checked before every `res.write`/`res.end` call after the first,
  closes this. The review's adjacent suggestion to also `removeListener` the `req.on('close')` handler was
  declined — the listener is attached to `req`, which is discarded (and garbage-collected, listener
  included) once the request completes; there is no leak to clean up.
- **D-11 (added in DRAFT-2, architect review): the NDJSON envelope (`{type: 'token'|'done'|'error'}`) is
  not versioned.** Declined — this protocol has exactly one client and one server, deployed from the same
  repository in the same commit; if the envelope shape ever changes, both ends change together, in the
  same PR. Adding a `version` field defends against a scenario (an independent third-party consumer this
  protocol was never designed for) that doesn't exist today, matching this project's established
  preference against designing for hypothetical future requirements over the concrete one in front of it.
- **D-12 (added in DRAFT-2, architect review): the NDJSON reader is split into `splitNdjsonLines`
  (framing only) and the caller's own `JSON.parse` per line, rather than one function owning both.**
  Accepted as a small, free improvement — `splitNdjsonLines` is now testable with arbitrary strings, not
  just well-formed JSON, and the separation matches this codebase's existing preference for narrowly-scoped
  pure helpers (e.g. TASK-052's `extractStructuredContent`/`parseStructuredResponse` split).
- **D-13 (added in DRAFT-2, self-initiated after the review flagged it as a non-blocking observation):
  client-side token deltas are batched into one `setState` per animation frame, not one per token.**
  The review raised this as a performance concern without listing it among the required revisions;
  treated as real anyway rather than deferred, since this app has genuine mobile/PWA usage elsewhere in
  this exact file (the `iosPwaCaveat`/mic-button handling) where 100+ `ReactMarkdown` re-parses over a few
  seconds is more likely to be felt than on a desktop dev machine. Implemented as a `pending`-string
  accumulator flushed via `requestAnimationFrame` (Design 5) — bounded to at most ~60 React updates/sec
  regardless of how many tokens arrive in that window, with a trailing flush after the stream ends so the
  last partial frame's tokens are never dropped.

---

## Allowed Files

- `server/services/ai/providerInterface.js` — add the abstract `streamMessage(session, message, onToken)`
  method (Design 1); `sendMessage` untouched.
- `server/services/ai/openaiProvider.js` — add `streamMessage` (Design 2); `sendMessage`,
  `extractToolCalls`, `extractText`, `buildToolResult`, `isResponseValid` untouched.
- `server/services/aiService.js` — `chat()` gains the `onToken` parameter and an optional
  `{ signal }` options object, forwarded to both `streamMessage` call sites (Design 3); the tool-loop and
  fallback-reply return points each gain one `onToken(...)` call. No other function in this file changes.
- `server/routes/ai.js` — the `POST /chat` handler only (Design 4): response becomes NDJSON, `res.flushHeaders()`
  (D-8), wraps the existing logic in try/catch/finally, adds the `AbortController`/`req.on('close')`/
  `clientDisconnected` wiring (D-10), and the recipe-suggestion streaming suppression (D-5). `GET
  /chat/history` and every other route in this file untouched.
- `client/src/api/index.js` — new `splitNdjsonLines` (exported, unit-testable, D-12) and `postStream`,
  added to the exported `api` object (Design 5). `request`/`get`/`post`/`patch`/`delete` untouched.
- `client/src/pages/ChatPage.jsx` — `send()`'s request call, the rAF-batched token accumulator (D-13), and
  the typing-indicator visibility condition (Design 5); the recipe-card/text-bubble suppression logic
  (`hasRecipeCards`) itself is unchanged — it now simply never receives non-empty streamed content for a
  cards-terminated reply, per D-5's server-side suppression.
- New: `client/src/api/index.ndjson.test.js` (or colocated equivalent, matching this repo's existing test
  file naming) — unit tests for `splitNdjsonLines` (Testing Plan).

## Forbidden Files

- The other 6 AI functions in `aiService.js` (`eatThisNow`, `expandSuggestion`, `parseReceipt`,
  `parseRecipeImage`, `parseRecipeText`, `enrichRecipeFields`) and their schemas — untouched; none of them
  use the provider abstraction or streaming (they call `openaiClient.chat.completions.create` directly per
  TASK-052).
- `server/services/ai/resolveProvider.js`, `server/middleware/requireAiAccess.js`,
  `server/middleware/aiRateLimit.js`, `server/middleware/createRateLimiter.js` — the access-gating and
  rate-limiting layer is unrelated to this task's response-transport change and is confirmed
  (Current Behavior) to run entirely before the route handler body.
- `server/services/chatService.js` — `getHistory`/`savePair`/`trimHistory` signatures and call sites are
  unchanged; persistence timing relative to the reply text is identical to today (Design 4).
- `server/services/chat/createToolHandlers.js` — the tool-handler contract (`async (args) => { ok, ... }`)
  and `ctx` mutation pattern are unchanged; this task only changes how the *response* that drives the loop
  is obtained, not the loop or its handlers.
- `client/src/hooks/useSpeechInput.js`, `client/src/hooks/useRecipeBlocklist.js`, and every non-chat
  component in `ChatPage.jsx` (recipe-card rendering markup, capabilities modal, suggested prompts) —
  unrelated to streaming.
- `vercel.json`, `api/index.js` — this task assumes the existing deployment shape works for streaming
  (Research/Known Risks); no config changes are proposed as part of this spec. If live verification
  (Testing Plan) shows streaming is actually buffered on Vercel, that is a **stop-and-reassess** trigger,
  not a signal to start tuning `vercel.json` speculatively within this task.

---

## Constraints

- **Zero new npm dependencies.** The installed `openai` SDK (`^4.104.0`) already provides
  `client.beta.chat.completions.stream()` with everything this task needs (Research); the client bundle
  gains no new dependency (D-4 — no `openai` import client-side).
- **`chat()`'s external contract changes only by appending two new optional parameters** (`onToken` default
  `() => {}`, and an options object with `signal`) — every other input/output is unchanged, so if any
  future caller invokes `chat()` without them, behavior is identical to today (silent no-op token callback,
  no abort signal).
- **No code may call `res.write`/`res.end` on `/chat` before `res.writeHead`'s headers are considered
  final, and no error after that point may be allowed to reach Express's global error middleware**
  ([app.js:72-79](../../server/app.js)) — enforced by wrapping the entire post-`writeHead` body in a single
  `try`/`catch`/`finally` (Design 4).
- **`chatService.savePair` must still run only after the complete reply text is known**, in the same
  relative order to `trimHistory` as today — streaming changes transport to the browser, not persistence
  semantics or timing (Design 4).
- **The mid-stream error contract is a deliberate, documented behavior change for this one endpoint**: once
  the first byte has been written, a failure can no longer change the HTTP status code — it must be
  signaled in-band as `{ type: 'error' }` (Design 4). Any future consumer of `POST /api/ai/chat` (today,
  only `ChatPage.jsx`) must handle that in-band event, not rely on HTTP status alone.
- **A mid-stream error means nothing is persisted** — `chatService.savePair` only runs in the success path
  (Design 4's `try` block, before the `catch`), exactly matching today's all-or-nothing persistence even
  though the transport is now incremental. This is worth stating as an explicit constraint, not just
  inferred from the code, since it's easy to assume partial streamed text implies partial persisted state.
- **Must be verified on a live Vercel Preview deployment, not only local dev, before this task is
  considered done** (Research/Known Risks) — local Express dev-server streaming behavior is not evidence
  about Vercel's Lambda-bridge-and-CDN path for the exact `res.write()`-in-a-raw-Node-handler shape this
  app uses.

---

## Testing / Verification Plan

1. **New unit test for `splitNdjsonLines`** (`client/src/api/index.ndjson.test.js` or equivalent): feed it
   a buffer containing multiple complete lines, a line split across two chunks (a real edge case — a
   network read can land mid-JSON-line), and an empty/whitespace-only line — assert the right raw lines
   are emitted in order and the correct remainder buffer is returned. Pure function, no network/mocking,
   and — per D-12 — no need to construct valid JSON at all, since this function no longer parses it.
2. **Existing test suite still passes unmodified**: `npm test --prefix server` — none of the 85 existing
   tests exercise `chat()` or `openaiProvider.js` today (confirmed by the total being unaffected by
   TASK-051/052's own test additions), so no regression is expected, but this confirms nothing else broke.
3. **`stream_options.include_usage` → `finalChatCompletion().usage` live confirmation**: send one live chat
   message in local dev, confirm the existing `prompt_tokens=… completion_tokens=… cached_tokens=…` log
   line still populates with real numbers (not `undefined`) — the one place this spec's static-code-reading
   confidence (Research) should still be checked against a real API response before trusting it in
   production.
4. **Plain-text happy path**: a chat message with no tool calls (e.g. "how do I store leftover rice?") —
   confirm the reply visibly streams token-by-token in the browser (not one blob appearing at once), and
   confirm via the browser's Network tab timing that response headers arrive well before the first token
   (D-8's `flushHeaders()`), not bundled together with it.
5. **Tool-calling happy path**: a message that triggers `add_pantry_item`/`consume_pantry_item` — confirm
   the `itemsAdded` pill still renders correctly after the stream completes, and confirm no stray or
   garbled partial text renders during the intervening tool-calling turn(s) (Design 2's "tool turns rarely
   emit content" claim, checked live rather than only inferred from SDK source).
6. **`suggest_recipes` path — confirm D-5's zero-flash behavior directly**: ask "what can I make with what
   I have?" — confirm the assistant bubble never appears at all for that reply (not even briefly) and only
   the recipe cards render, matching today's exact behavior; this replaces DRAFT-1's "observe the flash"
   step now that D-5 is designed to produce no flash to observe.
7. **Abort test**: start a chat message, close the tab or navigate away mid-stream — confirm via server log
   that the request was aborted (not left running silently to completion), and confirm no server-side
   error/crash results from the in-flight `res.write` calls hitting the now-closed socket (D-10's
   `clientDisconnected` guard).
8. **Error-path test**: force an error after at least one token has streamed (e.g. temporarily throw inside
   a tool handler, or disconnect network mid-response) — confirm the client shows an error toast and does
   not claim success, and confirm (by checking chat history after reload) that nothing was persisted for
   that turn, per the Constraints entry on this.
9. **Critical platform-risk verification — the highest-uncertainty item in this spec**: deploy to the
   project's staging Vercel Preview URL and, using the browser's real Network tab (not `curl`, which can
   mask proxy-buffering differences a real browser connection would show), confirm chat responses visibly
   arrive incrementally rather than all at once when the whole request completes. If this fails, this task
   is not shippable as designed and needs a fallback approach (Known Risks) before proceeding further.
10. **Client render-rate sanity check (D-13)**: during Step 4's plain-text happy path, instrument (e.g. a
    temporary console count, or React DevTools' render highlighting) how many `setMessages` calls / renders
    actually occur for one streamed reply — confirm it's bounded to roughly one per animation frame rather
    than one per token, and confirm the final flush after the stream ends isn't dropping trailing tokens
    (compare the fully-rendered bubble text against the `reply` logged server-side for the same request).
11. **Regression pass on chat's existing behaviors**: dietary allergy warnings still surface; the
    ambiguous-item clarification flow ("did you mean the eggs or the egg whites?") still works across
    multiple turns; `update_pantry_item`/`remove_pantry_item` still work end-to-end; `npm run lint` clean.

---

## Out of Scope (v1)

- **The other 3 remaining deferred TASK-051 findings** (vision-model accuracy eval, content-hash caching
  for recipe-URL parsing, context-size cap) — unrelated to this task, each still needs its own design
  decision or measurement per TASK-051's own accounting.
- **Migrating off Chat Completions onto OpenAI's Responses API** (D-6) — a larger, unrelated migration with
  no functional requirement forcing it here.
- **Adopting the SDK's `runTools()` automatic tool-execution helper** (D-1) — would change concurrency
  semantics and the `ctx`-mutation pattern `createToolHandlers.js` relies on; the existing hand-rolled loop
  is kept, only fed by a streaming call instead of a blocking one.
- **Streaming for the other 6 AI calls** (recipe parsing, receipt scanning, suggestion expansion, etc.) —
  those are bounded, already-fast single-shot extraction calls with a loading spinner; no UX benefit
  identified, not requested.
- **True SSE (`text/event-stream` + native `EventSource`) framing** (D-3) — not usable given this app's
  Bearer-token auth model; NDJSON-over-`fetch` chosen instead.
- **Any `vercel.json`/`api/index.js` configuration changes** — this spec assumes, but has not yet
  confirmed, that the existing deployment shape supports incremental streaming (Constraints/Known Risks);
  changing deployment config is explicitly not part of this task and would need its own investigation if
  Testing Plan step 9 fails.

---

## Known Risks

- **Vercel's streaming behavior for this app's exact deployment shape (raw Express handler wrapped as a
  Node.js Vercel Function, not Next.js/Edge) is not confirmed by any official documentation found in
  Research — only inferred from a general platform-level announcement.** This is the single biggest open
  risk in this entire spec. If Testing Plan step 9 shows the response is actually buffered until
  completion on a real Preview deployment, this task delivers zero user-visible benefit in production
  despite working perfectly in local dev — a fundamentally different outcome than "a minor bug to fix,"
  and worth treating as a go/no-go gate rather than a footnote.
- **D-5's `suggest_recipes` fix is scoped to the common case, not the anomalous one.** The zero-flash
  design (Design 4/D-5) depends on `ctx.result.recipeSuggestions` being populated in a turn strictly
  *before* the text-generating turn — true for every normal `suggest_recipes` invocation given this app's
  system prompt instructs the model to call tools before responding in text. If a future prompt change (or
  model behavior drift) ever caused a single turn to emit both a tool call and narrated text together, that
  turn's text would stream to the client before `ctx.result.recipeSuggestions` reflects it — the same
  already-flagged rare edge case below, not a new one introduced by D-5's fix.
- **The mid-stream error contract is a real behavioral departure from this app's otherwise-uniform
  "one atomic HTTP response, status code says everything" pattern**, used by every other endpoint in this
  app including the other 6 AI calls. Scoped to exactly one endpoint (`POST /api/ai/chat`) by design, but
  worth remembering if this endpoint ever grows a second consumer.
- **The rare case of a single turn producing both a tool call and narrated text** (Design 2) is not
  specially handled — whatever partial text streams during that turn would be visible to the user even
  though only the *final* turn's `extractText` result is what's actually persisted via `chatService.savePair`.
  This is an existing gap in how `chat()` reasons about "the reply," not something newly introduced by this
  task, but streaming makes it newly *visible* in a way the blocking version never was (the blocking
  version simply discards any earlier turn's stray text without ever displaying it).
- **`stream_options.include_usage`'s effect on `finalChatCompletion().usage` was confirmed by reading SDK
  source, not by a live call, at spec-drafting time** — high confidence, but Testing Plan step 3 exists
  specifically because this project's own convention (TASK-052) is to not fully trust static code reading
  over a live check when one is cheap to do.
- **The `clientDisconnected` write-guard (D-10) was found by tracing through a review question, not by an
  independent audit of every write path** — it fixes the specific throw-inside-`catch` scenario described
  in D-10, but Testing Plan step 7's live disconnect test is what actually confirms no other unguarded
  write path exists, rather than trusting the code-reading alone.
