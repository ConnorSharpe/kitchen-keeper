import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/index.js';
import { usePantryContext } from '../context/PantryContext.jsx';

export function usePantry() {
  const { refresh: refreshContext } = usePantryContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const data = await api.get('/api/pantry');
      setItems(data.items);
    } catch {
      toast.error('Failed to load pantry items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async (body) => {
    const data = await api.post('/api/pantry', body);
    setItems((prev) => [data.item, ...prev]);
    refreshContext(); // keep sidebar badge and expiry strip current
    return data.item;
  };

  const updateItem = async (id, body) => {
    const data = await api.patch(`/api/pantry/${id}`, body);
    setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    refreshContext(); // expiry date may have changed
    return data.item;
  };

  const removeItem = async (id) => {
    await api.delete(`/api/pantry/${id}`);
    setItems((prev) => prev.filter((i) => i.id !== id));
    refreshContext();
  };

  const markUsed = async (id) => {
    await api.patch(`/api/pantry/${id}/use`);
    // Item is now consumed — remove it from the active list
    setItems((prev) => prev.filter((i) => i.id !== id));
    refreshContext(); // waste-saved counter and badge may change
  };

  const toggleFreeze = async (id) => {
    const data = await api.patch(`/api/pantry/${id}/freeze`);
    setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    refreshContext(); // expiry date changes on freeze
    return data.item;
  };

  return { items, loading, addItem, updateItem, removeItem, markUsed, toggleFreeze, refresh: fetchItems };
}
