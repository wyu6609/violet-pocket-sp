'use strict';
const prefix='violet-sp-shell:'+self.registration.scope+':';
const name=prefix+'v2';
const files=['index.html','styles.css','app.js','emulator.js','offline.js','saves.js','transfer.js',
  'vendor/react.js','vendor/react-dom.js','vendor/fflate.js','vendor/mgba.js','vendor/mgba.wasm'];
const url=path=>new URL(path,self.registration.scope).href;
const shell=new Set(files.map(url));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(name).then(cache=>cache.addAll(files.map(f=>new Request(url(f),{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==name)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const target=new URL(req.url);
  let key=req.url;
  if(req.mode==='navigate'&&(target.pathname===new URL(self.registration.scope).pathname || target.pathname===new URL(url('index.html')).pathname))
    key=url('index.html');
  if(shell.has(key))event.respondWith(caches.open(name).then(async cache=>(await cache.match(key))||fetch(req)));
});
self.addEventListener('message',event=>{
  if(event.data!=='verify-shell'||!event.ports[0])return;
  event.waitUntil((async()=>{
    const cache=await caches.open(name);
    const keys=new Set((await cache.keys()).map(k=>k.url));
    event.ports[0].postMessage(files.every(f=>keys.has(url(f))));
  })());
});
