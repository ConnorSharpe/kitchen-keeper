const CACHE_NAME = 'kitchen-keeper-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let data = { title: 'Kitchen Keeper', body: 'You have a pantry update.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // malformed payload — use default message
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/pantry') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/pantry');
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Let API and upload requests go straight to the network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, toCache));
        }
        return response;
      });
      // Serve cached version immediately; fall back to network
      return cached || networkFetch;
    })
  );
});
