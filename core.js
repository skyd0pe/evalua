/* Evaluá: reglas del servidor.
   Este mismo archivo corre en Google Apps Script (producción), en Node (tests) y en el navegador (modo demostración).
   No contiene datos ni secretos: los datos viven en la planilla. */

var TABLAS = {
  Config: ['id', 'valor'],
  Cursos: ['id', 'nombre', 'ocultarTabla'],
  Alumnos: ['id', 'cursoId', 'nombre', 'activo'],
  Bancos: ['id', 'titulo'],
  Preguntas: ['id', 'bancoId', 'texto', 'opciones', 'correcta', 'anulada'],
  Clases: ['id', 'cursoId', 'bancoId', 'titulo', 'fecha', 'segundos', 'porAlumno', 'estado', 'modo'],
  Intentos: ['id', 'claseId', 'alumnoId', 'inicio', 'fin', 'orden', 'aciertos', 'total', 'enCasa', 'salidas', 'device', 'resp'],
  Marcas: ['id', 'claseId', 'alumnoId', 'estado'],
  Pines: ['id', 'pin', 'vence']
};
var H4 = 4 * 3600 * 1000;   // duración de un PIN
var GRACIA = 8000;          // margen por la demora de la red: en Google cada pedido tarda 3 a 5 segundos
var LECTURA = 5000;         // la pregunta se muestra sola, en grande, antes de las opciones
var REINTENTO = 5000;       // un pedido repetido antes de este tiempo es un reintento, no una reconexión

/* ---------- utilidades ---------- */
function E(msg, code) { var e = new Error(msg); e.user = true; e.code = code || ''; return e; }
function num(x) { return Number(x) || 0; }
function si(x) { return x === true || x === 'true' || x === 'TRUE'; }
function J(x, d) { try { return JSON.parse(x); } catch (e) { return d; } }
function uuid() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) return Utilities.getUuid();
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
}
function uno(ctx, t, id) { return ctx.db.all(t).filter(function (r) { return r.id === id; })[0]; }
function nid(ctx, p) { return p + ctx.rand().replace(/-/g, '').slice(0, 10); }
function azar(ctx) { return parseInt(ctx.rand().replace(/-/g, '').slice(0, 8), 16) / 4294967296; }
function mezclar(ctx, a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(azar(ctx) * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function cget(ctx, k) { var v = ctx.cache.get(k); return v ? J(v, null) : null; }
function cput(ctx, k, v, ttl) { ctx.cache.put(k, JSON.stringify(v), ttl); }
function puntos(aciertos, total) { return total > 0 ? Math.round(100 * aciertos / total) : 0; }
function porNombre(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }
function fechaOk(f) { return /^\d{4}-\d{2}-\d{2}$/.test(String(f || '')); }

/* ---------- lector de preguntas pegadas ----------
   1. Pregunta            (la numeración es opcional)
   a) opción              (letras a-h o números 1-9)
   *b) opción correcta    (asterisco adelante o atrás; también "Respuesta: b")
   Con opciones numeradas, las preguntas se separan con un renglón en blanco. */
function parseBlock(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n'), raw = [], cur = null;
  var reL = /^(\*)?\s*([a-hA-H])\s*(?:\)\s*|[.\-]\s+)(.+?)\s*(\*)?$/;
  var reN = /^(\*)?\s*([1-9])\s*(?:\)\s*|[.\-]\s+)(.+?)\s*(\*)?$/;
  var reAns = /^(?:respuesta|rta|correcta)\s*[:\-]?\s*([a-hA-H1-9])\s*[\).]?$/i;
  var reNum = /^(?:pregunta\s*\d+\s*[:\)\.\-]|\d+\s*[\)\.\-])\s+/i;
  function push() { if (cur) { raw.push(cur); cur = null; } }
  function nueva(line) { cur = { text: line.replace(reNum, ''), options: [], ans: null, mode: null }; }
  lines.forEach(function (l) {
    var line = l.trim(), m;
    if (!line) { push(); return; }
    if (!cur) { nueva(line); return; }
    if ((m = line.match(reAns))) { cur.ans = m[1].toLowerCase(); return; }
    m = cur.mode === 'n' ? line.match(reN) : cur.mode === 'l' ? line.match(reL) : (line.match(reL) || line.match(reN));
    if (m) {
      if (!cur.mode) cur.mode = /\d/.test(m[2]) ? 'n' : 'l';
      cur.options.push({ text: m[3], key: m[2].toLowerCase(), marked: !!(m[1] || m[4]) });
      return;
    }
    if (!cur.options.length) { cur.text += ' ' + line; return; }
    if (cur.mode === 'l' && (reNum.test(line) || line.charAt(0) === '¿')) { push(); nueva(line); return; }
    var last = cur.options[cur.options.length - 1];           // opción partida en dos renglones
    if (/\*$/.test(line)) { last.marked = true; line = line.replace(/\s*\*$/, ''); }
    last.text += ' ' + line;
  });
  push();
  var questions = [], errors = [], warnings = [];
  raw.forEach(function (q, idx) {
    var n = idx + 1, keys = {};
    if (q.ans) q.options.forEach(function (o) { if (o.key === q.ans) o.marked = true; });
    var rep = q.options.some(function (o) { var r = keys[o.key]; keys[o.key] = 1; return r; });
    var marked = q.options.filter(function (o) { return o.marked; });
    if (rep) { errors.push('Pregunta ' + n + ': hay opciones repetidas. Separá cada pregunta de la siguiente con un renglón en blanco.'); return; }
    if (q.options.length < 2) { errors.push('Pregunta ' + n + ': necesita al menos dos opciones, cada una en su renglón con la letra o el número adelante.'); return; }
    if (marked.length === 0) { errors.push('Pregunta ' + n + ': falta marcar la opción correcta con un asterisco (*).'); return; }
    if (marked.length > 1) { errors.push('Pregunta ' + n + ': hay más de una opción marcada como correcta.'); return; }
    if (q.options.some(function (o) { return /anteriores|todas las opciones|ninguna de las/i.test(o.text); }))
      warnings.push('Pregunta ' + n + ': como el orden se mezcla, una opción del tipo "todas las anteriores" puede quedar primera y no entenderse.');
    questions.push({ text: q.text, options: q.options.map(function (o) { return o.text; }), correct: q.options.indexOf(marked[0]) });
  });
  return { questions: questions, errors: errors, warnings: warnings };
}

