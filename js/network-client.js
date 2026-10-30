(function (root, factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  root.CNCNetwork=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STORAGE_KEY='cnc-virtual-host-session-v1';
  class HostLink {
    constructor({getState,onCommand,onStatus}) {
      this.getState=getState;this.onCommand=onCommand;this.onStatus=onStatus;
      this.mode='local';this.connected=false;this.clients=0;this.messages=0;this.lastCommand='—';this.error='';
      this.sessionId='';this.token='';this.pairCode='';this.expiresAt=0;this.remoteUrls=[];
      this.socket=null;this.retry=0;this.timer=0;this.lastTelemetry=0;this.forceNew=false;
    }
    notify(){this.onStatus?.();}
    stored(){try{return JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
    remember(){try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify({id:this.sessionId,token:this.token}));}catch{}}
    forget(){try{sessionStorage.removeItem(STORAGE_KEY);}catch{}}
    setSession(data,token){this.sessionId=data.sessionId;this.token=token;this.pairCode=data.pairCode;this.expiresAt=data.expiresAt;this.remoteUrls=[`${location.origin}/remote?session=${encodeURIComponent(this.sessionId)}`];this.remember();this.notify();}
    async createSession(){
      const response=await fetch('/api/sessions',{method:'POST',cache:'no-store'});
      if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'No se pudo crear la sesión.');
      const data=await response.json();this.setSession(data,data.hostToken);
    }
    async refreshSession(){
      const response=await fetch(`/api/sessions/${this.sessionId}`,{headers:{Authorization:`Bearer ${this.token}`},cache:'no-store'});
      if(response.status===404||response.status===403){this.forget();await this.createSession();return;}
      if(!response.ok)throw Error('No se pudo recuperar la sesión.');
      this.setSession(await response.json(),this.token);
    }
    async start(){
      if(!['http:','https:'].includes(location.protocol)){this.mode='local';this.notify();return;}
      try{
        const health=await fetch('/health',{cache:'no-store'});
        if(!health.ok || (await health.json()).status!=='ok')throw Error('No es el servidor CNC.');
        const saved=this.stored();
        if(saved&&/^[A-Za-z0-9_-]{16}$/.test(saved.id)&&/^[a-f0-9]{64}$/.test(saved.token)){this.sessionId=saved.id;this.token=saved.token;await this.refreshSession();}
        else await this.createSession();
        this.connect();
      }catch(error){this.mode='local';this.error=error.message;this.notify();}
    }
    connect(){
      if(!this.token||!this.sessionId)return;
      this.mode='connecting';this.notify();
      const scheme=location.protocol==='https:'?'wss:':'ws:';
      const socket=new WebSocket(`${scheme}//${location.host}/ws?session=${encodeURIComponent(this.sessionId)}`);this.socket=socket;
      socket.onopen=()=>socket.send(JSON.stringify({type:'hello',id:'host-hello',role:'host',token:this.token}));
      socket.onmessage=async event=>{
        let message;try{message=JSON.parse(event.data);}catch{return;}
        this.messages++;
        if(message.type==='command_ack'&&message.id==='host-hello'){
          this.connected=true;this.mode='connected';this.retry=0;this.error='';this.publish(true);
        }else if(message.type==='machine_state')this.clients=message.clients||0;
        else if(message.type==='command_error'){this.error=message.error||'Error de comunicación.';if(message.id==='host-hello'){this.forceNew=true;socket.close();}}
        else if(message.type==='execute'){
          this.lastCommand=message.action;
          try{const state=await this.onCommand(message.action,message.params||{});this.error='';this.send({type:'command_result',id:message.id,accepted:true,state});this.publish(true);}
          catch(error){this.error=error.message;this.send({type:'command_result',id:message.id,accepted:false,error:error.message,state:this.getState()});}
        }
        this.notify();
      };
      socket.onclose=()=>{
        if(this.socket!==socket)return;
        this.connected=false;this.mode='disconnected';this.clients=0;this.error=this.error||'Enlace WebSocket interrumpido.';this.notify();
        clearTimeout(this.timer);
        this.timer=setTimeout(async()=>{try{if(this.forceNew){this.forceNew=false;this.forget();await this.createSession();}else await this.refreshSession();}catch(error){this.error=error.message;this.notify();}this.connect();},Math.min(15000,1000*2**this.retry++));
      };
      socket.onerror=()=>{this.error='No se pudo establecer WebSocket.';this.notify();};
    }
    send(value){if(this.socket?.readyState===WebSocket.OPEN){this.socket.send(JSON.stringify(value));this.messages++;return true;}return false;}
    publish(force=false){if(!this.connected)return;const now=Date.now();if(!force&&now-this.lastTelemetry<100)return;this.lastTelemetry=now;this.send({type:'telemetry',state:this.getState()});}
    async rotate(){
      if(!this.connected)throw Error('Conecta el servidor antes de renovar el código.');
      const response=await fetch(`/api/sessions/${this.sessionId}/rotate`,{method:'POST',headers:{Authorization:`Bearer ${this.token}`}});
      if(!response.ok)throw Error('No se pudo renovar el código.');
      const data=await response.json();this.pairCode=data.pairCode;this.expiresAt=data.expiresAt;this.notify();return data.pairCode;
    }
  }
  return {HostLink};
});
