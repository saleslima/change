'use strict';

const CACHE_NAME = 'civiloff-v9.23-lotacao-dupla';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-config.js',
  './firebase-devices.js',
  './firebase-troca.js',
  './access-admin.js',
  './email-config.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/troca.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './flame.gif'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function isAppScript(pathname) {
  return (
    pathname.endsWith('/email-config.js')
    || pathname.endsWith('/access-admin.js')
    || pathname.endsWith('/app.js')
    || pathname.endsWith('/firebase-config.js')
    || pathname.endsWith('/firebase-devices.js')
    || pathname.endsWith('/firebase-troca.js')
    || pathname.endsWith('/firebase-presence.js')
    || pathname.endsWith('/sw.js')
    || pathname.endsWith('/index.html')
    || pathname.endsWith('/')
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // Scripts e HTML: rede primeiro, para correções de e-mail/login entrarem em vigor.
  if (isAppScript(requestUrl.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
