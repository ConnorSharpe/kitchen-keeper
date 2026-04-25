import { useState, useCallback } from 'react';
import { api } from '../api/index.js';
import toast from 'react-hot-toast';

export function useShopping() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/shopping');
      setLists(data.lists ?? []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Returns { list, items, warnings } so the caller can display results.
  const buildList = useCallback(async (name, recipeIds) => {
    const data = await api.post('/api/shopping/build', { name, recipeIds });
    setLists((prev) => [data.list, ...prev]);
    return data;
  }, []);

  const removeList = useCallback(async (listId) => {
    await api.delete(`/api/shopping/${listId}`);
    setLists((prev) => prev.filter((l) => l.id !== listId));
  }, []);

  return { lists, loading, fetchLists, buildList, removeList };
}
