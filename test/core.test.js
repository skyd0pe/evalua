const test = require('node:test');
const assert = require('node:assert');
const { api, parseBlock, memCtx, celda, puntos, periodoDe, H4 } = require('../core.js');
const empezados = ctx => ctx.db.all('Intentos').filter(i => i.inicio !== '');   // sin los renglones reservados al abrir

const PREGS = Array.from({ length: 10 }, (_, i) => `${i + 1}. Pregunta ${i}\n*a) bien${i}\nb) mal\nc) peor\nd) nada`).join('\n\n');

// Arma un mundo chico: docente con sesión, un curso de 3, un banco de 10 y una clase.
function mundo() {
  const ctx = memCtx();
  ctx.t = new Date(2027, 2, 8, 10, 0).getTime();   // lunes 8/3/2027 10:00
  ctx.db.insert('Config', { id: 'clave', valor: 'secreta-larga' });
  const ok = (a, d) => { const r = api(ctx, Object.assign({ a }, d)); assert.ok(r.ok, a + ': ' + r.error); return r.d; };
  const mal = (a, d) => { const r = api(ctx, Object.assign({ a }, d)); assert.ok(!r.ok, a + ' debía fallar'); return r; };
  const t = ok('login', { clave: 'secreta-larga', device: 'pc' }).tk;
  const doc = (a, d) => ok(a, Object.assign({ t }, d));
  doc('curso.guardar', { nombre: '1° A', alumnos: 'Ana Díaz\nBruno Paz\nCata Ríos' });
  doc('banco.guardar', { titulo: 'Tema', texto: PREGS });
  let p = doc('panel');
  const curso = p.cursos[0], bancoId = p.bancos[0].id;
  doc('clase.guardar', { cursoIds: [curso.id], bancoId, fecha: '2027-03-08', segundos: 20, porAlumno: 5 });
  const clase = doc('panel').clases[0];
  const entra = (i, dev) => { const e = ok('entrar', { cursoId: curso.id, pin: doc('panel').cursos[0].pin, device: dev || 'tel' + i }); ok('soy', { t: e.tk, alumnoId: curso.alumnos[i].id }); return e.tk; };
  return { ctx, ok, mal, doc, t, curso, bancoId, clase, entra };
}
// Responde bien `aciertos` preguntas y mal el resto. Devuelve el resumen final.
function rendir(w, tk, aciertos) {
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  for (let i = 0; !q.fin; i++) {
    w.ctx.t += 4000;
    const bien = q.opciones.findIndex(o => o.startsWith('bien'));
    q = w.ok('responder', { t: tk, claseId: w.clase.id, pos: q.pos, di: i < aciertos ? bien : (bien + 1) % 4 });
  }
  return q;
}

