const CACHE_NAME = 'allivision-v4';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
                );
            })
        ])
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (url.pathname.endsWith('index.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('/')) {
        e.respondWith(
            fetch(e.request).then(res => {
                const resClone = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
                return res;
            }).catch(() => caches.match(e.request))
        );
        return;
    }
    e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