/* ---------- configuración y períodos ---------- */
function cfg(ctx, k, def) { var r = uno(ctx, 'Config', k); return r && r.valor !== '' ? r.valor : def; }
function corteDe(ctx) { return cfg(ctx, 'corte', '07-15'); }
function periodoDe(fecha, corte) { return fecha.slice(0, 4) + (fecha.slice(5) < corte ? '-1' : '-2'); }
function periodoHoy(ctx) { return periodoDe(ctx.hoy(), corteDe(ctx)); }

/* ---------- límites de intentos y sesiones ---------- */
function limite(ctx, k, max, msg) { if (num(ctx.cache.get('lim:' + k)) >= max) throw E(msg, 'lim'); }
function falla(ctx, k) { ctx.cache.put('lim:' + k, String(num(ctx.cache.get('lim:' + k)) + 1), 600); }
function abrirSesion(ctx, s, ttl) { var tk = ctx.rand() + ctx.rand(); s.ttl = ttl; cput(ctx, 'ses:' + tk, s, ttl); return tk; }
function sesion(ctx, r, rol) {
  var s = r.t && cget(ctx, 'ses:' + r.t);
  if (!s) throw E('Tu sesión venció. Volvé a entrar.', 'ses');
  if (rol === 'docente' && s.rol !== 'docente') throw E('Esta parte es solo para el docente.', 'rol');
  if (rol === 'alumno' && (s.rol !== 'alumno' || !s.alumnoId)) throw E('Primero elegí tu nombre.', 'ses');
  return s;
}

/* ---------- PIN por curso: 4 números al azar, válido 4 horas.
   Solo se genera cuando el docente abre su panel; los alumnos nunca lo reciben del servidor. */
function pinDe(ctx, cursoId, crear) {
  var p = uno(ctx, 'Pines', cursoId);
  if (p && num(p.vence) > ctx.now()) return p;
  if (!crear) return null;
  var n = { id: cursoId, pin: ('000' + Math.floor(azar(ctx) * 10000)).slice(-4), vence: ctx.now() + H4 };
  if (p) ctx.db.update('Pines', cursoId, n); else ctx.db.insert('Pines', n);
  return n;
}
function activos(ctx, cursoId) {
  return ctx.db.all('Alumnos').filter(function (a) { return a.cursoId === cursoId && si(a.activo); }).sort(porNombre);
}

/* ---------- bancos de preguntas y corrección ---------- */
function banco(ctx, id) {
  var b = cget(ctx, 'bk:' + id);
  if (b) return b;
  b = ctx.db.all('Preguntas').filter(function (q) { return q.bancoId === id; }).map(function (q) {
    return { id: q.id, texto: q.texto, ops: J(q.opciones, []), ok: num(q.correcta), anulada: si(q.anulada) };
  });
  cput(ctx, 'bk:' + id, b, 600);
  return b;
}
function pregDe(b, id) { for (var i = 0; i < b.length; i++) if (b[i].id === id) return b[i]; return null; }
/* Corrige un intento. `resp` es {pregId: opción elegida}. Las preguntas anuladas no cuentan. */
function corregir(b, orden, resp) {
  var ok = 0, total = 0;
  orden.forEach(function (p) {
    var q = pregDe(b, p[0]);
    if (!q || q.anulada) return;
    total++;
    var e = resp[p[0]];
    if (e !== undefined && e !== '' && e !== null && num(e) === q.ok) ok++;
  });
  return { ok: ok, total: total };
}
/* Las respuestas de un intento viven en su propio renglón, columna "resp": {pregId: [opción elegida o null, milisegundos]}.
   Así, mientras los alumnos rinden, cada uno escribe solo en su renglón y nadie agrega renglones. */
function respDe(it) { return J(it.resp, {}) || {}; }
function respuestasDe(ctx, ids) {   // {intentoId: {pregId: {e, ms}}}
  var out = {};
  ctx.db.all('Intentos').forEach(function (it) {
    if (!ids[it.id]) return;
    var r = respDe(it), m = out[it.id] = {};
    Object.keys(r).forEach(function (k) { m[k] = { e: r[k][0], ms: num(r[k][1]) }; });
  });
  return out;
}
function eleg(a) { return a && a.e !== null && a.e !== '' && a.e !== undefined ? num(a.e) : null; }
function soloElegidas(m) { var o = {}; Object.keys(m || {}).forEach(function (k) { o[k] = eleg(m[k]); }); return o; }
function recalcular(ctx, bancoId) {   // después de corregir o anular una pregunta
  ctx.cache.remove('bk:' + bancoId);
  var b = banco(ctx, bancoId), cls = {}, ids = {};
  ctx.db.all('Clases').forEach(function (c) { if (c.bancoId === bancoId) cls[c.id] = 1; });
  var its = ctx.db.all('Intentos').filter(function (it) { return cls[it.claseId] && it.fin; });
  its.forEach(function (it) { ids[it.id] = 1; });
  var resp = respuestasDe(ctx, ids);
  its.forEach(function (it) {
    var g = corregir(b, J(it.orden, []), soloElegidas(resp[it.id]));
    if (g.ok !== num(it.aciertos) || g.total !== num(it.total)) {
      ctx.db.update('Intentos', it.id, { aciertos: g.ok, total: g.total });
      ctx.cache.remove('st:' + it.id);
    }
  });
}