test('lector: formato básico, numeración y respuesta aparte', () => {
  const p = parseBlock('1. ¿Cuántos son?\na) Cinco\n*b) Siete\n\nPregunta 2: ¿Cuál?\nA. Uno\nB. Dos\nRespuesta: a');
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.questions, [{ text: '¿Cuántos son?', options: ['Cinco', 'Siete'], correct: 1 }, { text: '¿Cuál?', options: ['Uno', 'Dos'], correct: 0 }]);
});
test('lector: no se come números ni citas al principio de la pregunta', () => {
  assert.strictEqual(parseBlock('3:16 es un versículo famoso, ¿de qué evangelio?\n*a) Juan\nb) Lucas').questions[0].text, '3:16 es un versículo famoso, ¿de qué evangelio?');
  assert.strictEqual(parseBlock('1054: ¿qué ocurrió ese año?\n*a) El Cisma\nb) Nada').questions[0].text, '1054: ¿qué ocurrió ese año?');
});
test('lector: opciones numeradas y opción partida en dos renglones', () => {
  const p = parseBlock('1. ¿Cuántos son?\n1) Cinco\n*2) Siete\n3) Diez\n\n2. ¿Qué es?\na) Una opción muy larga\nque sigue abajo\n*b) Otra');
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.questions[0], { text: '¿Cuántos son?', options: ['Cinco', 'Siete', 'Diez'], correct: 1 });
  assert.deepStrictEqual(p.questions[1].options, ['Una opción muy larga que sigue abajo', 'Otra']);
});
test('lector: preguntas pegadas sin renglón en blanco', () => {
  const p = parseBlock('1. Uno\na) x\n*b) y\n2. Dos\n*a) x\nb) y\n¿Tres?\na) x\n*b) y');
  assert.deepStrictEqual(p.questions.map(q => q.text + q.correct), ['Uno1', 'Dos0', '¿Tres?1']);
});
test('lector: avisa los errores en vez de guardar mal', () => {
  assert.match(parseBlock('P\na) x\nb) y').errors[0], /falta marcar/);
  assert.match(parseBlock('P\n*a) x\n*b) y').errors[0], /más de una/);
  assert.match(parseBlock('P\n*a) sola').errors[0], /al menos dos/);
  assert.match(parseBlock('1. Uno\n1) x\n*2) y\n2. Dos\n*1) x\n2) y').errors[0], /renglón en blanco/);
  assert.strictEqual(parseBlock('P\na) x\n*b) Todas las anteriores').warnings.length, 1);
});

test('PIN: 4 números, igual durante 4 horas, distinto después, y el viejo deja de servir', () => {
  const w = mundo(), pin = w.doc('panel').cursos[0].pin;
  assert.match(pin, /^\d{4}$/);
  w.ctx.t += H4 - 60000;
  assert.strictEqual(w.doc('panel').cursos[0].pin, pin);
  w.ctx.t += 120000;                                   // pasaron 4 h y un minuto: sin que el docente abra el panel, no hay PIN válido
  assert.strictEqual(w.mal('entrar', { cursoId: w.curso.id, pin, device: 'x' }).code, 'pin');
  w.ok('login', { clave: 'secreta-larga', device: 'pc2' });
  const t2 = w.ok('login', { clave: 'secreta-larga', device: 'pc2' }).tk;   // la sesión del docente dura 6 h; pide una nueva por las dudas
  const nuevo = w.ok('panel', { t: t2 }).cursos[0];
  assert.ok(nuevo.vence > w.ctx.t);
  w.ok('entrar', { cursoId: w.curso.id, pin: nuevo.pin, device: 'x' });
});
test('PIN: sin PIN no se ve la lista de alumnos, y los intentos fallidos se frenan', () => {
  const w = mundo(), bueno = w.doc('panel').cursos[0].pin, malo = bueno === '0000' ? '1111' : '0000';
  assert.deepStrictEqual(Object.keys(w.ok('cursos')[0]).sort(), ['id', 'nombre']);
  for (let i = 0; i < 8; i++) assert.strictEqual(w.mal('entrar', { cursoId: w.curso.id, pin: malo, device: 'd1' }).code, 'pin');
  assert.strictEqual(w.mal('entrar', { cursoId: w.curso.id, pin: bueno, device: 'd1' }).code, 'lim');
  assert.strictEqual(w.ok('entrar', { cursoId: w.curso.id, pin: bueno, device: 'd2' }).alumnos.length, 3);
});
test('permisos: un alumno no puede usar acciones de docente ni ver el PIN', () => {
  const w = mundo(), tk = w.entra(0);
  for (const a of ['panel', 'resultados', 'asistencia', 'clase.estado', 'banco.ver', 'intento.reiniciar', 'pin.nuevo', 'curso.guardar'])
    assert.strictEqual(w.mal(a, { t: tk, claseId: w.clase.id, cursoId: w.curso.id, id: w.clase.id }).code, 'rol', a);
  assert.strictEqual(w.mal('panel', {}).code, 'ses');
  assert.ok(!JSON.stringify(w.ok('inicio', { t: tk })).includes(w.doc('panel').cursos[0].pin + '"'));
  assert.strictEqual(w.mal('login', { clave: 'otra', device: 'z' }).error, 'Contraseña incorrecta.');
});

