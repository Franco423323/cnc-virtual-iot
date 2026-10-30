(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const engine = new CNCEngine.Engine(), iot = new CNCIoT.IoTSimulator();
  let frame = 0, previousTime = 0, lastMode = 'idle', network = null, loadedJob = 'Cuadrado';
  const setStatus = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const machineSnapshot = () => ({x:engine.x,y:engine.y,pen:engine.pen,contact:engine.contact,mode:engine.mode,progress:engine.progress,line:engine.line,loadedJob});
  function sync() {
    CNCRenderer.draw($('machine'), engine);
    $('xval').innerHTML = `${engine.x.toFixed(2)} <span>mm</span>`;
    $('yval').innerHTML = `${engine.y.toFixed(2)} <span>mm</span>`;
    $('penval').textContent = engine.contact ? 'ABAJO' : engine.pen && engine.mode === 'running' ? 'ARRIBA / G0' : engine.pen ? 'ABAJO' : 'ARRIBA';
    $('penval').style.color = engine.contact ? '#f4b766' : '#78ddd1';
    const progress = Math.round(engine.progress);
    $('progress').textContent = `${progress}%`; $('progressBar').style.width = `${progress}%`; $('progressTrack').setAttribute('aria-valuenow', String(progress));
    $('lineBadge').textContent = engine.line ? `LÍNEA ${engine.line}` : 'LÍNEA —';
    const modes = { idle: 'EN ESPERA', running: 'EJECUTANDO', paused: 'PAUSADO', stopped: 'DETENIDO', complete: 'COMPLETO', jogging: 'MOVIENDO' };
    $('machineState').textContent = modes[engine.mode];
    $('stateDot').className = 'state-dot' + (engine.mode === 'paused' ? ' paused' : engine.mode === 'stopped' ? ' stopped' : '');
    $('run').disabled = ['running','paused','jogging'].includes(engine.mode);
    $('pause').disabled = !['running','paused'].includes(engine.mode);
    $('pause').textContent = engine.mode === 'paused' ? '▶ Reanudar' : '⏸ Pausar';
    $('penToggle').textContent = engine.pen ? '↑ Elevar lapicero' : '↓ Bajar lapicero';
    $('networkStatus').textContent = iot.online ? 'ENLACE VIRTUAL' : 'DESCONECTADO';
    $('networkStatus').classList.toggle('offline', !iot.online);
    $('networkToggle').textContent = iot.online ? 'Desconectar enlace' : 'Conectar enlace';
    $('packets').textContent = String(iot.packets); $('remoteJobs').textContent = String(iot.remoteJobs);
    $('motorXY').textContent = `${engine.x.toFixed(1)} / ${engine.y.toFixed(1)}`;
    $('motorZ').textContent = engine.contact ? 'ABAJO' : 'ARRIBA';
    $('events').textContent = iot.events.join('\n');
    if (network) {
      $('realMode').textContent = network.connected ? 'CONECTADO · WS' : network.mode === 'local' ? 'MODO LOCAL' : 'DESCONECTADO';
      $('realMode').classList.toggle('offline', !network.connected);
      $('serverState').textContent = network.connected ? 'ACTIVO' : network.mode === 'connecting' ? 'CONECTANDO' : 'NO CONECTADO';
      $('clientCount').textContent = String(network.clients);
      $('realMachineState').textContent = modes[engine.mode];
      $('wsMessages').textContent = String(network.messages);
      $('pairCode').textContent = network.pairCode && Date.now() < network.expiresAt ? network.pairCode : network.pairCode ? 'VENCIDO' : '—';
      $('lastRemoteCommand').textContent = network.lastCommand;
      $('networkError').textContent = network.error || 'Ninguno';
      $('remoteUrl').textContent = network.remoteUrls.length ? network.remoteUrls[0] : 'Inicia el servidor para ver la dirección.';
      if (network.remoteUrls.length) $('remoteUrl').href = network.remoteUrls[0];
      else $('remoteUrl').removeAttribute?.('href');
      network.publish();
    }
  }
  function cancel() { if (frame) cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
  function loop(now) {
    frame = 0;
    const dt = previousTime ? now - previousTime : 16; previousTime = now;
    engine.advance(dt, Number($('speed').value)); sync();
    if (engine.mode !== 'running' && engine.mode !== 'jogging') network?.publish(true);
    if (engine.mode === 'running' || engine.mode === 'jogging') frame = requestAnimationFrame(loop);
    else if (engine.mode === 'complete' && lastMode === 'running') { setStatus('Trabajo terminado correctamente.'); iot.log('Trabajo terminado · trayectoria completa.'); sync(); }
    else if (engine.mode === 'idle' && lastMode === 'jogging') { setStatus('Movimiento manual completado.'); sync(); }
    lastMode = engine.mode;
  }
  function kick() { cancel(); lastMode = engine.mode; frame = requestAnimationFrame(loop); }
  function start(remote = false) {
    if (['running', 'paused', 'jogging'].includes(engine.mode)) throw new Error('Detén el movimiento actual antes de iniciar otro trabajo.');
    const parsed = CNCParser.parse($('commands').value);
    cancel(); engine.start(parsed);
    if (remote) iot.remoteJobs++;
    iot.log(`${remote ? 'Trabajo remoto' : 'Trabajo local'} iniciado · ${parsed.ops.length} operaciones.`);
    setStatus(`Ejecutando ${parsed.ops.length} operaciones G-Code.`); sync(); network?.publish(true); kick();
  }
  function togglePause() {
    if (engine.mode === 'running') { engine.pause(); cancel(); setStatus('Ejecución pausada.'); iot.log('Trabajo pausado.'); }
    else if (engine.mode === 'paused') { engine.resume(); setStatus('Ejecución reanudada.'); iot.log('Trabajo reanudado.'); kick(); }
    else throw new Error('No hay un trabajo activo para pausar.');
    sync(); network?.publish(true);
  }
  function stop() { const active = engine.stop(); cancel(); setStatus(active ? 'Ejecución detenida. El trazo permanece visible.' : 'No hay un movimiento activo.'); if (active) iot.log('Trabajo detenido.'); sync(); network?.publish(true); }
  function reset() { cancel(); engine.reset(); lastMode = 'idle'; setStatus('Trabajo reiniciado. Papel limpio y cabezal en origen.'); iot.log('Trabajo reiniciado.'); sync(); network?.publish(true); }
  function command(fn) { const failure = error => { setStatus(error.message, true); iot.log(`ERROR: ${error.message}`); sync(); }; try { const result = fn(); if (result && typeof result.catch === 'function') result.catch(failure); } catch (error) { failure(error); } }
  function moveManual(dx, dy, remote = false) { if (engine.jog(dx,dy)) { setStatus(`Movimiento ${remote?'Wi-Fi':'local'} hacia X ${engine.x+dx} / Y ${engine.y+dy} mm.`); iot.log(`JOG ${remote?'Wi-Fi':'local'} X${dx} Y${dy}.`); sync(); kick(); } }
  function jog(dx, dy) { command(() => { const step = Number($('step').value); moveManual(dx*step,dy*step); }); }
  function home(remote = false) { const moved = engine.home(); if (moved) { setStatus(remote ? 'Retorno remoto al origen.' : 'Regresando al origen.'); iot.log(`${remote ? 'HOME remoto' : 'HOME local'} solicitado.`); sync(); kick(); } else setStatus('El cabezal ya está en el origen.'); }
  function setPen(down, remote = false) { engine.setPen(down); iot.log(`Servo ${remote?'Wi-Fi':'local'}: lapicero ${down?'abajo':'arriba'}.`); setStatus(`Lapicero ${down?'bajado':'elevado'} ${remote?'por Wi-Fi':'manualmente'}.`); sync(); network?.publish(true); }
  function executeRemote(action, params) {
    iot.log(`Wi-Fi real → ${action}`);
    if (action === 'start_job') start(true);
    else if (action === 'pause_job') { if (engine.mode !== 'running') throw new Error('La máquina no está ejecutando.'); togglePause(); }
    else if (action === 'resume_job') { if (engine.mode !== 'paused') throw new Error('La máquina no está pausada.'); togglePause(); }
    else if (action === 'stop_job') stop();
    else if (action === 'jog') moveManual(params.dx,params.dy,true);
    else if (action === 'home') home(true);
    else if (action === 'pen_up') setPen(false,true);
    else if (action === 'pen_down') setPen(true,true);
    else throw new Error('Orden remota no implementada.');
    return machineSnapshot();
  }
  function updateLines() { const lines = $('commands').value.split('\n').length; $('lineNumbers').textContent = Array.from({length:lines},(_,i)=>i+1).join('\n'); $('lineNumbers').scrollTop = $('commands').scrollTop; }
  function download(name, url) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }
  $('run').onclick = () => command(() => start());
  $('pause').onclick = () => command(togglePause);
  $('stop').onclick = () => command(stop);
  $('reset').onclick = () => command(reset);
  $('jogUp').onclick = () => jog(0,1); $('jogDown').onclick = () => jog(0,-1);
  $('jogLeft').onclick = () => jog(-1,0); $('jogRight').onclick = () => jog(1,0);
  $('home').onclick = () => command(() => home());
  $('penToggle').onclick = () => command(() => setPen(!engine.pen));
  $('speed').oninput = () => { $('speedLabel').textContent = `${$('speed').value}×`; };
  $('shape').onchange = () => { $('nameRow').hidden = $('shape').value !== 'name'; };
  $('load').onclick = () => command(() => { const code = CNCExamples.get($('shape').value, $('customName').value); CNCParser.parse(code); $('commands').value = code; loadedJob = $('shape').selectedOptions[0].textContent.slice(0,80); updateLines(); reset(); setStatus('Figura cargada y lista para ejecutar.'); iot.log(`Figura cargada: ${loadedJob}.`); sync(); });
  $('validate').onclick = () => command(() => { const result = CNCParser.parse($('commands').value); setStatus(`G-Code válido: ${result.ops.length} operaciones. Punto final X ${result.end.x.toFixed(2)}, Y ${result.end.y.toFixed(2)} mm.`); iot.log(`G-Code validado: ${result.ops.length} operaciones.`); sync(); });
  $('commands').oninput = () => { loadedJob='G-Code editado'; updateLines(); sync(); }; $('commands').onscroll = updateLines;
  $('gfile').onchange = event => command(async () => { const file = event.target.files?.[0]; if (!file) return; if (!/\.(gcode|nc|txt)$/i.test(file.name)) throw new Error('Selecciona un archivo .gcode, .nc o .txt.'); if (file.size > 150000) throw new Error('Archivo demasiado grande (máximo 150 KB).'); const contents = await file.text(); $('commands').value = contents; loadedJob=file.name.slice(0,80); updateLines(); reset(); try { const parsed = CNCParser.parse(contents); setStatus(`Archivo ${file.name} importado: ${parsed.ops.length} operaciones válidas.`); } catch(error) { setStatus(`Archivo ${file.name} importado. ${error.message}`, true); } iot.log(`Archivo importado: ${file.name}.`); event.target.value = ''; sync(); });
  $('saveG').onclick = () => command(() => { const url = URL.createObjectURL(new Blob([$('commands').value+'\n'], {type:'text/plain;charset=utf-8'})); download('dibujo-cnc.gcode',url); setTimeout(()=>URL.revokeObjectURL(url),1000); setStatus('G-Code guardado.'); });
  $('export').onclick = () => command(() => { download('cnc-trazado.png',CNCRenderer.exportPaper(engine)); setStatus('Trazado exportado como PNG.'); });
  $('networkToggle').onclick = () => { iot.toggle(); setStatus(iot.online ? 'Enlace IoT virtual conectado.' : 'Enlace IoT virtual desconectado.'); sync(); };
  $('remoteStart').onclick = () => command(() => { iot.send('START',()=>start(true)); sync(); });
  $('remotePause').onclick = () => command(() => { iot.send('PAUSE/RESUME',togglePause); sync(); });
  $('remoteStop').onclick = () => command(() => { iot.send('STOP',stop); sync(); });
  $('remoteHome').onclick = () => command(() => { iot.send('HOME',()=>home(true)); sync(); });
  $('clearEvents').onclick = () => { iot.clear(); sync(); };
  $('rotateCode').onclick = () => command(async () => { const code=await network.rotate();setStatus(`Código de emparejamiento renovado: ${code}.`);iot.log('Código Wi-Fi renovado.');sync(); });
  $('commands').value = CNCExamples.get('square'); updateLines();
  network = new CNCNetwork.HostLink({getState:machineSnapshot,onCommand:executeRemote,onStatus:sync});
  sync(); network.start();
})();
