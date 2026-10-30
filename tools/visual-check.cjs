// Revisión manual reproducible. Requiere Chrome local y servidor en http://127.0.0.1:3099.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const WebSocket=require('ws');
const assert=require('node:assert/strict');
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const root=path.resolve(__dirname,'..');
const output=path.join(root,'artifacts','ui');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cnc-visual-'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browser=spawn(chrome,['--headless=old','--disable-gpu','--disable-gpu-sandbox','--disable-software-rasterizer','--no-sandbox','--no-first-run','--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let port;
async function ready(){
  for(let i=0;i<100;i++){const file=path.join(profile,'DevToolsActivePort');if(fs.existsSync(file)){port=Number(fs.readFileSync(file,'utf8').split('\n')[0]);return;}await delay(100);}
  throw Error('Chrome no abrió el puerto de depuración.');
}
async function tab(){
  const response=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'});
  const info=await response.json();const ws=new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  let id=0;const waiting=new Map();
  ws.on('message',raw=>{const message=JSON.parse(raw.toString());if(message.id&&waiting.has(message.id)){const {resolve,reject}=waiting.get(message.id);waiting.delete(message.id);message.error?reject(Error(message.error.message)):resolve(message.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;waiting.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
  await call('Page.enable');await call('Runtime.enable');
  return {call,evaluate,ws};
}
async function viewport(t,width,height,mobile,url){
  await t.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await t.call('Page.navigate',{url});
  for(let i=0;i<100;i++){if(await t.evaluate('document.readyState==="complete"'))return;await delay(100);}
  throw Error('La página no terminó de cargar: '+url);
}
async function until(t,expression){
  for(let i=0;i<100;i++){if(await t.evaluate(expression))return;await delay(100);}
  throw Error('No se alcanzó el estado: '+expression);
}
async function measure(t,name,width,height,mainSelector){
  const info=await t.evaluate('(()=>{const node=document.querySelector('+JSON.stringify(mainSelector)+');const rect=node.getBoundingClientRect();return {innerWidth,scrollWidth:document.documentElement.scrollWidth,mainTop:Math.round(rect.top),mainBottom:Math.round(rect.bottom),mainEnabled:!node.disabled,bodyHeight:document.body.scrollHeight}})()');
  assert.equal(info.innerWidth,width,name+' viewport');
  assert.ok(info.scrollWidth<=width,name+' desborda horizontalmente: '+JSON.stringify(info));
  assert.ok(info.mainTop<height,name+' acción principal fuera de la primera vista: '+JSON.stringify(info));
  const shot=await t.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));
  return {name,...info};
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});await ready();
  const host=await tab();const results=[];
  for(const [width,height] of [[1366,768],[1280,720],[768,1024]]){
    await viewport(host,width,height,width<900,'http://127.0.0.1:3099/');
    await until(host,'/^\\d{6}$/.test(document.querySelector("#pairCode").textContent)');
    results.push(await measure(host,'desktop-'+width,width,height,'#run'));
  }
  const link=await host.evaluate('document.querySelector("#remoteUrl").href');
  const code=await host.evaluate('document.querySelector("#pairCode").textContent');
  const remote=await tab();
  for(const [width,height] of [[390,844],[360,740]]){
    await viewport(remote,width,height,true,link);
    await until(remote,'document.querySelector("#connectionBadge").textContent==="Servidor activo"');
    assert.equal(await remote.evaluate('document.querySelector("#remotePanel").hidden'),true);
    const pairShot=await remote.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(output,'pair-'+width+'.png'),Buffer.from(pairShot.data,'base64'));
    await remote.evaluate('document.querySelector("#pairInput").value='+JSON.stringify(code)+';document.querySelector("#pairButton").click();true');
    await until(remote,'document.querySelector("#pairState").textContent==="EMPAREJADO"');
    assert.equal(await remote.evaluate('document.querySelector("#pairCard").hidden'),true);
    results.push(await measure(remote,'remote-'+width,width,height,'#start'));
  }
  console.log(JSON.stringify(results,null,2));
  host.ws.close();remote.ws.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  browser.kill();
  const intended=path.resolve(os.tmpdir())+path.sep;
  if(path.resolve(profile).startsWith(intended))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
});
