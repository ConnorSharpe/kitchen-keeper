import { useState, useCallback } from 'react';
import { api } from '../api/index.js';

export function useRecipeBlocklist() {
  const [blocklist, setBlocklist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/recipes/blocklist');
      setBlocklist(data.blocklist ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const addBlock = useCallback(async ({ source, sourceId, name }) => {
    const result = await api.post('/api/recipes/blocklist', {
      source,
      sourceId,
      name,
    });
    if (result.entry) {
      setBlocklist((prev) => [result.entry, ...prev]);
    }
    return result.entry;
  }, []);

  const removeBlock = useCallback(async (id) => {
    await api.delete(`/api/recipes/blocklist/${id}`);
    setBlocklist((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return { blocklist, loading, error, refresh, addBlock, removeBlock };
}
