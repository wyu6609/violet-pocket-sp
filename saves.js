'use strict';
const Saves = (() => {
  const table = Uint32Array.from({length:256}, (_,i) => {
    for(let n=0;n<8;n++) i=(i>>>1)^((i&1)?0xedb88320:0);
    return i>>>0;
  });
  function checksum(bytes) {
    let crc=0xffffffff;
    for(const b of bytes) crc=(crc>>>8)^table[(crc^b)&255];
    return (crc^0xffffffff)>>>0;
  }
  let database, opening;
  function open() {
    if(!opening) opening=new Promise((resolve,reject)=>{
      const req=indexedDB.open('violet-sp-saves',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('states');
      req.onerror=()=>{opening=null;reject(req.error);};
      req.onsuccess=()=>{
        database=req.result;
        database.onversionchange=()=>{database.close();database=null;opening=null;};
        resolve(database);
      };
    });
    return opening;
  }
  function transaction(mode,operation) {
    if(!database)return open().then(()=>transaction(mode,operation));
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('states',mode);
      const request=operation(tx.objectStore('states'));
      tx.oncomplete=()=>resolve(request?.result);
      tx.onabort=()=>reject(tx.error||Error('Save transaction interrupted.'));
    });
  }
  const get=key=>transaction('readonly',s=>s.get(key));
  const put=(key,value)=>transaction('readwrite',s=>s.put(value,key));
  function record(bytes,time=Date.now()) {
    return {bytes,time,crc:checksum(bytes)};
  }
  function valid(rec,size) {
    return rec?.bytes instanceof Uint8Array && rec.bytes.length===size && rec.crc===checksum(rec.bytes);
  }
  async function migrate(key,size) {
    const legacy=localStorage.getItem(key);
    if(!legacy)return;
    const sep=legacy.indexOf('|');
    const time=sep<0?0:Number(legacy.slice(0,sep))||0;
    const bytes=Uint8Array.from(atob(legacy.slice(sep+1)),c=>c.charCodeAt(0));
    if(bytes.length!==size)throw Error('Legacy checkpoint length is invalid.');
    const candidate=record(bytes,time);
    await transaction('readwrite',s=>{
      const q=s.get(key);
      q.onsuccess=()=>{if(!valid(q.result,size)||q.result.time<=time)s.put(candidate,key);};
      return q;
    });
    const copy=await get(key);
    if(!valid(copy,size)||copy.time<time||(copy.time===time&&!copy.bytes.every((v,i)=>v===bytes[i])))
      throw Error('Could not verify migrated checkpoint.');
    if(localStorage.getItem(key)===legacy)localStorage.removeItem(key);
  }
  return {open,transaction,get,put,record,valid,checksum,migrate};
})();
