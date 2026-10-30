const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const WebSocket=require('ws');
const {createServer}=require('../server/server.cjs');
const CNCParser=require('../js/gcode-parser.js'),CNCEngine=require('../js/cnc-engine.js'),CNCExamples=require('../js/examples.js'),CNCIoT=require('../js/iot-simulator.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await delay(10);}throw Error('No llegó el estado esperado.');}

test('el puente WebSocket ejecuta órdenes sobre la misma interfaz y motor CNC',async()=>{
  const server=createServer({host:'127.0.0.1',port:0});let remote;
  try{
    const port=(await server.start()).port,base=`http://127.0.0.1:${port}`;
    const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
    const elements=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,style:{},scrollTop:0,classList:{toggle(){}},setAttribute(){},get selectedOptions(){return[{textContent:this.value}]}}]));
    elements.speed.value='10';elements.step.value='10';elements.shape.value='square';
    const frames=new Map();let frameId=0,now=0;
    const context=vm.createContext({document:{getElementById:id=>elements[id]},CNCParser,CNCEngine,CNCExamples,CNCIoT,
      CNCRenderer:{draw(){},exportPaper(){return 'data:image/png;base64,AA=='}},
      location:{protocol:'http:',hostname:'127.0.0.1',host:`127.0.0.1:${port}`,port:String(port),origin:base},
      sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},
      fetch:(url,options)=>fetch(base+url,options),WebSocket,
      requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(callback,ms)=>{const timer=setTimeout(callback,ms);timer.unref();return timer},clearTimeout,Date,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/network-client.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8'),context);
    await until(()=>server.snapshot().online&&server.snapshot().state?.mode==='idle');
    const sessionId=[...server.sessions.keys()][0],session=server.sessions.get(sessionId);
    remote=new WebSocket(`ws://127.0.0.1:${port}/ws?session=${sessionId}`);
    const messages=[],waiting=[];
    remote.on('message',raw=>{const msg=JSON.parse(raw.toString());const index=waiting.findIndex(item=>item.match(msg));if(index>=0){const item=waiting.splice(index,1)[0];clearTimeout(item.timer);item.resolve(msg);}else messages.push(msg);});
    await new Promise(resolve=>remote.once('open',resolve));
    const wait=(match)=>{const index=messages.findIndex(match);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);return new Promise((resolve,reject)=>{const item={match,resolve,timer:setTimeout(()=>reject(Error('Respuesta remota ausente.')),3000)};waiting.push(item);});};
    const send=(id,action,params)=>remote.send(JSON.stringify({type:'command',id,action,...(params?{params}:{})}));
    remote.send(JSON.stringify({type:'pair',id:'pair1',code:session.pairCode}));await wait(m=>m.type==='command_ack'&&m.id==='pair1');
    send('start','start_job');await wait(m=>m.type==='command_ack'&&m.id==='start');assert.equal(elements.machineState.textContent,'EJECUTANDO');
    for(let i=0;i<8;i++){const [id,callback]=frames.entries().next().value;frames.delete(id);now+=16;callback(now);}
    assert.ok(parseFloat(elements.xval.innerHTML)>0);
    send('pause','pause_job');await wait(m=>m.type==='command_ack'&&m.id==='pause');assert.equal(elements.machineState.textContent,'PAUSADO');
    send('resume','resume_job');await wait(m=>m.type==='command_ack'&&m.id==='resume');assert.equal(elements.machineState.textContent,'EJECUTANDO');
    send('stop','stop_job');await wait(m=>m.type==='command_ack'&&m.id==='stop');assert.equal(elements.machineState.textContent,'DETENIDO');
    const before=parseFloat(elements.xval.innerHTML);
    send('jog','jog',{dx:5,dy:0});await wait(m=>m.type==='command_ack'&&m.id==='jog');assert.equal(elements.machineState.textContent,'MOVIENDO');
    while(frames.size){const [id,callback]=frames.entries().next().value;frames.delete(id);now+=16;callback(now);}
    assert.ok(Math.abs(parseFloat(elements.xval.innerHTML)-(before+5))<0.02);
    await delay(120);assert.ok(Math.abs(server.snapshot().state.x-(before+5))<0.02);
  }finally{remote?.terminate();await server.stop();}
});
