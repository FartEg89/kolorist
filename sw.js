const VERSION='kolorist-2.1.1';
const files=['./','./style.css?v=2.1.1','./model.js?v=2.1.1','./backup.js?v=2.1.1','./cabinet.js?v=2.1.1','./app.js?v=2.1.1','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const urls=new Set(files.map(file=>new URL(file,self.registration.scope).href));
const scopeKey=new URL(self.registration.scope).pathname;
const cacheName=VERSION+scopeKey;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  await cache.addAll(files.map(file=>new Request(file,{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for (const key of await caches.keys()) {
    if (key!==cacheName && ((key.startsWith('kolorist-2.') && key.endsWith(scopeKey)) || key==='kolorist-independent-v1')) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if (request.method!=='GET') return;
  const url=new URL(request.url);
  if (request.mode==='navigate' && new URL('./',url).href===self.registration.scope &&
      (url.pathname===scopeKey || url.pathname===scopeKey+'index.html')) {
    // Страница и её скрипты обновляются одним комплектом.
    event.respondWith(caches.open(cacheName).then(async cache=>await cache.match('./')||fetch(request)));
  } else if (urls.has(url.href)) {
    event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(request)||fetch(request)));
  }
});