/* ---------- el intento de un alumno, pregunta por pregunta ---------- */
function guardarSt(ctx, st) { ctx.cache.put('it:' + st.claseId + ':' + st.alumnoId, st.id, 7200); cput(ctx, 'st:' + st.id, st, 7200); }
function estado(ctx, claseId, alumnoId) {   // de la memoria rápida o, si no está, reconstruido desde la planilla
  var id = ctx.cache.get('it:' + claseId + ':' + alumnoId), st = id && cget(ctx, 'st:' + id);
  if (st) return st;
  var it = ctx.db.all('Intentos').filter(function (x) { return x.claseId === claseId && x.alumnoId === alumnoId; })[0];
  if (!it) return null;
  var cl = uno(ctx, 'Clases', claseId), orden = J(it.orden, []), ids = {};
  ids[it.id] = 1;
  var m = respuestasDe(ctx, ids)[it.id] || {};
  st = { id: it.id, claseId: claseId, alumnoId: alumnoId, bancoId: cl.bancoId, seg: num(cl.segundos), orden: orden,
    pos: Object.keys(m).length, enviada: 0, ok: corregir(banco(ctx, cl.bancoId), orden, soloElegidas(m)).ok, salidas: num(it.salidas), resp: respDe(it) };
  if (it.fin) { st.fin = true; st.ok = num(it.aciertos); st.total = num(it.total); }
  guardarSt(ctx, st);
  return st;
}
/* Lo único que viaja al teléfono: la pregunta, sus opciones y el texto de la siguiente (nunca la correcta).
   Con el texto de la siguiente, el teléfono la muestra en grande apenas el alumno responde, mientras la respuesta
   viaja a Google: así la espera queda escondida en los segundos de lectura.
   restante = lectura + segundos que le quedan, contando desde que el servidor la mandó. */
function vista(ctx, st) {
  var b = banco(ctx, st.bancoId), par = st.orden[st.pos], q = pregDe(b, par[0]), sig = st.orden[st.pos + 1];
  return { pos: st.pos, n: st.orden.length, texto: q.texto, opciones: par[1].map(function (i) { return q.ops[i]; }),
    siguiente: sig ? pregDe(b, sig[0]).texto : '', lectura: LECTURA, segundos: st.seg,
    restante: Math.max(0, LECTURA + st.seg * 1000 - (ctx.now() - st.enviada)) };
}
function resumen(st) { return { fin: true, aciertos: st.ok, total: st.total, puntos: puntos(st.ok, st.total) }; }
function cerrarIntento(ctx, st) {
  var b = banco(ctx, st.bancoId);
  st.total = st.orden.filter(function (p) { var q = pregDe(b, p[0]); return q && !q.anulada; }).length;
  st.fin = true;
  ctx.db.update('Intentos', st.id, { fin: ctx.now(), aciertos: st.ok, total: st.total, salidas: st.salidas });
}
function anotar(ctx, st, elegida, ms) {   // guarda una respuesta en el renglón del intento y avanza
  var par = st.orden[st.pos], q = pregDe(banco(ctx, st.bancoId), par[0]);
  st.resp = st.resp || {};
  st.resp[par[0]] = [elegida == null ? null : elegida, Math.round(ms)];
  ctx.db.update('Intentos', st.id, { resp: JSON.stringify(st.resp) });
  if (q && !q.anulada && elegida === q.ok) st.ok++;
  st.pos++;
  st.enviada = 0;
  if (st.pos >= st.orden.length) cerrarIntento(ctx, st);
}

/* ---------- asistencia: una sola regla para la grilla y para la planilla ----------
   P presente · T tarde (cuenta como presente) · J justificado (no cuenta) · H ausente que rindió en casa · A ausente */
function celda(intento, marca) {
  if (marca === 'T' || marca === 'J') return marca;
  if (intento && !si(intento.enCasa)) return 'P';
  if (marca === 'P') return 'P';
  if (intento) return 'H';
  return 'A';
}
function cuentaComoClase(c) { return c.estado !== 'nuevo'; }   // una clase preparada y sin abrir no es una falta

/* ---------- tabla de posiciones del cuatrimestre ---------- */
function tablaDe(ctx, per) {
  var t = cget(ctx, 'tabla:' + per);
  if (t) return t;
  var corte = corteDe(ctx), cl = {}, pts = {}, sum = {}, n = {};
  ctx.db.all('Clases').forEach(function (c) { if (periodoDe(c.fecha, corte) === per) cl[c.id] = c.cursoId; });
  ctx.db.all('Intentos').forEach(function (it) {
    var c = cl[it.claseId];
    if (!c || !it.fin) return;
    var p = puntos(num(it.aciertos), num(it.total));
    pts[it.alumnoId] = (pts[it.alumnoId] || 0) + p;
    sum[c] = (sum[c] || 0) + p; n[c] = (n[c] || 0) + 1;
  });
  var filas = ctx.db.all('Alumnos').filter(function (a) { return si(a.activo); }).map(function (a) {
    return { id: a.id, nombre: a.nombre, cursoId: a.cursoId, pts: pts[a.id] || 0 };
  });
  t = { filas: filas, cursos: ctx.db.all('Cursos').map(function (c) {
    return { id: c.id, nombre: c.nombre, oculta: si(c.ocultarTabla), pts: n[c.id] ? Math.round(sum[c.id] / n[c.id]) : 0,
      n: filas.filter(function (f) { return f.cursoId === c.id; }).length };
  }) };
  cput(ctx, 'tabla:' + per, t, 30);
  return t;
}
function rank(rows) {
  rows = rows.slice().sort(function (a, b) { return b.pts - a.pts || porNombre(a, b); });
  rows.forEach(function (r, i) { r.pos = (i > 0 && rows[i - 1].pts === r.pts) ? rows[i - 1].pos : i + 1; });
  return rows;
}
function top10(rows, yo, sub) {
  var out = rows.slice(0, 10), mio = rows.filter(function (r) { return r.id === yo; })[0];
  if (mio && out.indexOf(mio) < 0) out.push(mio);
  return out.map(function (r) { return { pos: r.pos, nombre: r.nombre, sub: sub ? sub(r) : '', pts: r.pts, yo: r.id === yo }; });
}

