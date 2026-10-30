(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CNCExamples = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const header = ['G21', 'G90', 'M5'];
  function fromStrokes(strokes) {
    const rows = [...header];
    for (const points of strokes) {
      if (!points.length) continue;
      rows.push(`G0 X${points[0][0].toFixed(2)} Y${points[0][1].toFixed(2)}`, 'M3');
      for (const [x,y] of points.slice(1)) rows.push(`G1 X${x.toFixed(2)} Y${y.toFixed(2)}`);
      rows.push('M5');
    }
    rows.push('G0 X0 Y0'); return rows.join('\n');
  }
  const glyphs = {
    A:['0,0 0,7 5,7 5,0','0,3.5 5,3.5'],B:['0,0 0,7 4,7 5,6 5,4.5 4,3.5 0,3.5','4,3.5 5,2.5 5,1 4,0 0,0'],
    C:['5,7 0,7 0,0 5,0'],D:['0,0 0,7 3.5,7 5,5.5 5,1.5 3.5,0 0,0'],E:['5,7 0,7 0,0 5,0','0,3.5 4,3.5'],
    F:['0,0 0,7 5,7','0,3.5 4,3.5'],G:['5,7 0,7 0,0 5,0 5,3.5 3,3.5'],H:['0,0 0,7','5,0 5,7','0,3.5 5,3.5'],
    I:['0,7 5,7','2.5,7 2.5,0','0,0 5,0'],J:['0,2 0,0 5,0 5,7'],K:['0,0 0,7','5,7 0,3.5 5,0'],L:['0,7 0,0 5,0'],
    M:['0,0 0,7 2.5,4 5,7 5,0'],N:['0,0 0,7 5,0 5,7'],O:['0,0 0,7 5,7 5,0 0,0'],P:['0,0 0,7 5,7 5,3.5 0,3.5'],
    Q:['0,0 0,7 5,7 5,0 0,0','3,2 6,0'],R:['0,0 0,7 5,7 5,3.5 0,3.5','2.5,3.5 5,0'],S:['5,7 0,7 0,3.5 5,3.5 5,0 0,0'],
    T:['0,7 5,7','2.5,7 2.5,0'],U:['0,7 0,0 5,0 5,7'],V:['0,7 2.5,0 5,7'],W:['0,7 0,0 2.5,3 5,0 5,7'],
    X:['0,7 5,0','5,7 0,0'],Y:['0,7 2.5,3.5 5,7','2.5,3.5 2.5,0'],Z:['0,7 5,7 0,0 5,0']
  };
  function name(text) {
    const value = String(text || '').trim().toUpperCase();
    if (!/^[A-Z]{1,10}$/.test(value)) throw new Error('El nombre requiere de 1 a 10 letras A–Z, sin espacios ni tildes.');
    const size = Math.min(12, 175 / (value.length * 7));
    const total = (value.length * 7 - 2) * size, left = (200 - total) / 2;
    const strokes = [];
    for (let index=0;index<value.length;index++) {
      for (const stroke of glyphs[value[index]]) {
        strokes.push(stroke.split(' ').map(point => {
          const [gx,gy]=point.split(',').map(Number);
          return [left+(index*7+gx)*size, 75+(gy-3.5)*size];
        }));
      }
    }
    return fromStrokes(strokes);
  }
  const square = fromStrokes([[[35,25],[135,25],[135,125],[35,125],[35,25]]]);
  const triangle = fromStrokes([[[100,130],[35,25],[165,25],[100,130]]]);
  const house = fromStrokes([[[55,25],[145,25],[145,95],[100,135],[55,95],[55,25]],[[85,25],[85,65],[115,65],[115,25]],[[87,100],[87,78],[113,78],[113,100],[87,100]]]);
  const circle = fromStrokes([Array.from({length:49},(_,i)=>[100+55*Math.cos(i*Math.PI*2/48),75+55*Math.sin(i*Math.PI*2/48)])]);
  const star = fromStrokes([Array.from({length:11},(_,i)=>{const angle=Math.PI/2+i*Math.PI/5,r=i%2?27:65;return [100+r*Math.cos(angle),75+r*Math.sin(angle)]})]);
  function get(key, customName='CNC') {
    const items = { square, triangle, circle, star, house, letters: name('CNC') };
    if (key === 'name') return name(customName);
    if (!(key in items)) throw new Error('Figura desconocida.');
    return items[key];
  }
  return { get, name, keys: ['square','triangle','circle','star','house','letters','name'] };
});
