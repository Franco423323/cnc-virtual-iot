const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../js/gcode-parser.js');
const { Engine } = require('../js/cnc-engine.js');
const examples = require('../js/examples.js');
const { IoTSimulator } = require('../js/iot-simulator.js');
const renderer = require('../js/cnc-renderer.js');

function finish(engine, speed = 10) { for (let i=0;i<10000 && ['running','jogging'].includes(engine.mode);i++) engine.advance(80,speed); assert.ok(!['running','jogging'].includes(engine.mode),'el movimiento debe terminar'); }

test('todas las figuras usan el parser y el motor único, y regresan al origen', () => {
  for (const key of examples.keys) {
    const program = parse(examples.get(key, 'INGENIERIA'));
    const engine = new Engine(); engine.start(program); finish(engine);
    assert.equal(engine.mode,'complete',key);
    assert.ok(Math.abs(engine.x)<1e-6 && Math.abs(engine.y)<1e-6,key);
    assert.ok(engine.path.some(s=>s.draw),key);
    assert.ok(engine.path.some(s=>!s.draw),key);
    assert.equal(engine.progress,100,key);
    for (const segment of engine.path) assert.ok(segment.bx>=0 && segment.bx<=200 && segment.by>=0 && segment.by<=150,key);
  }
});

test('G0 no dibuja aunque M3 esté activo; G1 sigue la trayectoria exacta', () => {
  const engine = new Engine(); engine.start(parse('G21\nG90\nM3\nG0 X10 Y10\nG1 X20 Y10\nM5\nG1 X20 Y20'));
  finish(engine);
  assert.ok(engine.path.filter(s=>s.rapid).every(s=>!s.draw));
  assert.ok(engine.path.some(s=>s.draw && Math.abs(s.by-10)<1e-6));
  assert.ok(engine.path.filter(s=>s.by>10).every(s=>!s.draw));
  assert.deepEqual([engine.x,engine.y],[20,20]);
  for (let i=1;i<engine.path.length;i++) assert.ok(Math.hypot(engine.path[i].ax-engine.path[i-1].bx,engine.path[i].ay-engine.path[i-1].by)<1e-6);
});

test('unidades, coordenadas relativas, palabras modales y G92 mantienen la posición física', () => {
  const program = parse('G21 G90\nG0 X30 Y20\nG92 X0 Y0\nG91\nG1 X10 Y-5\nG20\nG90\nG1 X1 Y1');
  assert.equal(program.ops.find(op=>op.type==='origin').x,30);
  assert.ok(Math.abs(program.end.x-55.4)<1e-8);
  assert.ok(Math.abs(program.end.y-45.4)<1e-8);
  const engine = new Engine(); engine.start(program); finish(engine);
  assert.ok(Math.abs(engine.x-55.4)<1e-8);
  assert.ok(Math.abs(engine.y-45.4)<1e-8);
});

test('instrucciones incorrectas y límites devuelven línea y motivo', () => {
  for (const code of ['G2 X10','G1 X201','G1 Y-1','G1 F100','G0 G1 X10','M3 M5','G92','X10','G1 X1 X2','G1 Xfoo']) {
    assert.throws(()=>parse(code),/Línea 1:/,code);
  }
});

test('pausa, reanudación, detención y reinicio', () => {
  const engine = new Engine(); engine.start(parse('G1 X150 Y100'));
  engine.advance(80,2); const x=engine.x,y=engine.y;
  assert.equal(engine.pause(),true); engine.advance(80,10); assert.deepEqual([engine.x,engine.y],[x,y]);
  assert.equal(engine.resume(),true); engine.advance(80,2); assert.ok(engine.x>x);
  assert.equal(engine.stop(),true); const stopped=engine.x; engine.advance(80,10); assert.equal(engine.x,stopped);
  engine.reset(); assert.deepEqual([engine.x,engine.y,engine.path.length,engine.mode],[0,0,0,'idle']);
});

test('jog positivo/negativo, lapicero manual y origen', () => {
  const engine = new Engine(); engine.setPen(true); engine.jog(10,5); finish(engine);
  assert.deepEqual([engine.x,engine.y],[10,5]); assert.ok(engine.path.every(s=>s.draw));
  engine.setPen(false); engine.jog(-5,-5); finish(engine); assert.deepEqual([engine.x,engine.y],[5,0]);
  assert.ok(engine.path.some(s=>!s.draw)); assert.throws(()=>engine.jog(-10,0),/fuera de límites/);
  engine.home(); finish(engine); assert.deepEqual([engine.x,engine.y],[0,0]); assert.equal(engine.pen,false);
});

test('enlace IoT virtual acepta y rechaza comandos y registra ACK', () => {
  const iot = new IoTSimulator(); let calls=0;
  iot.send('START',()=>calls++); assert.equal(calls,1); assert.equal(iot.packets,1);
  assert.ok(iot.events.some(entry=>entry.includes('ACK SIM')));
  iot.toggle(); assert.throws(()=>iot.send('STOP',()=>calls++),/desconectado/);
  assert.equal(calls,1); assert.equal(iot.packets,1);
});

test('el marcador mecánico usa exactamente las coordenadas del motor', () => {
  const arcs=[];
  const ctx=new Proxy({}, {get(target,key){
    if(key==='createLinearGradient')return()=>({addColorStop(){}});
    if(key==='arc')return(...args)=>arcs.push(args);
    return target[key] ?? (()=>{});
  },set(target,key,value){target[key]=value;return true}});
  const engine=new Engine();engine.jog(40,30);finish(engine);
  renderer.draw({width:1200,height:820,getContext:()=>ctx},engine);
  assert.ok(arcs.some(([x,y,r])=>Math.abs(x-390)<1e-6 && Math.abs(y-605)<1e-6 && r===11));
});
