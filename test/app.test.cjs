const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const CNCParser = require('../js/gcode-parser.js');
const CNCEngine = require('../js/cnc-engine.js');
const CNCExamples = require('../js/examples.js');
const CNCIoT = require('../js/iot-simulator.js');

function mount() {
  const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements = Object.fromEntries(ids.map(id=>[id,{
    value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,style:{},scrollTop:0,
    classList:{toggle(){},set name(value){}},setAttribute(){},
    get selectedOptions(){return [{textContent:this.value}]},
  }]));
  elements.speed.value='10'; elements.step.value='10'; elements.shape.value='square';
  const frames=new Map();let next=1, now=0;
  const context={document:{getElementById:id=>elements[id]},CNCParser,CNCEngine,CNCExamples,CNCIoT,
    CNCNetwork:{HostLink:class{constructor(){this.connected=false;this.mode='local';this.clients=0;this.messages=0;this.pairCode='';this.expiresAt=0;this.token='';this.remoteUrls=[];this.lastCommand='—';this.error='';}start(){}publish(){}async rotate(){return '123456';}}},
    CNCRenderer:{draw(){},exportPaper(){return 'data:image/png;base64,AA=='}},
    requestAnimationFrame:fn=>{const id=next++;frames.set(id,fn);return id},
    cancelAnimationFrame:id=>frames.delete(id),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8'),context);
  const stepFrames=(count=1)=>{for(let i=0;i<count && frames.size;i++){const [id,fn]=frames.entries().next().value;frames.delete(id);now+=16;fn(now)}};
  return {e:elements,stepFrames,frames};
}

test('interfaz: ejecución, pausa, remoto, enlace, jog, validación e importación',async()=>{
  const {e,stepFrames,frames}=mount();
  assert.ok(e.commands.value.includes('G21'));
  e.run.onclick();stepFrames(6);assert.equal(e.machineState.textContent,'EJECUTANDO');
  const movingX=e.xval.innerHTML;e.pause.onclick();stepFrames(8);assert.equal(e.machineState.textContent,'PAUSADO');assert.equal(e.xval.innerHTML,movingX);
  e.pause.onclick();stepFrames(8);assert.equal(e.machineState.textContent,'EJECUTANDO');
  e.stop.onclick();assert.equal(e.machineState.textContent,'DETENIDO');assert.equal(frames.size,0);
  e.reset.onclick();assert.equal(e.progress.textContent,'0%');assert.ok(e.xval.innerHTML.startsWith('0.00'));
  e.penToggle.onclick();e.jogRight.onclick();stepFrames(100);assert.ok(e.xval.innerHTML.startsWith('10.00'));assert.equal(e.penval.textContent,'ABAJO');
  e.penToggle.onclick();e.home.onclick();stepFrames(100);assert.ok(e.xval.innerHTML.startsWith('0.00'));
  e.networkToggle.onclick();e.remoteStart.onclick();assert.equal(e.machineState.textContent,'EN ESPERA');assert.equal(e.packets.textContent,'0');
  e.networkToggle.onclick();e.remoteStart.onclick();assert.equal(e.machineState.textContent,'EJECUTANDO');assert.equal(e.packets.textContent,'1');assert.equal(e.remoteJobs.textContent,'1');
  e.remoteStart.onclick();assert.equal(e.machineState.textContent,'EJECUTANDO');assert.equal(e.remoteJobs.textContent,'1');
  e.remotePause.onclick();assert.equal(e.machineState.textContent,'PAUSADO');e.remotePause.onclick();assert.equal(e.machineState.textContent,'EJECUTANDO');
  e.remoteStop.onclick();assert.equal(e.machineState.textContent,'DETENIDO');
  e.commands.value='G2 X10';e.validate.onclick();assert.match(e.status.textContent,/Línea 1/);
  e.gfile.onchange({target:{files:[{name:'cuadrado.gcode',size:90,text:async()=>fs.readFileSync(path.join(__dirname,'../ejemplos/cuadrado.gcode'),'utf8')}],value:'mock'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(e.status.textContent,/importado/);assert.ok(e.commands.value.includes('X135'));
  e.clearEvents.onclick();assert.match(e.events.textContent,/reiniciado/);
});
