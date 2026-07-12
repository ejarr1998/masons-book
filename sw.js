const CACHE_NAME = "jarrett-book-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for Firebase/API calls, cache-first for shell files.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("firestore.googleapis.com") || url.includes("firebasestorage") || url.includes("googleapis.com")) {
    return; // let these go straight to network; Firestore handles its own offline cache
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
