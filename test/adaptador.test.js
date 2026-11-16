// Prueba el adaptador de Google contra una planilla de mentira: verifica que lleva bien la cuenta de los renglones.
// No prueba a Google de verdad; eso se hace después de publicarlo.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');

function googleFalso() {
  const hojas = {}, cache = {};
  const hoja = n => ({
    v: [],
    getMaxRows() { return Math.max(1000, this.v.length); }, getLastRow() { return this.v.length; },
    insertRowsAfter() {}, setFrozenRows() {},
    appendRow(f) { this.v.push(f.slice()); },
    deleteRow(n) { this.v.splice(n - 1, 1); },
    getDataRange() { const s = this; return { getDisplayValues: () => s.v.map(r => r.slice()) }; },
    getRange(f, c, nf, nc) { const s = this; const r = { setNumberFormat: () => r, setFontWeight: () => r, setValues(vals) { vals.forEach((row, i) => { s.v[f - 1 + i] = row.slice(); }); return r; } }; return r; }
  });
  const ss = { getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = hoja(n)), getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', toast() {} };
  return { hojas, sandbox: {
    SpreadsheetApp: { getActive: () => ss },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => require('crypto').randomUUID(), formatDate: () => '2027-03-08' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) },
    console } };
}

test('adaptador de Google: un cuestionario completo pasando por doPost', () => {
  const g = googleFalso();
  vm.createContext(g.sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), g.sandbox);
  const post = body => JSON.parse(g.sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).t);
  const ok = body => { const r = post(body); assert.ok(r.ok, body.a + ': ' + r.error); return r.d; };
  g.sandbox.preparar();
  const clave = g.hojas.Config.v.find(r => r[0] === 'clave')[1];
  assert.match(clave, /^[0-9a-f]{12}$/);
  const t = ok({ a: 'login', clave, device: 'pc' }).tk;
  ok({ a: 'curso.guardar', t, nombre: '1° A', alumnos: 'Ana\nBruno\nCata' });
  ok({ a: 'banco.guardar', t, titulo: 'T', texto: Array.from({ length: 6 }, (_, i) => `${i + 1}. P${i}\n*a) bien\nb) mal`).join('\n\n') });
  let p = ok({ a: 'panel', t });
  ok({ a: 'clase.guardar', t, cursoIds: [p.cursos[0].id], bancoId: p.bancos[0].id, fecha: '2027-03-08', segundos: 20, porAlumno: 5 });
  p = ok({ a: 'panel', t });
  assert.match(g.hojas.Pines.v[1][1], /^\d{4}$/);
  const claseId = p.clases[0].id;
  ok({ a: 'clase.estado', t, id: claseId, estado: 'abierto' });
  assert.strictEqual(g.hojas.Clases.v[1][7], 'abierto');
  ok({ a: 'alumno.guardar', t, id: p.cursos[0].alumnos[1].id, baja: true });        // modifica un renglón del medio
  const e = ok({ a: 'entrar', cursoId: p.cursos[0].id, pin: p.cursos[0].pin, device: 'tel' });
  assert.deepStrictEqual(e.alumnos.map(a => a.nombre), ['Ana', 'Cata']);
  ok({ a: 'soy', t: e.tk, alumnoId: e.alumnos[1].id });
  let q = ok({ a: 'empezar', t: e.tk, claseId });
  while (!q.fin) q = ok({ a: 'responder', t: e.tk, claseId, pos: q.pos, di: q.opciones.indexOf('bien') });
  assert.strictEqual(q.puntos, 100);
  assert.strictEqual(g.hojas.Respuestas.v.length, 6);                                // encabezado + 5 respuestas
  const it = g.hojas.Intentos.v[1];
  assert.ok(it[4] !== '' && it[6] === '5' && it[7] === '5', 'el intento quedó cerrado con 5 de 5 en su renglón');
  ok({ a: 'marca', t, claseId, alumnoId: e.alumnos[0].id, estado: 'T' });
  ok({ a: 'marca', t, claseId, alumnoId: e.alumnos[0].id, estado: '' });
  assert.strictEqual(g.hojas.Marcas.v.length, 1);
  assert.deepStrictEqual(ok({ a: 'asistencia', t, cursoId: p.cursos[0].id }).filas.map(f => f.celdas[0].k), ['A', 'P']);
  assert.strictEqual(post({ a: 'panel', t: 'inventado' }).code, 'ses');
});
