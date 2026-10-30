const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('file:// conserva el modo local sin solicitar servidor ni abrir WebSocket',async()=>{
  let requests=0,sockets=0,updates=0;
  const context=vm.createContext({location:{protocol:'file:',hostname:'',host:''},
    fetch:()=>{requests++;throw Error('No debe consultar la red.');},
    WebSocket:class{constructor(){sockets++;throw Error('No debe abrir WebSocket.');}},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/network-client.js'),'utf8'),context);
  const link=new context.CNCNetwork.HostLink({getState:()=>({}),onCommand:()=>{},onStatus:()=>updates++});
  await link.start();
  assert.equal(link.mode,'local');assert.equal(requests,0);assert.equal(sockets,0);assert.equal(updates,1);
});