/* ---------- acciones ---------- */
var ACCIONES = {
  /* públicas */
  cursos: function (ctx) { return ctx.db.all('Cursos').map(function (c) { return { id: c.id, nombre: c.nombre }; }).sort(porNombre); },

  login: function (ctx, r) {
    var dev = String(r.device || '');
    limite(ctx, 'log:' + dev, 5, 'Demasiados intentos. Esperá 10 minutos.');
    limite(ctx, 'log:*', 40, 'El acceso de docente está pausado por 10 minutos.');
    var clave = cfg(ctx, 'clave', '');
    if (!clave || String(r.clave || '') !== clave) { falla(ctx, 'log:' + dev); falla(ctx, 'log:*'); throw E('Contraseña incorrecta.'); }
    return { tk: abrirSesion(ctx, { rol: 'docente' }, 21600) };
  },

  entrar: function (ctx, r) {
    var dev = String(r.device || '');
    limite(ctx, 'pin:' + dev, 8, 'Demasiados intentos. Esperá 10 minutos y pedile el PIN a tu profe.');
    limite(ctx, 'pinc:' + r.cursoId, 150, 'El ingreso a este curso está pausado por 10 minutos.');
    var cu = uno(ctx, 'Cursos', r.cursoId);
    if (!cu) throw E('Ese curso no existe.');
    var p = pinDe(ctx, cu.id, false);
    if (!p) throw E('El PIN de este curso venció. Pedile el nuevo a tu profe.', 'pin');
    if (String(r.pin || '').trim() !== String(p.pin)) { falla(ctx, 'pin:' + dev); falla(ctx, 'pinc:' + cu.id); throw E('PIN incorrecto.', 'pin'); }
    var als = activos(ctx, cu.id), yo = als.filter(function (a) { return a.id === r.alumnoId; })[0];
    var ttl = Math.round(Math.max(num(p.vence) - ctx.now(), 45 * 60000) / 1000);
    return { tk: abrirSesion(ctx, { rol: 'alumno', cursoId: cu.id, alumnoId: yo ? yo.id : '', device: dev }, ttl), curso: cu.nombre,
      alumnoId: yo ? yo.id : '', alumnos: als.map(function (a) { return { id: a.id, nombre: a.nombre }; }) };
  },

  /* alumno */
  soy: function (ctx, r) {
    var s = sesion(ctx, r);
    if (s.rol !== 'alumno') throw E('Esta parte es para alumnos.', 'rol');
    if (s.alumnoId && s.alumnoId !== r.alumnoId) throw E('Para cambiar de alumno hay que volver a poner el PIN.', 'ses');
    var a = uno(ctx, 'Alumnos', r.alumnoId);
    if (!a || a.cursoId !== s.cursoId || !si(a.activo)) throw E('Ese alumno no es de este curso.');
    s.alumnoId = a.id;
    cput(ctx, 'ses:' + r.t, s, s.ttl);
    return { nombre: a.nombre };
  },

  inicio: function (ctx, r) {
    var s = sesion(ctx, r, 'alumno'), per = periodoHoy(ctx), corte = corteDe(ctx), mios = {};
    var al = uno(ctx, 'Alumnos', s.alumnoId), cu = uno(ctx, 'Cursos', s.cursoId);
    ctx.db.all('Intentos').forEach(function (it) { if (it.alumnoId === s.alumnoId) mios[it.claseId] = it; });
    var clases = ctx.db.all('Clases').filter(function (c) {
      return c.cursoId === s.cursoId && c.bancoId && periodoDe(c.fecha, corte) === per && (c.estado === 'abierto' || mios[c.id]);
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).map(function (c) {
      var it = mios[c.id], disp = banco(ctx, c.bancoId).filter(function (q) { return !q.anulada; }).length;
      return { id: c.id, titulo: c.titulo, fecha: c.fecha, estado: c.estado, segundos: num(c.segundos), n: Math.min(num(c.porAlumno), disp),
        intento: it ? { fin: !!it.fin, aciertos: num(it.aciertos), total: num(it.total), puntos: puntos(num(it.aciertos), num(it.total)) } : null };
    });
    var oculta = si(cu.ocultarTabla), filas = rank(tablaDe(ctx, per).filas.filter(function (f) { return f.cursoId === s.cursoId; }));
    var yo = filas.filter(function (f) { return f.id === s.alumnoId; })[0];
    return { alumno: al.nombre, curso: cu.nombre, periodo: per, puntos: yo ? yo.pts : 0, puesto: oculta || !yo ? null : yo.pos, de: filas.length, tabla: !oculta, clases: clases };
  },

  empezar: function (ctx, r) {
    var s = sesion(ctx, r, 'alumno'), cl = uno(ctx, 'Clases', r.claseId);
    if (!cl || cl.cursoId !== s.cursoId || !cl.bancoId) throw E('Ese cuestionario no es de tu curso.');
    var st = estado(ctx, cl.id, s.alumnoId);
    if (st) {                                   // ya había empezado: reintento o reconexión
      if (st.fin) throw E('Ya rendiste este cuestionario.', 'hecho');
      // La pregunta que estaba en pantalla al cortarse cuenta como sin responder: así nadie gana tiempo saliendo y volviendo.
      if (st.enviada && ctx.now() - st.enviada > REINTENTO) anotar(ctx, st, null, Math.max(0, Math.min(ctx.now() - st.enviada - LECTURA, st.seg * 1000)));
      if (st.fin) { guardarSt(ctx, st); return resumen(st); }
      if (!st.enviada) st.enviada = ctx.now();
      guardarSt(ctx, st);
      return vista(ctx, st);
    }
    if (cl.estado !== 'abierto') throw E('Este cuestionario está cerrado.', 'cerrado');
    var pregs = banco(ctx, cl.bancoId).filter(function (q) { return !q.anulada; });
    if (!pregs.length) throw E('Este cuestionario no tiene preguntas.');
    var k = 'it:' + cl.id + ':' + s.alumnoId, id = nid(ctx, 'i'), libre = false;
    ctx.lock(function () { if (!ctx.cache.get(k)) { ctx.cache.put(k, id, 7200); libre = true; } });   // evita dos intentos por doble toque
    if (!libre) throw E('Ya estás empezando este cuestionario. Esperá un segundo y tocá de nuevo.', 'ya');
    var orden = mezclar(ctx, pregs).slice(0, Math.max(1, num(cl.porAlumno))).map(function (q) {
      return [q.id, mezclar(ctx, q.ops.map(function (_, i) { return i; }))];
    });
    try {
      ctx.db.insert('Intentos', { id: id, claseId: cl.id, alumnoId: s.alumnoId, inicio: ctx.now(), fin: '', orden: JSON.stringify(orden),
        aciertos: 0, total: orden.length, enCasa: cl.modo === 'ausentes', salidas: 0, device: s.device || '', resp: '{}' });
    } catch (e) { ctx.cache.remove(k); throw e; }   // si no se pudo guardar, que pueda volver a tocar Empezar
    st = { id: id, claseId: cl.id, alumnoId: s.alumnoId, bancoId: cl.bancoId, seg: num(cl.segundos), orden: orden, pos: 0, enviada: ctx.now(), ok: 0, salidas: 0, resp: {} };
    guardarSt(ctx, st);
    return vista(ctx, st);
  },

  responder: function (ctx, r) {
    var s = sesion(ctx, r, 'alumno'), st = estado(ctx, r.claseId, s.alumnoId);
    if (!st) throw E('Todavía no empezaste este cuestionario.');
    if (st.fin) return resumen(st);
    var pos = num(r.pos);
    if (pos < st.pos) {                         // reenvío de una respuesta que ya estaba guardada
      if (!st.enviada) { st.enviada = ctx.now(); guardarSt(ctx, st); }
      return vista(ctx, st);
    }
    if (pos > st.pos) throw E('Esa pregunta todavía no te tocó.');
    // El teléfono informa cuánto tardó (la red de Google suma varios segundos que no son del alumno).
    // El servidor pone el límite: entre que mandó la pregunta y recibió la respuesta no pueden pasar más de los segundos + GRACIA.
    var srv = st.enviada ? ctx.now() - st.enviada : 0, tope = st.seg * 1000, cli = r.ms === undefined || r.ms === '' ? srv : num(r.ms);
    var tarde = srv > LECTURA + tope + GRACIA || cli > tope + 500, di = r.di, ops = st.orden[pos][1];
    var elegida = (di === null || di === undefined || di === '' || tarde || !(num(di) >= 0 && num(di) < ops.length)) ? null : ops[num(di)];
    anotar(ctx, st, elegida, Math.max(0, Math.min(cli, srv, tope)));
    if (!st.fin) st.enviada = ctx.now();
    guardarSt(ctx, st);
    return st.fin ? resumen(st) : vista(ctx, st);
  },

  salida: function (ctx, r) {
    var s = sesion(ctx, r, 'alumno'), st = estado(ctx, r.claseId, s.alumnoId);
    if (st && !st.fin) { st.salidas++; guardarSt(ctx, st); }
    return {};
  },

  revision: function (ctx, r) {
    var s = sesion(ctx, r, 'alumno'), cl = uno(ctx, 'Clases', r.claseId);
    if (!cl || cl.cursoId !== s.cursoId) throw E('Ese cuestionario no es de tu curso.');
    if (cl.estado === 'abierto') throw E('Vas a poder ver la corrección cuando tu profe cierre el cuestionario.');
    var it = ctx.db.all('Intentos').filter(function (x) { return x.claseId === cl.id && x.alumnoId === s.alumnoId; })[0];
    if (!it) throw E('No rendiste este cuestionario.');
    var b = banco(ctx, cl.bancoId), ids = {};
    ids[it.id] = 1;
    var m = respuestasDe(ctx, ids)[it.id] || {};
    return { titulo: cl.titulo, aciertos: num(it.aciertos), total: num(it.total), puntos: puntos(num(it.aciertos), num(it.total)),
      items: J(it.orden, []).map(function (p) {
        var q = pregDe(b, p[0]), e = eleg(m[p[0]]);
        return q && { texto: q.texto, anulada: q.anulada, elegida: e === null ? null : q.ops[e], correcta: q.ops[q.ok], ok: e === q.ok };
      }).filter(Boolean) };
  },

  tabla: function (ctx, r) {
    var s = sesion(ctx, r), doc = s.rol === 'docente', per = (doc && r.periodo) || periodoHoy(ctx), t = tablaDe(ctx, per);
    var cursoId = doc ? (r.cursoId || (t.cursos[0] || {}).id) : s.cursoId, yo = doc ? '' : s.alumnoId, nom = {}, vis = {};
    t.cursos.forEach(function (c) { nom[c.id] = c.nombre; vis[c.id] = doc || !c.oculta; });
    if (!vis[cursoId]) throw E('Tu profe ocultó la tabla de este curso.');
    var deCurso = function (f) { return nom[f.cursoId]; };
    return { periodo: per, curso: nom[cursoId] || '',
      mio: top10(rank(t.filas.filter(function (f) { return f.cursoId === cursoId; })), yo),
      cursos: top10(rank(t.cursos.filter(function (c) { return vis[c.id]; })), doc ? '' : s.cursoId, function (c) { return c.n + ' alumnos'; }),
      mejores: top10(rank(t.filas.filter(function (f) { return vis[f.cursoId]; })), yo, deCurso) };
  },

  /* docente */
  panel: function (ctx, r) {
    sesion(ctx, r, 'docente');
    var corte = corteDe(ctx), per = r.periodo || periodoHoy(ctx), pers = {}, hechos = {}, usos = {}, cuenta = {};
    pers[periodoHoy(ctx)] = 1;
    ctx.db.all('Clases').forEach(function (c) { pers[periodoDe(c.fecha, corte)] = 1; if (c.bancoId) usos[c.bancoId] = (usos[c.bancoId] || 0) + 1; });
    ctx.db.all('Intentos').forEach(function (it) { if (it.fin) hechos[it.claseId] = (hechos[it.claseId] || 0) + 1; });
    ctx.db.all('Preguntas').forEach(function (q) { var c = cuenta[q.bancoId] || (cuenta[q.bancoId] = { n: 0, an: 0 }); if (si(q.anulada)) c.an++; else c.n++; });
    return { periodo: per, periodos: Object.keys(pers).sort().reverse(), corte: corte, hoy: ctx.hoy(), ahora: ctx.now(),
      cursos: ctx.db.all('Cursos').slice().sort(porNombre).map(function (c) {
        var p = pinDe(ctx, c.id, true);
        return { id: c.id, nombre: c.nombre, oculta: si(c.ocultarTabla), pin: String(p.pin), vence: num(p.vence),
          alumnos: activos(ctx, c.id).map(function (a) { return { id: a.id, nombre: a.nombre }; }) };
      }),
      bancos: ctx.db.all('Bancos').slice().sort(function (a, b) { return a.titulo.localeCompare(b.titulo, 'es'); }).map(function (b) {
        var c = cuenta[b.id] || { n: 0, an: 0 };
        return { id: b.id, titulo: b.titulo, n: c.n, anuladas: c.an, usos: usos[b.id] || 0 };
      }),
      clases: ctx.db.all('Clases').filter(function (c) { return periodoDe(c.fecha, corte) === per; }).map(function (c) {
        return { id: c.id, cursoId: c.cursoId, bancoId: c.bancoId, titulo: c.titulo, fecha: c.fecha, segundos: num(c.segundos),
          porAlumno: num(c.porAlumno), estado: c.estado, modo: c.modo, hechos: hechos[c.id] || 0 };
      }) };
  },

  'pin.nuevo': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var p = uno(ctx, 'Pines', r.cursoId);
    if (p) ctx.db.update('Pines', r.cursoId, { vence: 0 });
    pinDe(ctx, r.cursoId, true);
    return {};
  },

  'config.guardar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    if (!/^\d{2}-\d{2}$/.test(String(r.corte || ''))) throw E('Elegí el día en que empieza el segundo cuatrimestre.');
    if (uno(ctx, 'Config', 'corte')) ctx.db.update('Config', 'corte', { valor: r.corte }); else ctx.db.insert('Config', { id: 'corte', valor: r.corte });
    return {};
  },

  'curso.guardar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var nombre = String(r.nombre || '').trim(), id = r.id;
    if (!nombre) throw E('Falta el nombre del curso.');
    var nuevos = String(r.alumnos || '').split('\n').map(function (x) { return x.trim().replace(/\s+/g, ' '); }).filter(Boolean);
    var ya = {}, rep = [];
    if (id) activos(ctx, id).forEach(function (a) { ya[a.nombre.toLowerCase()] = 1; });
    nuevos.forEach(function (n) { var k = n.toLowerCase(); if (ya[k] && rep.indexOf(n) < 0) rep.push(n); ya[k] = 1; });
    if (rep.length) throw E('Hay nombres repetidos: ' + rep.join(', ') + '. Agregales algo para distinguirlos, por ejemplo el segundo nombre.');
    if (!id && !nuevos.length) throw E('Cargá al menos un alumno, uno por renglón.');
    if (id) ctx.db.update('Cursos', id, { nombre: nombre, ocultarTabla: !!r.oculta });
    else { id = nid(ctx, 'c'); ctx.db.insert('Cursos', { id: id, nombre: nombre, ocultarTabla: false }); }
    ctx.db.insertMany('Alumnos', nuevos.map(function (n) { return { id: nid(ctx, 'a'), cursoId: id, nombre: n, activo: true }; }));
    return { id: id };
  },

  'curso.borrar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    if (ctx.db.all('Clases').some(function (c) { return c.cursoId === r.id; })) throw E('Este curso tiene clases cargadas. Borrá primero sus clases.');
    ctx.db.all('Alumnos').filter(function (a) { return a.cursoId === r.id; }).forEach(function (a) { ctx.db.remove('Alumnos', a.id); });
    ctx.db.remove('Cursos', r.id);
    return {};
  },

  'alumno.guardar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var a = uno(ctx, 'Alumnos', r.id), nombre = String(r.nombre || '').trim().replace(/\s+/g, ' ');
    if (!a) throw E('Ese alumno no existe.');
    if (r.baja) { ctx.db.update('Alumnos', a.id, { activo: false }); return {}; }   // se conserva su historial
    if (!nombre) throw E('Falta el nombre.');
    if (activos(ctx, a.cursoId).some(function (x) { return x.id !== a.id && x.nombre.toLowerCase() === nombre.toLowerCase(); }))
      throw E('Ya hay otro alumno con ese nombre en el curso.');
    ctx.db.update('Alumnos', a.id, { nombre: nombre });
    return {};
  },

  'banco.guardar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var titulo = String(r.titulo || '').trim(), p = String(r.texto || '').trim() ? parseBlock(r.texto) : null, id = r.id;
    if (!titulo) throw E('Falta el tema.');
    if (p && p.errors.length) throw E(p.errors.join('\n'));
    if (!id && (!p || !p.questions.length)) throw E('Pegá al menos una pregunta.');
    if (id) ctx.db.update('Bancos', id, { titulo: titulo }); else { id = nid(ctx, 'b'); ctx.db.insert('Bancos', { id: id, titulo: titulo }); }
    ctx.db.insertMany('Preguntas', (p ? p.questions : []).map(function (q) {
      return { id: nid(ctx, 'p'), bancoId: id, texto: q.text, opciones: JSON.stringify(q.options), correcta: q.correct, anulada: false };
    }));
    ctx.cache.remove('bk:' + id);
    return { id: id };
  },

  'banco.ver': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var b = uno(ctx, 'Bancos', r.id);
    if (!b) throw E('Ese banco de preguntas no existe.');
    ctx.cache.remove('bk:' + b.id);
    return { id: b.id, titulo: b.titulo, preguntas: banco(ctx, b.id).map(function (q) { return { id: q.id, texto: q.texto, opciones: q.ops, correcta: q.ok, anulada: q.anulada }; }) };
  },

  'banco.borrar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    if (ctx.db.all('Clases').some(function (c) { return c.bancoId === r.id; })) throw E('Este banco se usó en clases. No se puede borrar.');
    ctx.db.all('Preguntas').filter(function (q) { return q.bancoId === r.id; }).forEach(function (q) { ctx.db.remove('Preguntas', q.id); });
    ctx.db.remove('Bancos', r.id);
    ctx.cache.remove('bk:' + r.id);
    return {};
  },

  'pregunta.guardar': function (ctx, r) {   // corregir una pregunta ya cargada, en el mismo formato de pegado
    sesion(ctx, r, 'docente');
    var q = uno(ctx, 'Preguntas', r.id), p = parseBlock(r.texto);
    if (!q) throw E('Esa pregunta no existe.');
    if (p.errors.length) throw E(p.errors.join('\n'));
    if (p.questions.length !== 1) throw E('Acá va una sola pregunta.');
    var n = p.questions[0], respondida = ctx.db.all('Intentos').some(function (it) { return it.resp.indexOf('"' + q.id + '"') >= 0; });
    if (respondida && n.options.length !== J(q.opciones, []).length)
      throw E('Esta pregunta ya fue respondida: podés corregir el texto o cuál es la correcta, pero no agregar ni quitar opciones. Si está mal, anulala y cargá una nueva.');
    ctx.db.update('Preguntas', q.id, { texto: n.text, opciones: JSON.stringify(n.options), correcta: n.correct });
    recalcular(ctx, q.bancoId);
    return {};
  },

  'pregunta.anular': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var q = uno(ctx, 'Preguntas', r.id);
    if (!q) throw E('Esa pregunta no existe.');
    ctx.db.update('Preguntas', q.id, { anulada: !!r.anulada });
    recalcular(ctx, q.bancoId);
    return {};
  },

  'clase.guardar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var seg = Math.round(num(r.segundos)) || 20, por = Math.round(num(r.porAlumno)) || 5;
    if (!fechaOk(r.fecha)) throw E('Falta la fecha de la clase.');
    if (seg < 5 || seg > 120) throw E('Los segundos por pregunta tienen que estar entre 5 y 120.');
    if (r.id) {
      var vieja = uno(ctx, 'Clases', r.id);
      if (!vieja) throw E('Esa clase no existe.');
      ctx.db.update('Clases', r.id, { titulo: String(r.titulo || '').trim() || vieja.titulo, fecha: r.fecha, segundos: seg, porAlumno: por });
      return {};
    }
    var b = r.bancoId ? uno(ctx, 'Bancos', r.bancoId) : null, titulo = String(r.titulo || '').trim() || (b ? b.titulo : '');
    if (r.bancoId && !b) throw E('Ese banco de preguntas no existe.');
    if (!titulo) throw E('Falta el tema de la clase.');
    var cursos = (r.cursoIds || []).filter(function (id) { return uno(ctx, 'Cursos', id); });
    if (!cursos.length) throw E('Elegí al menos un curso.');
    ctx.db.insertMany('Clases', cursos.map(function (cid) {   // el mismo banco sirve para varios cursos: se crea una clase por curso
      return { id: nid(ctx, 'k'), cursoId: cid, bancoId: b ? b.id : '', titulo: titulo, fecha: r.fecha, segundos: seg, porAlumno: por,
        estado: b ? 'nuevo' : 'cerrado', modo: '' };
    }));
    return {};
  },

  'clase.estado': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var cl = uno(ctx, 'Clases', r.id);
    if (!cl || !cl.bancoId) throw E('Esa clase no tiene cuestionario.');
    if (r.estado === 'abierto') { ctx.db.update('Clases', cl.id, { estado: 'abierto', modo: r.ausentes ? 'ausentes' : 'clase' }); return {}; }
    ctx.db.all('Intentos').filter(function (it) { return it.claseId === cl.id && !it.fin; }).forEach(function (it) {
      var st = estado(ctx, cl.id, it.alumnoId);   // los que quedaron a medias se cierran con lo que respondieron
      cerrarIntento(ctx, st);
      guardarSt(ctx, st);
    });
    ctx.db.update('Clases', cl.id, { estado: 'cerrado' });
    return {};
  },

  'clase.borrar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    ['Intentos', 'Marcas'].forEach(function (t) {
      ctx.db.all(t).filter(function (x) { return x.claseId === r.id; }).forEach(function (x) { ctx.db.remove(t, x.id); });
    });
    ctx.db.remove('Clases', r.id);
    return {};
  },

  'intento.reiniciar': function (ctx, r) {
    sesion(ctx, r, 'docente');
    var it = uno(ctx, 'Intentos', r.id);
    if (!it) return {};
    ctx.db.remove('Intentos', it.id);
    ctx.cache.remove('st:' + it.id);
    ctx.cache.remove('it:' + it.claseId + ':' + it.alumnoId);
    return {};
  },

  vivo: function (ctx, r) { return resultadosDe(ctx, r, false); },
  resultados: function (ctx, r) { return resultadosDe(ctx, r, true); },

  asistencia: function (ctx, r) {
    sesion(ctx, r, 'docente');
    var corte = corteDe(ctx), per = r.periodo || periodoHoy(ctx), cu = uno(ctx, 'Cursos', r.cursoId), its = {}, mar = {};
    if (!cu) throw E('Ese curso no existe.');
    var clases = ctx.db.all('Clases').filter(function (c) { return c.cursoId === cu.id && periodoDe(c.fecha, corte) === per && cuentaComoClase(c); })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
    ctx.db.all('Intentos').forEach(function (it) { its[it.claseId + '|' + it.alumnoId] = it; });
    ctx.db.all('Marcas').forEach(function (m) { mar[m.id] = m.estado; });
    return { curso: cu.nombre, periodo: per,
      clases: clases.map(function (c) { return { id: c.id, titulo: c.titulo, fecha: c.fecha, sinCuestionario: !c.bancoId }; }),
      filas: activos(ctx, cu.id).map(function (a) {
        var pres = 0, den = 0, sum = 0, n = 0;
        var celdas = clases.map(function (c) {
          var k0 = c.id + '|' + a.id, it = its[k0], k = celda(it, mar[k0]), hecho = it && it.fin;
          if (k !== 'J') { den++; if (k === 'P' || k === 'T') pres++; }
          if (hecho) { sum += puntos(num(it.aciertos), num(it.total)); n++; }
          return { k: k, nota: hecho ? num(it.aciertos) + '/' + num(it.total) : '' };
        });
        return { id: a.id, nombre: a.nombre, celdas: celdas, presentes: pres, clases: den, pct: den ? Math.round(100 * pres / den) : null,
          nota: n ? Math.max(1, Math.round(sum / n) / 10) : null, rendidos: n };
      }) };
  },

  marca: function (ctx, r) {
    sesion(ctx, r, 'docente');
    var id = r.claseId + '|' + r.alumnoId, m = uno(ctx, 'Marcas', id), e = String(r.estado || '');
    if (['', 'P', 'T', 'J'].indexOf(e) < 0) throw E('Marca desconocida.');
    if (!e) { if (m) ctx.db.remove('Marcas', id); }
    else if (m) ctx.db.update('Marcas', id, { estado: e });
    else ctx.db.insert('Marcas', { id: id, claseId: r.claseId, alumnoId: r.alumnoId, estado: e });
    return {};
  },

  'marca.todos': function (ctx, r) {   // para una clase sin cuestionario: todos presentes y después se corrigen los ausentes
    sesion(ctx, r, 'docente');
    var cl = uno(ctx, 'Clases', r.claseId);
    if (!cl) throw E('Esa clase no existe.');
    ctx.db.insertMany('Marcas', activos(ctx, cl.cursoId).filter(function (a) { return !uno(ctx, 'Marcas', cl.id + '|' + a.id); }).map(function (a) {
      return { id: cl.id + '|' + a.id, claseId: cl.id, alumnoId: a.id, estado: 'P' };
    }));
    return {};
  }
};

