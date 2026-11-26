'use strict';
const Offline=(()=>{
  const cartCache='violet-sp-roms:'+new URL('./',document.baseURI).href+':v1';
  const url=path=>new URL(encodeURIComponent(path),document.baseURI).href;
  let generation=0;
  const label=()=>document.querySelector('#offline-status');
  function set(message){generation++;label().textContent=message;}
  const registration='serviceWorker' in navigator
    ? navigator.serviceWorker.register('./sw.js').catch(()=>null) : Promise.resolve(null);
  async function bundled(path){
    let cache;
    try{
      cache=await caches.open(cartCache);
      const hit=await cache.match(url(path));
      if(hit)return hit;
    }catch{/* Network play still works without persistent storage. */}
    const response=await fetch(url(path));
    if(response.ok&&cache){
      try{await cache.put(url(path),response.clone());}
      catch(error){logPlayer('warn','Offline cartridge cache failed',{error:errorText(error)});}
    }
    return response;
  }
  async function verifyShell(){
    const reg=await registration;
    if(!reg)return false;
    const worker=reg.active || reg.installing || reg.waiting;
    if(!worker)return false;
    if(worker.state!=='activated')await new Promise((resolve,reject)=>{
      const changed=()=>{
        if(worker.state==='activated'||worker.state==='redundant'){
          worker.removeEventListener('statechange',changed);
          worker.state==='activated'?resolve():reject(Error('Offline install failed.'));
        }
      };
      worker.addEventListener('statechange',changed);changed();
    });
    return new Promise(resolve=>{
      const ch=new MessageChannel();
      const timer=setTimeout(()=>{ch.port1.close();resolve(false);},5000);
      ch.port1.onmessage=e=>{clearTimeout(timer);ch.port1.close();resolve(e.data===true);};
      worker.postMessage('verify-shell',[ch.port2]);
    });
  }
  async function check(id,path){
    const which=++generation;
    let ready=false;
    try{
      const stored=path ? await (await caches.open(cartCache)).match(url(path)) :
        await cartridgeStore('readonly',s=>s.get(id));
      ready=Boolean(stored)&&await verifyShell();
    }catch{/* The status stays unavailable until the next successful boot. */}
    if(which===generation)label().textContent=ready?'Ready offline':'Offline unavailable for this cartridge';
  }
  return {set,bundled,check};
})();
