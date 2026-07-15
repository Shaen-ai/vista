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
  // Never intercept API / streaming / non-GET requests. A pass-through SW
  // mediating a streaming POST (e.g. the SSE /api/project/create-stream) stalls
  // the stream — the browser must handle these directly, with no SW involvement.
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request));
});