test('cuestionario: cerrado no se rinde; abierto manda preguntas sin la respuesta correcta', () => {
  const w = mundo(), tk = w.entra(0);
  assert.strictEqual(w.mal('empezar', { t: tk, claseId: w.clase.id }).code, 'cerrado');
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  const q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  assert.deepStrictEqual(Object.keys(q).sort(), ['lectura', 'n', 'opciones', 'pos', 'restante', 'segundos', 'siguiente', 'texto']);
  assert.strictEqual(q.n, 5); assert.strictEqual(q.opciones.length, 4);
  assert.strictEqual(q.restante, 25000, '5 s de lectura + 20 s para responder');
  assert.ok(q.siguiente.startsWith('Pregunta '), 'trae el texto de la siguiente');
  w.ctx.t += 3000;
  const q2 = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: 0, ms: 1000 });
  assert.strictEqual(q2.texto, q.siguiente, 'la que viene es la que se anunció');
});
test('cuestionario: se guarda pregunta por pregunta y se corrige en el servidor', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  const r = rendir(w, tk, 3);
  assert.deepStrictEqual(r, { fin: true, aciertos: 3, total: 5, puntos: 60 });
  assert.strictEqual(Object.keys(JSON.parse(empezados(w.ctx)[0].resp)).length, 5);
  assert.strictEqual(w.mal('empezar', { t: tk, claseId: w.clase.id }).code, 'hecho');   // una sola vez
  assert.strictEqual(empezados(w.ctx).length, 1);
});
test('tiempo: el teléfono informa lo que tardó y el servidor pone un tope', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  const bien = () => q.opciones.findIndex(o => o.startsWith('bien'));
  w.ctx.t += 30000;                                    // 30 s en el servidor (5 de lectura + red), pero el alumno tardó 18
  q = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: bien(), ms: 18000 });
  w.ctx.t += 5000;                                     // el teléfono dice 21 s: pasado de tiempo
  q = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 1, di: bien(), ms: 21000 });
  w.ctx.t += 40000;                                    // el teléfono miente (dice 5 s) pero pasaron 40: el servidor lo corta
  w.ok('responder', { t: tk, claseId: w.clase.id, pos: 2, di: bien(), ms: 5000 });
  const r = Object.values(JSON.parse(empezados(w.ctx)[0].resp));
  assert.deepStrictEqual(r.map(x => x[0] === null ? 'tarde' : 'ok'), ['ok', 'tarde', 'tarde']);
  assert.strictEqual(r[0][1], 18000);
});
test('tiempo: lo mide el servidor; una respuesta tardía cuenta como sin responder', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  w.ctx.t += 60000;                                     // el teléfono "frenó" su reloj un minuto
  w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: q.opciones.findIndex(o => o.startsWith('bien')) });
  assert.deepStrictEqual(Object.values(JSON.parse(empezados(w.ctx)[0].resp)), [[null, 20000]]);
});
test('reconexión: recargar no borra el intento, y la pregunta que estaba en pantalla se pierde', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  w.ctx.t += 3000; q = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: 0 });
  assert.strictEqual(q.pos, 1);
  w.ctx.t += 2000;
  assert.strictEqual(w.ok('empezar', { t: tk, claseId: w.clase.id }).pos, 1);   // reintento rápido: misma pregunta, el reloj sigue
  w.ctx.t += 8000;
  assert.strictEqual(w.ok('empezar', { t: tk, claseId: w.clase.id }).pos, 2);   // salió y volvió: la 1 quedó sin responder
  assert.strictEqual(Object.values(JSON.parse(empezados(w.ctx)[0].resp))[1][0], null);
  assert.strictEqual(empezados(w.ctx).length, 1);
});
test('reenvío: la misma respuesta mandada dos veces se guarda una sola', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  w.ok('empezar', { t: tk, claseId: w.clase.id });
  const a = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: 1 });
  const b = w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: 2 });
  assert.strictEqual(a.pos, 1); assert.strictEqual(b.pos, 1); assert.strictEqual(a.texto, b.texto);
  assert.strictEqual(Object.keys(JSON.parse(empezados(w.ctx)[0].resp)).length, 1);
});
test('si se pierde la memoria rápida, el intento se reconstruye desde la planilla', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: q.opciones.findIndex(o => o.startsWith('bien')) });
  const it = empezados(w.ctx)[0];
  w.ctx.cache.remove('st:' + it.id); w.ctx.cache.remove('it:' + it.claseId + ':' + it.alumnoId);
  assert.strictEqual(w.ok('empezar', { t: tk, claseId: w.clase.id }).pos, 1);
  assert.strictEqual(empezados(w.ctx).length, 1);
});
test('cerrar: los intentos a medias se cierran con lo respondido; la corrección se ve recién al cerrar', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  let q = w.ok('empezar', { t: tk, claseId: w.clase.id });
  w.ok('responder', { t: tk, claseId: w.clase.id, pos: 0, di: q.opciones.findIndex(o => o.startsWith('bien')) });
  assert.match(w.mal('revision', { t: tk, claseId: w.clase.id }).error, /cuando tu profe cierre/);
  w.doc('clase.estado', { id: w.clase.id, estado: 'cerrado' });
  assert.deepStrictEqual(w.ok('responder', { t: tk, claseId: w.clase.id, pos: 1, di: 0 }), { fin: true, aciertos: 1, total: 5, puntos: 20 });
  const rev = w.ok('revision', { t: tk, claseId: w.clase.id });
  assert.strictEqual(rev.items.length, 5); assert.strictEqual(rev.items.filter(i => i.ok).length, 1);
});

