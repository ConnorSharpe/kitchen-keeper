import { useState, useCallback } from 'react';
import { api } from '../api/index.js';

export function useRecipes() {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/recipes');
      setRecipes(data.recipes ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const addRecipe = useCallback(async (data) => {
    const result = await api.post('/api/recipes', data);
    setRecipes((prev) => [result.recipe, ...prev]);
    return result.recipe;
  }, []);

  const updateRecipe = useCallback(async (id, data) => {
    const result = await api.patch(`/api/recipes/${id}`, data);
    setRecipes((prev) => prev.map((r) => (r.id === id ? result.recipe : r)));
    return result.recipe;
  }, []);

  const removeRecipe = useCallback(async (id) => {
    await api.delete(`/api/recipes/${id}`);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleFavorite = useCallback(async (id) => {
    const result = await api.patch(`/api/recipes/${id}/favorite`);
    setRecipes((prev) => prev.map((r) => (r.id === id ? result.recipe : r)));
    return result.recipe;
  }, []);

  return {
    recipes,
    loading,
    error,
    refresh,
    addRecipe,
    updateRecipe,
    removeRecipe,
    toggleFavorite,
  };
}
