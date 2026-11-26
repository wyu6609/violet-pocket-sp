'use strict';
const Transfer=(()=>{
  const magic='VioletPocketSP/1\n';
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const batterySizes=[512,8192,32768,65536,131072];
  function encode(record){
    const header={game:cartridge,core:'mgba-0.3.1',time:record.time,size:record.bytes.length,
      crc:record.crc,batterySize:record.battery?.length||0,batteryCRC:record.batteryCRC??0};
    const prefix=encoder.encode(magic+JSON.stringify(header)+'\n');
    return new Blob([prefix,record.bytes,record.battery||new Uint8Array()],{type:'application/octet-stream'});
  }
  function decode(bytes){
    const end=bytes.indexOf(10,magic.length);
    if(end<0||end>1024||decoder.decode(bytes.subarray(0,magic.length))!==magic)throw Error('Invalid checkpoint file.');
    const h=JSON.parse(decoder.decode(bytes.subarray(magic.length,end)));
    if(h.game!==cartridge||h.core!=='mgba-0.3.1')throw Error('This checkpoint belongs to another game or core.');
    if(h.size!==core._mgbawasm_state_size()||!Number.isSafeInteger(h.batterySize)||
      (h.batterySize!==0&&!batterySizes.includes(h.batterySize))||end+1+h.size+h.batterySize!==bytes.length)
      throw Error('Checkpoint length is invalid.');
    const rec={bytes:bytes.subarray(end+1,end+1+h.size),crc:h.crc,time:Date.now()};
    if(h.batterySize){rec.battery=bytes.subarray(end+1+h.size);rec.batteryCRC=h.batteryCRC;}
    if(!Saves.valid(rec,h.size))throw Error('Checkpoint checksum failed.');
    return rec;
  }
  function download(blob,ext){
    const a=document.createElement('a'),href=URL.createObjectURL(blob);
    a.href=href;a.download=$('#cart').textContent.replace(/\.gba$/i,'')+'.'+ext;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),60000);
    logPlayer('info','Save exported',{format:ext,bytes:blob.size});
  }
  function report(error){status(error.message);logPlayer('error','Save transfer failed',{error:errorText(error)});}
  $('#export-state').onclick=()=>{try{download(encode(captureRecord()),'vpspsave');}catch(e){report(e);}};
  $('#export-battery').onclick=()=>{
    try{
      const bytes=readBattery();
      if(!bytes)throw Error('Make a save from the game menu first.');
      download(new Blob([bytes],{type:'application/octet-stream'}),'sav');
    }catch(e){report(e);}
  };
  $('#import-save').onclick=()=>$('#save-file').click();
  $('#save-file').onchange=async e=>{
    const file=e.target.files[0],key=cartridge;
    e.target.value='';
    if(!file||!key)return;
    let before,wasPaused;
    try{
      if(!file.size||file.size>8*1024*1024)throw Error('Invalid save file size.');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(cartridge!==key)return;
      const raw=/\.sav$/i.test(file.name);
      if(!raw&&!/\.vpspsave$/i.test(file.name))throw Error('Choose a .vpspsave or .sav file.');
      const rec=raw?null:decode(bytes);
      if(raw){
        const expected=readBattery()?.length;
        if(!batterySizes.includes(bytes.length)||(expected&&expected!==bytes.length))throw Error('Game save size does not match this cartridge.');
      }
      const prompt=raw?'Import this game save for '+$('#cart').textContent+' and restart at the title screen? Raw .sav files do not identify the game.':
        'Restore this checkpoint and replace the current autosave?';
      if(!confirm(prompt))return;
      before=captureRecord();wasPaused=paused;
      pause(true,'import');busyLoading(true);$('fieldset').disabled=true;
      if(raw){loadBattery(bytes);core._mgbawasm_reset();paint();}
      else restoreState(rec);
      if(!await checkpoint('import',true))throw Error('Import could not be saved.');
      status(raw?'Game save imported. Choose Continue in the game.':'Checkpoint imported.');
      logPlayer('info','Save imported',{format:raw?'sav':'vpspsave'});
    }catch(error){
      if(before)restoreState(before);
      report(error);
    }finally{
      if(before){pause(wasPaused||document.hidden,'import finished');busyLoading(false);$('fieldset').disabled=false;}
    }
  };
  return {encode,decode};
})();
