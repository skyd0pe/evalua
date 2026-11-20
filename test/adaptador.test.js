// Prueba el adaptador de Google contra una planilla de mentira: verifica que lleva bien la cuenta de los renglones.
// No prueba a Google de verdad; eso se hace después de publicarlo.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');

function googleFalso() {
  const hojas = {}, cache = {};
  const hoja = n => ({
    v: [], getName: () => n,
    getMaxRows() { return Math.max(1000, this.v.length); }, getLastRow() { let i = this.v.length; while (i > 0 && this.v[i - 1].every(c => c === '')) i--; return i; },
    insertRowsAfter() {}, setFrozenRows() {},
    getRange(f, c, nf = 1, nc = 1) {
      const s = this, celdas = () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => ((s.v[f - 1 + i] || [])[c - 1 + j]) ?? ''));
      const r = {
        setNumberFormat: () => r, setFontWeight: () => r,
        getDisplayValues: celdas, getDisplayValue: () => celdas()[0][0],
        setValues(vals) { vals.forEach((row, i) => { const fila = s.v[f - 1 + i] = s.v[f - 1 + i] || []; row.forEach((x, j) => { fila[c - 1 + j] = String(x); }); }); return r; },
        setValue(x) { return r.setValues([[x]]); },
        clearContent() { return r.setValues(Array.from({ length: nf }, () => Array(nc).fill(''))); }
      };
      return r;
    }
  });
  const ss = { flush() {}, getSheetByName: n => hojas[n] || null, getSheets: () => Object.values(hojas), insertSheet: n => (hojas[n] = hoja(n)), getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', toast() {} };
  return { hojas, cache, sandbox: {
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])), put: (k, v) => { cache[k] = String(v); }, putAll: o => { Object.assign(cache, o); }, remove: k => { delete cache[k]; } }) },
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
  assert.strictEqual(g.hojas.Alumnos.v.find(r => r[2] === 'Cata')[4], 'tel', 'el nombre quedó vinculado al teléfono, en la planilla');
  let q = ok({ a: 'empezar', t: e.tk, claseId });
  while (!q.fin) q = ok({ a: 'responder', t: e.tk, claseId, pos: q.pos, di: q.opciones.indexOf('bien') });
  assert.strictEqual(q.puntos, 100);
  const it = g.hojas.Intentos.v.find(r => r[3] !== '' && r[0] !== 'id');   // el renglón del intento empezado (los otros son reservas)
  assert.ok(it[4] !== '' && it[6] === '5' && it[7] === '5', 'el intento quedó cerrado con 5 de 5 en su renglón');
  assert.strictEqual(Object.keys(JSON.parse(it[11])).length, 5, 'las 5 respuestas quedaron en el renglón del intento');
  assert.strictEqual(g.hojas.Respuestas, undefined, 'ya no hay pestaña Respuestas');
  ok({ a: 'marca', t, claseId, alumnoId: e.alumnos[0].id, estado: 'T' });
  ok({ a: 'marca', t, claseId, alumnoId: e.alumnos[0].id, estado: '' });
  assert.ok(g.hojas.Marcas.v.slice(1).every(r => r.every(c => c === '')), 'borrar vacía el renglón');
  const filaCata = g.hojas.Alumnos.v.findIndex(r => r[2] === 'Cata');
  ok({ a: 'curso.guardar', t, id: p.cursos[0].id, nombre: '1° A', alumnos: 'Dani' });   // agregar después de borrar no mueve a nadie
  assert.strictEqual(g.hojas.Alumnos.v.findIndex(r => r[2] === 'Cata'), filaCata);
  assert.deepStrictEqual(ok({ a: 'asistencia', t, cursoId: p.cursos[0].id }).filas.map(f => f.nombre + ' ' + f.celdas[0].k), ['Ana A', 'Cata P', 'Dani A']);
  assert.strictEqual(post({ a: 'panel', t: 'inventado' }).code, 'ses');
});

