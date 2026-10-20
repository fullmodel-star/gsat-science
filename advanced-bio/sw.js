const C='fenkeqb-v19';
const A=['index.html','manifest.json','ridgeline-ui.css','favicon.svg','icon-192.png','icon-512.png','icon-maskable-512.png','icon.svg','rl-mark-denali-navy.png','rl-mark-denali-white.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
