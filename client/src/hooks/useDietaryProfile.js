import { useState, useEffect } from 'react';
import { api } from '../api/index.js';

export function useDietaryProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/api/dietary')
      .then((data) => setProfile(data))
      .catch(() =>
        setProfile({ conditions: [], allergies: [], foodPreferences: [] })
      )
      .finally(() => setLoading(false));
  }, []);

  async function save(data) {
    setSaving(true);
    try {
      await api.patch('/api/dietary', data);
      setProfile((prev) => ({ ...prev, ...data }));
    } finally {
      setSaving(false);
    }
  }

  return { profile, loading, saving, save };
}
