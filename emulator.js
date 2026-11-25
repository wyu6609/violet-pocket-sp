'use strict';
const $ = selector => document.querySelector(selector);
const cdn = 'https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.3.1/dist/mgba/';
const screenContext = $('canvas').getContext('2d', {alpha:false});
const pixels = screenContext.createImageData(240,160);
const names = ['A','B','Select','Start','Right','Left','Up','Down','R','L'];
const keys = {KeyZ:'A',KeyX:'B',Enter:'Start',ShiftLeft:'Select',ShiftRight:'Select',KeyA:'L',KeyS:'R',ArrowLeft:'Left',ArrowUp:'Up',ArrowRight:'Right',ArrowDown:'Down'};
const pressed = new Map(), sources = new Set();
let core, audio, gain, audioPtr, cartridge, paused=true, speed=1, nextSound=0, last=0, debt=0;
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
async function reopenCartridge(){
  $('#open').disabled=true;
  try{
    const file=await cartridgeStore('readonly',store=>store.get('current')).catch(()=>null);
    if(file){
      await boot(file,false);
    }else{
      status('Loading Pokémon FireRed…');
      const response=await fetch('./firered.zip');
      if(!response.ok)throw Error('Default cartridge unavailable.');
      await boot(new File([await response.blob()],'firered.zip'),false);
    }
  }catch{status('Default cartridge unavailable. Choose Load ROM to play.');}
  finally{$('#open').disabled=false;}
}
async function boot(file,remember){
  $('#open').disabled=true;
  try{
    file=await readCartridge(file);
    if(!/\.gba$/i.test(file.name)||file.size<192||file.size>32*1024*1024)throw Error('Choose an unpacked .gba file up to 32 MiB.');
    const buffer=await file.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    pause(true);cartridge=null;$('fieldset').disabled=true;$('#cart').textContent='No ROM loaded';
    const loaded=memory(buffer.byteLength,ptr=>{
      core.HEAPU8.set(new Uint8Array(buffer),ptr);
      return core._mgbawasm_load(ptr,buffer.byteLength,0,0,0,0,1);
    });
    if(!loaded)throw Error('mGBA could not open this cartridge.');
    cartridge='violet-mgba-031:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    $('#cart').textContent=file.name;$('fieldset').disabled=false;pause(false);status('Playing');
    if(remember){
      try{await cartridgeStore('readwrite',store=>store.put(file,'current'));}
      catch{status('Playing. Browser storage could not keep the cartridge.');}
    }else if(localStorage.getItem(cartridge)){state(false);}
  }catch(e){status(e.message);}finally{$('#open').disabled=false;}
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
      if(advanced)paint();
    }catch(e){pause(true);status(e.message);}
  }
  requestAnimationFrame(tick);
}
$('#pause').onclick=async()=>{try{if(paused)await audio.resume();pause(!paused);status(paused?'Paused':'Playing');}catch(e){status(e.message);}};
$('#fast').onclick=()=>{speed=speed===1?2:1;flushSound();$('#fast').setAttribute('aria-pressed',String(speed===2));};
$('#vol').oninput=e=>gain.gain.setTargetAtTime(e.target.value/100,audio.currentTime,.012);
function state(save){
  try{
    const size=core._mgbawasm_state_size();if(!size)throw Error('No active cartridge.');
    memory(size,ptr=>{
      if(save){
        if(!core._mgbawasm_state_save(ptr))throw Error('Core could not save.');
        const bytes=core.HEAPU8.subarray(ptr,ptr+size),parts=[];
        for(let i=0;i<size;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
        localStorage.setItem(cartridge,btoa(parts.join('')));
      }else{
        const saved=localStorage.getItem(cartridge);if(!saved)throw Error('No state saved for this ROM.');
        const raw=atob(saved);if(raw.length!==size)throw Error('Incompatible state.');
        core.HEAPU8.set(Uint8Array.from(raw,c=>c.charCodeAt(0)),ptr);
        if(!core._mgbawasm_state_load(ptr))throw Error('Core rejected this state.');
        flushSound();clearInput();last=0;debt=0;paint();
      }
    });
    status(save?'State saved on this device.':'State restored.');
  }catch(e){status(e.message);}
}
$('#save').onclick=()=>state(true);$('#load').onclick=()=>state(false);
window.addEventListener('keydown',e=>{
  if(!cartridge||paused||!keys[e.code]||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,summary'))return;
  e.preventDefault();pressed.set(e.code,keys[e.code]);syncKeys();
});
window.addEventListener('keyup',e=>{if(pressed.delete(e.code))syncKeys();});
document.querySelectorAll('[data-key]').forEach(button=>{
  button.onpointerdown=e=>{
    if(!cartridge||paused)return;e.preventDefault();button.setPointerCapture(e.pointerId);
    pressed.set(e.pointerId,button.dataset.key);syncKeys();navigator.vibrate?.(8);
  };
  button.onpointermove=e=>{
    if(!pressed.has(e.pointerId)||!button.closest('.dpad'))return;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.dpad button');
    pressed.set(e.pointerId,target?.dataset.key);syncKeys();
  };
  button.onlostpointercapture=button.onpointercancel=button.onpointerup=e=>{pressed.delete(e.pointerId);syncKeys();};
});
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&cartridge){pause(true);status('Paused');}});

async function readCartridge(file){
  if(!/\.zip$/i.test(file.name))return file;
  if(file.size>40*1024*1024)throw Error('ZIP exceeds 40 MiB.');
  const entries=fflate.unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>/\.gba$/i.test(e.name)&&e.originalSize>=192&&e.originalSize<=32*1024*1024&&!e.name.startsWith('__MACOSX/')});
  const names=Object.keys(entries);
  if(names.length!==1)throw Error('Select a ZIP containing one .gba cartridge.');
  return new File([entries[names[0]]],names[0].split('/').pop());
}