test('asistencia: la regla de cada celda', () => {
  assert.strictEqual(celda(null, ''), 'A');
  assert.strictEqual(celda({ enCasa: 'false' }, ''), 'P');
  assert.strictEqual(celda({ enCasa: 'true' }, ''), 'H');
  assert.strictEqual(celda(null, 'P'), 'P');
  assert.strictEqual(celda({ enCasa: 'false' }, 'T'), 'T');
  assert.strictEqual(celda(null, 'J'), 'J');
});
test('asistencia: una clase preparada sin abrir no es falta; tarde cuenta, justificado no; en casa sigue ausente', () => {
  const w = mundo(), [ana, bruno, cata] = w.curso.alumnos;
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  rendir(w, w.entra(0), 5);
  w.doc('clase.estado', { id: w.clase.id, estado: 'cerrado' });
  w.doc('clase.guardar', { cursoIds: [w.curso.id], bancoId: w.bancoId, fecha: '2027-03-15', segundos: 20, porAlumno: 5 });   // preparada, sin abrir
  let a = w.doc('asistencia', { cursoId: w.curso.id });
  assert.strictEqual(a.clases.length, 1);
  assert.deepStrictEqual(a.filas.map(f => [f.celdas[0].k, f.pct]), [['P', 100], ['A', 0], ['A', 0]]);
  w.doc('marca', { claseId: w.clase.id, alumnoId: bruno.id, estado: 'T' });
  w.doc('marca', { claseId: w.clase.id, alumnoId: cata.id, estado: 'J' });
  a = w.doc('asistencia', { cursoId: w.curso.id });
  assert.deepStrictEqual(a.filas.map(f => [f.celdas[0].k, f.pct]), [['P', 100], ['T', 100], ['J', null]]);
  w.doc('marca', { claseId: w.clase.id, alumnoId: bruno.id, estado: '' });
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto', ausentes: true });   // reabierta para los que faltaron
  rendir(w, w.entra(1), 4);
  a = w.doc('asistencia', { cursoId: w.curso.id });
  assert.deepStrictEqual([a.filas[1].celdas[0].k, a.filas[1].celdas[0].nota, a.filas[1].pct, a.filas[1].nota], ['H', '4/5', 0, 8]);
  assert.strictEqual(a.filas[0].nota, 10);
});
test('clase sin cuestionario: cuenta para la asistencia y se marca a mano', () => {
  const w = mundo();
  w.doc('clase.guardar', { cursoIds: [w.curso.id], titulo: 'Película', fecha: '2027-03-10' });
  const sin = w.doc('panel').clases.find(c => !c.bancoId);
  w.doc('marca.todos', { claseId: sin.id });
  w.doc('marca', { claseId: sin.id, alumnoId: w.curso.alumnos[2].id, estado: '' });
  const a = w.doc('asistencia', { cursoId: w.curso.id });
  assert.deepStrictEqual(a.filas.map(f => f.pct), [100, 100, 0]);
});

