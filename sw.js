/**
 * Service Worker for Ahmadiah Pitch Manager PWA
 * Caches static shell, assets, and styles for offline reliability.
 * Realtime booking data is ALWAYS handled network-first with offline alert.
 */

const CACHE_NAME = 'ahmadiah-pitch-cache-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './display.html',
  './admin/index.html',
  './manifest.json',
  './css/main.css',
  './css/admin.css',
  './css/display.css',
  './css/animations.css',
  './js/utils.js',
  './js/firebase-config.js',
  './js/countdown.js',
  './js/booking.js',
  './js/schedule.js',
  './js/display.js',
  './js/app.js',
  './js/admin/auth.js',
  './js/admin/admin-dashboard.js',
  './js/admin/finance.js',
  './js/admin/expenses.js',
  './js/admin/reports.js',
  './js/admin/settings.js',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-caching encountered an issue, skipping non-fatal items:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do NOT cache Firebase database or functions calls
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || event.request.method !== 'GET') {
    return;
  }

  // Network-First with Cache Fallback for HTML documents, Cache-First for static assets
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Revalidate in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return networkResponse;
      });
    })
  );
});