/* Control en vivo (liviano) y resultados (con el detalle por pregunta) salen de la misma función. */
function resultadosDe(ctx, r, detalle) {
  sesion(ctx, r, 'docente');
  var cl = uno(ctx, 'Clases', r.claseId);
  if (!cl) throw E('Esa clase no existe.');
  var cu = uno(ctx, 'Cursos', cl.cursoId), its = {}, ids = {}, devs = {}, nom = {};
  var alumnos = ctx.db.all('Alumnos').filter(function (a) { return a.cursoId === cl.cursoId; });
  alumnos.forEach(function (a) { nom[a.id] = a.nombre; });
  ctx.db.all('Intentos').forEach(function (it) {
    if (it.claseId !== cl.id) return;
    its[it.alumnoId] = it; ids[it.id] = 1;
    if (it.device) (devs[it.device] || (devs[it.device] = [])).push(it.alumnoId);
  });
  var b = detalle && cl.bancoId ? banco(ctx, cl.bancoId) : [], resp = detalle ? respuestasDe(ctx, ids) : {};
  var filas = alumnos.filter(function (a) { return si(a.activo) || its[a.id]; }).sort(porNombre).map(function (a) {
    var it = its[a.id];
    if (!it) return { id: a.id, nombre: a.nombre, e: 'no' };
    var otros = (devs[it.device] || []).filter(function (x) { return x !== a.id; }).map(function (x) { return nom[x]; });
    var f = { id: a.id, nombre: a.nombre, intentoId: it.id, e: it.fin ? 'listo' : 'rindiendo', enCasa: si(it.enCasa), dup: otros.join(', '),
      aciertos: num(it.aciertos), total: num(it.total), salidas: num(it.salidas) };
    if (detalle) {
      var m = resp[it.id] || {}, ks = Object.keys(m);
      if (!it.fin) f.aciertos = corregir(b, J(it.orden, []), soloElegidas(m)).ok;
      f.seg = ks.length ? Math.round(ks.reduce(function (t, k) { return t + m[k].ms; }, 0) / ks.length / 100) / 10 : null;
    }
    f.puntos = puntos(f.aciertos, f.total);
    return f;
  });
  var out = { id: cl.id, titulo: cl.titulo, fecha: cl.fecha, curso: cu ? cu.nombre : '', estado: cl.estado, modo: cl.modo, filas: filas };
  if (detalle) out.preguntas = b.map(function (q) {
    var vistas = 0, ok = 0;
    Object.keys(resp).forEach(function (iid) { var a = resp[iid][q.id]; if (!a) return; vistas++; if (eleg(a) === q.ok) ok++; });
    return { texto: q.texto, anulada: q.anulada, vistas: vistas, ok: ok };
  });
  return out;
}

