(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const sessionId=new URLSearchParams(location.search).get('session')||'';
  const validSession=/^[A-Za-z0-9_-]{16}$/.test(sessionId);
  const modes={idle:'DISPONIBLE',running:'EJECUTANDO',paused:'PAUSADO',stopped:'DETENIDO',complete:'FINALIZADO',jogging:'MOVIENDO'};
  const actions={start_job:'Inicio',pause_job:'Pausa',resume_job:'Reanudación',stop_job:'Detención',jog:'Movimiento manual',home:'Retorno al origen',pen_up:'Lapicero elevado',pen_down:'Lapicero bajado'};
  let socket=null,connected=false,paired=false,pairEditorOpen=false,machineOnline=false,state=null,code='',retry=0,sequence=0,pending=null,stopUntil=0,stopTimer=0;
  const history=[];
  function log(message){const time=new Date().toLocaleTimeString('es-PE',{hour12:false});history.unshift('['+time+'] '+message);history.length=Math.min(history.length,30);$('messages').textContent=history.join('\n');}
  function feedback(message,kind=''){$('commandFeedback').textContent=message;$('commandFeedback').className='command-feedback '+kind;}
  function send(type,fields={}){
    if(!socket||socket.readyState!==WebSocket.OPEN){log('Sin conexión WebSocket.');feedback('No hay conexión con el servidor.','error');return null;}
    const id='r'+Date.now()+'_'+(++sequence);socket.send(JSON.stringify({type,id,...fields}));return id;
  }
  function clearStop(){stopUntil=0;clearTimeout(stopTimer);$('stop').textContent='Detener';$('stop').classList?.remove?.('confirming');}
  function update(){
    $('connectionBadge').textContent=connected?(paired?'Vinculado':'Servidor activo'):'Sin conexión';
    $('connectionBadge').className='connection-badge '+(connected?'connected':'disconnected');
    $('pairState').textContent=paired?'EMPAREJADO':'SIN EMPAREJAR';
    $('pairCard').hidden=paired&&!pairEditorOpen;$('remotePanel').hidden=!paired;
    $('availability').textContent=machineOnline?'Máquina disponible':'Máquina no disponible';
    $('availability').classList.toggle('online',machineOnline);
    $('loadedJob').textContent=state?.loadedJob||'Sin trabajo';
    $('machineMode').textContent=modes[state?.mode]||'SIN ESTADO';
    $('x').innerHTML=(state?.x??0).toFixed(2)+' <em>mm</em>';
    $('y').innerHTML=(state?.y??0).toFixed(2)+' <em>mm</em>';
    $('pen').textContent=state?.contact?'ABAJO':'ARRIBA';
    const progress=Math.round(state?.progress??0);
    $('progress').textContent=progress+'%';$('progressBar').style.width=progress+'%';
    $('line').textContent='Línea G-Code: '+(state?.line??'—');
    const ready=connected&&paired&&machineOnline&&!pending;
    const idle=['idle','stopped','complete'].includes(state?.mode),running=state?.mode==='running',paused=state?.mode==='paused',moving=state?.mode==='jogging';
    $('start').hidden=!idle;$('pause').hidden=!running;$('resume').hidden=!paused;
    $('start').disabled=!ready||!idle;$('pause').disabled=!ready||!running;$('resume').disabled=!ready||!paused;
    $('stop').disabled=!ready||!(running||paused||moving);
    const manual=ready&&idle,step=Number($('step').value);
    $('step').disabled=!manual;
    $('up').disabled=!manual||!state||state.y+step>150;
    $('down').disabled=!manual||!state||state.y-step<0;
    $('left').disabled=!manual||!state||state.x-step<0;
    $('right').disabled=!manual||!state||state.x+step>200;
    $('home').disabled=!manual||!state||(state.x===0&&state.y===0);
    $('penUp').disabled=!manual||!state?.pen;
    $('penDown').disabled=!manual||!!state?.pen;
    $('pairButton').disabled=!connected||!validSession||!!pending;
  }
  function command(action,params){
    if(!connected||!paired||!machineOnline||pending)return;
    const id=send('command',{action,...(params?{params}:{})});
    if(!id)return;pending={id,action};feedback((actions[action]||'Orden')+' enviada. Esperando confirmación…');log('Enviada: '+(actions[action]||action)+'.');update();
  }
  function connect(){
    if(!validSession){log('Falta una sesión válida. Abre el enlace compartido por el anfitrión.');$('pairHelp').textContent='Abre el enlace compartido por la estación anfitriona.';feedback('Abre el enlace compartido por la estación anfitriona.','error');return;}
    const scheme=location.protocol==='https:'?'wss:':'ws:';
    socket=new WebSocket(scheme+'//'+location.host+'/ws?session='+encodeURIComponent(sessionId));
    socket.onopen=()=>{connected=true;retry=0;log('Conectado al servidor.');update();};
    socket.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{log('Respuesta JSON inválida.');return;}
      if(message.type==='connection'){
        if(message.sessionId!==sessionId){socket.close();log('La respuesta pertenece a otra sesión.');return;}
        machineOnline=!!message.online;state=message.state||null;if(code){const id=send('pair',{code});if(id)pending={id,action:'pair'};}
      }else if(message.type==='machine_state'||message.type==='telemetry'){
        machineOnline=!!message.online;state=message.state||null;
      }else if(message.type==='command_ack'){
        if(message.paired){paired=true;pairEditorOpen=false;pending=null;code=$('pairInput').value.trim()||code;feedback('Control conectado a la máquina.','success');$('pairHelp').textContent='Conexión aceptada.';log('Emparejamiento aceptado.');}
        else{const action=pending?.id===message.id?pending.action:message.action;pending=null;feedback((actions[action]||'Orden')+' aceptada por la máquina.','success');log('Orden aceptada: '+(actions[action]||message.action||message.id)+'.');}
        if(message.state)state=message.state;clearStop();
      }else if(message.type==='command_error'){
        const action=pending?.id===message.id?pending.action:null;pending=null;
        const reason=message.error||'Orden rechazada.';
        feedback((action==='pair'?'No se pudo conectar: ':'Orden rechazada: ')+reason,'error');
        if(action==='pair')$('pairHelp').textContent=reason;
        log('RECHAZADO: '+reason);clearStop();
      }
      update();
    };
    socket.onclose=()=>{
      connected=false;paired=false;pairEditorOpen=false;machineOnline=false;state=null;pending=null;clearStop();
      const message=retry<8?'Conexión perdida. Reconectando…':'Sesión no disponible. Solicita un enlace nuevo.';
      $('pairHelp').textContent=message;feedback(message,'error');log(message);update();
      if(retry<8)setTimeout(connect,Math.min(15000,1000*2**retry++));
    };
    socket.onerror=()=>log('Error en el enlace WebSocket.');
  }
  $('pairButton').onclick=()=>{
    const value=$('pairInput').value.trim();
    if(!/^\d{6}$/.test(value)){feedback('Escribe los seis dígitos del código.','error');$('pairHelp').textContent='Escribe los seis dígitos del código.';log('Escribe un código de seis dígitos.');return;}
    code=value;const id=send('pair',{code});if(id){pending={id,action:'pair'};$('pairHelp').textContent='Verificando código…';feedback('Verificando código…');update();}
  };
  $('pairInput').onkeydown=event=>{if(event.key==='Enter')$('pairButton').click();};
  for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{
    const action=button.dataset.action;
    if(action==='stop_job'){
      if(Date.now()>stopUntil){stopUntil=Date.now()+3500;button.textContent='Confirmar detención';button.classList?.add?.('confirming');feedback('Pulsa de nuevo para detener el movimiento.');stopTimer=setTimeout(clearStop,3500);return;}
      clearStop();
    }
    command(action);
  };
  const jog=(dx,dy)=>{const step=Number($('step').value);command('jog',{dx:dx*step,dy:dy*step});};
  $('step').onchange=update;
  $('up').onclick=()=>jog(0,1);$('down').onclick=()=>jog(0,-1);$('left').onclick=()=>jog(-1,0);$('right').onclick=()=>jog(1,0);
  $('home').onclick=()=>command('home');
  $('changeCode').onclick=()=>{pairEditorOpen=true;update();$('pairInput').focus?.();};
  $('clear').onclick=()=>{history.length=0;log('Registro local reiniciado.');};
  $('sessionLabel').textContent=validSession?sessionId:'—';
  update();connect();
})();
