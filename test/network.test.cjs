const test=require('node:test');
const assert=require('node:assert/strict');
const WebSocket=require('ws');
const {createServer}=require('../server/server.cjs');
const {Engine}=require('../js/cnc-engine.js');
const {parse}=require('../js/gcode-parser.js');
const examples=require('../js/examples.js');

function client(url){
  const socket=new WebSocket(url),messages=[],waiters=[];
  socket.on('message',raw=>{const msg=JSON.parse(raw.toString());const waiter=waiters.find(w=>w.match(msg));if(waiter){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(msg);}else messages.push(msg);});
  const ready=new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const wait=(match,timeout=3000)=>{const found=messages.findIndex(match);if(found>=0)return Promise.resolve(messages.splice(found,1)[0]);return new Promise((resolve,reject)=>{const waiter={match,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Tiempo agotado esperando mensaje.'));},timeout)};waiters.push(waiter);});};
  return {socket,ready,wait,send:message=>socket.send(JSON.stringify(message)),close:()=>socket.close()};
}
const by=(type,id)=>message=>message.type===type&&(id===undefined||message.id===id);
function snapshot(engine){return{x:engine.x,y:engine.y,pen:engine.pen,contact:engine.contact,mode:engine.mode,progress:engine.progress,line:engine.line,loadedJob:'Cuadrado'};}

test('servidor, emparejamiento, dos clientes, órdenes reales, límites y reconexión',async()=>{
  const server=createServer({host:'127.0.0.1',port:0});
  const sockets=[];
  try{
    const address=await server.start(),base=`http://127.0.0.1:${address.port}`;
    const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/CNC Virtual/);
    assert.equal((await fetch(base+'/remote')).status,200);
    assert.equal((await fetch(base+'/js/remote.js')).status,200);
    assert.equal((await fetch(base+'/../package.json')).status,404);
    assert.deepEqual(await (await fetch(base+'/health')).json(),{status:'ok'});
    const session=await (await fetch(base+'/api/sessions',{method:'POST'})).json();assert.match(session.pairCode,/^\d{6}$/);
    assert.match(session.sessionId,/^[A-Za-z0-9_-]{16}$/);
    const url=`ws://127.0.0.1:${address.port}/ws?session=${session.sessionId}`;
    const host=client(url),a=client(url),b=client(url);sockets.push(host,a,b);await Promise.all([host.ready,a.ready,b.ready]);
    const engine=new Engine();
    host.socket.on('message',raw=>{
      const msg=JSON.parse(raw.toString());if(msg.type!=='execute')return;
      try{
        const p=msg.params||{};
        if(msg.action==='start_job'){if(engine.mode==='running')throw Error('Ya hay trabajo.');engine.start(parse(examples.get('square')));}
        else if(msg.action==='pause_job'){if(!engine.pause())throw Error('No está ejecutando.');}
        else if(msg.action==='resume_job'){if(!engine.resume())throw Error('No está pausado.');}
        else if(msg.action==='stop_job')engine.stop();
        else if(msg.action==='jog'){engine.jog(p.dx,p.dy);for(let i=0;i<100&&engine.mode==='jogging';i++)engine.advance(80,10);}
        else if(msg.action==='home'){engine.home();for(let i=0;i<100&&engine.mode==='jogging';i++)engine.advance(80,10);}
        else if(msg.action==='pen_up')engine.setPen(false);
        else if(msg.action==='pen_down')engine.setPen(true);
        host.send({type:'command_result',id:msg.id,accepted:true,state:snapshot(engine)});
        host.send({type:'telemetry',state:snapshot(engine)});
      }catch(error){host.send({type:'command_result',id:msg.id,accepted:false,error:error.message,state:snapshot(engine)});}
    });
    host.send({type:'hello',id:'h1',role:'host',token:session.hostToken});assert.equal((await host.wait(by('command_ack','h1'))).role,'host');
    host.send({type:'telemetry',state:snapshot(engine)});
    a.send({type:'command',id:'unauth',action:'start_job'});assert.match((await a.wait(by('command_error','unauth'))).error,/Emparejamiento/);
    a.send({type:'pair',id:'wrong',code:'000000'});assert.match((await a.wait(by('command_error','wrong'))).error,/incorrecto/);
    a.send({type:'pair',id:'pa',code:session.pairCode});assert.equal((await a.wait(by('command_ack','pa'))).paired,true);
    b.send({type:'pair',id:'pb',code:session.pairCode});assert.equal((await b.wait(by('command_ack','pb'))).paired,true);
    a.send({type:'command',id:'badtype',action:'jog',params:{dx:999,dy:0}});assert.match((await a.wait(by('command_error','badtype'))).error,/JOG/);
    a.send({type:'command',id:'badextra',action:'start_job',params:{code:'evil'}});assert.match((await a.wait(by('command_error','badextra'))).error,/parámetros/);
    a.socket.send('{bad json');assert.match((await a.wait(by('command_error'))).error,/JSON/);
    a.send({type:'command',id:'start1',action:'start_job'});assert.equal((await a.wait(by('command_ack','start1'))).action,'start_job');assert.equal(engine.mode,'running');
    b.send({type:'command',id:'start2',action:'start_job'});assert.match((await b.wait(by('command_error','start2'))).error,/Ya hay trabajo/);
    a.send({type:'command',id:'pause1',action:'pause_job'});await a.wait(by('command_ack','pause1'));assert.equal(engine.mode,'paused');
    b.send({type:'command',id:'resume1',action:'resume_job'});await b.wait(by('command_ack','resume1'));assert.equal(engine.mode,'running');
    a.send({type:'command',id:'stop1',action:'stop_job'});await a.wait(by('command_ack','stop1'));assert.equal(engine.mode,'stopped');
    a.send({type:'command',id:'jog1',action:'jog',params:{dx:10,dy:0}});await a.wait(by('command_ack','jog1'));assert.equal(engine.x,10);
    const telemetry=await b.wait(message=>message.type==='telemetry'&&message.state?.x===10);assert.equal(telemetry.state.x,10);
    a.send({type:'command',id:'out',action:'jog',params:{dx:-25,dy:0}});assert.match((await a.wait(by('command_error','out'))).error,/fuera de límites/);
    a.send({type:'command',id:'dup',action:'pen_down'});await a.wait(by('command_ack','dup'));
    a.send({type:'command',id:'dup',action:'pen_down'});assert.match((await a.wait(by('command_error','dup'))).error,/repetido/);
    a.close();await new Promise(resolve=>a.socket.once('close',resolve));
    const again=client(url);sockets.push(again);await again.ready;
    const connection=await again.wait(by('connection'));assert.equal(connection.state.x,10);
    again.send({type:'pair',id:'again',code:session.pairCode});await again.wait(by('command_ack','again'));
    again.send({type:'command',id:'home1',action:'home'});await again.wait(by('command_ack','home1'));assert.equal(engine.x,0);
    for(let i=0;i<13;i++)again.send({type:'command',id:`rate${i}`,action:'pen_up'});
    assert.match((await again.wait(by('command_error','rate12'))).error,/frecuencia/);
    const rotated=await fetch(base+`/api/sessions/${session.sessionId}/rotate`,{method:'POST',headers:{Authorization:`Bearer ${session.hostToken}`}});assert.equal(rotated.status,200);assert.match((await rotated.json()).pairCode,/^\d{6}$/);
  }finally{for(const item of sockets)item.socket.terminate();await server.stop();}
});
