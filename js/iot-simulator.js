(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CNCIoT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  class IoTSimulator {
    constructor() { this.online = true; this.packets = 0; this.remoteJobs = 0; this.events = []; this.log('Sistema iniciado · enlace IoT local simulado.'); }
    log(message) {
      const time = new Date().toLocaleTimeString('es-PE', { hour12: false });
      this.events.unshift(`[${time}] ${message}`); this.events.length = Math.min(this.events.length, 40);
    }
    toggle() { this.online = !this.online; this.log(this.online ? 'Enlace virtual conectado.' : 'Enlace virtual desconectado.'); return this.online; }
    send(command, handler) {
      if (!this.online) { this.log(`RECHAZADO ${command}: enlace virtual desconectado.`); throw new Error('El enlace IoT virtual está desconectado.'); }
      this.packets++; this.log(`ENVÍO SIM → ${command}`);
      try { const result = handler(); this.log(`ACK SIM ← ${command}`); return result; }
      catch (error) { this.log(`ERROR SIM ← ${command}: ${error.message}`); throw error; }
    }
    clear() { this.events = []; this.log('Registro virtual reiniciado.'); }
  }
  return { IoTSimulator };
});
