(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CNCParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 200, HEIGHT = 150, EPS = 1e-7;
  function fail(line, message) { throw new Error(`Línea ${line}: ${message}`); }
  function parse(source, origin = { x: 0, y: 0 }) {
    if (typeof source !== 'string') throw new Error('El programa G-Code debe ser texto.');
    let x = origin.x, y = origin.y, ox = 0, oy = 0, unit = 1, absolute = true, pen = false, modal = null;
    const ops = [], lines = source.split(/\r?\n/);
    if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) throw new Error('Origen físico fuera de límites.');
    for (let index = 0; index < lines.length; index++) {
      const line = index + 1;
      let raw = lines[index].replace(/\([^()]*\)/g, '').replace(/;.*/, '').trim().toUpperCase();
      if (!raw) continue;
      const words = [], re = /([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))/y;
      let cursor = 0;
      while (cursor < raw.length) {
        while (/\s/.test(raw[cursor] || '') && cursor < raw.length) cursor++;
        if (cursor >= raw.length) break;
        re.lastIndex = cursor;
        const match = re.exec(raw);
        if (!match) fail(line, `palabra no reconocida cerca de "${raw.slice(cursor, cursor + 12)}".`);
        words.push({ letter: match[1], value: Number(match[2]) });
        cursor = re.lastIndex;
      }
      const axes = {}, groups = {}, mCodes = [];
      for (const word of words) {
        const { letter, value } = word;
        if (!Number.isFinite(value)) fail(line, 'valor numérico inválido.');
        if (letter === 'X' || letter === 'Y') {
          if (letter in axes) fail(line, `eje ${letter} repetido.`);
          axes[letter] = value;
        } else if (letter === 'G') {
          if (!Number.isInteger(value)) fail(line, `G${value} no compatible.`);
          const group = [0, 1].includes(value) ? 'motion' : [20, 21].includes(value) ? 'unit' : [90, 91].includes(value) ? 'position' : value === 92 ? 'origin' : null;
          if (!group) fail(line, `G${value} no compatible.`);
          if (groups[group] !== undefined) fail(line, `comandos G incompatibles en la misma línea.`);
          groups[group] = value;
        } else if (letter === 'M') {
          if (![3, 5].includes(value)) fail(line, `M${value} no compatible.`);
          mCodes.push(value);
        } else fail(line, `parámetro ${letter} no implementado.`);
      }
      if (mCodes.length > 1 || (mCodes.length && (groups.motion !== undefined || groups.origin !== undefined || Object.keys(axes).length))) fail(line, 'M3/M5 debe ir en una línea separada del movimiento.');
      if (groups.origin !== undefined && (groups.motion !== undefined || !Object.keys(axes).length)) fail(line, 'G92 requiere X o Y y no admite movimiento simultáneo.');
      if (groups.unit !== undefined) unit = groups.unit === 20 ? 25.4 : 1;
      if (groups.position !== undefined) absolute = groups.position === 90;
      if (groups.motion !== undefined) modal = groups.motion;
      if (groups.origin !== undefined) {
        if ('X' in axes) ox = x - axes.X * unit;
        if ('Y' in axes) oy = y - axes.Y * unit;
        ops.push({ type: 'origin', line, x, y, offsetX: ox, offsetY: oy });
      } else if (groups.motion !== undefined || Object.keys(axes).length) {
        if (modal === null) fail(line, 'falta G0 o G1 antes de las coordenadas.');
        const nx = 'X' in axes ? (absolute ? axes.X * unit + ox : x + axes.X * unit) : x;
        const ny = 'Y' in axes ? (absolute ? axes.Y * unit + oy : y + axes.Y * unit) : y;
        if (nx < -EPS || nx > WIDTH + EPS || ny < -EPS || ny > HEIGHT + EPS) fail(line, `fuera de límites: X ${nx.toFixed(2)}, Y ${ny.toFixed(2)} mm (X 0–200, Y 0–150).`);
        ops.push({ type: 'move', line, ax: x, ay: y, bx: Math.max(0, Math.min(WIDTH, nx)), by: Math.max(0, Math.min(HEIGHT, ny)), rapid: modal === 0, draw: modal === 1 && pen });
        x = nx; y = ny;
      }
      if (mCodes.length) { pen = mCodes[0] === 3; ops.push({ type: 'pen', line, down: pen }); }
      if (!mCodes.length && groups.origin === undefined && groups.motion === undefined && groups.unit === undefined && groups.position === undefined && !Object.keys(axes).length) fail(line, 'instrucción vacía.');
    }
    if (!ops.length) throw new Error('El programa no contiene movimientos ni órdenes de lapicero.');
    return { ops, lines: lines.length, end: { x, y }, width: WIDTH, height: HEIGHT };
  }
  return { parse, WIDTH, HEIGHT };
});
