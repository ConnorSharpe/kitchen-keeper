import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/index.js';
import toast from 'react-hot-toast';

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
  const bottomRef  = useRef(null);
  const textareaRef = useRef(null);

  // Load persisted history on mount — chat survives navigation
  useEffect(() => {
    api.get('/api/ai/chat/history')
      .then(({ messages: history }) => {
        // DB rows have integer id; normalise to string key for React
        setMessages(history.map((m) => ({ ...m, key: String(m.id) })));
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });
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
      const { reply, itemsAdded } = await api.post('/api/ai/chat', { message: userText });
      setMessages((prev) => [
        ...prev,
        { key: nextTempId(), role: 'assistant', content: reply, itemsAdded: itemsAdded ?? [] },
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
        <h1 className="text-lg font-semibold text-gray-800">Explore</h1>
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
        {messages.map((msg) => (
          <div key={msg.key}>
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
          </div>
        ))}

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
