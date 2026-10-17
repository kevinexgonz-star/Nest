#!/usr/bin/env node
/* Tests de Rotula Nest (navegador real, Playwright).
 *
 *   node tests/run-tests.js [carpeta-con-pdfs-reales]
 *
 * Carga rotula-nest.html en Chromium y comprueba, con archivos SINTÉTICOS que se generan
 * aquí mismo (PDF, DXF, SVG) y, si se pasa, con una carpeta de PDF reales del panel
 * ("<CÓDIGO>-<línea>-<cliente>.pdf"):
 *   · tamaño exacto de la geometría importada (sin el encogido del viewBox con margen)
 *   · espejo horizontal en PDF, DXF y SVG
 *   · cantidad del pedido aplicada a TODAS sus piezas
 *   · nesting por bloques: cero solapes (separación ≥ hueco), dentro de la placa, cada pedido
 *     en un bloque que no se pisa con otro
 *   · rótulos de pedido fuera de la placa, título del material, capa por pedido en el DXF
 *   · flujo completo panel → lote → nesting → lienzo → exportar DXF/SVG/PDF
 * pdf.js se descarga de cdnjs la primera vez: hace falta red (o proxy en HTTPS_PROXY).
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Falta Playwright: npm i -D playwright  (o npx playwright install chromium)');
  process.exit(2);
}
const HTML = process.env.ROTULA_HTML || path.join(__dirname, '..', 'rotula-nest.html');
const PDF_DIR = process.argv[2] || process.env.ROTULA_PDFS || '';
const MM = 72 / 25.4;

/* ── archivos sintéticos ──────────────────────────────────────────────────────── */
// "L" asimétrica: palo a la izquierda, pie abajo hacia la derecha (y hacia abajo). Su
// centroide cae a la IZQUIERDA y ABAJO; espejada, a la DERECHA y abajo.
const L_MM = [[0, 0], [12, 0], [12, 88], [60, 88], [60, 100], [0, 100]];
function pdfFile(pageWmm, pageHmm, content, form) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + (pageWmm * MM).toFixed(3) + ' ' + (pageHmm * MM).toFixed(3) + '] /Contents 4 0 R' + (form ? ' /Resources << /XObject << /Fm0 5 0 R >> >>' : '') + ' >>';
  objs[4] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
  if (form) objs[5] = '<< /Type /XObject /Subtype /Form /BBox [' + form.bbox.join(' ') + '] /Matrix [' + form.matrix.join(' ') + '] /Length ' + form.content.length + ' >>\nstream\n' + form.content + '\nendstream';
  let out = '%PDF-1.4\n';
  const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const x = out.length;
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) out += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
// polígono en mm (y hacia abajo, origen arriba-izquierda de la página) → operadores PDF
function pdfPoly(ptsMM, pageHmm, dx, dy) {
  return ptsMM.map(([x, y], i) => ((x + dx) * MM).toFixed(3) + ' ' + ((pageHmm - (y + dy)) * MM).toFixed(3) + (i ? ' l' : ' m')).join('\n') + '\nh\n';
}
function syntheticPDF() {
  const H = 300;
  const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  let c = '0 g\n';
  c += pdfPoly(L_MM, H, 20, 20) + 'f\n';                    // "L" rellena…
  c += '0 G 1 w\n' + pdfPoly(L_MM, H, 20, 20) + 'S\n';       // …y el MISMO contorno trazado (duplicado)
  c += pdfPoly(sq(120, 20, 80), H, 0, 0) + pdfPoly(sq(140, 40, 40), H, 0, 0) + 'f*\n'; // "O": anillo con hueco
  c += pdfPoly([[0, 0], [91.7, 0], [91.7, 3.4], [0, 3.4]], H, 20, 160) + 'f\n'; // guion fino 91,7×3,4 mm
  c += '/Fm0 Do\n';
  // Form XObject con matriz NO identidad: traslada 100 mm a la derecha y 150 mm hacia ARRIBA
  const form = { bbox: [0, 0, 300 * MM, 300 * MM], matrix: [1, 0, 0, 1, (100 * MM).toFixed(3), (150 * MM).toFixed(3)], content: '0 g\n' + pdfPoly([[0, 0], [30, 0], [30, 70], [0, 70]], H, 120, 160) + 'f\n' };
  return pdfFile(240, H, c, form);
}
function syntheticDXF() {
  // DXF con Y hacia ARRIBA: la "L" con el pie abajo es (0,0)…(60,12) + palo (0..12, 0..100)
  const pts = [[0, 0], [60, 0], [60, 12], [12, 12], [12, 100], [0, 100]].map(([x, y]) => [x + 500, y + 700]);
  const L = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', 'CORTE', '90', String(pts.length), '70', '1'];
  pts.forEach(([x, y]) => L.push('10', String(x), '20', String(y)));
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n');
}
function syntheticSVG() {
  const d = 'M' + L_MM.map(p => p.join(' ')).join(' L') + ' Z';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="300mm" viewBox="0 0 400 300"><g transform="translate(100,50)"><path d="' + d + '" fill="#000"/></g></svg>';
}

