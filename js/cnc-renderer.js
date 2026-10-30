(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CNCRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const X0 = 250, Y0 = 710, SCALE = 3.5, PW = 700, PH = 525;
  function round(ctx, x, y, w, h, r, fill, stroke, width = 1) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function line(ctx, x1, y1, x2, y2, color, width = 1, dash = []) {
    ctx.beginPath(); ctx.setLineDash(dash); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]);
  }
  function label(ctx, value, x, y, color = '#a8bfd1', size = 13, align = 'left') {
    ctx.fillStyle = color; ctx.font = `600 ${size}px Consolas, monospace`; ctx.textAlign = align; ctx.fillText(value, x, y); ctx.textAlign = 'left';
  }
  function bolt(ctx, x, y) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fillStyle = '#627c8d'; ctx.fill(); line(ctx, x-2, y, x+2, y, '#203444'); }
  function motor(ctx, x, y, title, angle) {
    ctx.save(); ctx.translate(x, y);
    round(ctx, -34, -34, 68, 68, 9, '#263c4a', '#7994a1', 2);
    round(ctx, -27, -27, 54, 54, 5, '#1a2c38', '#496576', 2);
    for (const sx of [-25, 25]) for (const sy of [-25, 25]) bolt(ctx, sx, sy);
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fillStyle = '#425f6b'; ctx.fill(); ctx.strokeStyle = '#91aab3'; ctx.lineWidth = 2; ctx.stroke();
    ctx.rotate(angle);
    line(ctx, -14, 0, 14, 0, '#b5e2d6', 3); line(ctx, 0, -14, 0, 14, '#b5e2d6', 3);
    ctx.restore();
    label(ctx, title, x, y + 48, '#a6c3cf', 12, 'center');
  }
  function pulley(ctx, x, y, angle) {
    ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fillStyle = '#263947'; ctx.fill(); ctx.strokeStyle = '#9cb9c3'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.strokeStyle = '#5b8292'; ctx.stroke();
    line(ctx, x + Math.cos(angle)*5, y + Math.sin(angle)*5, x + Math.cos(angle)*12, y + Math.sin(angle)*12, '#d4e6e9', 2);
  }
  function drawPath(ctx, path, exportOnly = false) {
    for (const segment of path) {
      if (exportOnly && !segment.draw) continue;
      const x1 = X0 + segment.ax*SCALE, y1 = Y0 - segment.ay*SCALE;
      const x2 = X0 + segment.bx*SCALE, y2 = Y0 - segment.by*SCALE;
      if (segment.draw) line(ctx, x1, y1, x2, y2, '#256bc8', exportOnly ? 3 : 3.4);
      else line(ctx, x1, y1, x2, y2, '#95a9ac', 1.3, [5, 6]);
    }
  }
  function paper(ctx, path, exportOnly = false) {
    ctx.fillStyle = '#e3e9e7'; ctx.fillRect(X0+6, Y0-PH+7, PW, PH);
    ctx.fillStyle = '#fafcf9'; ctx.fillRect(X0, Y0-PH, PW, PH);
    ctx.strokeStyle = '#b1c7ca'; ctx.lineWidth = 2; ctx.strokeRect(X0, Y0-PH, PW, PH);
    for (let i=0;i<=200;i+=10) line(ctx, X0+i*SCALE, Y0-PH, X0+i*SCALE, Y0, i%50===0?'#d4dfdf':'#e9efed');
    for (let i=0;i<=150;i+=10) line(ctx, X0, Y0-i*SCALE, X0+PW, Y0-i*SCALE, i%50===0?'#d4dfdf':'#e9efed');
    drawPath(ctx, path, exportOnly);
  }
  function draw(canvas, engine) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0,0,0,820); bg.addColorStop(0,'#101f2b'); bg.addColorStop(1,'#08131d'); ctx.fillStyle=bg; ctx.fillRect(0,0,1200,820);
    for(let x=35;x<1200;x+=40) for(let y=30;y<820;y+=40){ctx.fillStyle='#1c3542';ctx.fillRect(x,y,1,1)}
    label(ctx,'CNC / XY PLOTTER',40,45,'#7da9b6',16); label(ctx,'MECÁNICA VIRTUAL · VISTA SUPERIOR',40,66,'#557b8a',11);
    // Bastidor y cama de trabajo.
    round(ctx,118,105,951,669,20,'#152b38','#557081',3);
    round(ctx,136,121,915,637,13,'#263c47','#809aa5',2);
    round(ctx,152,137,882,605,8,'#12242d','#486472',2);
    round(ctx,227,162,746,572,5,'#344a50','#6d8b91',2);
    for(const [bx,by] of [[157,143],[1030,143],[157,737],[1030,737]]){round(ctx,bx-15,by-15,30,30,5,'#324c58','#73909c');bolt(ctx,bx,by)}
    paper(ctx,engine.path);
    // Regla y límites físicos.
    line(ctx,X0,Y0+26,X0+PW,Y0+26,'#83a4af',1.5); line(ctx,X0-25,Y0,X0-25,Y0-PH,'#83a4af',1.5);
    for(let n=0;n<=200;n+=25){const x=X0+n*SCALE;line(ctx,x,Y0+22,x,Y0+29,'#9db8c0');label(ctx,String(n),x,Y0+45,'#a9c3c8',10,'center')}
    for(let n=0;n<=150;n+=25){const y=Y0-n*SCALE;line(ctx,X0-29,y,X0-21,y,'#9db8c0');label(ctx,String(n),X0-34,y+4,'#a9c3c8',10,'right')}
    label(ctx,'X / mm',X0+PW+30,Y0+45,'#9ecac8',11);label(ctx,'Y / mm',X0-57,Y0-PH-18,'#9ecac8',11);
    // Guías Y y transmisión longitudinal.
    for(const rx of [198,1002]){round(ctx,rx-12,169,24,550,5,'#12252f','#698493',2);line(ctx,rx-4,172,rx-4,716,'#a1b5ba',3);line(ctx,rx+5,172,rx+5,716,'#475f6b',2)}
    line(ctx,1032,178,1032,706,'#d0a864',4);line(ctx,1044,178,1044,706,'#8e734c',2);
    pulley(ctx,1038,181,engine.y/5);pulley(ctx,1038,705,engine.y/5);
    // El pórtico se mueve con Y y lleva el motor X.
    const cy=Y0-engine.y*SCALE, cx=X0+engine.x*SCALE;
    round(ctx,176,cy-43,850,86,9,'#294653','#8ca4af',2);
    round(ctx,202,cy-35,799,70,4,'#142d39','#597889',2);
    line(ctx,222,cy-23,981,cy-23,'#b8cfce',4);line(ctx,222,cy+23,981,cy+23,'#b8cfce',4);
    line(ctx,222,cy-10,981,cy-10,'#d4ae72',4);line(ctx,222,cy+10,981,cy+10,'#886f50',3);
    pulley(ctx,222,cy,engine.x/5);pulley(ctx,980,cy,engine.x/5);
    for(const rx of [198,1002]){round(ctx,rx-22,cy-51,44,102,7,'#365363','#94b0ba',2);bolt(ctx,rx,cy-39);bolt(ctx,rx,cy+39)}
    motor(ctx,164,cy,'NEMA 17 / X',engine.x/5);
    motor(ctx,1105,673,'NEMA 17 / Y',engine.y/5);
    // Acoplamiento del motor Y al ramal de correa.
    line(ctx,1074,673,1038,705,'#ba9560',3);
    // Carro X, servo Z y punta del lapicero comparten exactamente cx,cy.
    round(ctx,cx-38,cy-36,76,72,9,'#162e3a','#b2c6c9',2);
    round(ctx,cx-29,cy-29,58,58,6,'#325766','#9fc8c8',2);
    for(const sx of [-24,24])for(const sy of [-24,24])bolt(ctx,cx+sx,cy+sy);
    round(ctx,cx+22,cy-53,44,27,5,'#ad854c','#f0c58b',2);
    label(ctx,'SG90',cx+44,cy-35,'#2a2826',10,'center');
    const contact=engine.contact;
    line(ctx,cx,cy-15,cx,cy+(contact?13:5),'#e5ece9',7);
    ctx.beginPath();ctx.arc(cx,cy,contact?9:11,0,7);ctx.fillStyle=contact?'#f4b766':'#57d9c6';ctx.fill();ctx.strokeStyle='#102b35';ctx.lineWidth=2;ctx.stroke();
    line(ctx,cx-17,cy,cx-10,cy,'#dbeceb',1.5);line(ctx,cx+10,cy,cx+17,cy,'#dbeceb',1.5);
    line(ctx,cx,cy-17,cx,cy-10,'#dbeceb',1.5);line(ctx,cx,cy+10,cx,cy+17,'#dbeceb',1.5);
    // Lectura técnica directa en la máquina.
    round(ctx,39,754,250,43,6,'#0d2631','#355a64');label(ctx,`X ${engine.x.toFixed(2)}  Y ${engine.y.toFixed(2)} mm`,52,780,'#b1e6dc',13);
    round(ctx,902,754,251,43,6,'#0d2631','#355a64');label(ctx,`Z ${contact?'ABAJO':'ARRIBA'} / ${engine.mode.toUpperCase()}`,915,780,'#b1e6dc',12);
    label(ctx,'0,0',X0+9,Y0-10,'#5c7881',11);
  }
  function exportPaper(engine) {
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=625;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,800,625);
    ctx.save();ctx.translate(-X0+50,-(Y0-PH)+50);paper(ctx,engine.path,true);ctx.restore();
    return canvas.toDataURL('image/png');
  }
  return { draw, exportPaper };
});