test('puntos: cada cuestionario vale hasta 100, tenga 5 o 10 preguntas', () => {
  assert.strictEqual(puntos(5, 5), 100); assert.strictEqual(puntos(10, 10), 100); assert.strictEqual(puntos(3, 8), 38); assert.strictEqual(puntos(0, 0), 0);
});
test('tabla: suma por cuatrimestre, empates comparten puesto, y se puede ocultar', () => {
  const w = mundo();
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  const tks = [w.entra(0), w.entra(1), w.entra(2)];
  rendir(w, tks[0], 5); rendir(w, tks[1], 3); rendir(w, tks[2], 3);
  w.ctx.t += 31000;                                    // la tabla se recalcula cada 30 s
  const t = w.ok('tabla', { t: tks[1] });
  assert.deepStrictEqual(t.mio.map(f => [f.pos, f.pts, f.yo]), [[1, 100, false], [2, 60, true], [2, 60, false]]);
  assert.strictEqual(t.cursos[0].pts, 73);            // promedio por intento, no suma
  assert.strictEqual(w.ok('inicio', { t: tks[1] }).puesto, 2);
  w.doc('curso.guardar', { id: w.curso.id, nombre: '1° A', oculta: true });
  w.ctx.t += 31000;
  assert.match(w.mal('tabla', { t: tks[1] }).error, /ocultó/);
  assert.strictEqual(w.ok('inicio', { t: tks[1] }).tabla, false);
  assert.strictEqual(periodoDe('2027-03-08', '07-15'), '2027-1'); assert.strictEqual(periodoDe('2027-08-02', '07-15'), '2027-2');
  w.ctx.t = new Date(2027, 7, 2, 10).getTime();        // agosto: segundo cuatrimestre, la tabla arranca de cero
  const tk2 = w.ok('login', { clave: 'secreta-larga', device: 'pc3' }).tk, c2 = w.ok('panel', { t: tk2 }).cursos[0];
  const e = w.ok('entrar', { cursoId: c2.id, pin: c2.pin, device: 'telx', alumnoId: c2.alumnos[0].id });
  assert.strictEqual(w.ok('inicio', { t: e.tk }).puntos, 0);
});
test('anular una pregunta o corregir cuál era la correcta recalcula las notas', () => {
  const w = mundo(), tk = w.entra(0);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  rendir(w, tk, 3);
  const it = () => empezados(w.ctx)[0], orden = JSON.parse(it().orden);
  w.doc('pregunta.anular', { id: orden[4][0], anulada: true });          // la quinta estaba mal respondida
  assert.deepStrictEqual([it().aciertos, it().total], ['3', '4']);
  w.doc('pregunta.guardar', { id: orden[3][0], texto: 'Pregunta corregida\na) bien\n*b) mal\nc) peor\nd) nada' });   // la cuarta: ahora la correcta es otra
  assert.ok(Number(it().aciertos) >= 3 && Number(it().aciertos) <= 4);
  assert.match(w.mal('pregunta.guardar', { t: w.t, id: orden[0][0], texto: 'P\n*a) x\nb) y' }).error, /no agregar ni quitar/);
});
test('cursos: nombres repetidos dan error en vez de borrarse; dar de baja conserva el historial', () => {
  const w = mundo();
  assert.match(w.mal('curso.guardar', { t: w.t, nombre: 'X', alumnos: 'Juan Pérez\nJuan Pérez' }).error, /repetidos: Juan Pérez/);
  assert.match(w.mal('curso.guardar', { t: w.t, id: w.curso.id, nombre: '1° A', alumnos: 'ana díaz' }).error, /repetidos/);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  rendir(w, w.entra(0), 5);
  w.doc('alumno.guardar', { id: w.curso.alumnos[0].id, nombre: 'Ana María Díaz' });
  w.doc('alumno.guardar', { id: w.curso.alumnos[1].id, baja: true });
  assert.deepStrictEqual(w.doc('panel').cursos[0].alumnos.map(a => a.nombre), ['Ana María Díaz', 'Cata Ríos']);
  assert.strictEqual(w.doc('resultados', { claseId: w.clase.id }).filas[0].puntos, 100);
});
test('el mismo banco se usa en varios cursos, y dos alumnos en un mismo teléfono quedan señalados', () => {
  const w = mundo();
  w.doc('curso.guardar', { nombre: '2° B', alumnos: 'Dani\nEli' });
  const ids = w.doc('panel').cursos.map(c => c.id);
  w.doc('clase.guardar', { cursoIds: ids, bancoId: w.bancoId, fecha: '2027-03-09', segundos: 20, porAlumno: 5 });
  assert.strictEqual(w.doc('panel').clases.filter(c => c.fecha === '2027-03-09').length, 2);
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  rendir(w, w.entra(0, 'mismo'), 2); rendir(w, w.entra(1, 'mismo'), 2);
  const v = w.doc('vivo', { claseId: w.clase.id });
  assert.deepStrictEqual(v.filas.map(f => [f.e, f.dup || '']), [['listo', 'Bruno Paz'], ['listo', 'Ana Díaz'], ['no', '']]);
});