/* ── mini-runner ─────────────────────────────────────────────────────────────── */
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log('  ✓ ' + name + '  (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { results.push([false, name, Date.now() - t0, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg || 'aserción fallida'); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, (msg || '') + ' (' + a + ' vs ' + b + ', tol ' + tol + ')');

async function main() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => typeof parsePDF === 'function' && document.querySelector('#root').children.length > 0);
  await page.evaluate(() => ensurePdfJs());
  // utilidades en la página
  await page.evaluate(() => {
    window.__t = {
      buf: b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; },
      geo: p => pieceToPolylinesMM({ ...p, x: 0, y: 0, placedW: p.w, placedH: p.h, drawW: p.w, drawH: p.h, rotated: false, rotation: 0 }).polylines,
      bbox: pls => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; pls.forEach(q => q.forEach(p => { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); })); return { x: a, y: b, w: c - a, h: d - b }; },
      // centroide por área de los anillos cerrados (par-impar con signo)
      centroid: pls => { let A = 0, X = 0, Y = 0; pls.forEach(q => { for (let i = 0; i + 1 < q.length; i++) { const k = q[i].x * q[i + 1].y - q[i + 1].x * q[i].y; A += k; X += (q[i].x + q[i + 1].x) * k; Y += (q[i].y + q[i + 1].y) * k; } }); return { x: X / (3 * A), y: Y / (3 * A) }; },
      // separación mínima real entre piezas colocadas y fuera de placa
      audit: (sheets, W, H, gap) => {
        const CL = ClipperLib, S = 1000, rep = { overlaps: [], outside: 0, pieces: 0, blockOverlaps: [], orderSplit: [] };
        sheets.forEach((sh, si) => {
          const G = sh.pieces.map(p => pieceToPolylinesMM(p).polylines);
          rep.pieces += G.length;
          G.forEach(pl => pl.forEach(q => q.forEach(p => { if (p.x < -0.01 || p.y < -0.01 || p.x > W + 0.01 || p.y > H + 0.01) rep.outside++; })));
          const U = G.map(pl => { const c = new CL.Clipper(); const ps = pl.filter(q => q.length >= 4 && isClosedPts(q)).map(q => { const r = q.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) })); if (!CL.Clipper.Orientation(r)) r.reverse(); return r; }); c.AddPaths(ps, CL.PolyType.ptSubject, true); const o = new CL.Paths(); c.Execute(CL.ClipType.ctUnion, o, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero); return o; });
          const off = U.map(u => { const co = new CL.ClipperOffset(2, 0.02 * S); co.AddPaths(u, CL.JoinType.jtRound, CL.EndType.etClosedPolygon); const o = new CL.Paths(); co.Execute(o, (gap / 2 - 0.1) * S); return o; });
          const bb = U.map(u => { let a = 1e18, b = 1e18, c = -1e18, d = -1e18; u.forEach(pp => pp.forEach(q => { a = Math.min(a, q.X); b = Math.min(b, q.Y); c = Math.max(c, q.X); d = Math.max(d, q.Y); })); return { a, b, c, d }; });
          for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) {
            const A = bb[i], B = bb[j], m = gap * S;
            if (A.c + m < B.a || B.c + m < A.a || A.d + m < B.b || B.d + m < A.b) continue;
            const c = new CL.Clipper(); c.AddPaths(off[i], CL.PolyType.ptSubject, true); c.AddPaths(off[j], CL.PolyType.ptClip, true);
            const o = new CL.Paths(); c.Execute(CL.ClipType.ctIntersection, o, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
            let a = 0; o.forEach(pp => a += Math.abs(CL.Clipper.Area(pp)));
            if (a > 0.01 * S * S) rep.overlaps.push('placa ' + (si + 1) + ': ' + sh.pieces[i].label + ' / ' + sh.pieces[j].label);
          }
          // bloques por pedido: cajas que no se pisan
          const blk = {};
          sh.pieces.forEach((p, i) => { const k = orderKeyOf(p); if (!k) return; const b = bb[i]; const e = blk[k] || (blk[k] = { a: 1e18, b: 1e18, c: -1e18, d: -1e18 }); e.a = Math.min(e.a, b.a); e.b = Math.min(e.b, b.b); e.c = Math.max(e.c, b.c); e.d = Math.max(e.d, b.d); });
          const ks = Object.keys(blk);
          for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const A = blk[ks[i]], B = blk[ks[j]]; if (A.a < B.c && B.a < A.c && A.b < B.d && B.b < A.d) rep.blockOverlaps.push(ks[i] + '/' + ks[j]); }
        });
        // un pedido que cabe en una placa no se reparte entre placas
        const where = {};
        sheets.forEach((sh, si) => sh.pieces.forEach(p => { const k = orderKeyOf(p); if (k) (where[k] = where[k] || new Set()).add(si); }));
        Object.keys(where).forEach(k => { if (where[k].size > 1) rep.orderSplit.push(k); });
        return rep;
      },
      // DXF → capas, entidades y puntos (lector mínimo de pares código/valor)
      readDXF: txt => {
        const L = txt.split('\r\n'), layers = {}, ents = [];
        let sec = null, lay = null, cur = null;
        for (let i = 0; i + 1 < L.length; i += 2) {
          const c = +L[i], v = L[i + 1];
          if (c === 2 && (v === 'HEADER' || v === 'TABLES' || v === 'ENTITIES')) { sec = v; continue; }
          if (sec === 'TABLES') { if (c === 0 && v === 'LAYER') lay = {}; else if (lay && c === 2) lay.name = v; else if (lay && c === 62) { layers[lay.name] = +v; lay = null; } }
          if (sec === 'ENTITIES') {
            if (c === 0) { if (cur) ents.push(cur); cur = v === 'ENDSEC' || v === 'EOF' ? null : { type: v, pts: [], closed: 0 }; continue; }
            if (!cur) continue;
            if (c === 8) cur.layer = v; else if (c === 70) cur.closed = +v & 1; else if (c === 10) cur.pts.push({ x: +v }); else if (c === 20) cur.pts[cur.pts.length - 1].y = +v;
          }
        }
        if (cur) ents.push(cur);
        return { layers, ents };
      }
    };
  });

  console.log('\nImportación');
  const synth = syntheticPDF().toString('base64');
  await test('PDF: geometría a tamaño EXACTO (antes encogía por el margen del viewBox)', async () => {
    const r = await page.evaluate(async b64 => { const res = await parsePDF(__t.buf(b64), 0, 1, { w: 2000, h: 3000 }); return res.pieces.map(p => ({ w: p.w, h: p.h, g: __t.bbox(__t.geo(p)) })); }, synth);
    const dash = r.find(p => Math.abs(p.w - 91.7) < 0.2);
    assert(dash, 'no aparece el guion de 91,7 mm: ' + JSON.stringify(r.map(p => [p.w, p.h])));
    near(dash.g.w, 91.7, 0.05, 'ancho del guion exportado');
    near(dash.g.h, 3.4, 0.05, 'alto del guion exportado');
    // tolerancia = la de la decimación de exportación (GEOM_TOL_MM, 0,05 mm)
    r.forEach(p => { near(p.g.w, p.w, 0.06, 'ancho geometría = ancho pieza'); near(p.g.h, p.h, 0.06, 'alto geometría = alto pieza'); near(p.g.x, 0, 0.06, 'origen x'); near(p.g.y, 0, 0.06, 'origen y'); });
  });
  await test('PDF: relleno + contorno del mismo dibujo = 1 pieza; el hueco de la "O" viaja con ella', async () => {
    const r = await page.evaluate(async b64 => (await parsePDF(__t.buf(b64), 0, 1, { w: 2000, h: 3000 })).pieces.map(p => [Math.round(p.w), Math.round(p.h), __t.geo(p).length]), synth);
    const ls = r.filter(p => p[0] === 60 && p[1] === 100), os = r.filter(p => p[0] === 80 && p[1] === 80);
    assert(ls.length === 1, '"L" duplicada o perdida: ' + JSON.stringify(r));
    assert(os.length === 1 && os[0][2] === 2, '"O" con hueco: ' + JSON.stringify(r));
    assert(r.length === 4, '4 piezas esperadas: ' + JSON.stringify(r));
  });
  await test('PDF: Form XObject con /Matrix se coloca donde debe', async () => {
    const r = await page.evaluate(async b64 => {
      __NEST_CFG__.mirror = false;
      try { const res = await parsePDF(__t.buf(b64), 0, 1, { w: 2000, h: 3000 }); return res.pieces.map(p => ({ w: p.w, h: p.h, vb: p.viewBox })); } finally { __NEST_CFG__.mirror = true; }
    }, synth);
    const f = r.find(p => Math.round(p.w) === 30 && Math.round(p.h) === 70);
    assert(f, 'falta la pieza del formulario: ' + JSON.stringify(r));
    const [x, y] = f.vb.split(' ').map(Number);
    near(x, 220, 0.05, 'x del formulario (120 + 100 de su matriz)');
    near(y, 10, 0.05, 'y del formulario (160 − 150 de su matriz)');
  });
  await test('PDF: espejo horizontal (letra L con el palo a la DERECHA)', async () => {
    const r = await page.evaluate(async b64 => {
      const pick = async mirror => { __NEST_CFG__.mirror = mirror; const res = await parsePDF(__t.buf(b64), 0, 1, { w: 2000, h: 3000 }); const p = res.pieces.find(q => Math.round(q.w) === 60 && Math.round(q.h) === 100); return { c: __t.centroid(__t.geo(p)), w: p.w, h: p.h }; };
      try { return { off: await pick(false), on: await pick(true) }; } finally { __NEST_CFG__.mirror = true; }
    }, synth);
    assert(r.off.c.x < r.off.w / 2, 'sin espejo el palo va a la izquierda');
    assert(r.on.c.x > r.on.w / 2, 'con espejo el palo va a la derecha');
    near(r.on.c.x, r.on.w - r.off.c.x, 0.05, 'reflejo exacto');
    near(r.on.c.y, r.off.c.y, 0.05, 'el espejo no voltea en vertical');
  });
  await test('DXF: entra derecho, a tamaño y espejado (antes caía fuera de su viewBox)', async () => {
    const r = await page.evaluate(dxf => { const p = parseDXF(dxf).pieces[0]; const g = __t.geo(p); return { w: p.w, h: p.h, bb: __t.bbox(g), c: __t.centroid(g), outline: !!pieceOutlineMM(p) }; }, syntheticDXF());
    near(r.w, 60, 0.01, 'ancho'); near(r.h, 100, 0.01, 'alto');
    near(r.bb.x, 0, 0.02, 'geometría dentro de su caja (x)'); near(r.bb.y, 0, 0.02, 'geometría dentro de su caja (y)');
    near(r.bb.w, 60, 0.02, 'ancho dibujado'); near(r.bb.h, 100, 0.02, 'alto dibujado');
    assert(r.c.y > r.h / 2, 'el pie de la L abajo (Y del DXF volteada)');
    assert(r.c.x > r.w / 2, 'espejada: palo a la derecha');
    assert(r.outline, 'contorno de nesting sin DOM');
  });
  await test('SVG: espejado y contorno de nesting con transform de grupo', async () => {
    const r = await page.evaluate(svg => { const p = parseSVG(svg).pieces[0]; const g = __t.geo(p); const o = pieceOutlineMM(p); return { w: p.w, h: p.h, bb: __t.bbox(g), c: __t.centroid(g), ob: o && __t.bbox([o]) }; }, syntheticSVG());
    near(r.w, 60, 0.01, 'ancho'); near(r.h, 100, 0.01, 'alto');
    near(r.bb.w, 60, 0.02, 'ancho dibujado'); near(r.bb.x, 0, 0.02, 'x dibujada');
    assert(r.c.x > r.w / 2, 'espejada: palo a la derecha');
    assert(r.ob && Math.abs(r.ob.x) < 0.05 && Math.abs(r.ob.w - 60) < 0.05, 'pieceOutlineMM respeta la pila de transformaciones: ' + JSON.stringify(r.ob));
  });

  console.log('\nPedidos');
  await test('cantidad del pedido = copias del diseño ENTERO (todas las piezas)', async () => {
    const r = await page.evaluate(() => orderToPieces({ ref: 'AGENCYXX-2', qty: 2 }, [{ w: 1, h: 1, quantity: 1 }, { w: 2, h: 2 }, { w: 3, h: 3, quantity: 1 }], 'PVC').map(p => p.quantity));
    assert(r.join() === '2,2,2', 'cantidades: ' + r);
  });
  await test('código de pedido desde ref o nombre de archivo (como lo rotula VCarve)', async () => {
    const r = await page.evaluate(() => [orderKeyOf({ ref: 'BDKGQVISY-1' }), orderKeyOf({ fileName: 'GCTKASPDM-2-Roberto-Merani.pdf', label: 'PDF 3' }), orderKeyOf({ ref: 'PED-001' }), orderKeyOf({ label: 'Rect 2' }), orderMatColor({ matLabel: 'Plancha De Pvc 3mm Pvc Negro' }), sheetTitleText('PVC', 3, 'NEGRO')]);
    assert(JSON.stringify(r) === JSON.stringify(['BDKGQVISY', 'GCTKASPDM', 'PED-001', '', 'NEGRO', 'PVC 3MM NEGRO']), JSON.stringify(r));
  });
  await test('colores de pedido distintos y exactos en ACI (mismo color en VCarve)', async () => {
    const r = await page.evaluate(() => { const ps = Array.from({ length: 20 }, (_, i) => ({ ref: 'ORDER' + String.fromCharCode(65 + i) + 'XX-1' })); const m = orderColorMap(ps); const cols = ps.map(p => orderColorOf(p, m)); return { uniq: new Set(cols).size, aci: new Set(cols.map(hexToACI)).size, exact: cols.every(c => aciHex(hexToACI(c)) === c) }; });
    assert(r.uniq === 20 && r.aci === 20 && r.exact, JSON.stringify(r));
  });

  console.log('\nNesting por bloques de pedido');
  // pedidos sintéticos: letras L, O y guiones repartidas en 9 pedidos
  const synthOrders = await page.evaluate(async b64 => {
    const res = await parsePDF(__t.buf(b64), 0, 1, { w: 2000, h: 3000 });
    const out = [];
    for (let k = 0; k < 9; k++) out.push(...orderToPieces({ ref: 'SYNTH' + String.fromCharCode(65 + k) + 'QQ-1', fileName: 'x.pdf', qty: 1 + (k % 4) }, res.pieces, 'PVC'));
    window.__synth = out;
    return out.length;
  }, synth);
  assert(synthOrders > 0, 'sin piezas sintéticas');
  await test('9 pedidos sintéticos: sin solapes, dentro de placa, bloques que no se pisan', async () => {
    const r = await page.evaluate(async () => { const t = performance.now(); const sh = await nestWithRetales(__synth, 2000, 3000, 5, null, []); return { ms: performance.now() - t, grouped: !!sh._grouped, sheets: sh.length, a: __t.audit(sh, 2000, 3000, 5), inst: __synth.reduce((s, p) => s + p.quantity, 0) }; });
    assert(r.grouped, 'no entró el motor por bloques');
    assert(r.a.pieces === r.inst, 'piezas colocadas ' + r.a.pieces + ' de ' + r.inst);
    assert(!r.a.overlaps.length, 'solapes/separación < hueco: ' + r.a.overlaps.slice(0, 5).join(', '));
    assert(!r.a.outside, r.a.outside + ' puntos fuera de placa');
    assert(!r.a.blockOverlaps.length, 'bloques que se pisan: ' + r.a.blockOverlaps.join(', '));
    assert(!r.a.orderSplit.length, 'pedidos repartidos entre placas: ' + r.a.orderSplit.join(', '));
    assert(r.ms < 15000, 'demasiado lento: ' + Math.round(r.ms) + ' ms');
  });
  await test('placa pequeña: los pedidos pasan a placas nuevas sin solapar ni salirse', async () => {
    const r = await page.evaluate(async () => { const sh = await nestWithRetales(__synth, 350, 450, 5, null, []); return { sheets: sh.length, a: __t.audit(sh, 350, 450, 5), inst: __synth.reduce((s, p) => s + p.quantity, 0), over: sh._oversized || null }; });
    assert(r.sheets > 1, 'debería necesitar varias placas');
    assert(r.a.pieces === r.inst, 'piezas colocadas ' + r.a.pieces + ' de ' + r.inst + ' ' + JSON.stringify(r.over));
    assert(!r.a.overlaps.length && !r.a.outside && !r.a.blockOverlaps.length, JSON.stringify(r.a).slice(0, 300));
  });
  await test('piezas giradas 90/180/270 se dibujan donde reservó el motor', async () => {
    const r = await page.evaluate(async () => {
      const sh = await nestWithRetales(__synth, 400, 3000, 5, null, []); // franja estrecha: obliga a girar
      const rots = new Set(); sh.forEach(s => s.pieces.forEach(p => rots.add(p.rotation)));
      return { rots: [...rots], a: __t.audit(sh, 400, 3000, 5) };
    });
    assert(r.rots.some(x => x), 'no se giró ninguna pieza: ' + r.rots);
    assert(!r.a.overlaps.length && !r.a.outside, JSON.stringify(r.a).slice(0, 300));
  });
  await test('rótulos fuera de la placa y título encima', async () => {
    const r = await page.evaluate(async () => {
      const sh = await nestWithRetales(__synth, 2000, 3000, 5, null, []);
      const d = sheetExportData(sh[0], 2000, 3000, CAPAS_INIT, { title: 'PVC 3MM NEGRO' });
      const inside = d.labels.filter(l => l.pts.some(p => p.x > 0.5 && p.x < 1999.5 && p.y > 0.5 && p.y < 2999.5)).length;
      const keys = new Set(sh[0].pieces.map(orderKeyOf));
      return { inside, n: d.layout.labels.length, keys: keys.size, title: d.layout.title && d.layout.title.y < 0 };
    });
    assert(r.inside === 0, r.inside + ' trazos de rótulo dentro de la placa');
    assert(r.n === r.keys, r.n + ' rótulos para ' + r.keys + ' pedidos');
    assert(r.title, 'título encima de la placa');
  });
  await test('DXF de placa: capa y color por pedido, rótulos en su capa, sin TEXT por pieza', async () => {
    const r = await page.evaluate(async () => {
      const sh = await nestWithRetales(__synth, 2000, 3000, 5, null, []);
      const keys = [...new Set(sh[0].pieces.map(orderKeyOf))];
      const dxf = buildDXF(sh[0], 2000, 3000, 0, CAPAS_INIT, { cmap: orderColorMap(sh.flatMap(s => s.pieces)), title: 'PVC 3MM NEGRO' });
      const D = __t.readDXF(dxf);
      const cut = D.ents.filter(e => keys.includes(e.layer));
      return { keys, layers: D.layers, texts: D.ents.filter(e => e.type === 'TEXT').length, cutOpen: cut.filter(e => !e.closed).length, cut: cut.length,
        labelInside: D.ents.filter(e => / ETIQUETA$/.test(e.layer) || e.layer === 'ETIQUETAS').filter(e => e.pts.some(p => p.x > 0.5 && p.x < 1999.5 && p.y > 0.5 && p.y < 2999.5)).length,
        cutOutside: cut.filter(e => e.pts.some(p => p.x < -0.01 || p.x > 2000.01 || p.y < -0.01 || p.y > 3000.01)).length };
    });
    assert(r.keys.every(k => r.layers[k] != null && r.layers[k + ' ETIQUETA'] === r.layers[k]), 'capas: ' + JSON.stringify(r.layers));
    assert(new Set(r.keys.map(k => r.layers[k])).size === r.keys.length, 'colores ACI repetidos entre pedidos');
    assert(r.texts === 0, r.texts + ' TEXT (rótulo por pieza) en el DXF');
    assert(r.cut > 0 && r.cutOpen === 0, r.cutOpen + ' contornos de corte abiertos');
    assert(r.labelInside === 0 && r.cutOutside === 0, 'rótulos dentro: ' + r.labelInside + ' · corte fuera: ' + r.cutOutside);
  });

  // Pedidos SVG reales que trae la demo (panel embebido en rotula-nest-demo.html)
  const demoHtml = path.join(__dirname, '..', 'rotula-nest-demo.html');
  const demoOrders = (() => {
    try {
      const t = fs.readFileSync(demoHtml, 'utf8');
      const b64 = /var PANEL_B64 = "([^"]+)"/.exec(t)[1];
      const panel = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(/const ORDERS = (\[.*?\]);\n/s.exec(panel)[1]).map(o => ({ ref: o.ref, fileName: o.fileName, matName: o.matName, thk: o.thk, qty: o.qty, svg: Buffer.from(o.b64, 'base64').toString('utf8') }));
    } catch (e) { return []; }
  })();
  if (demoOrders.length) {
    console.log('\nSVG reales de la demo (' + demoOrders.length + ' pedidos)');
    await test('cada lote material+grosor: bloques sin solapes con geometría real (polygon/circle/rect incluidos)', async () => {
      const r = await page.evaluate(async orders => {
        const by = {};
        for (const o of orders) { const k = o.matName + ' ' + o.thk; (by[k] = by[k] || []).push(...orderToPieces(o, parseSVG(o.svg).pieces, o.matName)); }
        const out = [];
        for (const k in by) {
          const t = performance.now();
          const sh = await nestWithRetales(by[k], 2000, 3000, 5, null, []);
          out.push({ k, ms: Math.round(performance.now() - t), grouped: !!sh._grouped, inst: by[k].reduce((s, p) => s + p.quantity, 0), over: sh._oversized || null, a: __t.audit(sh, 2000, 3000, 5) });
        }
        return out;
      }, demoOrders);
      for (const b of r) {
        assert(b.grouped, b.k + ': no entró el motor por bloques');
        assert(!b.a.overlaps.length && !b.a.outside, b.k + ': ' + JSON.stringify({ ov: b.a.overlaps.slice(0, 3), out: b.a.outside }));
        assert(b.a.pieces === b.inst || b.over, b.k + ': colocadas ' + b.a.pieces + ' de ' + b.inst);
        assert(b.ms < 20000, b.k + ': ' + b.ms + ' ms');
      }
      console.log('      ' + r.map(b => b.k + ' ' + b.inst + ' pzs ' + b.ms + ' ms').join(' · '));
    });
    await test('aplanado sin DOM de las máscaras ⊇ geometría exportada (≤ 0,05 mm)', async () => {
      const worst = await page.evaluate(orders => {
        let w = 0;
        for (const o of orders) for (const p of parseSVG(o.svg).pieces) {
          const bb = pls => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; pls.forEach(q => q.forEach(pt => { a = Math.min(a, pt.x); b = Math.min(b, pt.y); c = Math.max(c, pt.x); d = Math.max(d, pt.y); })); return [a, b, c, d]; };
          const A = bb(pieceOutlineMM.shapes(p, 0.05)), B = bb(__t.geo(p));
          w = Math.max(w, A[0] - B[0], A[1] - B[1], B[2] - A[2], B[3] - A[3]);
        }
        return w;
      }, demoOrders);
      assert(worst <= 0.05, 'la geometría exportada sobresale ' + worst.toFixed(3) + ' mm de la usada para anidar');
    });
  }

  if (PDF_DIR) {
    console.log('\nPDF reales (' + PDF_DIR + ')');
    const files = fs.readdirSync(PDF_DIR).filter(f => /\.(pdf|ai)$/i.test(f)).sort();
    const orders = files.map(f => {
      const fn = f.replace(/^[0-9a-f]{8}-/, ''); // nombre subido con prefijo de 8 hex
      const m = /^([A-Z0-9]+-\d+)/i.exec(fn);
      return { ref: m ? m[1] : fn, fileName: fn, fileType: 'pdf', content: fs.readFileSync(path.join(PDF_DIR, f)).toString('base64'), matName: 'PVC', thk: 3, qty: 1, matLabel: 'Plancha De Pvc 3mm Pvc Negro' };
    });
    await test(files.length + ' PDF: geometría exacta y espejada en todas las piezas', async () => {
      const r = await page.evaluate(async orders => {
        const bad = [];
        let n = 0;
        for (const o of orders) {
          const res = await parsePDF(__t.buf(o.content), 0, 10, { w: 2000, h: 3000 });
          res.pieces.forEach(p => { n++; const b = __t.bbox(__t.geo(p)); if (Math.abs(b.w - p.w) > 0.06 || Math.abs(b.h - p.h) > 0.06) bad.push(o.ref + ' ' + p.w + '×' + p.h + ' → ' + b.w.toFixed(2) + '×' + b.h.toFixed(2)); });
        }
        return { n, bad };
      }, orders);
      assert(r.n > 0, 'sin piezas');
      assert(!r.bad.length, r.bad.slice(0, 5).join(' · '));
    });
    await test('flujo completo: panel → nesting → lienzo → exportar (DXF del editor)', async () => {
      await page.evaluate(o => window.postMessage({ type: 'ROTULA_NEST_LOAD', payload: { orders: o } }, '*'), orders);
      let n = 0;
      for (let i = 0; i < 240 && !n; i++) { n = await page.evaluate(() => (document.body.innerText.match(/(\d+) objeto\(s\) en el lienzo/) || [])[1] | 0); if (!n) await page.waitForTimeout(250); }
      assert(n > 0, 'el lienzo no recibió piezas');
      await page.waitForTimeout(600);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(txt.indexOf('NEGRO') >= 0 || (await page.inputValue('input[placeholder="p. ej. NEGRO"]')) === 'NEGRO', 'color de plancha del lote');
      await page.click('text=⬇ Exportar');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('button', { hasText: /^DXF$/ }).first().click()]);
      const file = path.join(require('os').tmpdir(), 'rotula-test-' + Date.now() + '.dxf');
      await dl.saveAs(file);
      const D = await page.evaluate(t => __t.readDXF(t), fs.readFileSync(file, 'latin1'));
      fs.unlinkSync(file);
      const codes = [...new Set(orders.map(o => o.ref.replace(/-\d+$/, '')))];
      codes.forEach(c => assert(D.layers[c] != null && D.layers[c + ' ETIQUETA'] != null, 'falta la capa del pedido ' + c + ': ' + Object.keys(D.layers)));
      assert(D.layers.ETIQUETAS != null, 'falta el título (capa ETIQUETAS)');
      const shot = path.join(require('os').tmpdir(), 'rotula-test-lienzo.png');
      await page.screenshot({ path: shot });
      console.log('      captura del lienzo: ' + shot);
    });
  }
  const errs = logs.filter(l => /^pageerror|^error/.test(l));
  await test('sin errores de JavaScript en la página', async () => assert(!errs.length, errs.slice(0, 5).join(' | ')));
  await browser.close();
  const ok = results.filter(r => r[0]).length;
  console.log('\n' + ok + '/' + results.length + ' tests OK');
  process.exit(ok === results.length ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