/* Puerta de entrada: recibe {a: acción, t: sesión, ...} y devuelve {ok, d} o {ok:false, error}. */
function api(ctx, req) {
  try {
    var f = ACCIONES[req && req.a];
    if (!f) throw E('Pedido desconocido.');
    return { ok: true, d: f(ctx, req) };
  } catch (e) {
    if (e.user) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
}

/* Base de datos en memoria, para los tests y el modo demostración. Guarda todo como texto, igual que la planilla. */
function memCtx(data, cache) {
  data = data || {}; cache = cache || {};
  function fila(t, o) { var r = {}; TABLAS[t].forEach(function (k) { r[k] = o[k] === undefined || o[k] === null ? '' : String(o[k]); }); return r; }
  var ctx = {
    t: null,                                             // reloj de prueba: si es un número, reemplaza a la hora real
    now: function () { return ctx.t === null ? Date.now() : ctx.t; },
    hoy: function () { var d = new Date(ctx.now()); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
    rand: uuid,
    lock: function (f) { f(); },
    cache: {
      get: function (k) { var e = cache[k]; return e && e.x > ctx.now() ? e.v : null; },
      put: function (k, v, ttl) { cache[k] = { v: String(v), x: ctx.now() + ttl * 1000 }; },
      remove: function (k) { delete cache[k]; }
    },
    db: {
      all: function (t) { return data[t] || (data[t] = []); },
      insert: function (t, o) { ctx.db.all(t).push(fila(t, o)); },
      insertMany: function (t, os) { os.forEach(function (o) { ctx.db.all(t).push(fila(t, o)); }); },
      update: function (t, id, p) { var r = uno(ctx, t, id); if (r) Object.keys(p).forEach(function (k) { r[k] = String(p[k]); }); },
      remove: function (t, id) { data[t] = ctx.db.all(t).filter(function (r) { return r.id !== id; }); }
    }
  };
  return ctx;
}

if (typeof module !== 'undefined') module.exports = { api: api, parseBlock: parseBlock, memCtx: memCtx, celda: celda, puntos: puntos, periodoDe: periodoDe, TABLAS: TABLAS, H4: H4 };
