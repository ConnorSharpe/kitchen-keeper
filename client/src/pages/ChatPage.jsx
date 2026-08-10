import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/index.js';
import toast from 'react-hot-toast';
import { useSpeechInput } from '../hooks/useSpeechInput.js';
import { useRecipeBlocklist } from '../hooks/useRecipeBlocklist.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import RecipeSuggestionCard from '../components/recipes/RecipeSuggestionCard.jsx';

// Round to max 2 decimal places, strip trailing zeros
function formatQty(n) {
  return parseFloat(n.toFixed(2)).toString();
}

const SUGGESTED_PROMPTS = [
  'What can I make with what I have?',
  'How do I store leftovers to make them last longer?',
  "What's a good substitute for eggs in baking?",
];

let tempIdCounter = 0;
function nextTempId() {
  return `temp_${++tempIdCounter}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [savedRecipeNames, setSavedRecipeNames] = useState(new Set());
  const [showCapabilities, setShowCapabilities] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const { addBlock } = useRecipeBlocklist();

  useEffect(() => () => abortRef.current?.abort(), []);

  const {
    supported: micSupported,
    iosPwaCaveat,
    listening,
    toggle: toggleMic,
  } = useSpeechInput({
    lang: navigator.language,
    onResult: (transcript) =>
      setInput((prev) => {
        const base = prev.trimEnd();
        return base ? `${base} ${transcript.trim()}` : transcript.trim();
      }),
    onError: (errorCode) => {
      if (errorCode === 'not-allowed' || errorCode === 'audio-capture') {
        toast.error(
          'Microphone permission denied. Check your browser settings.'
        );
      }
    },
  });

  // Load persisted history and saved recipe names on mount
  useEffect(() => {
    api
      .get('/api/ai/chat/history')
      .then(({ messages: history }) => {
        setMessages(
          history.map((m) => ({
            ...m,
            key: String(m.id),
            recipeSuggestions: m.metadata?.recipeSuggestions ?? [],
          }))
        );
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });

    // Seed savedRecipeNames so history-loaded cards show correct "Saved" state
    api
      .get('/api/recipes')
      .then(({ recipes }) => {
        setSavedRecipeNames(new Set(recipes.map((r) => r.name)));
      })
      .catch(() => {}); // non-fatal — falls back to empty Set; createOrIgnore guards DB integrity
  }, []);

  // Scroll to the bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text) {
    const userText = text.trim();
    if (!userText || loading) return;

    const tempKey = nextTempId();
    const assistantKey = nextTempId();
    setInput('');
    setMessages((prev) => [
      ...prev,
      { key: tempKey, role: 'user', content: userText },
      {
        key: assistantKey,
        role: 'assistant',
        content: '',
        itemsAdded: [],
        recipeSuggestions: [],
      },
    ]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Batches incoming deltas into one setState per animation frame instead of
    // one per token — meaningfully reduces ReactMarkdown re-parse frequency on
    // this app's mobile/PWA usage.
    let pending = '';
    let flushScheduled = false;
    function flush() {
      flushScheduled = false;
      const delta = pending;
      pending = '';
      setMessages((prev) =>
        prev.map((m) =>
          m.key === assistantKey ? { ...m, content: m.content + delta } : m
        )
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
        { signal: controller.signal, onToken }
      );
      if (flushScheduled) flush();
      setMessages((prev) =>
        prev.map((m) =>
          m.key === assistantKey
            ? {
                ...m,
                itemsAdded: itemsAdded ?? [],
                recipeSuggestions: recipeSuggestions ?? [],
              }
            : m
        )
      );
    } catch (err) {
      // Remove the optimistic user message and the streaming placeholder — neither was saved to the DB
      setMessages((prev) =>
        prev.filter((m) => m.key !== tempKey && m.key !== assistantKey)
      );
      setInput(userText);
      toast.error(err.message || 'Failed to send message. Please try again.');
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleSaveRecipe(recipeName) {
    setSavedRecipeNames((prev) => new Set([...prev, recipeName]));
    send(`save ${recipeName}`);
  }

  async function handleBlockSuggestion(recipe) {
    try {
      await addBlock({
        source: recipe.source,
        sourceId: recipe.sourceId,
        name: recipe.name,
      });
      toast.success(`"${recipe.name}" won't be suggested again`);
    } catch (err) {
      toast.error(err.message || 'Failed to block recipe');
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  // Send on Enter, allow Shift+Enter for newlines
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const isEmpty = historyLoaded && messages.length === 0 && !loading;

  return (
    // h-screen so the input bar stays at the bottom of the viewport.
    // The sidebar is sticky h-screen, so this fills the remaining column.
    <div className="h-screen flex flex-col">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-surface">
        <PageHeader
          title="Kitchen Keeper"
          subtitle="Ask anything about your kitchen, ingredients, or recipes."
          actions={
            <button
              onClick={() => setShowCapabilities(true)}
              className="w-7 h-7 rounded-full border border-border text-ink-subtle hover:text-ink-muted hover:border-primary flex items-center justify-center text-sm transition-colors"
              aria-label="What can the assistant do?"
              title="What can the assistant do?"
            >
              ⓘ
            </button>
          }
        />
      </div>

      {showCapabilities && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCapabilities(false)}
        >
          <div
            className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-ink">
                What can Kitchen Keeper do?
              </h2>
              <button
                onClick={() => setShowCapabilities(false)}
                className="text-ink-subtle hover:text-ink-muted text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-ink-muted leading-relaxed">
              Ask it to add, update, or remove pantry items just by describing
              them in plain language, or to log what you&apos;ve eaten or used
              up. Ask what to cook and it&apos;ll suggest recipes from what&apos;s
              already in your pantry — prioritizing what&apos;s expiring soon —
              and you can save any suggestion straight to your recipe book.
              Suggestions always account for your household&apos;s dietary
              profile and flag allergy conflicts.
            </p>
            <p className="text-xs text-ink-subtle leading-relaxed">
              Receipt scanning, recipe-photo import, and importing recipes
              from a URL are separate tools elsewhere in the app — the chat
              assistant itself can&apos;t do those.
            </p>
          </div>
        </div>
      )}

      {/* ── Message list ── */}
      {/* min-h-0 is required: flex children default to min-height:auto which
          prevents the container from shrinking and enabling overflow scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {/* Empty state with suggested prompts */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <p className="text-3xl mb-2" aria-hidden>
                🍳
              </p>
              <h2 className="text-base font-semibold text-ink-muted">
                What would you like to know?
              </h2>
              <p className="text-sm text-ink-subtle mt-1">
                Kitchen Keeper knows your pantry and saved recipes — ask away.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="text-left px-4 py-2.5 rounded-xl border border-border text-sm text-ink-muted hover:bg-page hover:border-primary transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg) => {
          // TASK-034 Part C: structural suppression — when recipe cards are present, the
          // assistant's text bubble (and avatar) is not rendered at all. Cards only.
          const hasRecipeCards =
            msg.role === 'assistant' && msg.recipeSuggestions?.length > 0;
          // TASK-053: the streaming placeholder starts with empty content before
          // its first token arrives (and stays empty for the whole exchange when
          // the reply is suppressed server-side for D-5) — don't render a hollow
          // bubble alongside the typing dots in either case.
          const isEmptyAssistantBubble =
            msg.role === 'assistant' && !msg.content;

          return (
            <div key={msg.key}>
              {!hasRecipeCards && !isEmptyAssistantBubble && (
                <div
                  className={`flex items-end gap-2 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div
                      className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm flex-shrink-0"
                      aria-hidden
                    >
                      🍳
                    </div>
                  )}

                  <div
                    className={`max-w-[75%] text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'chat-bubble-user rounded-br-sm'
                        : 'chat-bubble-assistant rounded-bl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      // ReactMarkdown with remark-gfm renders tables, task lists,
                      // and strikethrough correctly — without it, pipes render as text.
                      <div className="prose-chat">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && msg.itemsAdded?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-9">
                  {msg.itemsAdded.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-status-ok-bg/30 border border-status-ok-bg text-xs text-status-ok-text"
                    >
                      <span aria-hidden>+</span>
                      {item.name} added to pantry
                    </span>
                  ))}
                </div>
              )}

              {msg.role === 'assistant' &&
                msg.recipeSuggestions?.length > 0 && (
                  <div className="flex flex-col gap-3 mt-2 ml-9">
                    {msg.recipeSuggestions.map((recipe) => {
                      const prepSteps = recipe.prepSteps ?? [];
                      const ingredients = recipe.ingredients ?? [];
                      const isSaved = savedRecipeNames.has(recipe.name);
                      const footerNote = [
                        recipe.prepMins != null && `${recipe.prepMins} min prep`,
                        recipe.cookMins != null && `${recipe.cookMins} min cook`,
                        recipe.servings != null && `${recipe.servings} servings`,
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <RecipeSuggestionCard
                          key={recipe.name}
                          className="w-full max-w-md sm:max-w-[75%]"
                          item={recipe}
                          name={recipe.name}
                          sourceUrl={recipe.sourceUrl}
                          description={recipe.description}
                          footerNote={footerNote ? `⏱ ${footerNote}` : undefined}
                          onSave={(r) => handleSaveRecipe(r.name)}
                          isSaving={loading}
                          isSaved={isSaved}
                          onBlock={handleBlockSuggestion}
                        >
                          {/* Prep steps */}
                          {prepSteps.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-1">
                                Before You Start
                              </p>
                              <ul className="space-y-0.5">
                                {prepSteps.map((step, i) => (
                                  <li
                                    key={i}
                                    className="text-xs text-ink-muted flex gap-1.5"
                                  >
                                    <span aria-hidden>•</span>
                                    <span>{step}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Ingredients */}
                          {ingredients.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-1">
                                Ingredients
                              </p>
                              <ul className="space-y-0.5">
                                {ingredients.map((ing, i) => {
                                  const status = ing.pantryStatus ?? 'missing';
                                  const have = status === 'have';
                                  const qty = [
                                    ing.quantity != null &&
                                      String(ing.quantity),
                                    ing.unit,
                                  ]
                                    .filter(Boolean)
                                    .join(' ');
                                  return (
                                    <li
                                      key={i}
                                      className={`text-xs flex gap-1.5 ${have ? 'text-status-ok-text' : 'text-status-critical-text'}`}
                                    >
                                      <span aria-hidden>•</span>
                                      <span>
                                        <strong>
                                          {qty && `${qty} `}
                                          {ing.name}
                                        </strong>
                                        {status === 'partial' &&
                                          ing.needToBuy != null && (
                                            <span className="font-normal ml-1">
                                              (need to buy{' '}
                                              {formatQty(ing.needToBuy)}
                                              {ing.unit ? ` ${ing.unit}` : ''})
                                            </span>
                                          )}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {/* Allergy note */}
                          {recipe.allergyNote && (
                            <p className="text-xs font-medium text-status-warning-text bg-status-warning-bg/30 rounded-lg px-2 py-1">
                              ⚠ {recipe.allergyNote}
                            </p>
                          )}

                          {/* Health note */}
                          {recipe.healthNote && (
                            <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-2 py-1">
                              ℹ {recipe.healthNote}
                            </p>
                          )}
                        </RecipeSuggestionCard>
                      );
                    })}
                  </div>
                )}
            </div>
          );
        })}

        {/* Typing indicator — animated dots until the first token of the final
            (text-producing) turn arrives; the live streaming bubble takes over
            once the assistant message has content. */}
        {loading && !messages[messages.length - 1]?.content && (
          <div className="flex items-end gap-2 justify-start">
            <div
              className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm flex-shrink-0"
              aria-hidden
            >
              🍳
            </div>
            <div className="chat-bubble-assistant rounded-bl-sm">
              <div className="flex gap-1 items-center" aria-label="Thinking…">
                <span className="w-2 h-2 bg-ink-subtle rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-ink-subtle rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-ink-subtle rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Invisible anchor — scroll target for auto-scroll to bottom */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-border bg-surface px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          {/* Mic button — mobile only via md:hidden; also feature-detected via supported */}
          {(micSupported || iosPwaCaveat) && (
            <button
              type="button"
              onClick={
                iosPwaCaveat
                  ? () =>
                      toast(
                        "Voice input isn't available when Kitchen Keeper is installed as an app."
                      )
                  : toggleMic
              }
              disabled={!iosPwaCaveat && loading}
              className={`md:hidden flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg transition-colors
                ${
                  iosPwaCaveat
                    ? 'border-border text-ink-subtle cursor-default'
                    : 'border-border disabled:opacity-50'
                }`}
              aria-label={listening ? 'Stop recording' : 'Voice input'}
            >
              {listening ? (
                <span
                  className="w-3 h-3 rounded-full bg-red-500 animate-pulse"
                  aria-hidden
                />
              ) : (
                <span aria-hidden>🎙️</span>
              )}
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your kitchen…"
            rows={1}
            disabled={loading}
            className="input flex-1 resize-none rounded-xl py-2.5 disabled:bg-page disabled:text-ink-subtle"
            style={{ maxHeight: '120px' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="btn-primary flex-shrink-0"
          >
            Send
          </button>
        </form>
        <p className="text-xs text-ink-subtle mt-1.5">
          Press Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