test('adaptador de Google: la copia en memoria rápida se renueva al escribir desde la app y al editar a mano', () => {
  const g = googleFalso();
  vm.createContext(g.sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), g.sandbox);
  const post = body => JSON.parse(g.sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).t);
  const ok = body => { const r = post(body); assert.ok(r.ok, body.a + ': ' + r.error); return r.d; };
  g.sandbox.preparar();
  const clave = g.hojas.Config.v.find(r => r[0] === 'clave')[1];
  const t = ok({ a: 'login', clave }).tk;
  ok({ a: 'curso.guardar', t, nombre: '1° A', alumnos: 'Ana\nBruno' });
  assert.deepStrictEqual(ok({ a: 'cursos' }).map(c => c.nombre), ['1° A']);
  assert.ok(Object.keys(g.cache).some(k => k.startsWith('dat:Cursos:')), 'quedó una copia de Cursos');
  // Si la planilla cambia sin avisar, se sigue viendo la copia (prueba de que no se lee la planilla)...
  g.hojas.Cursos.v[1][1] = 'Cambiado a mano';
  assert.deepStrictEqual(ok({ a: 'cursos' }).map(c => c.nombre), ['1° A']);
  // ...hasta que onEdit avisa.
  g.sandbox.onEdit({ range: { getSheet: () => ({ getName: () => 'Cursos' }) } });
  assert.deepStrictEqual(ok({ a: 'cursos' }).map(c => c.nombre), ['Cambiado a mano']);
  // Escribir desde la app renueva la copia.
  ok({ a: 'curso.guardar', t, nombre: '2° B', alumnos: 'Caro' });
  assert.deepStrictEqual(ok({ a: 'cursos' }).map(c => c.nombre).sort(), ['2° B', 'Cambiado a mano']);
  // Cambiar la contraseña a mano y avisar: la vieja deja de servir.
  g.hojas.Config.v.find(r => r[0] === 'clave')[1] = 'otra-clave-larga';
  g.sandbox.onEdit({ range: { getSheet: () => ({ getName: () => 'Config' }) } });
  assert.ok(!post({ a: 'login', clave }).ok);
  assert.ok(post({ a: 'login', clave: 'otra-clave-larga' }).ok);
  // Una copia partida en varios pedazos se arma bien (preguntas largas).
  const largo = Array.from({ length: 40 }, (_, i) => `${i + 1}. ${'Pregunta larguísima con tildes áéíóú '.repeat(40)}${i}\n*a) bien\nb) mal`).join('\n\n');
  ok({ a: 'banco.guardar', t, titulo: 'Largo', texto: largo });
  const b = ok({ a: 'panel', t }).bancos[0];
  assert.ok(Object.keys(g.cache).some(k => /^dat:Preguntas:[^:]+:1$/.test(k)), 'Preguntas quedó en más de un pedazo');
  assert.strictEqual(ok({ a: 'banco.ver', t, id: b.id }).preguntas.length, 40);
  assert.strictEqual(ok({ a: 'banco.ver', t, id: b.id }).preguntas.length, 40);
});

test('adaptador de Google: una planilla de antes (Alumnos sin columna "vinculo") se completa sola y los alumnos quedan sin teléfono', () => {
  const g = googleFalso();
  vm.createContext(g.sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), g.sandbox);
  const post = body => JSON.parse(g.sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).t);
  const ok = body => { const r = post(body); assert.ok(r.ok, body.a + ': ' + r.error); return r.d; };
  g.sandbox.preparar();
  const t = ok({ a: 'login', clave: g.hojas.Config.v.find(r => r[0] === 'clave')[1] }).tk;
  ok({ a: 'curso.guardar', t, nombre: '1° A', alumnos: 'Ana\nBruno' });
  // Se deja la hoja como estaba antes de esta versión: 4 columnas.
  const h = g.hojas.Alumnos;
  h.v = h.v.map(r => r.slice(0, 4)); h.v[0] = ['id', 'cursoId', 'nombre', 'activo'];
  Object.keys(g.cache).filter(k => /^(cab|dat|ver):Alumnos/.test(k)).forEach(k => delete g.cache[k]);
  const p = ok({ a: 'panel', t });
  assert.deepStrictEqual(h.v[0], ['id', 'cursoId', 'nombre', 'activo', 'vinculo'], 'agrega la columna nueva');
  assert.deepStrictEqual(p.cursos[0].alumnos.map(a => a.vinculado), [false, false]);
  const e = ok({ a: 'entrar', cursoId: p.cursos[0].id, pin: p.cursos[0].pin, device: 'tel-A', alumnoId: p.cursos[0].alumnos[0].id });
  assert.strictEqual(e.alumnoId, p.cursos[0].alumnos[0].id);
  assert.strictEqual(h.v.find(r => r[2] === 'Ana')[4], 'tel-A');
  const otro = ok({ a: 'entrar', cursoId: p.cursos[0].id, pin: p.cursos[0].pin, device: 'tel-B' });
  assert.strictEqual(post({ a: 'soy', t: otro.tk, alumnoId: p.cursos[0].alumnos[0].id }).code, 'vinc');
  ok({ a: 'alumno.liberar', t, id: p.cursos[0].alumnos[0].id });
  assert.strictEqual(h.v.find(r => r[2] === 'Ana')[4], '');
  ok({ a: 'soy', t: otro.tk, alumnoId: p.cursos[0].alumnos[0].id });
});
