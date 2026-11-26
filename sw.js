const VERSION='kolorist-independent-v1';
const shell=['./','./style.css','./app.js','./model.js','./storage.js','./activation.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const urls=new Set(shell.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);
    await cache.addAll(shell.map(path=>new Request(path,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for (const key of await caches.keys()) if (key.startsWith('kolorist-independent-') && key!==VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if (event.request.method!=='GET' || !event.request.url.startsWith(self.registration.scope)) return;
  if (event.request.mode==='navigate') {
    event.respondWith((async()=>{
      const cache=await caches.open(VERSION);
      return await cache.match('./') || fetch(event.request);
    })());
    return;
  }
  if (urls.has(event.request.url)) {
    event.respondWith(caches.open(VERSION).then(async cache=>await cache.match(event.request)||fetch(event.request)));
  }
});
