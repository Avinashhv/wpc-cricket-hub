var CACHE='wpc-scorer-v1';
var SHELL=[
  '/scorer.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.js'
];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(SHELL);}));
  self.skipWaiting();
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }));
  self.clients.claim();
});

self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET') return; // pass through POST/PATCH (Supabase writes)
  if(e.request.url.includes('supabase.co')) return; // app handles API failures itself
  e.respondWith(
    fetch(e.request).then(function(res){
      var clone=res.clone();
      caches.open(CACHE).then(function(c){c.put(e.request,clone);});
      return res;
    }).catch(function(){
      return caches.match(e.request);
    })
  );
});
