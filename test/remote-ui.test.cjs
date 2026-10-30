const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const WebSocket=require('ws');
const {createServer}=require('../server/server.cjs');
const {Engine}=require('../js/cnc-engine.js');
const {parse}=require('../js/gcode-parser.js');
const examples=require('../js/examples.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await delay(10);}throw Error('La interfaz remota no alcanzó el estado esperado.');}

test('panel táctil remoto: empareja, controla y muestra telemetría del anfitrión',async()=>{
  const server=createServer({host:'127.0.0.1',port:0});let host,remoteSocket;
  try{
    const port=(await server.start()).port,base=`http://127.0.0.1:${port}`,session=await(await fetch(base+'/api/sessions',{method:'POST'})).json();
    const engine=new Engine(),state=()=>({x:engine.x,y:engine.y,pen:engine.pen,contact:engine.contact,mode:engine.mode,progress:engine.progress,line:engine.line,loadedJob:'Cuadrado'});
    host=new WebSocket(`ws://127.0.0.1:${port}/ws?session=${session.sessionId}`);
    host.on('message',raw=>{
      const msg=JSON.parse(raw.toString());if(msg.type!=='execute')return;
      try{
        if(msg.action==='start_job')engine.start(parse(examples.get('square')));
        else if(msg.action==='pause_job')engine.pause();
        else if(msg.action==='resume_job')engine.resume();
        else if(msg.action==='stop_job')engine.stop();
        else if(msg.action==='jog'){engine.jog(msg.params.dx,msg.params.dy);while(engine.mode==='jogging')engine.advance(80,10);}
        else if(msg.action==='home'){engine.home();while(engine.mode==='jogging')engine.advance(80,10);}
        else if(msg.action==='pen_up')engine.setPen(false);
        else if(msg.action==='pen_down')engine.setPen(true);
        host.send(JSON.stringify({type:'command_result',id:msg.id,accepted:true,state:state()}));
      }catch(error){host.send(JSON.stringify({type:'command_result',id:msg.id,accepted:false,error:error.message,state:state()}));}
    });
    await new Promise(resolve=>host.once('open',resolve));
    host.send(JSON.stringify({type:'hello',id:'host',role:'host',token:session.hostToken}));
    await until(()=>server.snapshot().online);
    host.send(JSON.stringify({type:'telemetry',state:state()}));
    const html=fs.readFileSync(path.join(__dirname,'../remote.html'),'utf8');
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
    const elements=Object.fromEntries(ids.map(id=>[id,{id,value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{toggle(){}}}]));
    for(const match of html.matchAll(/id="([^"]+)"[^>]*data-action="([^"]+)"/g))elements[match[1]].dataset={action:match[2]};
    elements.step.value='10';
    class TrackedSocket extends WebSocket{constructor(url){super(url);remoteSocket=this;}}
    const context=vm.createContext({document:{getElementById:id=>elements[id],querySelectorAll:()=>Object.values(elements).filter(e=>e.dataset?.action)},
      location:{protocol:'http:',host:`127.0.0.1:${port}`,search:`?session=${session.sessionId}`},URLSearchParams,WebSocket:TrackedSocket,Date,
      setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/remote.js'),'utf8'),context);
    await until(()=>elements.connectionBadge.textContent==='Servidor activo');
    assert.equal(elements.remotePanel.hidden,true);
    assert.equal(elements.start.disabled,true);
    elements.pairInput.value='123';elements.pairButton.onclick();
    assert.match(elements.pairHelp.textContent,/seis dígitos/);
    elements.pairInput.value=session.pairCode==='000000'?'000001':'000000';elements.pairButton.onclick();
    await until(()=>/Código incorrecto/.test(elements.pairHelp.textContent));
    assert.equal(elements.pairCard.hidden,false);
    elements.pairInput.value=session.pairCode;elements.pairButton.onclick();await until(()=>elements.pairState.textContent==='EMPAREJADO');
    assert.equal(elements.connectionBadge.textContent,'Vinculado');
    assert.equal(elements.pairCard.hidden,true);
    assert.equal(elements.remotePanel.hidden,false);
    assert.equal(elements.start.disabled,false);
    elements.start.onclick();await until(()=>elements.machineMode.textContent==='EJECUTANDO');
    assert.equal(elements.start.disabled,true);
    assert.equal(elements.pause.disabled,false);
    assert.equal(elements.right.disabled,true);
    elements.pause.onclick();await until(()=>elements.machineMode.textContent==='PAUSADO');
    assert.equal(elements.resume.disabled,false);
    elements.resume.onclick();await until(()=>elements.machineMode.textContent==='EJECUTANDO');
    elements.stop.onclick();assert.equal(elements.machineMode.textContent,'EJECUTANDO');
    assert.equal(elements.stop.textContent,'Confirmar detención');
    elements.stop.onclick();await until(()=>elements.machineMode.textContent==='DETENIDO');
    assert.equal(elements.right.disabled,false);
    elements.right.onclick();await until(()=>elements.x.innerHTML.startsWith('10.00'));
    assert.match(elements.progress.textContent,/^\d+%$/);
    elements.penDown.onclick();await until(()=>elements.pen.textContent==='ABAJO');
    elements.home.onclick();await until(()=>elements.x.innerHTML.startsWith('0.00'));
    assert.match(elements.messages.textContent,/Orden aceptada/);
  }finally{remoteSocket?.terminate();host?.terminate();await server.stop();}
});