test('al abrir se reserva un renglón por alumno; no cuenta como intento ni como falta, y Empezar lo completa', () => {
  const w = mundo();
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto' });
  assert.strictEqual(w.ctx.db.all('Intentos').length, 3);
  assert.strictEqual(empezados(w.ctx).length, 0);
  assert.deepStrictEqual(w.doc('vivo', { claseId: w.clase.id }).filas.map(f => f.e), ['no', 'no', 'no']);
  rendir(w, w.entra(0), 2);
  assert.strictEqual(w.ctx.db.all('Intentos').length, 3, 'Empezar completa el renglón reservado, no agrega otro');
  w.doc('clase.estado', { id: w.clase.id, estado: 'cerrado' });
  w.doc('clase.estado', { id: w.clase.id, estado: 'abierto', ausentes: true });
  assert.strictEqual(w.ctx.db.all('Intentos').length, 3, 'reabrir no duplica las reservas');
  const a = w.doc('asistencia', { cursoId: w.curso.id });
  assert.deepStrictEqual(a.filas.map(f => f.celdas[0].k), ['P', 'A', 'A']);
  const it = empezados(w.ctx)[0];
  w.doc('intento.reiniciar', { id: it.id });
  assert.strictEqual(empezados(w.ctx).length, 0, 'reiniciar deja el renglón reservado otra vez');
  rendir(w, w.entra(0), 1);
  assert.strictEqual(empezados(w.ctx).length, 1);
});
test('carga: 35 alumnos rindiendo intercalados, sin intentos duplicados ni respuestas perdidas', () => {
  const ctx = memCtx(); ctx.t = new Date(2027, 2, 8, 10).getTime();
  ctx.db.insert('Config', { id: 'clave', valor: 'x' });
  const ok = (a, d) => { const r = api(ctx, Object.assign({ a }, d)); assert.ok(r.ok, a + ': ' + r.error); return r.d; };
  const t = ok('login', { clave: 'x', device: 'pc' }).tk;
  ok('curso.guardar', { t, nombre: 'C', alumnos: Array.from({ length: 35 }, (_, i) => 'Alumno ' + String(i).padStart(2, '0')).join('\n') });
  ok('banco.guardar', { t, titulo: 'T', texto: Array.from({ length: 20 }, (_, i) => `${i + 1}. P${i}\n*a) bien\nb) mal`).join('\n\n') });
  let p = ok('panel', { t });
  ok('clase.guardar', { t, cursoIds: [p.cursos[0].id], bancoId: p.bancos[0].id, fecha: '2027-03-08', segundos: 20, porAlumno: 8 });
  p = ok('panel', { t }); const claseId = p.clases[0].id;
  ok('clase.estado', { t, id: claseId, estado: 'abierto' });
  const al = p.cursos[0].alumnos.map((a, i) => { const e = ok('entrar', { cursoId: p.cursos[0].id, pin: p.cursos[0].pin, device: 'd' + i }); ok('soy', { t: e.tk, alumnoId: a.id }); return { tk: e.tk, q: null, fin: null }; });
  al.forEach(a => { a.q = ok('empezar', { t: a.tk, claseId }); ok('empezar', { t: a.tk, claseId }); });   // doble toque en "Empezar"
  let vivos = al.length;
  while (vivos) for (const a of al) {
    if (a.fin) continue;
    ctx.t += 100;
    const r = ok('responder', { t: a.tk, claseId, pos: a.q.pos, di: a.q.opciones.indexOf('bien') });
    if (r.fin) { a.fin = r; vivos--; } else a.q = r;
  }
  assert.strictEqual(empezados(ctx).length, 35);
  assert.strictEqual(empezados(ctx).reduce((s, i) => s + Object.keys(JSON.parse(i.resp)).length, 0), 35 * 8);
  assert.ok(al.every(a => a.fin.puntos === 100));
  const ordenes = new Set(empezados(ctx).map(i => JSON.parse(i.orden).map(x => x[0]).sort().join()));
  assert.ok(ordenes.size > 25, 'casi todos deberían recibir un juego distinto de preguntas: ' + ordenes.size);
});

