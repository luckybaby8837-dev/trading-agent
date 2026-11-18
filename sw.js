// 앱 화면 파일은 저장해 두고(네트워크 우선), 시세는 항상 새로 받아옴
const CACHE = "trade-agent-v18";
const SHELL = ["./", "./index.html", "./app.css", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./js/store.js", "./js/sync.js", "./js/bybit.js", "./js/market.js", "./js/indicators.js", "./js/chart.js", "./js/analysis.js", "./js/main.js"];
const LIBS = ["unpkg.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (LIBS.includes(url.hostname)) { // 라이브러리·글꼴: 저장본 우선
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // 시세 API는 그대로
  // 앱 파일은 항상 서버에 새 버전이 있는지 확인 (브라우저 임시 저장본 무시)
  e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
