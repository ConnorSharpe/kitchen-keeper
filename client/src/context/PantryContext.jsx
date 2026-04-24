import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/index.js';

const PantryContext = createContext(null);

// Returns the ISO string for the most recent Monday at 00:00:00 UTC
function getMondayISO() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

export function PantryProvider({ children }) {
  const [expiringItems, setExpiringItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [wasteSaved, setWasteSaved] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [expiring, all, waste] = await Promise.all([
        api.get('/api/pantry?expiring=7'),
        api.get('/api/pantry'),
        api.get(`/api/pantry/waste-saved?since=${getMondayISO()}`),
      ]);

      // Sort most-urgent first (earliest expiry date); items with no date go last
      const sorted = [...expiring.items].sort((a, b) => {
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return new Date(a.expiryDate) - new Date(b.expiryDate);
      });

      setExpiringItems(sorted);
      setAllItems(all.items);
      setWasteSaved(waste.count);
    } catch {
      toast.error('Failed to load pantry data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PantryContext.Provider value={{ expiringItems, allItems, wasteSaved, loading, refresh }}>
      {children}
    </PantryContext.Provider>
  );
}

export function usePantryContext() {
  return useContext(PantryContext);
}