test('lote: varios pedidos en una llamada, con la sesión que entrega el login y cortando en el primer error', () => {
  const w = mundo();
  const r = api(w.ctx, { a: 'lote', pasos: [{ a: 'login', clave: 'secreta-larga' }, { a: 'panel' }] });
  assert.ok(r.ok);
  assert.ok(r.d[0].ok && r.d[1].ok, 'el panel usa la sesión recién creada');
  assert.strictEqual(r.d[1].d.cursos.length, 1);
  const pin = w.doc('panel').cursos[0].pin;
  const e = api(w.ctx, { a: 'lote', device: 'telX', pasos: [{ a: 'entrar', cursoId: w.curso.id, pin }, { a: 'soy', alumnoId: w.curso.alumnos[0].id }, { a: 'inicio' }] });
  assert.ok(e.d.every(x => x.ok), JSON.stringify(e.d.map(x => x.error)));
  assert.strictEqual(e.d[2].d.alumno, 'Ana Díaz');
  const m = api(w.ctx, { a: 'lote', t: w.t, pasos: [{ a: 'clase.estado', id: 'no-existe', estado: 'abierto' }, { a: 'panel' }] });
  assert.strictEqual(m.d.length, 1, 'después de un error no sigue');
  assert.ok(!m.d[0].ok);
  const sin = api(w.ctx, { a: 'lote', pasos: [{ a: 'panel' }] });
  assert.ok(!sin.d[0].ok, 'sin sesión no hay panel');
  const anidado = api(w.ctx, { a: 'lote', t: w.t, pasos: [{ a: 'lote', pasos: [] }] });
  assert.ok(!anidado.d[0].ok);
  const largo = api(w.ctx, { a: 'lote', t: w.t, pasos: Array.from({ length: 20 }, () => ({ a: 'panel' })) });
  assert.strictEqual(largo.d.length, 6);
});
