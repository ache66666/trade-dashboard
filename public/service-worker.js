'use strict';

var CACHE_NAME = 'market-coach-static-v1';
var STATIC_PATHS = [
  '/styles.css',
  '/overview.css',
  '/auth.css',
  '/journal.css',
  '/morning.css',
  '/auth.js',
  '/auth-ui.js',
  '/app.js',
  '/journal.js',
  '/morning.js',
  '/manifest.webmanifest',
  '/icons/market-coach.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(STATIC_PATHS);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.map(function (name) {
      return name === CACHE_NAME ? null : caches.delete(name);
    }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;
  url = new URL(request.url);
  if (url.origin !== self.location.origin || STATIC_PATHS.indexOf(url.pathname) < 0) return;
  event.respondWith(fetch(request).then(function (response) {
    if (!response || !response.ok || response.type !== 'basic') return response;
    return caches.open(CACHE_NAME).then(function (cache) {
      cache.put(request, response.clone());
      return response;
    });
  }).catch(function () {
    return caches.match(request);
  }));
});
