(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CNCEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 200, HEIGHT = 150;
  class Engine {
    constructor() { this.reset(); }
    reset() {
      this.x = 0; this.y = 0; this.pen = false; this.contact = false;
      this.path = []; this.program = []; this.index = 0; this.distance = 0;
      this.mode = 'idle'; this.line = null; this.offsetX = 0; this.offsetY = 0;
    }
    start(parsed) {
      if (!parsed || !Array.isArray(parsed.ops) || !parsed.ops.length) throw new Error('Programa vacío.');
      this.reset(); this.program = parsed.ops; this.mode = 'running';
    }
    pause() { if (this.mode !== 'running') return false; this.mode = 'paused'; return true; }
    resume() { if (this.mode !== 'paused') return false; this.mode = 'running'; return true; }
    stop() { if (!['running', 'paused', 'jogging'].includes(this.mode)) return false; this.mode = 'stopped'; this.contact = false; this.program = []; this.distance = 0; return true; }
    setPen(down) { if (['running', 'paused', 'jogging'].includes(this.mode)) throw new Error('Detén el movimiento antes de cambiar el lapicero.'); this.pen = !!down; this.contact = this.pen; }
    jog(dx, dy) {
      if (['running', 'paused', 'jogging'].includes(this.mode)) throw new Error('Detén el trabajo antes del movimiento manual.');
      const nx = this.x + dx, ny = this.y + dy;
      if (nx < -1e-8 || nx > WIDTH + 1e-8 || ny < -1e-8 || ny > HEIGHT + 1e-8) throw new Error('Movimiento fuera de límites: X 0–200, Y 0–150 mm.');
      if (Math.hypot(dx, dy) < 1e-8) return false;
      this.program = [{ type: 'move', ax: this.x, ay: this.y, bx: nx, by: ny, rapid: false, draw: this.pen, line: null }];
      this.index = 0; this.distance = 0; this.mode = 'jogging'; this.line = null; return true;
    }
    home() {
      if (['running', 'paused', 'jogging'].includes(this.mode)) throw new Error('Detén el trabajo antes de volver al origen.');
      this.pen = false; this.contact = false;
      if (this.x === 0 && this.y === 0) return false;
      this.program = [{ type: 'move', ax: this.x, ay: this.y, bx: 0, by: 0, rapid: true, draw: false, line: null }];
      this.index = 0; this.distance = 0; this.mode = 'jogging'; this.line = null; return true;
    }
    advance(ms, speed = 5) {
      if (!['running', 'jogging'].includes(this.mode)) return;
      let budget = Math.max(0, Math.min(ms, 80)) * Math.max(1, Math.min(10, speed)) * 0.012;
      let guard = 0;
      while (this.index < this.program.length && guard++ < 1000) {
        const op = this.program[this.index]; this.line = op.line;
        if (op.type === 'pen') { this.pen = op.down; this.contact = this.pen; this.index++; continue; }
        if (op.type === 'origin') { this.offsetX = op.offsetX; this.offsetY = op.offsetY; this.index++; continue; }
        if (op.type !== 'move') { this.index++; continue; }
        const length = Math.hypot(op.bx - op.ax, op.by - op.ay);
        if (length < 1e-9) { this.index++; this.distance = 0; continue; }
        if (budget <= 0) break;
        const available = budget * (op.rapid ? 2.6 : 1);
        const delta = Math.min(length - this.distance, available);
        const a = this.distance / length, b = (this.distance + delta) / length;
        const x0 = op.ax + (op.bx - op.ax) * a, y0 = op.ay + (op.by - op.ay) * a;
        this.x = op.ax + (op.bx - op.ax) * b; this.y = op.ay + (op.by - op.ay) * b;
        this.contact = op.draw && !op.rapid;
        this.path.push({ ax: x0, ay: y0, bx: this.x, by: this.y, draw: this.contact, rapid: op.rapid });
        this.distance += delta; budget -= delta / (op.rapid ? 2.6 : 1);
        if (this.distance >= length - 1e-8) { this.x = op.bx; this.y = op.by; this.index++; this.distance = 0; this.contact = this.pen; }
      }
      if (this.index >= this.program.length) {
        this.mode = this.mode === 'jogging' ? 'idle' : 'complete';
        this.contact = this.pen;
      }
    }
    get progress() {
      if (!this.program.length) return 0;
      if (this.mode === 'complete') return 100;
      const op = this.program[this.index];
      const length = op?.type === 'move' ? Math.hypot(op.bx - op.ax, op.by - op.ay) : 0;
      return Math.min(100, 100 * (this.index + (length ? this.distance / length : 0)) / this.program.length);
    }
  }
  return { Engine, WIDTH, HEIGHT };
});
