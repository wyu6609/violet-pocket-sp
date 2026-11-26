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
const status = message => { $('#status').textContent=message; };
function syncKeys(){
  const held = new Set(pressed.values());
  core?._mgbawasm_set_keys(names.reduce((mask,name,i)=>mask|(held.has(name)?1<<i:0),0));
  document.querySelectorAll('[data-key]').forEach(b=>b.classList.toggle('held',held.has(b.dataset.key)));
}
function clearInput(){pressed.clear();syncKeys();}
function flushSound(){for(const s of sources)s.stop();sources.clear();nextSound=0;}
function pause(value){
  paused=value;last=0;debt=0;clearInput();flushSound();
  $('#pause').textContent=value?'Resume':'Pause';
}
$('#start').onclick=async()=>{
  const button=$('#start');button.disabled=true;
  try{
    audio??=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
    await audio.resume();
    if(!gain){gain=audio.createGain();gain.gain.value=.65;gain.connect(audio.destination);}
    status('Loading mGBA…');
    if(typeof createMgbaModule==='undefined')await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=cdn+'mgba.js';script.onload=resolve;
      script.onerror=()=>reject(Error('Core download failed. Check your connection and retry.'));document.head.append(script);
    });
    core=await createMgbaModule({locateFile:name=>cdn+name});
    core._mgbawasm_init();audioPtr=core._malloc(16384*4);
    if(!audioPtr)throw Error('Could not allocate audio memory.');
    $('#gate').hidden=true;$('#open').disabled=false;status('Choose a local .gba cartridge.');requestAnimationFrame(tick); await reopenCartridge();
  }catch(e){button.disabled=false;status(e.message);}
};
function memory(size,action){
  const ptr=core._malloc(size);if(!ptr)throw Error('Insufficient emulator memory.');
  try{return action(ptr);}finally{core._free(ptr);}
}
$('#open').onclick=()=>$('#file').click();
$('#file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(file)await boot(file,true);
};
function cartridgeStore(mode,action){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('violet-cartridges',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('library');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('library',mode);
      const operation=action(tx.objectStore('library'));
      tx.oncomplete=()=>{db.close();resolve(operation.result);};
      tx.onabort=()=>{db.close();reject(tx.error);};
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
async function openGame(id){
  busyLoading(true);
  try{
    const game=bundledGames.get(id);
    let file;
    if(game){
      status('Loading '+game.title+'…');
      const response=await fetch('./'+encodeURIComponent(game.path));
      if(!response.ok)throw Error(game.title+' could not be downloaded.');
      file=new File([await response.blob()],game.path);
    }else{
      file=await cartridgeStore('readonly',store=>store.get(id));
      if(!file)throw Error('This cartridge is unavailable. Import it again.');
    }
    await boot(file,false,id);
  }catch(error){status(error.message);}
  finally{library.value=selectedGame;busyLoading(false);}
}
async function reopenCartridge(){
  busyLoading(true);
  let previous;
  try{
    const names=await cartridgeStore('readonly',store=>store.get('titles')) || {};
    for(const [key,name] of Object.entries(names))library.add(new Option(name,key));
    previous=await cartridgeStore('readonly',store=>store.get('current'));
  }catch { /* Bundled games also work when storage is unavailable. */ }
  if(!userSelected && previous instanceof Blob){
    await boot(previous,true);
    return;
  }
  const id=userSelected?library.value:previous;
  await openGame(Array.from(library.options).some(o=>o.value===id)?id:'firered');
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
async function boot(file,remember,id){
  busyLoading(true);
  try{
    file=await readCartridge(file);
    if(!/\.gba$/i.test(file.name)||file.size<192||file.size>32*1024*1024)throw Error('Choose an unpacked .gba file up to 32 MiB.');
    const buffer=await file.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    if (cartridge && !checkpoint()) throw Error('Could not save current progress. Free browser storage before switching games.');
    pause(true);cartridge=null;$('fieldset').disabled=true;$('#cart').textContent='No ROM loaded';
    const loaded=memory(buffer.byteLength,ptr=>{
      core.HEAPU8.set(new Uint8Array(buffer),ptr);
      return core._mgbawasm_load(ptr,buffer.byteLength,0,0,0,0,1);
    });
    if(!loaded)throw Error('mGBA could not open this cartridge.');
    cartridge='violet-mgba-031:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    $('#cart').textContent=file.name;
    progressChanged=false;
    checkpointDue=performance.now()+checkpointInterval;
    $('fieldset').disabled=false;
    pause(document.hidden);
    status(document.hidden?'Paused':'Playing');
    try {
      const automatic=localStorage.getItem(cartridge+':auto');
      if (automatic) {
        try { restoreState(automatic); status('Automatic checkpoint restored.'); }
        catch (error) {
          const manual=localStorage.getItem(cartridge);
          if (!manual) throw error;
          restoreState(manual);
          status('Automatic checkpoint unreadable. Manual save restored.');
        }
      } else {
        const manual=localStorage.getItem(cartridge);
        if (manual) { restoreState(manual); status('Manual save restored.'); }
      }
    } catch (error) { status('Could not recover progress: '+error.message); }
    selectedGame=id || cartridge;
    if(!Array.from(library.options).some(o=>o.value===selectedGame))library.add(new Option(file.name,selectedGame));
    library.value=selectedGame;
    try{await rememberGame(selectedGame,remember?file:null);}
    catch{status('Playing. Browser storage could not remember this game.');}
  }catch(e){status(e.message);}finally{busyLoading(false);}
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
        progressChanged=true;
        if(time>=checkpointDue){
          checkpointDue=time+checkpointInterval;
          checkpoint();
        }
      }
    }catch(e){pause(true);status(e.message);}
  }
  requestAnimationFrame(tick);
}
$('#pause').onclick=async()=>{try{if(paused)await audio.resume();pause(!paused);status(paused?'Paused':'Playing');}catch(e){status(e.message);}};
$('#fast').onclick=()=>{speed=speed===1?2:1;flushSound();$('#fast').setAttribute('aria-pressed',String(speed===2));};
$('#vol').oninput=e=>gain.gain.setTargetAtTime(e.target.value/100,audio.currentTime,.012);
function saveState(key){
  const size=core._mgbawasm_state_size();
  if(!size)throw Error('No active cartridge.');
  memory(size,ptr=>{
    if(!core._mgbawasm_state_save(ptr))throw Error('Core could not save.');
    const bytes=core.HEAPU8.subarray(ptr,ptr+size),parts=[];
    for(let i=0;i<size;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    localStorage.setItem(key,btoa(parts.join('')));
  });
}
function restoreState(saved){
  if(!saved)throw Error('No state saved for this ROM.');
  const raw=atob(saved),size=core._mgbawasm_state_size();
  if(!size||raw.length!==size)throw Error('Incompatible state.');
  memory(size,ptr=>{
    core.HEAPU8.set(Uint8Array.from(raw,c=>c.charCodeAt(0)),ptr);
    if(!core._mgbawasm_state_load(ptr))throw Error('Core rejected this state.');
  });
  flushSound();clearInput();last=0;debt=0;paint();
}
function checkpoint(){
  if(!cartridge||!progressChanged)return true;
  try{
    saveState(cartridge+':auto');
    progressChanged=false;
    return true;
  }catch(error){
    status('Automatic save failed: '+error.message);
    return false;
  }
}
$('#save').onclick=()=>{
  try{saveState(cartridge);status('Manual state saved.');}catch(error){status(error.message);}
};
$('#load').onclick=()=>{
  try{
    restoreState(localStorage.getItem(cartridge));
    progressChanged=true;
    if(checkpoint())status('Manual state restored.');
  }catch(error){status(error.message);}
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
window.addEventListener('blur',clearInput);
function pauseForBackground(){
  if(!cartridge)return;
  pause(true);
  if(checkpoint())status('Paused. Tap Resume to continue.');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForBackground();});
window.addEventListener('pagehide',pauseForBackground);

async function readCartridge(file){
  if(!/\.zip$/i.test(file.name))return file;
  if(file.size>40*1024*1024)throw Error('ZIP exceeds 40 MiB.');
  const entries=fflate.unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>/\.gba$/i.test(e.name)&&e.originalSize>=192&&e.originalSize<=32*1024*1024&&!e.name.startsWith('__MACOSX/')});
  const names=Object.keys(entries);
  if(names.length!==1)throw Error('Select a ZIP containing one .gba cartridge.');
  return new File([entries[names[0]]],names[0].split('/').pop());
}
