'use strict';
const Diagnostics=(()=>{
  const panel=document.querySelector('#diagnostics'),recent=[];
  const start=performance.now();
  let totalFrames=0,sampleFrames=0,sampleStart=0,fps=0,activeMs=0,timer;
  let saves=0,failures=0,latestSave,issue;
  try{issue=JSON.parse(sessionStorage.getItem('violet-sp-last-issue'));}catch{/* Storage is optional. */}
  function resetRate(){fps=0;sampleFrames=0;sampleStart=0;}
  function frames(count,now){
    totalFrames+=count;
    if(!sampleStart){sampleStart=now;return;}
    sampleFrames+=count;
    const elapsed=now-sampleStart;
    if(elapsed>=1000){
      fps=sampleFrames*1000/elapsed;
      activeMs+=elapsed;sampleFrames=0;sampleStart=now;
    }
  }
  function event(level,name,details){
    const time=Date.now(),entry={time,name};
    if(name==='Checkpoint saved'){saves++;latestSave={time:details.savedAt||time,slot:details.slot};}
    if(name==='Checkpoint restored')latestSave={time:details.savedAt,slot:details.slot};
    if(name==='Checkpoint failed')failures++;
    if(level==='error'){
      issue={time,name,description:String(details.error||'').slice(0,200)};
      try{sessionStorage.setItem('violet-sp-last-issue',JSON.stringify(issue));}catch{/* Session-only. */}
    }
    if(name==='Checkpoint saved'&&details.reason==='periodic'&&recent.at(-1)?.name===name)recent.pop();
    recent.push(entry);
    if(recent.length>40)recent.shift();
  }
  function sample(){return {totalFrames,fps,activeMs,saves,failures};}
  function duration(ms){
    const s=Math.floor(ms/1000);
    return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
  }
  function summary(){
    return {
      'Session length':duration(performance.now()-start),
      'Player':!cartridge?'No cartridge':paused?'Paused':'Playing',
      'Emulated frame rate':(paused?0:fps).toFixed(1)+' FPS',
      'Frames advanced':totalFrames.toLocaleString(),
      'Latest checkpoint':latestSave?(latestSave.time?new Date(latestSave.time).toLocaleString():'Undated')+' ('+latestSave.slot+')':'None yet',
      'Save writes':saves,'Save failures':failures,
      'Offline':document.querySelector('#offline-status').textContent,
      'Latest error':issue?new Date(issue.time).toLocaleString()+' · '+issue.name+' '+issue.description:'None recorded'
    };
  }
  function render(){
    const list=document.querySelector('#diag-summary');list.replaceChildren();
    for(const [label,value] of Object.entries(summary())){
      const term=document.createElement('dt'),desc=document.createElement('dd');
      term.textContent=label;desc.textContent=value;list.append(term,desc);
    }
  }
  panel.addEventListener('toggle',()=>{
    clearInterval(timer);
    if(panel.open){render();timer=setInterval(render,1000);}
  });
  document.querySelector('#copy-report').onclick=async()=>{
    const report=['Violet Pocket SP',...Object.entries(summary()).map(([k,v])=>k+': '+v),
      '',...recent.map(e=>new Date(e.time).toISOString()+' '+e.name)].join('\n');
    const field=document.querySelector('#report-text'),result=document.querySelector('#copy-result');
    try{
      await navigator.clipboard.writeText(report);field.hidden=true;result.textContent='Report copied.';
    }catch{field.value=report;field.hidden=false;field.focus();field.select();result.textContent='Select and copy the report below.';}
  };
  return {frames,event,resetRate,sample};
})();
