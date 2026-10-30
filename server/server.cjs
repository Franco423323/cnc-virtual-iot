'use strict';
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const FILES = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/remote', 'remote.html'], ['/remote.html', 'remote.html'],
  ['/css/style.css', 'css/style.css'], ['/css/network.css', 'css/network.css'], ['/css/remote.css', 'css/remote.css'],
  ...['gcode-parser','cnc-engine','cnc-renderer','examples','iot-simulator','app','network-client','remote'].map(name => [`/js/${name}.js`, `js/${name}.js`]),
]);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const ACTIONS = new Set(['start_job','pause_job','resume_job','stop_job','jog','home','pen_up','pen_down']);
const MODES = new Set(['idle','running','paused','stopped','complete','jogging']);
const SESSION_ID = /^[A-Za-z0-9_-]{16}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (object, allowed) => Object.keys(object).every(key => allowed.includes(key));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
const boundedInt = (value, fallback, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
function tokenMatches(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}
function normalizeState(value) {
  if (!isObject(value) || !onlyKeys(value,['x','y','pen','contact','mode','progress','line','loadedJob'])) return null;
  if (!Number.isFinite(value.x) || value.x < 0 || value.x > 200 || !Number.isFinite(value.y) || value.y < 0 || value.y > 150) return null;
  if (typeof value.pen !== 'boolean' || typeof value.contact !== 'boolean' || !MODES.has(value.mode)) return null;
  if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100) return null;
  if (value.line !== null && (!Number.isInteger(value.line) || value.line < 1 || value.line > 100000)) return null;
  if (typeof value.loadedJob !== 'string' || value.loadedJob.length > 80) return null;
  return {x:value.x,y:value.y,pen:value.pen,contact:value.contact,mode:value.mode,progress:value.progress,line:value.line,loadedJob:value.loadedJob};
}
function validateCommand(message) {
  if (!isObject(message) || !onlyKeys(message,['id','type','action','params']) || !validId(message.id) || message.type !== 'command' || !ACTIONS.has(message.action)) return 'Comando o identificador inválido.';
  const params = message.params === undefined ? {} : message.params;
  if (!isObject(params)) return 'Parámetros inválidos.';
  if (message.action !== 'jog') return Object.keys(params).length ? 'Esta orden no acepta parámetros.' : null;
  if (!onlyKeys(params,['dx','dy']) || !('dx' in params) || !('dy' in params)) return 'JOG requiere dx y dy.';
  const {dx,dy} = params;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 25 || Math.abs(dy) > 25 || (dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) return 'JOG admite un solo eje y un paso de 1 a 25 mm.';
  if (![1,5,10,25].includes(Math.abs(dx) || Math.abs(dy))) return 'Paso JOG no permitido (1, 5, 10 o 25 mm).';
  return null;
}
function createServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Puerto inválido.');
  const maxSessions = boundedInt(options.maxSessions ?? Number(process.env.MAX_SESSIONS), 100, 1, 1000);
  const trustProxy = options.trustProxy ?? Boolean(process.env.RENDER_EXTERNAL_HOSTNAME);
  const sessions = new Map(), creationAttempts = new Map();
  let closed = false;
  function clientIp(request) {
    if (trustProxy) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') return forwarded.split(',')[0].trim().slice(0,64);
    }
    return request.socket.remoteAddress || 'unknown';
  }
  function createSession() {
    const id = crypto.randomBytes(12).toString('base64url');
    const session = {id,token:crypto.randomBytes(32).toString('hex'),pairCode:String(crypto.randomInt(100000,1000000)),pairExpires:Date.now()+30*60_000,
      createdAt:Date.now(),lastActivity:Date.now(),host:null,state:null,sockets:new Map(),queue:[],inFlight:null,pairAttempts:new Map(),pairTotal:[]};
    sessions.set(id,session); return session;
  }
  function summary(session) {
    return {sessionId:session.id,online:!!session.host,state:session.host?session.state:null,
      clients:[...session.sockets.values()].filter(meta => meta.role !== 'host').length,
      pairedClients:[...session.sockets.values()].filter(meta => meta.paired).length};
  }
  const fail = (socket,id,error) => send(socket,{type:'command_error',id:validId(id)?id:null,error});
  function broadcast(session,message) { for (const socket of session.sockets.keys()) send(socket,message); }
  function publish(session) { broadcast(session,{type:'machine_state',...summary(session)}); }
  function failQueue(session,error) {
    for (const item of [...session.queue,...(session.inFlight?[session.inFlight]:[])]) { clearTimeout(item.timer);fail(item.socket,item.id,error); }
    session.queue=[];session.inFlight=null;
  }
  function next(session) {
    if (session.inFlight || !session.host || !session.queue.length) return;
    const item=session.inFlight=session.queue.shift();
    item.timer=setTimeout(() => { if(session.inFlight!==item)return;fail(item.socket,item.id,'La máquina no confirmó la orden a tiempo.');session.inFlight=null;next(session); },5000);
    send(session.host,{type:'execute',id:item.serverId,clientId:item.clientId,action:item.action,params:item.params});
  }
  function discard(session) {
    failQueue(session,'Sesión finalizada.');
    for (const socket of session.sockets.keys()) socket.close(1001,'Sesión finalizada');
    sessions.delete(session.id);
  }
  function publicSession(session) { return {sessionId:session.id,pairCode:session.pairCode,expiresAt:session.pairExpires}; }
  function json(res,status,value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value)); }
  const httpServer=http.createServer((req,res) => {
    const pathname=new URL(req.url,'http://localhost').pathname;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (pathname==='/health' && req.method==='GET') { json(res,200,{status:'ok'});return; }
    if (pathname==='/api/sessions' && req.method==='POST') {
      if (req.headers['content-length'] && req.headers['content-length']!=='0' || req.headers['transfer-encoding']) { json(res,413,{error:'La creación no acepta cuerpo.'});return; }
      const ip=clientIp(req),now=Date.now(),recent=(creationAttempts.get(ip)||[]).filter(time=>now-time<10*60_000);recent.push(now);creationAttempts.set(ip,recent);
      if (recent.length>10) { json(res,429,{error:'Demasiadas sesiones creadas. Espera diez minutos.'});return; }
      if (sessions.size>=maxSessions) { json(res,503,{error:'Capacidad temporal de sesiones alcanzada.'});return; }
      const session=createSession();json(res,201,{...publicSession(session),hostToken:session.token});return;
    }
    const api=/^\/api\/sessions\/([A-Za-z0-9_-]{16})(?:\/(rotate))?$/.exec(pathname);
    if (api) {
      const session=sessions.get(api[1]);
      if (!session) { json(res,404,{error:'Sesión vencida o inexistente.'});return; }
      const supplied=req.headers.authorization?.replace(/^Bearer /,'');
      if (!tokenMatches(session.token,supplied)) { json(res,403,{error:'Token de anfitrión inválido.'});return; }
      session.lastActivity=Date.now();
      if (api[2]==='rotate' && req.method==='POST') { session.pairCode=String(crypto.randomInt(100000,1000000));session.pairExpires=Date.now()+30*60_000;json(res,200,publicSession(session));return; }
      if (!api[2] && req.method==='GET') { json(res,200,publicSession(session));return; }
      json(res,405,{error:'Método no permitido.'});return;
    }
    if (req.method!=='GET' || !FILES.has(pathname)) { res.writeHead(404);res.end('Not found');return; }
    const file=path.join(ROOT,FILES.get(pathname));
    fs.readFile(file,(error,data) => { if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]});res.end(data); });
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  httpServer.on('upgrade',(request,socket,head) => {
    let url;try{url=new URL(request.url,'http://localhost');}catch{socket.destroy();return;}
    const ids=url.searchParams.getAll('session');
    if (url.pathname!=='/ws' || ids.length!==1 || !SESSION_ID.test(ids[0]) || !sessions.has(ids[0])) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n');socket.destroy();return; }
    const origin=request.headers.origin;
    if (origin) { try { const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.host!==request.headers.host)throw Error(); } catch { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return; } }
    wss.handleUpgrade(request,socket,head,ws => wss.emit('connection',ws,request,sessions.get(ids[0])));
  });
  wss.on('connection',(socket,request,session) => {
    const meta={id:crypto.randomUUID(),role:'guest',paired:false,alive:true,commands:[],recent:new Set(),ip:clientIp(request)};
    session.sockets.set(socket,meta);session.lastActivity=Date.now();
    send(socket,{type:'connection',clientId:meta.id,paired:false,...summary(session)});publish(session);
    socket.on('pong',() => { meta.alive=true; });
    socket.on('message',data => {
      session.lastActivity=Date.now();
      let message;try{message=JSON.parse(data.toString());}catch{fail(socket,null,'JSON inválido.');return;}
      if (!isObject(message) || typeof message.type!=='string') { fail(socket,message?.id,'Mensaje inválido.');return; }
      if (message.type==='hello') {
        if (meta.role!=='guest' || !onlyKeys(message,['type','id','role','token']) || !validId(message.id) || message.role!=='host' || !tokenMatches(session.token,message.token) || session.host) { fail(socket,message.id,'Autenticación de anfitrión rechazada.');return; }
        meta.role='host';session.host=socket;session.state=null;send(socket,{type:'command_ack',id:message.id,role:'host',sessionId:session.id});publish(session);return;
      }
      if (message.type==='pair') {
        if (meta.role==='host' || !onlyKeys(message,['type','id','code']) || !validId(message.id) || typeof message.code!=='string' || !/^\d{6}$/.test(message.code)) { fail(socket,message.id,'Solicitud de emparejamiento inválida.');return; }
        const now=Date.now();meta.pairCount=(meta.pairCount||0)+1;
        session.pairTotal=session.pairTotal.filter(time=>now-time<60_000);session.pairTotal.push(now);
        const recent=(session.pairAttempts.get(meta.ip)||[]).filter(time=>now-time<60_000);recent.push(now);session.pairAttempts.set(meta.ip,recent);
        if (meta.pairCount>8 || recent.length>8 || session.pairTotal.length>40) { fail(socket,message.id,'Demasiados intentos. Espera un minuto.');return; }
        if (now>session.pairExpires || message.code!==session.pairCode) { fail(socket,message.id,'Código incorrecto o vencido.');return; }
        meta.role='controller';meta.paired=true;send(socket,{type:'command_ack',id:message.id,paired:true,clientId:meta.id,sessionId:session.id});publish(session);return;
      }
      if (message.type==='telemetry') {
        if (socket!==session.host || !onlyKeys(message,['type','state'])) { fail(socket,message.id,'Telemetría no autorizada.');return; }
        const clean=normalizeState(message.state);if(!clean){fail(socket,null,'Telemetría inválida.');return;}
        session.state=clean;broadcast(session,{type:'telemetry',...summary(session)});return;
      }
      if (message.type==='command_result') {
        const item=session.inFlight;
        if (socket!==session.host || !onlyKeys(message,['type','id','accepted','error','state']) || !item || message.id!==item.serverId || typeof message.accepted!=='boolean') { fail(socket,message.id,'Confirmación inválida.');return; }
        clearTimeout(item.timer);session.inFlight=null;
        const clean=normalizeState(message.state);
        if (clean) { session.state=clean;broadcast(session,{type:'telemetry',...summary(session)}); }
        if (message.accepted && clean) send(item.socket,{type:'command_ack',id:item.id,action:item.action,state:clean});
        else fail(item.socket,item.id,message.accepted?'Estado de máquina inválido.':typeof message.error==='string'?message.error.slice(0,180):'Orden rechazada por la máquina.');
        next(session);return;
      }
      if (message.type==='command') {
        if (meta.role!=='controller' || !meta.paired) { fail(socket,message.id,'Emparejamiento requerido.');return; }
        const error=validateCommand(message);if(error){fail(socket,message.id,error);return;}
        if (meta.recent.has(message.id)) { fail(socket,message.id,'Identificador de mensaje repetido.');return; }
        meta.recent.add(message.id);if(meta.recent.size>100)meta.recent.delete(meta.recent.values().next().value);
        const now=Date.now();meta.commands=meta.commands.filter(time=>now-time<2000);meta.commands.push(now);
        if (meta.commands.length>12) { fail(socket,message.id,'Límite de frecuencia: 12 órdenes cada 2 segundos.');return; }
        if (!session.host) { fail(socket,message.id,'Máquina anfitriona desconectada.');return; }
        if (session.queue.length>=16) { fail(socket,message.id,'Cola de órdenes llena.');return; }
        if (message.action==='jog' && session.state && (session.state.x+message.params.dx<0 || session.state.x+message.params.dx>200 || session.state.y+message.params.dy<0 || session.state.y+message.params.dy>150)) { fail(socket,message.id,'Movimiento fuera de límites físicos.');return; }
        session.queue.push({socket,id:message.id,clientId:meta.id,action:message.action,params:message.params||{},serverId:crypto.randomUUID(),timer:null});next(session);return;
      }
      fail(socket,message.id,'Tipo de mensaje no implementado.');
    });
    socket.on('close',() => { session.sockets.delete(socket);if(socket===session.host){session.host=null;session.state=null;failQueue(session,'Máquina anfitriona desconectada.');}publish(session); });
    socket.on('error',() => {});
  });
  const heartbeat=setInterval(() => { for(const session of sessions.values())for(const [socket,meta] of session.sockets){if(!meta.alive){socket.terminate();continue;}meta.alive=false;socket.ping();} },15000);heartbeat.unref();
  const cleanup=setInterval(() => {
    const now=Date.now();for(const session of sessions.values())if(!session.sockets.size && now-session.lastActivity>30*60_000)discard(session);
    for(const [ip,times] of creationAttempts){const kept=times.filter(time=>now-time<10*60_000);if(kept.length)creationAttempts.set(ip,kept);else creationAttempts.delete(ip);}
  },60_000);cleanup.unref();
  return {
    httpServer,wss,sessions,
    snapshot(id){const session=id?sessions.get(id):sessions.size===1?[...sessions.values()][0]:null;return session?summary(session):{sessions:sessions.size};},
    async start(){await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,host,resolve);});return httpServer.address();},
    async stop(){if(closed)return;closed=true;clearInterval(heartbeat);clearInterval(cleanup);for(const session of sessions.values())discard(session);for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>httpServer.close(resolve));},
  };
}
function addresses(port){const values=[];for(const list of Object.values(os.networkInterfaces()))for(const item of list||[])if(item.family==='IPv4'&&!item.internal)values.push(`http://${item.address}:${port}`);return values;}
if(require.main===module){
  const server=createServer();server.start().then(address=>{
    const port=address.port;
    console.log(`\nCNC Virtual · puerto ${port} · sesiones independientes`);
    console.log(`Simulador local: http://localhost:${port}/`);
    for(const url of addresses(port))console.log(`En red local: ${url}/`);
    if(process.env.RENDER_EXTERNAL_HOSTNAME)console.log(`En Render: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/`);
    console.log('Cada visitante abre su propia CNC; el código de su sesión aparece en el simulador. Ctrl+C para detener.\n');
  }).catch(error=>{console.error('No se pudo iniciar el servidor:',error.message);process.exitCode=1;});
  const shutdown=()=>server.stop().then(()=>process.exit(0));process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
module.exports={createServer,validateCommand,normalizeState};
