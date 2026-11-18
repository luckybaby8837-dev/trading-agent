// ???붾㈃ ?뚯씪? ??ν빐 ?먭퀬(?ㅽ듃?뚰겕 ?곗꽑), ?쒖꽭????긽 ?덈줈 諛쏆븘??const CACHE = "trade-agent-v12";
const SHELL = ["./", "./index.html", "./app.css", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./js/store.js", "./js/sync.js", "./js/bybit.js", "./js/market.js", "./js/indicators.js", "./js/chart.js", "./js/analysis.js", "./js/main.js"];
const LIBS = ["unpkg.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (LIBS.includes(url.hostname)) { // ?쇱씠釉뚮윭由?룰?瑗? ??λ낯 ?곗꽑
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // ?쒖꽭 API??洹몃?濡?  // ???뚯씪? ??긽 ?쒕쾭????踰꾩쟾???덈뒗吏 ?뺤씤 (釉뚮씪?곗? ?꾩떆 ??λ낯 臾댁떆)
  e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
