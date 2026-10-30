(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const sessionId=new URLSearchParams(location.search).get('session')||'';
  const validSession=/^[A-Za-z0-9_-]{16}$/.test(sessionId);
  let socket=null,connected=false,paired=false,machineOnline=false,state=null,code='',retry=0,sequence=0;
  const history=[];
  function log(message){const time=new Date().toLocaleTimeString('es-PE',{hour12:false});history.unshift(`[${time}] ${message}`);history.length=Math.min(history.length,30);$('messages').textContent=history.join('\n');}
  function send(type,fields={}){if(!socket || socket.readyState!==WebSocket.OPEN){log('Sin conexión WebSocket.');return false;}socket.send(JSON.stringify({type,id:`r${Date.now()}_${++sequence}`,...fields}));return true;}
  function update(){
    $('connectionBadge').textContent=connected?'WS CONECTADO':'RECONEXIÓN';$('connectionBadge').className=`badge ${connected?'connected':'disconnected'}`;
    $('pairState').textContent=paired?'EMPAREJADO':'SIN EMPAREJAR';$('pairState').style.color=paired?'#89e8d3':'#efbb74';
    $('availability').textContent=machineOnline?'CNC DISPONIBLE':'NO DISPONIBLE';$('availability').classList.toggle('online',machineOnline);
    $('loadedJob').textContent=state?.loadedJob||'—';$('machineMode').textContent=state?.mode?.toUpperCase()||'—';
    $('x').innerHTML=`${(state?.x??0).toFixed(2)} <em>mm</em>`;$('y').innerHTML=`${(state?.y??0).toFixed(2)} <em>mm</em>`;
    $('pen').textContent=state?.contact?'ABAJO':'ARRIBA';const progress=Math.round(state?.progress??0);$('progress').textContent=`${progress}%`;$('progressBar').style.width=`${progress}%`;
    $('line').textContent=`Línea G-Code: ${state?.line??'—'}`;
    const ready=connected&&paired&&machineOnline;
    const idle=['idle','stopped','complete'].includes(state?.mode),running=state?.mode==='running',paused=state?.mode==='paused',moving=state?.mode==='jogging';
    $('start').disabled=!ready||!idle;$('pause').disabled=!ready||!running;$('resume').disabled=!ready||!paused;$('stop').disabled=!ready||!(running||paused||moving);
    for(const id of ['up','down','left','right','home','penUp','penDown'])$(id).disabled=!ready||!idle;
    $('pairButton').disabled=!connected||!validSession;
  }
  function connect(){
    if(!validSession){log('Falta una sesión válida. Abre el enlace compartido por el anfitrión.');return;}
    const scheme=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${scheme}//${location.host}/ws?session=${encodeURIComponent(sessionId)}`);
    socket.onopen=()=>{connected=true;retry=0;log('Conectado al servidor; esperando estado.');update();};
    socket.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{log('Respuesta JSON inválida.');return;}
      if(message.type==='connection'){
        if(message.sessionId!==sessionId){socket.close();log('La respuesta pertenece a otra sesión.');return;}
        machineOnline=!!message.online;state=message.state||null;if(code)send('pair',{code});
      }else if(message.type==='machine_state'||message.type==='telemetry'){
        machineOnline=!!message.online;state=message.state||null;
      }else if(message.type==='command_ack'){
        if(message.paired){paired=true;log('Emparejamiento aceptado.');}else log(`Orden aceptada: ${message.action||message.id}.`);
        if(message.state)state=message.state;
      }else if(message.type==='command_error')log(`RECHAZADO: ${message.error}`);
      update();
    };
    socket.onclose=()=>{connected=false;paired=false;machineOnline=false;state=null;log(retry<8?'Conexión perdida. Reconectando…':'Sesión no disponible. Solicita un enlace nuevo.');update();if(retry<8)setTimeout(connect,Math.min(15000,1000*2**retry++));};
    socket.onerror=()=>log('Error en el enlace WebSocket.');
  }
  $('pairButton').onclick=()=>{const value=$('pairInput').value.trim();if(!/^\d{6}$/.test(value)){log('Escribe un código de seis dígitos.');return;}code=value;send('pair',{code});};
  $('pairInput').onkeydown=event=>{if(event.key==='Enter')$('pairButton').click();};
  for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{if(!paired)return;const action=button.dataset.action;send('command',{action});log(`Enviado: ${action}.`);};
  const jog=(dx,dy)=>{const step=Number($('step').value);send('command',{action:'jog',params:{dx:dx*step,dy:dy*step}});log(`Enviado: JOG X${dx*step} Y${dy*step}.`);};
  $('up').onclick=()=>jog(0,1);$('down').onclick=()=>jog(0,-1);$('left').onclick=()=>jog(-1,0);$('right').onclick=()=>jog(1,0);
  $('home').onclick=()=>{send('command',{action:'home'});log('Enviado: HOME.');};
  $('clear').onclick=()=>{history.length=0;log('Registro local reiniciado.');};
  $('sessionLabel').textContent=validSession?sessionId:'—';update();connect();
})();
