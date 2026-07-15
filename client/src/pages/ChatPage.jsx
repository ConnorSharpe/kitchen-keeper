import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/index.js';
import toast from 'react-hot-toast';
import { useSpeechInput } from '../hooks/useSpeechInput.js';
import { useRecipeBlocklist } from '../hooks/useRecipeBlocklist.js';

// Round to max 2 decimal places, strip trailing zeros
function formatQty(n) {
  return parseFloat(n.toFixed(2)).toString();
}

const SUGGESTED_PROMPTS = [
  "What can I make with what I have?",
  "How do I store leftovers to make them last longer?",
  "What's a good substitute for eggs in baking?",
];

let tempIdCounter = 0;
function nextTempId() {
  return `temp_${++tempIdCounter}`;
}

export default function ChatPage() {
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [savedRecipeNames, setSavedRecipeNames] = useState(new Set());
  const bottomRef  = useRef(null);
  const textareaRef = useRef(null);
  const { addBlock } = useRecipeBlocklist();

  const { supported: micSupported, iosPwaCaveat, listening, toggle: toggleMic } = useSpeechInput({
    lang: navigator.language,
    onResult: (transcript) =>
      setInput((prev) => {
        const base = prev.trimEnd();
        return base ? `${base} ${transcript.trim()}` : transcript.trim();
      }),
    onError: (errorCode) => {
      if (errorCode === 'not-allowed' || errorCode === 'audio-capture') {
        toast.error('Microphone permission denied. Check your browser settings.');
      }
    },
  });

  // Load persisted history and saved recipe names on mount
  useEffect(() => {
    api.get('/api/ai/chat/history')
      .then(({ messages: history }) => {
        setMessages(history.map((m) => ({
          ...m,
          key: String(m.id),
          recipeSuggestions: m.metadata?.recipeSuggestions ?? [],
        })));
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });

    // Seed savedRecipeNames so history-loaded cards show correct "Saved" state
    api.get('/api/recipes')
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
    setInput('');
    setMessages((prev) => [
      ...prev,
      { key: tempKey, role: 'user', content: userText },
    ]);
    setLoading(true);

    try {
      const { reply, itemsAdded, recipeSuggestions } = await api.post('/api/ai/chat', { message: userText });
      setMessages((prev) => [
        ...prev,
        {
          key: nextTempId(),
          role: 'assistant',
          content: reply,
          itemsAdded: itemsAdded ?? [],
          recipeSuggestions: recipeSuggestions ?? [],
        },
      ]);
    } catch (err) {
      // Remove the optimistic user message — it was not saved to the DB
      setMessages((prev) => prev.filter((m) => m.key !== tempKey));
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
      await addBlock({ source: recipe.source, sourceId: recipe.sourceId, name: recipe.name });
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
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-800">Kitchen Keeper</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Ask anything about your kitchen, ingredients, or recipes.
        </p>
      </div>

      {/* ── Message list ── */}
      {/* min-h-0 is required: flex children default to min-height:auto which
          prevents the container from shrinking and enabling overflow scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">

        {/* Empty state with suggested prompts */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <p className="text-3xl mb-2" aria-hidden>🍳</p>
              <h2 className="text-base font-semibold text-gray-700">
                What would you like to know?
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Kitchen Keeper knows your pantry and saved recipes — ask away.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="text-left px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-orange-50 hover:border-orange-300 transition-colors"
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
          const hasRecipeCards = msg.role === 'assistant' && msg.recipeSuggestions?.length > 0;

          return (
          <div key={msg.key}>
            {!hasRecipeCards && (
            <div
              className={`flex items-end gap-2 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-sm flex-shrink-0"
                  aria-hidden
                >
                  🍳
                </div>
              )}

              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-orange-500 text-white rounded-br-sm'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
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
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-xs text-green-700"
                  >
                    <span aria-hidden>+</span>
                    {item.name} added to pantry
                  </span>
                ))}
              </div>
            )}

            {msg.role === 'assistant' && msg.recipeSuggestions?.length > 0 && (
              <div className="flex flex-col gap-3 mt-2 ml-9">
                {msg.recipeSuggestions.map((recipe) => {
                  const prepSteps = recipe.prepSteps ?? [];
                  const ingredients = recipe.ingredients ?? [];
                  const isSaved = savedRecipeNames.has(recipe.name);

                  return (
                    <div
                      key={recipe.name}
                      className="w-full max-w-md sm:max-w-[75%] bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800"
                    >
                      {/* Header row: name + save button */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-semibold leading-snug">
                          {recipe.sourceUrl ? (
                            <a
                              href={recipe.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-600 hover:underline"
                            >
                              {recipe.name} <span aria-hidden>↗</span>
                            </a>
                          ) : (
                            recipe.name
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleBlockSuggestion(recipe)}
                            className="text-sm leading-none text-gray-300 hover:text-red-500 transition-colors"
                            aria-label="Don't suggest again"
                            title="Don't suggest again"
                          >
                            🚫
                          </button>
                          <button
                            onClick={() => handleSaveRecipe(recipe.name)}
                            disabled={isSaved || loading}
                            className="px-3 py-1 rounded-lg bg-orange-500 text-white text-xs font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {isSaved ? 'Saved' : 'Save Recipe'}
                          </button>
                        </div>
                      </div>

                      {/* Description */}
                      {recipe.description && (
                        <p className="text-gray-500 text-xs mb-2">{recipe.description}</p>
                      )}

                      {/* Time / servings metadata */}
                      {(recipe.prepMins != null || recipe.cookMins != null || recipe.servings != null) && (
                        <p className="text-xs text-gray-400 mb-3">
                          ⏱{' '}
                          {[
                            recipe.prepMins != null && `${recipe.prepMins} min prep`,
                            recipe.cookMins != null && `${recipe.cookMins} min cook`,
                            recipe.servings != null && `${recipe.servings} servings`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}

                      {/* Prep steps */}
                      {prepSteps.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            Before You Start
                          </p>
                          <ul className="space-y-0.5">
                            {prepSteps.map((step, i) => (
                              <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                                <span aria-hidden>•</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Ingredients */}
                      {ingredients.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            Ingredients
                          </p>
                          <ul className="space-y-0.5">
                            {ingredients.map((ing, i) => {
                              const status = ing.pantryStatus ?? 'missing';
                              const have = status === 'have';
                              const qty = [
                                ing.quantity != null && String(ing.quantity),
                                ing.unit,
                              ].filter(Boolean).join(' ');
                              return (
                                <li
                                  key={i}
                                  className={`text-xs flex gap-1.5 ${have ? 'text-green-700' : 'text-red-600'}`}
                                >
                                  <span aria-hidden>•</span>
                                  <span>
                                    <strong>{qty && `${qty} `}{ing.name}</strong>
                                    {status === 'partial' && ing.needToBuy != null && (
                                      <span className="font-normal ml-1">
                                        (need to buy {formatQty(ing.needToBuy)}{ing.unit ? ` ${ing.unit}` : ''})
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
                        <p className="mt-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
                          ⚠ {recipe.allergyNote}
                        </p>
                      )}

                      {/* Health note */}
                      {recipe.healthNote && (
                        <p className="mt-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg px-2 py-1">
                          ℹ {recipe.healthNote}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}

        {/* Typing indicator — animated dots while awaiting assistant reply */}
        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <div
              className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-sm flex-shrink-0"
              aria-hidden
            >
              🍳
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center" aria-label="Thinking…">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Invisible anchor — scroll target for auto-scroll to bottom */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          {/* Mic button — mobile only via md:hidden; also feature-detected via supported */}
          {(micSupported || iosPwaCaveat) && (
            <button
              type="button"
              onClick={iosPwaCaveat
                ? () => toast('Voice input isn\'t available when Kitchen Keeper is installed as an app.')
                : toggleMic
              }
              disabled={!iosPwaCaveat && loading}
              className={`md:hidden flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg transition-colors
                ${iosPwaCaveat
                  ? 'border-gray-100 text-gray-300 cursor-default'
                  : 'border-gray-200 disabled:opacity-50'
                }`}
              aria-label={listening ? 'Stop recording' : 'Voice input'}
            >
              {listening ? (
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" aria-hidden />
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
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            style={{ maxHeight: '120px' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            Send
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-1.5">
          Press Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
