const CACHE_NAME = 'rand-eval-v1';
const urlsToCache = [
    './mobile.html',
    './mobile.css',
    './mobile.js',
    './icon.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // キャッシュがあればそれを返し、なければネットワークへリクエスト
                return response || fetch(event.request);
            })
    );
});
