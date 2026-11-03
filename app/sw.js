// Service worker : permet d'installer l'application et de l'ouvrir avec un réseau faible.
// Stratégie « réseau d'abord » pour les fichiers de l'application : une mise à jour publiée
// est visible tout de suite, et le cache ne sert qu'en secours hors connexion.
// Les appels à Supabase (autre domaine) ne passent jamais par ce cache.
const CACHE = 'facturesn-v26';
const SHELL = [
  './', './index.html', './css/app.css', './js/app.js', './js/db.js', './js/config.js', './js/format.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
