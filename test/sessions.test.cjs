const test=require('node:test');
const assert=require('node:assert/strict');
const WebSocket=require('ws');
const {createServer}=require('../server/server.cjs');

function client(url){
  const socket=new WebSocket(url),messages=[],waiters=[];
  socket.on('message',raw=>{
    const message=JSON.parse(raw.toString()),index=waiters.findIndex(item=>item.match(message));
    if(index<0)messages.push(message);
    else{const item=waiters.splice(index,1)[0];clearTimeout(item.timer);item.resolve(message);}
  });
  const ready=new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const wait=(match,ms=3000)=>{
    const index=messages.findIndex(match);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{const item={match,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(item),1);reject(Error('Tiempo agotado'));},ms)};waiters.push(item);});
  };
  return {socket,ready,wait,send:message=>socket.send(JSON.stringify(message))};
}
const by=(type,id)=>message=>message.type===type&&(id===undefined||message.id===id);

test('dos CNC simultáneas aíslan tokens, códigos, órdenes y telemetría',async()=>{
  const server=createServer({host:'127.0.0.1',port:0}),sockets=[];
  try{
    const port=(await server.start()).port,base=`http://127.0.0.1:${port}`;
    const create=async()=>await(await fetch(base+'/api/sessions',{method:'POST'})).json();
    const first=await create(),second=await create();
    while(second.pairCode===first.pairCode){
      const renewed=await(await fetch(base+`/api/sessions/${second.sessionId}/rotate`,{method:'POST',headers:{Authorization:`Bearer ${second.hostToken}`}})).json();
      second.pairCode=renewed.pairCode;
    }
    assert.notEqual(first.sessionId,second.sessionId);assert.notEqual(first.hostToken,second.hostToken);
    const url=id=>`ws://127.0.0.1:${port}/ws?session=${id}`;
    const h1=client(url(first.sessionId)),h2=client(url(second.sessionId)),c1=client(url(first.sessionId)),c2=client(url(second.sessionId)),impostor=client(url(second.sessionId));
    sockets.push(h1,h2,c1,c2,impostor);await Promise.all(sockets.map(item=>item.ready));
    impostor.send({type:'hello',id:'wronghost',role:'host',token:first.hostToken});
    assert.match((await impostor.wait(by('command_error','wronghost'))).error,/rechazada/);
    h1.send({type:'hello',id:'host1',role:'host',token:first.hostToken});
    h2.send({type:'hello',id:'host2',role:'host',token:second.hostToken});
    await Promise.all([h1.wait(by('command_ack','host1')),h2.wait(by('command_ack','host2'))]);
    const privateResponse=await fetch(base+`/api/sessions/${first.sessionId}`,{headers:{Authorization:`Bearer ${second.hostToken}`}});
    assert.equal(privateResponse.status,403);
    c1.send({type:'pair',id:'cross',code:second.pairCode});
    assert.match((await c1.wait(by('command_error','cross'))).error,/incorrecto/);
    c1.send({type:'pair',id:'pair1',code:first.pairCode});c2.send({type:'pair',id:'pair2',code:second.pairCode});
    await Promise.all([c1.wait(by('command_ack','pair1')),c2.wait(by('command_ack','pair2'))]);
    const state=x=>({x,y:0,pen:false,contact:false,mode:'idle',progress:0,line:null,loadedJob:'A'});
    h1.send({type:'telemetry',state:state(11)});h2.send({type:'telemetry',state:state(72)});
    assert.equal((await c1.wait(m=>m.type==='telemetry'&&m.state?.x===11)).state.x,11);
    assert.equal((await c2.wait(m=>m.type==='telemetry'&&m.state?.x===72)).state.x,72);
    assert.equal(server.snapshot(first.sessionId).state.x,11);assert.equal(server.snapshot(second.sessionId).state.x,72);
    c1.send({type:'command',id:'move1',action:'jog',params:{dx:5,dy:0}});
    const execute=await h1.wait(by('execute'));assert.equal(execute.action,'jog');
    await assert.rejects(h2.wait(by('execute'),120),/Tiempo agotado/);
    h1.send({type:'command_result',id:execute.id,accepted:true,state:state(16)});
    assert.equal((await c1.wait(by('command_ack','move1'))).state.x,16);
    assert.equal(server.snapshot(second.sessionId).state.x,72);
  }finally{for(const item of sockets)item.socket.terminate();await server.stop();}
});
