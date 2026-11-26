const h=React.createElement;
function key(name,label=name){return h('button',{'data-key':name,'aria-label':name,key:name},label)}
const skins = [
  ['Violet','#8d7ac5'], ['Ruby','#b74955'], ['Cobalt','#426dab'],
  ['Jade','#46876a'], ['Amber','#d89739'], ['Pearl','#e5dfd6'],
  ['Graphite','#525762'], ['Rose','#cd83a0'], ['Glacier','#80bdc8'],
  ['Tangerine','#da7345'], ['Checkered Mint','#358b7c','checker'],
  ['Rally Stripe','#324f75','stripes'], ['Starfield','#36345b','stars'],
  ['Crystal Circuit','#9cbfbc','clear']
];
function savedSkin(){
  try { return skins.find(skin=>skin[0]===localStorage.getItem('violet-shell')) || skins[0]; }
  catch { return skins[0]; }
}
function SkinnedHandheld(){
  const [skin,setSkin]=React.useState(savedSkin);
  const bag=React.useRef([]);
  function shuffle(){
    if(!bag.current.length)bag.current=skins.filter(candidate=>candidate!==skin);
    const index=Math.floor(Math.random()*bag.current.length);
    const [next]=bag.current.splice(index,1);
    setSkin(next);
    try { localStorage.setItem('violet-shell',next[0]); } catch { /* Session-only preference. */ }
  }
  return h('div',null,h(Handheld,{skin}),h('div',{className:'skin-controls'},
    h('button',{type:'button',onClick:shuffle},'Shuffle skin'),
    h('output',{'aria-live':'polite'},skin[0])));
}
function Handheld({skin}){return h('section',{className:'console', style:{'--shell':skin[1]}, 'data-finish':skin[2]||'solid', 'aria-label':'SP handheld'},
 h('div',{className:'lid'},h('div',{className:'bezel'},h('canvas',{width:240,height:160,'aria-label':'Game display'}),h('div',{id:'gate'},h('button',{id:'start'},'Power on'))),h('small',null,'VIOLET POCKET  /  SP')),
 h('div',{className:'hinge','aria-hidden':true}),
 h('div',{className:'deck'},h('div',{className:'shoulders'},key('L'),key('R')),h('div',{className:'controls'},h('div',{className:'dpad'},key('Up','▲'),key('Left','◀'),key('Right','▶'),key('Down','▼')),h('div',{className:'grille','aria-hidden':true}),h('div',{className:'ab'},key('B'),key('A'))),h('div',{className:'system'},key('Select'),key('Start'))));}
function Panel(){return h('aside',null,h('h2',null,'Cartridge'),h('p',{id:'cart'},'No ROM loaded'),h('button',{id:'open',disabled:true},'Load ROM'),h('input',{id:'file',type:'file',accept:'.gba,.zip',hidden:true}),h('fieldset',{disabled:true},h('legend',null,'Playback'),h('button',{id:'pause'},'Pause'),h('button',{id:'fast','aria-pressed':false},'Fast forward · 2×'),h('label',null,'Volume',h('input',{id:'vol',type:'range',min:0,max:100,defaultValue:65})),h('div',{className:'states'},h('button',{id:'save'},'Save State'),h('button',{id:'load'},'Load State'))),h('p',{id:'status',role:'status'},'Power on, then choose a .gba or .zip file.'),h('details',null,h('summary',null,'Controls Guide'),h('p',null,'Arrows · D-pad | Z / X · A / B | A / S · L / R | Enter / Shift · Start / Select')));}
function App(){return h('main',null,h('header',null,h('span',{className:'mark'},'▦'),h('div',null,h('h1',null,'Violet Pocket SP'),h('p',null,'Game Boy Advance emulator'))),h('div',{className:'layout'},h(SkinnedHandheld),h(Panel)));}
ReactDOM.flushSync(()=>ReactDOM.createRoot(document.getElementById('root')).render(h(App)));
