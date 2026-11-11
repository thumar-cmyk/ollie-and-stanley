/* Offline cache. Bump CACHE when files change so phones pick up the update. */
const CACHE = "catgame-v3-2";
const CORE = [
  "./", "./index.html", "./manifest.json", "./css/style.css",
  "./js/config.js", "./js/audio.js", "./js/vendor/peerjs.min.js", "./js/game.js",
  "./js/sprites.js",
  "./assets/cats/stanley-face.png", "./assets/cats/ollie-face.png",
  "./assets/icons/icon-192.png", "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png", "./assets/icons/favicon-32.png"
];
const CATS = ["stanley", "ollie"].flatMap((c) =>
  ["walk-0", "walk-1", "walk-2", "walk-3", "sit", "pounce", "nap"].map((f) => `./assets/cats/${c}/${f}.png`));
CORE.push(...CATS);
const ROOMS = ["hallway","living-room","stairway","kitchen","kitchen-toward-dining","dining-room","pantry","mudroom"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // room photos: cache both sizes in the background, don't fail install
    await Promise.all(ROOMS.flatMap((r) => ["1280", "1920"].map((s) =>
      c.add(`./assets/rooms/${s}/${r}.jpg`).catch(() => {}))));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // network-first for code (so updates show up), cache-first for images
  const isCode = /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isCode) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"))));
  } else {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
  }
});
