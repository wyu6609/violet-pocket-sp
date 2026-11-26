'use strict';
const $ = selector => document.querySelector(selector);
const cdn = 'https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.3.1/dist/mgba/';
const screenContext = $('canvas').getContext('2d', {alpha:false});
const pixels = screenContext.createImageData(240,160);
const names = ['A','B','Select','Start','Right','Left','Up','Down','R','L'];
const keys = {KeyZ:'A',KeyX:'B',Enter:'Start',ShiftLeft:'Select',ShiftRight:'Select',KeyA:'L',KeyS:'R',ArrowLeft:'Left',ArrowUp:'Up',ArrowRight:'Right',ArrowDown:'Down'};
const pressed = new Map(), sources = new Set();
let core, audio, gain, audioPtr, cartridge, paused=true, speed=1, nextSound=0, last=0, debt=0;
const checkpointInterval = 10000;
let checkpointDue = 0, progressChanged = false;
let lastAutosaveError, awaitingFirstFrame=false;
function logPlayer(level, event, details = {}) {
  console[level]('[Violet Pocket SP] ' + event, details);
}
function errorText(error) {
  return [error?.name, error?.message || (typeof error === 'string' ? error : '')]
    .filter(Boolean).join(': ').slice(0,300) || 'Unknown error';
}
// Use a short ROM fingerprint to correlate events without logging local filenames or game data.
function activeRom() { return cartridge?.split(':').pop().slice(0,12); }
const status = message => { $('#status').textContent=message; };
function syncKeys(){
  const held = new Set(pressed.values());
  core?._mgbawasm_set_keys(names.reduce((mask,name,i)=>mask|(held.has(name)?1<<i:0),0));
  document.querySelectorAll('[data-key]').forEach(b=>b.classList.toggle('held',held.has(b.dataset.key)));
}
function clearInput(reason){
  if(pressed.size)logPlayer('debug','Held controls released',{reason, count:pressed.size});
  pressed.clear();syncKeys();
}
function flushSound(){for(const s of sources)s.stop();sources.clear();nextSound=0;}
function pause(value,reason){
  const changed = paused !== value;
  paused=value;last=0;debt=0;clearInput(reason);flushSound();
  if(changed)logPlayer('info',value ? 'Emulator paused' : 'Emulator resumed',{reason, rom:activeRom()});
  $('#pause').textContent=value?'Resume':'Pause';
}
$('#start').onclick=async()=>{
  const button=$('#start');button.disabled=true;
  const startedAt=performance.now();
  let stage='audio startup';
  logPlayer('info','Power on requested');
  try{
    audio??=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
    await audio.resume();
    if(!gain){gain=audio.createGain();gain.gain.value=.65;gain.connect(audio.destination);}
    stage='core loader';
    logPlayer('info','Loading emulator core',{core:'mGBA', version:'0.3.1'});
    status('Loading mGBA…');
    if(typeof createMgbaModule==='undefined')await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=cdn+'mgba.js';script.onload=resolve;
      script.onerror=()=>reject(Error('Core download failed. Check your connection and retry.'));document.head.append(script);
    });
    stage='core initialization';
    core=await createMgbaModule({locateFile:name=>cdn+name});
    core._mgbawasm_init();audioPtr=core._malloc(16384*4);
    if(!audioPtr)throw Error('Could not allocate audio memory.');
    logPlayer('info','Core ready',{startupMs:Math.round(performance.now()-startedAt), audio:audio.state});
    stage='reopen cartridge';
    $('#gate').hidden=true;$('#open').disabled=false;status('Choose a local .gba cartridge.');requestAnimationFrame(tick); await reopenCartridge();
  }catch(e){
    logPlayer('error','Power on failed',{stage, error:errorText(e)});
    button.disabled=false;status(e.message);
  }
};
function memory(size,action){
  const ptr=core._malloc(size);if(!ptr)throw Error('Insufficient emulator memory.');
  try{return action(ptr);}finally{core._free(ptr);}
}
$('#open').onclick=()=>$('#file').click();
$('#file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(file)await boot(file,{source:'local file',reason:'import',remember:true});
};
function cartridgeStore(mode,action){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('violet-cartridges',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('library');
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>logPlayer('warn','Cartridge library blocked',{operation:mode});
    request.onsuccess=()=>{
      const db=request.result;
      try{
        const tx=db.transaction('library',mode);
        const operation=action(tx.objectStore('library'));
        tx.oncomplete=()=>{db.close();resolve(operation.result);};
        tx.onabort=()=>{db.close();reject(tx.error || Error('Cartridge storage transaction interrupted.'));};
      }catch(error){db.close();reject(error);}
    };
  });
}
const bundledGames = new Map([
  ['firered', {title:'Pokémon FireRed', path:'firered.zip'}],
  ['fusion', {title:'Metroid Fusion', path:'Metroid Fusion.zip'}],
]);
const library = document.createElement('select');
library.setAttribute('aria-label','Game library');
library.style.cssText='display:block;width:100%;padding:10px;margin:8px 0;color:inherit;background:#332c41;border:1px solid #615580;border-radius:8px;font:inherit';
for(const [id,game] of bundledGames)library.add(new Option(game.title,id));
$('aside h2').textContent='Game library';
$('#cart').before(library);
let selectedGame='firered';
let userSelected=false;
library.onchange=()=>{
  userSelected=true;
  if(core && $('#gate').hidden && !$('#open').disabled)openGame(library.value);
};
function busyLoading(busy){library.disabled=busy;$('#open').disabled=busy;}
async function openGame(id,reason='selection'){
  busyLoading(true);
  const game=bundledGames.get(id);
  const source=game ? 'bundled URL' : 'IndexedDB';
  logPlayer('info','Opening cartridge',{source, game:game?.title, reason});
  try{
    let file;
    if(game){
      status('Loading '+game.title+'…');
      const startedAt=performance.now();
      const response=await fetch('./'+encodeURIComponent(game.path));
      if(!response.ok)throw Error(game.title+' could not be downloaded (HTTP '+response.status+').');
      file=new File([await response.blob()],game.path);
      const timings=performance.getEntriesByName?.(response.url,'resource') || [];
      const timing=timings.filter(entry=>entry.initiatorType==='fetch' && entry.startTime>=startedAt).pop();
      let delivery='unknown';
      if(timing?.transferSize>0)delivery='network or revalidated';
      else if(timing?.transferSize===0 && timing.encodedBodySize>0)delivery='browser cache';
      logPlayer('info','Bundled ROM ready',{game:game.title, delivery, bytes:file.size,
        fetchMs:Math.round(performance.now()-startedAt)});
    }else{
      file=await cartridgeStore('readonly',store=>store.get(id));
      if(!file)throw Error('This cartridge is unavailable. Import it again.');
    }
    await boot(file,{source, id, reason});
  }catch(error){
    logPlayer('error','Cartridge unavailable',{source, game:game?.title, reason, error:errorText(error)});
    status(error.message);
  }
  finally{library.value=selectedGame;busyLoading(false);}
}
async function reopenCartridge(){
  busyLoading(true);
  let previous;
  try{
    const names=await cartridgeStore('readonly',store=>store.get('titles')) || {};
    for(const [key,name] of Object.entries(names))library.add(new Option(name,key));
    previous=await cartridgeStore('readonly',store=>store.get('current'));
    logPlayer('info','Cartridge library ready',{importedCount:Object.keys(names).length});
  }catch(error){
    logPlayer('warn','Cartridge library unavailable',{error:errorText(error), fallback:'bundled games'});
  }
  if(!userSelected && previous instanceof Blob){
    await boot(previous,{source:'IndexedDB',reason:'reopen legacy cartridge',remember:true});
    return;
  }
  const id=userSelected?library.value:previous;
  await openGame(Array.from(library.options).some(o=>o.value===id)?id:'firered','power on');
}
async function rememberGame(id,file){
  if(!file)return cartridgeStore('readwrite',store=>store.put(id,'current'));
  return cartridgeStore('readwrite',store=>{
    const request=store.get('titles');
    request.onsuccess=()=>{
      const titles=request.result || {};
      titles[id]=file.name;
      store.put(titles,'titles');
      store.put(file,id);
      store.put(id,'current');
    };
    return request;
  });
}
async function boot(file,{source,reason,id,remember=false}){
  busyLoading(true);
  const startedAt=performance.now();
  let stage='read cartridge';
  const format=/\.zip$/i.test(file.name) ? 'ZIP' : /\.gba$/i.test(file.name) ? 'GBA' : 'unknown';
  logPlayer('info','ROM boot requested',{source,reason,format,bytes:file.size});
  try{
    file=await readCartridge(file);
    if(!/\.gba$/i.test(file.name)||file.size<192||file.size>32*1024*1024)throw Error('Choose an unpacked .gba file up to 32 MiB.');
    stage='identify cartridge';
    const buffer=await file.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    stage='save before ROM switch';
    if (cartridge && !await checkpoint('switch',true)) throw Error('Could not save current progress. Free browser storage before switching games.');
    stage='load ROM into core';
    pause(true,'switch');cartridge=null;$('fieldset').disabled=true;$('#cart').textContent='No ROM loaded';
    const loaded=memory(buffer.byteLength,ptr=>{
      core.HEAPU8.set(new Uint8Array(buffer),ptr);
      return core._mgbawasm_load(ptr,buffer.byteLength,0,0,0,0,1);
    });
    if(!loaded)throw Error('mGBA could not open this cartridge.');
    cartridge='violet-mgba-031:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    $('#cart').textContent=file.name;
    progressChanged=false;
    lastAutosaveError=undefined;
    awaitingFirstFrame=true;
    checkpointDue=performance.now()+checkpointInterval;
    $('#last-save').textContent='No checkpoint yet';
    status(document.hidden?'Paused':'Playing');
    try {
      await resumeLatestState();
    } catch (error) {
      logPlayer('error','Save recovery failed',{rom:activeRom(), error:errorText(error)});
      status('Could not recover progress: '+error.message);
    }
    pause(document.hidden,'boot');
    $('fieldset').disabled=false;
    logPlayer('info','ROM ready',{rom:activeRom(), source, paused, bytes:buffer.byteLength,
      bootMs:Math.round(performance.now()-startedAt)});
    selectedGame=id || cartridge;
    if(!Array.from(library.options).some(o=>o.value===selectedGame))library.add(new Option(file.name,selectedGame));
    library.value=selectedGame;
    try{await rememberGame(selectedGame,remember?file:null);}
    catch(error){
      logPlayer('warn','Cartridge library write failed',{rom:activeRom(), error:errorText(error)});
      status('Playing. Browser storage could not remember this game.');
    }
  }catch(e){
    logPlayer('error','ROM boot failed',{source, reason, stage, error:errorText(e)});
    status(e.message);
  }finally{busyLoading(false);}
};
function queueAudio(){
  const n=core._mgbawasm_read_audio(audioPtr,16384);
  if(!n||audio.state!=='running')return;
  const buffer=audio.createBuffer(2,n,core._mgbawasm_sample_rate());
  const start=audioPtr>>>1;
  for(let channel=0;channel<2;channel++){
    const data=buffer.getChannelData(channel);
    for(let i=0;i<n;i++)data[i]=core.HEAP16[start+2*i+channel]/32768;
  }
  const source=audio.createBufferSource();source.buffer=buffer;source.playbackRate.value=speed;
  source.connect(gain);sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();};
  if(nextSound<audio.currentTime||nextSound>audio.currentTime+.2)nextSound=audio.currentTime+.035;
  source.start(nextSound);nextSound+=buffer.duration/speed;
}
function paint(){
  const ptr=core._mgbawasm_video_ptr();pixels.data.set(core.HEAPU8.subarray(ptr,ptr+pixels.data.length));screenContext.putImageData(pixels,0,0);
}
function tick(time){
  if(cartridge&&!paused){
    try{
      debt+=Math.min(80,last?time-last:17)*speed;last=time;
      const step=1000/59.7275;
      let advanced=false;
      while(debt>=step){core._mgbawasm_run_frame();queueAudio();debt-=step;advanced=true;}
      if(advanced){
        paint();
        if(awaitingFirstFrame){
          awaitingFirstFrame=false;
          logPlayer('info','First frame rendered',{rom:activeRom()});
        }
        progressChanged=true;
        if(time>=checkpointDue){
          checkpointDue=time+checkpointInterval;
          checkpoint();
        }
      }
    }catch(e){
      logPlayer('error','Emulation interrupted',{rom:activeRom(), error:errorText(e)});
      pause(true,'runtime error');status(e.message);
    }
  }
  requestAnimationFrame(tick);
}
$('#pause').onclick=async()=>{try{if(paused)await audio.resume();pause(!paused,'user');status(paused?'Paused':'Playing');}catch(e){
  logPlayer('error','Playback change failed',{rom:activeRom(), error:errorText(e)});status(e.message);
}};
$('#fast').onclick=()=>{speed=speed===1?2:1;logPlayer('info','Playback speed changed',{speed});flushSound();$('#fast').setAttribute('aria-pressed',String(speed===2));};
$('#vol').oninput=e=>gain.gain.setTargetAtTime(e.target.value/100,audio.currentTime,.012);
function captureState(){
  const size=core._mgbawasm_state_size();
  if(!size)throw Error('No active cartridge.');
  return memory(size,ptr=>{
    if(!core._mgbawasm_state_save(ptr))throw Error('Core could not save.');
    return core.HEAPU8.slice(ptr,ptr+size);
  });
}
function markSaved(key,time) {
  if(key!==cartridge)return;
  $('#last-save').textContent=time?'Last saved '+new Date(time).toLocaleString():'Recovered an undated save';
}
async function resumeLatestState(){
  const size=core._mgbawasm_state_size();
  await Saves.open();
  for(const key of [cartridge,cartridge+':auto']){
    try{await Saves.migrate(key,size);}
    catch(error){logPlayer('warn','Legacy save retained',{error:errorText(error)});}
  }
  const slots=[
    {slot:'auto',name:'Automatic checkpoint',state:await Saves.get(cartridge+':auto')},
    {slot:'manual',name:'Manual save',state:await Saves.get(cartridge)}
  ].filter(slot=>slot.state).sort((a,b)=>b.state.time-a.state.time);
  if(!slots.length)logPlayer('info','No checkpoint found',{rom:activeRom()});
  let failure;
  for(const slot of slots){
    try{
      restoreState(slot.state);
      markSaved(cartridge,slot.state.time);
      logPlayer('info','Checkpoint restored',{rom:activeRom(),slot:slot.slot,reason:'boot',savedAt:slot.state.time,usedFallback:Boolean(failure)});
      status(slot.name+' restored.'+(failure?' Newer save was unreadable.':''));
      return;
    }catch(error){failure=error;logPlayer('warn','Unreadable checkpoint',{slot:slot.slot,error:errorText(error)});}
  }
  if(failure)throw failure;
}
function restoreState(record){
  if(!record)throw Error('No state saved for this ROM.');
  const size=core._mgbawasm_state_size();
  if(!Saves.valid(record,size))throw Error('Damaged or incompatible checkpoint.');
  memory(size,ptr=>{
    core.HEAPU8.set(record.bytes,ptr);
    if(!core._mgbawasm_state_load(ptr))throw Error('Core rejected this state.');
  });
  flushSound();clearInput('restore');last=0;debt=0;paint();
}
async function checkpoint(reason='periodic',force=false){
  if(!cartridge||(!force&&!progressChanged))return true;
  const key=cartridge,rom=activeRom();
  try{
    const record=Saves.record(captureState());
    progressChanged=false;
    await Saves.put(key+':auto',record);
    if(cartridge!==key)return true;
    const recovered=lastAutosaveError!==undefined;
    lastAutosaveError=undefined;
    markSaved(key,record.time);
    logPlayer(reason==='periodic'&&!recovered?'debug':'info','Checkpoint saved',{
      rom,slot:'auto',reason,bytes:record.bytes.length,savedAt:record.time,recovered
    });
    return true;
  }catch(error){
    if(cartridge===key){
      progressChanged=true;
      const message=errorText(error);
      if(reason!=='periodic'||lastAutosaveError!==message)logPlayer('error','Checkpoint failed',{rom,slot:'auto',reason,error:message});
      lastAutosaveError=message;status('Automatic save failed: '+error.message);
    }
    return false;
  }
}
$('#save').onclick=async()=>{
  const key=cartridge;
  try{
    const rec=Saves.record(captureState());
    await Saves.put(key,rec);
    if(cartridge!==key)return;
    markSaved(key,rec.time);
    logPlayer('info','Checkpoint saved',{rom:activeRom(),slot:'manual',reason:'user',bytes:rec.bytes.length,savedAt:rec.time});
    status('Manual state saved.');
  }catch(error){logPlayer('error','Checkpoint failed',{slot:'manual',error:errorText(error)});status(error.message);}
};
$('#load').onclick=async()=>{
  const key=cartridge;
  try{
    const rec=await Saves.get(key);
    if(cartridge!==key)return;
    restoreState(rec);
    logPlayer('info','Checkpoint restored',{rom:activeRom(),slot:'manual',reason:'user',savedAt:rec.time});
    progressChanged=true;
    if(await checkpoint('manual restore'))status('Manual state restored.');
  }catch(error){logPlayer('error','Manual restore failed',{error:errorText(error)});status(error.message);}
};
window.addEventListener('keydown',e=>{
  if(!cartridge||paused||!keys[e.code]||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,summary'))return;
  e.preventDefault();pressed.set(e.code,keys[e.code]);syncKeys();
});
window.addEventListener('keyup',e=>{if(pressed.delete(e.code))syncKeys();});
const mobileDevice = navigator.userAgentData?.mobile || /Android|iPhone|iPod|iPad|Mobi/i.test(navigator.userAgent);
function pulseOnTouch(event){
  if(mobileDevice && event.pointerType==='touch')navigator.vibrate?.(15);
}
// Touch release also supplies user activation on the first skin selection.
$('.skin-controls button').addEventListener('pointerup',pulseOnTouch);
document.querySelectorAll('[data-key]').forEach(button=>{
  button.onpointerdown=e=>{
    if(!cartridge||paused)return;e.preventDefault();button.setPointerCapture(e.pointerId);
    pressed.set(e.pointerId,button.dataset.key);syncKeys();pulseOnTouch(e);
  };
  button.onpointermove=e=>{
    if(!pressed.has(e.pointerId)||!button.closest('.dpad'))return;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.dpad button');
    const direction=target?.dataset.key;
    if(direction===pressed.get(e.pointerId))return;
    pressed.set(e.pointerId,direction);syncKeys();
    if(direction)pulseOnTouch(e);
  };
  button.onlostpointercapture=button.onpointercancel=button.onpointerup=e=>{pressed.delete(e.pointerId);syncKeys();};
});
window.addEventListener('blur',()=>clearInput('blur'));
async function pauseForBackground(reason){
  if(!cartridge)return;
  pause(true,reason);
  if(await checkpoint(reason))status('Paused. Tap Resume to continue.');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForBackground('visibilitychange');});
window.addEventListener('pagehide',()=>pauseForBackground('pagehide'));

async function readCartridge(file){
  if(!/\.zip$/i.test(file.name))return file;
  if(file.size>40*1024*1024)throw Error('ZIP exceeds 40 MiB.');
  const entries=fflate.unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>/\.gba$/i.test(e.name)&&e.originalSize>=192&&e.originalSize<=32*1024*1024&&!e.name.startsWith('__MACOSX/')});
  const names=Object.keys(entries);
  if(names.length!==1)throw Error('Select a ZIP containing one .gba cartridge.');
  return new File([entries[names[0]]],names[0].split('/').pop());
}
