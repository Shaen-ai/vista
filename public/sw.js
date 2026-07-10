// Passthrough service worker for PWA installability only.
// Standard lifecycle: no skipWaiting() / clients.claim() — no cache to invalidate.
// If offline caching is added later, introduce an explicit update strategy in that PR.

self.addEventListener("install", () => {
  // Intentionally empty — rely on default SW lifecycle.
});

self.addEventListener("activate", () => {
  // Intentionally empty — no cache to invalidate.
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
