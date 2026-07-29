import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';

const MAX_LENGTH = 2000;

export default function SuggestionBox() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.post('/api/suggestions', { message: message.trim() });
      toast.success('Thanks! Your feedback helps improve Kitchen Keeper.');
      setMessage('');
    } catch (err) {
      toast.error(err.message || 'Failed to send suggestion');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">
        Suggest an Improvement
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's frustrating? What's missing? We'd love your ideas."
          maxLength={MAX_LENGTH}
          rows={3}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm resize-none
                     focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          required
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {message.length}/{MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md
                       hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : 'Send Suggestion'}
          </button>
        </div>
      </form>
    </div>
  );
}
