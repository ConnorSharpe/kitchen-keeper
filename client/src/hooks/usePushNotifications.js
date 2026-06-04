import { useState, useEffect } from 'react';
import { api } from '../api/index.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Shared registration helper — idempotent; both mount init and subscribe() use this.
// Ensures a single registration call site for easier debugging.
async function getSWRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

export function usePushNotifications() {
  const [permission,   setPermission]   = useState(Notification.permission);
  const [subscription, setSubscription] = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  // On mount: register SW (idempotent via getSWRegistration), then check for existing sub.
  // Register first — navigator.serviceWorker.ready hangs indefinitely on first visit
  // if no SW has ever been registered. Using the returned registration is deterministic.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    getSWRegistration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscription(sub))
      .catch(() => {});
  }, []);

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const { publicKey } = await api.get('/api/push/vapid-public-key');

      const reg = await getSWRegistration();
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setPermission(Notification.permission);
      setSubscription(sub);

      await api.post('/api/push/subscribe', sub.toJSON());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    if (!subscription) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;

  return { isSupported, permission, subscription, loading, error, subscribe, unsubscribe };
}
