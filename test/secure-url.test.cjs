const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sessionId='abcdefghijklmnop',hostToken='a'.repeat(64);

test('páginas HTTPS eligen WSS; páginas HTTP locales eligen WS',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../js/network-client.js'),'utf8');
  for(const [protocol,scheme] of [['https:','wss:'],['http:','ws:']]){
    const urls=[];
    class Socket{constructor(url){urls.push(url);this.readyState=0;}send(){}static OPEN=1;}
    const origin=`${protocol}//example.test`;
    const context=vm.createContext({location:{protocol,host:'example.test',origin},WebSocket:Socket,
      fetch:async url=>({ok:true,json:async()=>url==='/health'?{status:'ok'}:{sessionId,hostToken,pairCode:'123456',expiresAt:Date.now()+1000}}),
      sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},Date,setTimeout,clearTimeout});
    vm.runInContext(source,context);
    const link=new context.CNCNetwork.HostLink({getState:()=>({}),onCommand:()=>{},onStatus:()=>{}});
    await link.start();
    assert.equal(urls[0],`${scheme}//example.test/ws?session=${sessionId}`);
    assert.equal(link.remoteUrls[0],`${origin}/remote?session=${sessionId}`);
  }
});

test('el controlador remoto usa WSS y conserva el ID de su sesión',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../js/remote.js'),'utf8');
  const urls=[],elements=new Map();
  class Socket{constructor(url){urls.push(url);this.readyState=0;}static OPEN=1;}
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{toggle(){}}});
    return elements.get(id);
  };
  vm.runInNewContext(source,{location:{protocol:'https:',host:'example.test',search:`?session=${sessionId}`},URLSearchParams,
    WebSocket:Socket,Date,document:{getElementById:element,querySelectorAll:()=>[]},setTimeout,clearTimeout});
  assert.equal(urls[0],`wss://example.test/ws?session=${sessionId}`);
  assert.equal(element('sessionLabel').textContent,sessionId);
});
