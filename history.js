'use strict';
const History=(()=>{
  const interval=5*60*1000;
  const slots=['past-1','past-2','past-3'];
  const index=key=>key+':history';
  const clean=entries=>Array.isArray(entries)?entries.filter(e=>slots.includes(e?.slot)&&Number.isFinite(e.time))
    .sort((a,b)=>b.time-a.time).slice(0,3):[];
  function thumbnail(){
    const small=document.createElement('canvas');
    small.width=120;small.height=80;
    small.getContext('2d').drawImage(document.querySelector('main canvas'),0,0,120,80);
    return small.toDataURL('image/jpeg',0.65);
  }
  async function list(key){return clean(await Saves.get(index(key)));}
  async function write(key,record){
    const auto=key+':auto';
    let rotated=false;
    try{
      await Saves.transaction('readwrite',s=>{
        const get=s.get(index(key));
        get.onsuccess=()=>{
          const entries=clean(get.result);
          if(entries[0]&&record.time<entries[0].time+interval){s.put(record,auto);return;}
          const previous=s.get(auto);
          previous.onsuccess=()=>{
            const prior=previous.result,newest=entries[0];
            if(prior && prior.time<=record.time && (!newest || prior.time>=newest.time+interval) &&
                prior.crc!==newest?.crc && Saves.valid(prior,record.bytes.length)){
              const slot=slots.find(id=>!entries.some(e=>e.slot===id))||entries.at(-1).slot;
              const item={slot,time:prior.time,thumbnail:prior.thumbnail};
              s.put(prior,key+':'+slot);
              s.put([item,...entries.filter(e=>e.slot!==slot)],index(key));
              rotated=true;
            }
            s.put(record,auto);
          };
        };
        return get;
      });
    }catch(error){
      if(error.name!=='QuotaExceededError')throw error;
      await Saves.put(auto,record);
      logPlayer('warn','Autosave history storage full',{rom:activeRom()});
      return false;
    }
    return rotated;
  }
  let generation=0;
  async function render(){
    const key=cartridge,serial=++generation,rows=$('#history-list');
    if(!key||!$('#history-panel').open)return;
    try{
      const entries=await list(key);
      if(key!==cartridge||serial!==generation)return;
      rows.replaceChildren();
      if(!entries.length){rows.textContent='Older checkpoints appear as you play.';return;}
      for(const entry of entries){
        const row=document.createElement('button');row.type='button';
        if(entry.thumbnail?.startsWith('data:image/jpeg;base64,')){
          const img=document.createElement('img');img.src=entry.thumbnail;img.alt='';row.append(img);
        }
        row.append(document.createTextNode($('#cart').textContent+' · '+new Date(entry.time).toLocaleString()));
        row.onclick=()=>recover(key,entry);
        rows.append(row);
      }
    }catch(error){if(key===cartridge)rows.textContent='Could not read history: '+error.message;}
  }
  async function recover(key,entry){
    if(!confirm('Restore this earlier checkpoint and make it the current autosave?'))return;
    let before,wasPaused;
    try{
      const rec=await Saves.get(key+':'+entry.slot);
      if(key!==cartridge)return;
      if(!rec||rec.time!==entry.time)throw Error('History changed. Open the picker again.');
      before=captureRecord();wasPaused=paused;
      pause(true,'history');busyLoading(true);$('fieldset').disabled=true;
      restoreState(rec);
      if(!await checkpoint('history restore',true))throw Error('Could not save recovered checkpoint.');
      status('Earlier checkpoint restored.');
      logPlayer('info','Checkpoint restored',{rom:activeRom(),slot:entry.slot,reason:'history',savedAt:entry.time});
    }catch(error){
      if(before)restoreState(before);
      logPlayer('error','History restore failed',{error:errorText(error)});status(error.message);
    }finally{
      if(before){pause(wasPaused||document.hidden,'history finished');busyLoading(false);$('fieldset').disabled=false;}
    }
  }
  $('#history-panel').addEventListener('toggle',render);
  return {list,write,render,thumbnail};
})();
