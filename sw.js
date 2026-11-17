// Offline support. Network first, so an online visit always gets the newest files; the cache
// is only used when the network is down or too slow (competition venues, captive portals).
const CACHE = 'valleyvis-v2';
const SHELL = [
  "./",
  "assets/field-biobuzz.webp",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon.svg",
  "index.html",
  "manifest.webmanifest",
  "src/codegen.js",
  "src/collision.js",
  "src/defaults.js",
  "src/expr.js",
  "src/geometry.js",
  "src/heading.js",
  "src/interact.js",
  "src/lint.js",
  "src/main.js",
  "src/park.js",
  "src/poses.js",
  "src/presets.js",
  "src/render.js",
  "src/resolve.js",
  "src/schema.js",
  "src/share.js",
  "src/simulate.js",
  "src/store.js",
  "src/ui/export.js",
  "src/ui/fields.js",
  "src/ui/help.js",
  "src/ui/menu.js",
  "src/ui/problems.js",
  "src/ui/routine.js",
  "src/ui/settings.js",
  "src/ui/timeline.js",
  "src/ui/zones.js",
  "src/util.js",
  "styles.css"
];
const SLOW_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? cache.match('index.html') : undefined);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  // if the network is slow and we have a copy, show the copy and let the fetch finish in the background
  const slow = new Promise((resolve) => setTimeout(resolve, SLOW_MS)).then(() => fromCache(request));
  try {
    const first = await Promise.race([network, slow]);
    if (first) return first;
    return await network;
  } catch (err) {
    const cached = await fromCache(request);
    if (cached) return cached;
    throw err;
  } finally {
    network.catch(() => {});
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
