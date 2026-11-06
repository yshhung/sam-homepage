// 只快取首頁本身的檔案，讓它開得快；資料一律即時抓，不快取。
const VERSION = 'v22';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest', 'template/SamHomepage.xlsx',
  'vendor/msal-browser-3.28.1.min.js', 'vendor/lunar-javascript-1.7.7.js',
  'js/app.js', 'js/almanac.js', 'js/auth.js', 'js/store.js', 'js/sources.js', 'js/util.js',
  'invest.html', 'invest.css', 'vendor/d3-7.9.0.min.js', 'js/invest/shim.js', 'js/invest/data.js', 'js/invest/load.js',
  'js/invest/page0.js', 'js/invest/page1.js', 'js/invest/page2.js', 'js/invest/page3.js', 'js/invest/page4.js', 'js/invest/page5.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 先抓網路上的新版，抓不到（離線）才用快取
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
