const C='natscihub-v27';
const A=['index.html','manifest.json','ridgeline-ui.css','favicon.svg','icon-192.png','icon-512.png','icon.svg','rl-mark-denali-white.png','rl-mark-denali-navy.png','vendor/round-ui/gs-round.woff2','vendor/fluent-3d/dna.png','vendor/fluent-3d/globe.png','vendor/fluent-3d/microscope.png','vendor/fluent-3d/test_tube.png','vendor/fluent-3d/sparkles.png','vendor/fluent-3d/rocket.png','vendor/fluent-3d/check.png','vendor/fluent-3d/target.png','vendor/fluent-3d/memo.png','vendor/fluent-3d/calendar.png','vendor/fluent-3d/books.png','vendor/fluent-3d/bulb.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING'||e.data==='skipWaiting'||(e.data&&e.data.type==='SKIP_WAITING'))self.skipWaiting()});
