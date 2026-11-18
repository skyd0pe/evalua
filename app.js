/* Evaluá: la pantalla. No guarda datos ni corrige nada: le pide todo al servidor. */
var DEMO = !API_URL;
var app = document.getElementById('app');

function guardado(k, v, donde) {
  donde = donde || localStorage;
  try { if (v === undefined) return JSON.parse(donde.getItem(k)); if (v === null) donde.removeItem(k); else donde.setItem(k, JSON.stringify(v)); } catch (e) {}
  return null;
}
var DEV = guardado('ev-dev') || (function () { var d = uuid(); guardado('ev-dev', d); return d; })();
var S = {
  rol: location.hash === '#docente' ? 'docente' : 'alumno',
  al: Object.assign({ v: 'cargando' }, guardado('ev-al') || {}),
  doc: { tk: guardado('ev-doc', undefined, sessionStorage), tab: 'clases', vivo: {} },
  confirm: null, busy: 0
};
var timer = null;

/* ---------- utilidades ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }
function val(id) { var e = $(id); return e ? e.value : ''; }
function nivel(p) { return p >= .8 ? 'good' : p >= .5 ? 'warn' : 'crit'; }
function fmtDate(iso) { var p = iso.split('-'), d = new Date(+p[0], p[1] - 1, +p[2]); return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + (+p[2]) + '/' + (+p[1]); }
function fmtFull(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function hora(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function perLabel(p) { var x = p.split('-'); return (x[1] === '1' ? 'Primer' : 'Segundo') + ' cuatrimestre ' + x[0]; }
function opciones(lista, elegido, f) {   // un solo lugar arma todas las listas desplegables
  return lista.map(function (x) { var o = f(x); return '<option value="' + esc(o[0]) + '"' + (o[0] === elegido ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
}
function confirmar(clave, texto, act, extra) {
  var on = S.confirm === clave;
  return '<button type="button" class="btn danger" data-act="' + (on ? act : 'preguntar') + '" data-clave="' + esc(clave) + '" ' + (extra || '') + '>' + (on ? '¿Seguro? Tocá de nuevo' : texto) + '</button>';
}
function aviso(msg, tipo) {
  var t = $('toast');
  t.textContent = msg; t.className = 'toast show ' + (tipo || '');
  clearTimeout(aviso.t); aviso.t = setTimeout(function () { t.className = 'toast'; }, tipo === 'err' ? 6000 : 3000);
}
function barra() { $('bar').className = S.busy > 0 ? 'on' : ''; }

/* ---------- hablar con el servidor ---------- */
function enviar(body, n, callado) {
  var p = API_URL
    ? fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); })
    : new Promise(function (ok) { ok(demoApi(body)); });
  return p.catch(function (e) {
    if (callado || n >= 4) throw new Error('No hay conexión. Revisá internet y probá de nuevo.');
    aviso('Sin señal. Reintentando…', 'wrn');
    return new Promise(function (ok) { setTimeout(ok, 1500 * (n + 1)); }).then(function () { return enviar(body, n + 1); });
  });
}
function call(a, d, callado) {
  var body = Object.assign({ a: a, t: S.rol === 'docente' ? S.doc.tk : S.al.tk, device: DEV }, d || {});
  if (!callado) { S.busy++; barra(); }
  var fin = function () { if (!callado) { S.busy--; barra(); } };
  return enviar(body, 0, callado).then(function (res) {
    fin();
    if (res.ok) { if (!callado && $('toast').className.indexOf('err') > 0) $('toast').className = 'toast'; return res.d; }   // un error viejo no queda colgado
    var e = new Error(res.error || 'Algo salió mal.'); e.code = res.code; throw e;
  }, function (e) { fin(); throw e; });
}
/* Varios pedidos en una sola llamada. Devuelve las respuestas tal cual ({ok, d} o {ok:false, error}). */
function lote(pasos, callado) { return call('lote', { pasos: pasos }, callado); }
function dato(r) { if (r && r.ok) return r.d; var e = new Error((r && r.error) || 'Algo salió mal.'); e.code = r && r.code; throw e; }
/* Un pedido seguido de otros que traen lo que hay que mostrar después; si el primero falla, se ve su error. */
function todo(pasos, callado) { return lote(pasos, callado).then(function (rs) { return rs.map(dato); }); }
function fallo(e) {
  if (e.code === 'ses') {
    if (S.rol === 'docente') { S.doc.tk = null; guardado('ev-doc', null, sessionStorage); }
    else { S.al.tk = null; if (S.al.cursoId) { S.al.v = 'pin'; } else return irCursos(); }
    render();
    if (S.rol === 'alumno') aviso('Poné el PIN de hoy para entrar.');
    return;
  }
  aviso(e.message || 'Algo salió mal.', 'err');
}

/* ================= ALUMNO ================= */
function recordar() { var a = S.al; guardado('ev-al', { tk: a.tk, cursoId: a.cursoId, cursoNombre: a.cursoNombre, alumnoId: a.alumnoId, nombre: a.nombre }); }
function irCursos() {
  var antes = guardado('ev-cursos');                     // la lista de la vez anterior aparece al instante y se actualiza atrás
  S.al = antes ? { v: 'cursos', cursos: antes } : { v: 'cargando' }; guardado('ev-al', null); render();
  return call('cursos', null, !!antes).then(function (d) {
    guardado('ev-cursos', d);
    if (S.al.v === 'cursos' || S.al.v === 'cargando') { S.al.cursos = d; S.al.v = 'cursos'; render(); }
  }, function (e) { if (!antes) throw e; });
}
function ponerHome(d) { S.al.home = d; S.al.nombre = d.alumno; S.al.v = 'home'; recordar(); render(); }
function irHome() { return call('inicio').then(ponerHome); }
function entrar(pin) {
  var a = S.al;
  var pasos = [{ a: 'entrar', cursoId: a.cursoId, pin: pin, alumnoId: a.alumnoId || '' }];
  if (a.alumnoId) pasos.push({ a: 'inicio' });           // si ya sabemos quién es, la pantalla de inicio viene en la misma llamada
  return lote(pasos).then(function (rs) {
    var d = dato(rs[0]);
    a.tk = d.tk; a.alumnos = d.alumnos; a.cursoNombre = d.curso;
    if (d.alumnoId) { recordar(); return rs[1] && rs[1].ok ? ponerHome(rs[1].d) : irHome(); }
    a.alumnoId = ''; a.nombre = ''; a.v = 'nombre'; render();
  });
}

function vAlumno() {
  var a = S.al, h = '';
  if (a.v === 'cargando') return '<p class="empty">Cargando…</p>';
  if (a.v === 'cursos') {
    h = '<div class="stack"><h2>¿En qué curso estás?</h2>';
    if (!a.cursos.length) h += '<p class="empty">Tu docente todavía no cargó cursos.</p>';
    a.cursos.forEach(function (c) { h += '<button class="list-btn" data-act="elegir-curso" data-id="' + c.id + '" data-n="' + esc(c.nombre) + '">' + esc(c.nombre) + '</button>'; });
    return h + '<button class="btn ghost pie" data-act="rol" data-v="docente">Acceso docente</button></div>';
  }
  if (a.v === 'pin') {
    return '<form class="card" id="f-pin" novalidate><h2>PIN de ' + esc(a.cursoNombre) + '</h2>' +
      '<p class="meta">Son 4 números. Tu profe los dice en clase y cambian cada 4 horas.</p>' +
      '<div class="field"><label for="pin">PIN</label><input id="pin" class="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>' +
      (a.nombre ? '<p class="meta">Vas a entrar como <b>' + esc(a.nombre) + '</b>.</p>' : '') +
      '<button type="submit" class="btn primary big">Entrar</button>' +
      '<button type="button" class="btn ghost" data-act="otro-curso">' + (a.nombre ? 'No soy ' + esc(a.nombre) : 'Cambiar de curso') + '</button></form>';
  }
  if (a.v === 'nombre') {
    h = '<div class="stack"><h2>Elegí tu nombre</h2><p class="meta">Fijate bien: para cambiarlo después hay que volver a poner el PIN.</p>';
    a.alumnos.forEach(function (n) { h += '<button class="list-btn" data-act="elegir-alumno" data-id="' + n.id + '" data-n="' + esc(n.nombre) + '">' + esc(n.nombre) + '</button>'; });
    return h + '</div>';
  }
  if (a.v === 'home') {
    var d = a.home, hayAbierto = false;
    h = '<div class="stack"><h2>Hola, ' + esc(d.alumno.split(' ')[0]) + '</h2>' +
      '<div class="card"><div class="mypts"><div><p class="meta">Tus puntos del cuatrimestre</p><b>' + d.puntos + '</b></div>' +
      (d.puesto && d.puntos ? '<span class="pill">Puesto ' + d.puesto + ' de ' + d.de + '</span>' : '') + '</div>' +
      (d.tabla ? '<button class="btn" data-act="al-tabla">Ver la tabla de posiciones</button>' : '') + '</div>';
    var tarjetas = d.clases.map(function (c) {
      var it = c.intento, puede = c.estado === 'abierto' && (!it || !it.fin);
      if (puede) hayAbierto = true;
      return '<article class="card' + (puede ? ' open' : '') + '"><div class="card-head"><h2>' + esc(c.titulo) + '</h2>' +
        (it && it.fin ? '<span class="pill plain">' + it.aciertos + ' de ' + it.total + '</span>' : '<span class="pill good">Abierto</span>') + '</div>' +
        '<p class="meta">' + fmtDate(c.fecha) + ' · ' + c.n + ' preguntas · ' + c.segundos + ' segundos cada una</p>' +
        (puede ? (it ? '<button class="btn primary" data-act="empezar" data-id="' + c.id + '">Continuar</button>'
                     : '<button class="btn primary" data-act="intro" data-id="' + c.id + '">Empezar</button>')
          : c.estado === 'abierto' ? '<p class="hint">Vas a poder ver la corrección cuando tu profe cierre el cuestionario.</p>'
          : '<button class="btn" data-act="revision" data-id="' + c.id + '">Ver la corrección</button>') + '</article>';
    }).join('');
    if (!hayAbierto) h += '<p class="empty">No hay ningún cuestionario abierto ahora. Cuando tu profe lo abra, tocá Actualizar.</p>';
    return h + tarjetas + '<button class="btn" data-act="al-home">Actualizar</button>' +
      '<button class="btn ghost pie" data-act="otro-curso">No soy ' + esc(d.alumno) + '</button></div>';
  }
  if (a.v === 'intro') {
    var c = a.clase;
    return '<div class="stack"><h2>' + esc(c.titulo) + '</h2><div class="card"><p><b>' + c.n + ' preguntas</b>, con <b>' + c.segundos + ' segundos</b> para cada una.</p>' +
      '<p class="meta">Cuando tocás una respuesta pasás a la siguiente y no se puede volver atrás. Si se acaba el tiempo, la pregunta queda sin responder. ' +
      'Cada pregunta aparece primero sola, en grande, durante 5 segundos para que la leas; después aparecen las opciones y empieza a correr el tiempo. ' +
      'Si salís o recargás, perdés la pregunta que tenías en pantalla.</p></div>' +
      '<button class="btn primary big" data-act="empezar" data-id="' + c.id + '">Empezar ahora</button><button class="btn" data-act="al-home">Todavía no</button></div>';
  }
  if (a.v === 'fin') {
    var r = a.res;
    var pc = r.aciertos / Math.max(1, r.total);
    return '<div class="stack"><div class="card" style="align-items:center;text-align:center"><p class="meta">Sumaste</p><p class="score">+' + r.puntos + '</p><p class="meta">puntos</p>' +
      '<p><b>' + r.aciertos + ' de ' + r.total + ' bien</b></p>' +
      '<span class="pill' + (pc === 1 ? ' good' : '') + '">' + (pc === 1 ? '¡Todas bien!' : pc >= .5 ? 'Bien, con cosas para repasar' : 'Este tema vale la pena repasarlo') + '</span>' +
      '<p class="hint">La corrección pregunta por pregunta se habilita cuando tu profe cierre el cuestionario.</p></div>' +
      '<button class="btn primary" data-act="al-home">Volver</button></div>';
  }
  if (a.v === 'rev') {
    var v = a.rev;
    h = '<div class="stack"><button class="btn ghost" data-act="al-home" style="align-self:flex-start">← Volver</button><section class="card"><div class="card-head"><h2>' + esc(v.titulo) + '</h2>' +
      '<span class="pill plain">' + v.aciertos + ' de ' + v.total + '</span></div>';
    v.items.forEach(function (x, i) {
      h += '<div class="rev"><b>' + (i + 1) + '. ' + esc(x.texto) + '</b>' +
        (x.anulada ? '<span>Tu profe anuló esta pregunta: no cuenta.</span>'
          : (x.elegida === null ? '<span class="b">Sin responder</span>' : '<span class="' + (x.ok ? 'g' : 'b') + '">' + (x.ok ? 'Correcta: ' : 'Elegiste: ') + esc(x.elegida) + '</span>') +
            (x.ok ? '' : '<span>La correcta era: ' + esc(x.correcta) + '</span>')) + '</div>';
    });
    return h + '</section></div>';
  }
  if (a.v === 'tabla') return '<div class="stack"><button class="btn ghost" data-act="al-home" style="align-self:flex-start">← Volver</button>' + vTabla(a.tabla, a.alcance || 'curso', true) + '</div>';
  return '';
}

/* ----- el cuestionario en pantalla -----
   Cada pregunta tiene dos fases: "leer" (la pregunta sola, en grande, 5 segundos) y "opciones" (corre el reloj).
   Al responder, si ya se conoce el texto de la siguiente, se muestra enseguida en fase "leer" mientras la respuesta
   se guarda: la demora de Google queda escondida en la lectura. Las opciones aparecen cuando pasaron los 5 segundos
   y además llegaron del servidor. */
function cabeza(pos, n) {
  return '<div class="row" style="justify-content:space-between"><span class="pill">Pregunta ' + (pos + 1) + ' de ' + n + '</span><span class="meta">' + esc(S.al.nombre) + '</span></div>';
}
function vRun() {
  var a = S.al, r = a.run;
  /* Lectura y opciones tienen la misma forma: la pregunta no se mueve; la barra de lectura se convierte en el reloj. */
  if (r.fase === 'leer') return '<div class="stack leer">' + cabeza(r.pos, r.n) + '<p class="qrun">' + esc(r.texto) + '</p>' +
    '<div class="timer leer" role="timer" aria-label="Segundos para leer"><div class="tr"><i id="lbar"></i></div><span class="num" id="lnum">' + Math.ceil(r.lectura / 1000) + '</span></div>' +
    '<p class="meta" id="lmsg" aria-live="polite">Leé con calma: las opciones aparecen cuando termina la barra gris.</p>' +
    '<div id="run-msg" class="meta" aria-live="polite"></div></div>';
  if (r.fase === 'guardando') return '<div class="stack">' + cabeza(r.pos, r.n) + '<p class="empty">Guardando tu última respuesta…</p><div id="run-msg" class="meta" aria-live="polite"></div></div>';
  var q = r.q;
  return '<div class="stack">' + cabeza(q.pos, q.n) + '<p class="qrun">' + esc(q.texto) + '</p>' +
    '<div class="timer" id="timer" data-level="ok" role="timer" aria-label="Segundos restantes"><div class="tr"><i id="tbar"></i></div><span class="num" id="tnum">' + Math.ceil(r.ms / 1000) + '</span></div>' +
    '<div class="choices">' + q.opciones.map(function (o, i) {
      return '<button class="choice" data-act="responder" data-di="' + i + '" aria-pressed="false"><span class="k">' + 'ABCDEFGHI'[i] + '</span><span>' + esc(o) + '</span></button>';
    }).join('') + '</div><div id="run-msg" class="meta" aria-live="polite"></div></div>';
}
function correrReloj() { if (!timer) timer = setInterval(tick, 100); tick(); }
function terminar(res) { clearInterval(timer); timer = null; S.al.res = res; S.al.run = null; S.al.v = 'fin'; render(); }
/* Una pregunta que llega del servidor (al empezar o al volver a entrar). */
function ponerPregunta(q) {
  var a = S.al;
  if (q.fin) return terminar(q);
  var seg = q.segundos * 1000, lect = Math.max(0, Math.min(q.lectura || 0, q.restante - seg));
  a.v = 'run';
  a.run = { pos: q.pos, n: q.n, texto: q.texto, q: q, fase: 'leer', lectura: lect, leerHasta: performance.now() + lect, ms: Math.min(seg, q.restante) };
  render(); correrReloj();
}
function mostrarOpciones() {
  var r = S.al.run;
  r.fase = 'opciones'; r.bloq = false; r.desde = performance.now(); r.lim = r.desde + r.ms;   // performance.now no depende de la hora del teléfono
  r.base = r.q.segundos * 1000 - r.ms;                                                    // lo que ya había pasado si volvió a entrar
  render(); tick();
}
function tick() {
  var a = S.al, r = a.run;
  if (S.rol !== 'alumno' || a.v !== 'run' || !r) return;
  var ahora = performance.now();
  if (r.fase === 'leer') {
    var falta = r.leerHasta - ahora, lb = $('lbar');
    if (lb) { lb.style.transform = 'scaleX(' + Math.max(0, Math.min(1, falta / Math.max(1, r.lectura))) + ')'; }   // se vacía, igual que el reloj
    if (falta > 0) { if ($('lnum')) $('lnum').textContent = Math.ceil(falta / 1000); return; }
    if (r.q && r.q.pos === r.pos) { mostrarOpciones(); return; }
    if ($('lmsg') && !r.esperando) { r.esperando = true; $('lmsg').textContent = 'Cargando las opciones…'; }
    return;
  }
  if (r.fase !== 'opciones' || r.bloq) return;
  var rem = r.lim - ahora, tot = r.q.segundos * 1000, bar = $('tbar');
  if (bar) {
    var p = Math.max(0, Math.min(1, rem / tot)), s = Math.ceil(Math.max(0, rem) / 1000);
    bar.style.transform = 'scaleX(' + p + ')';
    $('tnum').textContent = s;
    $('timer').dataset.level = s <= 5 ? 'crit' : p <= .5 ? 'warn' : 'ok';
  }
  if (rem <= 0) responder(null);
}
function responder(di) {
  var a = S.al, r = a.run;
  if (!r || r.fase !== 'opciones' || r.bloq) return;
  r.bloq = true;
  var q = r.q;
  a.pend = { claseId: a.claseId, pos: q.pos, di: di, ms: Math.round(performance.now() - r.desde) + r.base };
  if (q.siguiente) {   // pasa ya a leer la siguiente; la respuesta se guarda mientras tanto
    a.run = { pos: q.pos + 1, n: q.n, texto: q.siguiente, q: null, fase: 'leer', lectura: q.lectura || 0,
      leerHasta: performance.now() + (q.lectura || 0), ms: q.segundos * 1000 };
  } else a.run = { pos: q.pos, n: q.n, fase: 'guardando' };
  render();
  mandarRespuesta();
}
function mandarRespuesta() {
  var a = S.al, m = $('run-msg');
  if (m) m.textContent = '';
  return call('responder', a.pend).then(function (q) {
    var r = a.run;
    if (!r) return;
    if (q.fin) return terminar(q);
    if (r.fase === 'leer' && r.pos === q.pos) { r.q = q; return; }   // llegaron las opciones de la que está leyendo
    ponerPregunta(q);                                                   // el servidor dice otra cosa (por ejemplo, perdió la pregunta): manda él
  }, function (e) {
    if (e.code) return fallo(e);
    var m2 = $('run-msg');
    if (m2) m2.innerHTML = '<p class="msg err">No se pudo guardar tu respuesta. No cierres esta pantalla.</p><button class="btn primary" data-act="reintentar">Reintentar</button>';
  });
}

/* ================= TABLAS (alumno y docente) ================= */
function listaRank(filas) {
  if (!filas.length || filas.every(function (r) { return !r.pts; })) return '<p class="empty">Todavía nadie sumó puntos en este cuatrimestre.</p>';
  var h = '<ol class="rank">', prev = 0;
  filas.forEach(function (r, i) {
    if (i >= 10 && r.pos > prev + 1) h += '<li class="gap" aria-hidden="true">···</li>';
    prev = r.pos;
    h += '<li class="p' + r.pos + (r.yo ? ' me' : '') + '"><span class="pos">' + r.pos + '</span><span class="nm">' + esc(r.nombre) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span><b>' + r.pts + ' <small>pts</small></b></li>';
  });
  return h + '</ol>';
}
function vTabla(t, alcance, esAlumno) {
  if (!t) return '<p class="empty">Cargando…</p>';
  var h = '<div class="seg" role="group" aria-label="Qué tabla ver" style="align-self:flex-start">' +
    '<button data-act="alcance" data-v="curso" aria-pressed="' + (alcance === 'curso') + '">' + (esAlumno ? 'Mi curso' : 'Por curso') + '</button>' +
    '<button data-act="alcance" data-v="todos" aria-pressed="' + (alcance === 'todos') + '">Todos los cursos</button></div>';
  if (alcance === 'curso') h += '<section class="card"><div class="card-head"><h2>Tabla de ' + esc(t.curso) + '</h2></div>' + listaRank(t.mio) + '</section>';
  else h += '<section class="card"><h2>Cursos</h2><p class="hint">Promedio por cuestionario rendido, para que no gane el curso con más alumnos ni el que tuvo más clases.</p>' + listaRank(t.cursos) + '</section>' +
    '<section class="card"><h2>Mejores de todos los cursos</h2>' + listaRank(t.mejores) + '</section>';
  return h + '<p class="hint">' + perLabel(t.periodo) + '. Cada cuestionario vale hasta 100 puntos. Se muestran los 10 primeros' + (esAlumno ? ' y tu puesto.' : '.') + '</p>';
}

/* ================= DOCENTE ================= */
function pPanel() { return { a: 'panel', periodo: S.doc.per || '' }; }
function ponerPanel(d) { S.doc.p = d; S.doc.per = d.periodo; S.doc.cargado = Date.now(); render(); sondear(); }
function recargar() { return call('panel', { periodo: S.doc.per || '' }).then(ponerPanel); }
/* Hace algo y trae el panel actualizado en la misma llamada. */
function hacer(a, d, msg) { return todo([Object.assign({ a: a }, d || {}), pPanel()]).then(function (r) { S.confirm = null; if (msg) aviso(msg); ponerPanel(r[1]); }); }
function cursoDe(id) { return S.doc.p.cursos.filter(function (c) { return c.id === id; })[0]; }
function claseDe(id) { return S.doc.p.clases.filter(function (c) { return c.id === id; })[0]; }
function conCuestionario() { return S.doc.p.clases.filter(function (c) { return c.bancoId && c.estado !== 'nuevo'; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }); }
function cargarRes() { var d = S.doc, l = conCuestionario(); if (!claseDe(d.resId) || !claseDe(d.resId).bancoId) d.resId = l.length ? l[0].id : null; d.res = null; if (!d.resId) return Promise.resolve(); return call('resultados', { claseId: d.resId }).then(function (r) { d.res = r; render(); }); }
function cargarAsis() { var d = S.doc; if (!cursoDe(d.asisCurso)) d.asisCurso = d.p.cursos.length ? d.p.cursos[0].id : null; d.asis = null; if (!d.asisCurso) return Promise.resolve(); return call('asistencia', { cursoId: d.asisCurso, periodo: d.per }).then(function (r) { d.asis = r; render(); }); }
function cargarTabla() { var d = S.doc; if (!cursoDe(d.tablaCurso)) d.tablaCurso = d.p.cursos.length ? d.p.cursos[0].id : null; d.tabla = null; if (!d.tablaCurso) return Promise.resolve(); return call('tabla', { cursoId: d.tablaCurso, periodo: d.per }).then(function (r) { d.tabla = r; render(); }); }
function ponerBanco(b) { S.doc.banco = b; S.doc.edq = null; render(); }
function cargarBanco(id) { return call('banco.ver', { id: id }).then(ponerBanco); }
function cargarTab() { var t = S.doc.tab; return t === 'resultados' ? cargarRes() : t === 'asistencia' ? cargarAsis() : t === 'tabla' ? cargarTabla() : Promise.resolve(); }

function vDocente() {
  var d = S.doc;
  if (!d.tk) return '<form class="card" id="f-login" novalidate style="max-width:420px;width:100%;align-self:center"><h2>Acceso del docente</h2>' +
    '<p class="meta">Esta parte es solo para el profesor. Si sos alumno, tocá <b>Alumno</b> arriba.</p>' +
    (DEMO ? '<p class="msg wrn">En esta demostración la contraseña es <b>demo</b>.</p>' : '') +
    '<div class="field"><label for="clave">Contraseña</label><input type="password" id="clave" autocomplete="current-password" autocapitalize="off" spellcheck="false"></div>' +
    '<button type="submit" class="btn primary big">Entrar</button><button type="button" class="btn ghost" data-act="rol" data-v="alumno">Soy alumno</button></form>';
  if (!d.p) return '<p class="empty">Cargando…</p>';
  var tabs = [['clases', 'Clases'], ['bancos', 'Preguntas'], ['resultados', 'Resultados'], ['asistencia', 'Asistencia'], ['tabla', 'Tabla'], ['cursos', 'Cursos']];
  var h = '<nav class="tabs" aria-label="Secciones del docente">' + tabs.map(function (t) {
      return '<button class="tab" data-act="tab" data-v="' + t[0] + '" aria-current="' + (d.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</nav>';
  h += d.tab === 'clases' ? vClases() : d.tab === 'bancos' ? vBancos() : d.tab === 'resultados' ? vResultados() : d.tab === 'asistencia' ? vAsistencia()
    : d.tab === 'tabla' ? vTablaDoc() : vCursos();
  return h + '<button class="btn ghost" data-act="salir" style="align-self:center">Cerrar sesión de docente</button>';
}

/* ----- clases ----- */
/* El cuatrimestre se elige dentro de las pestañas que lo usan, y solo si hay más de uno. */
function selPer() {
  var d = S.doc;
  if (d.p.periodos.length < 2) return '';
  return '<div class="field"><label for="s-per">Cuatrimestre</label><select id="s-per">' + opciones(d.p.periodos, d.per, function (p) { return [p, perLabel(p)]; }) + '</select></div>';
}
function vVivo(v) {
  if (!v) return '<p class="hint">Cargando quién respondió…</p>';
  var n = { listo: 0, rindiendo: 0, no: 0 }, dups = {};
  v.filas.forEach(function (f) { n[f.e]++; if (f.dup) dups[[f.nombre].concat(f.dup.split(', ')).sort().join(' y ')] = 1; });
  return '<div class="row" style="justify-content:space-between"><h3>Control en vivo</h3><span class="meta">Terminaron ' + n.listo + ' · Rindiendo ' + n.rindiendo + ' · Faltan ' + n.no + '</span></div>' +
    '<p class="hint">Si aparece en color alguien que no está en el aula, otro respondió por él.</p><div class="chips">' + v.filas.map(function (f) {
      return '<span class="chip' + (f.e === 'listo' ? ' ok' : f.e === 'rindiendo' ? ' home' : '') + '">' + esc(f.nombre) + (f.e === 'rindiendo' ? ' (rindiendo)' : '') + (f.enCasa ? ' (en casa)' : '') + '</span>';
    }).join('') + '</div>' + Object.keys(dups).map(function (k) { return '<p class="msg wrn">Mismo teléfono: ' + esc(k) + '</p>'; }).join('');
}
function tarjetaClase(c) {
  var d = S.doc, cu = cursoDe(c.cursoId) || { nombre: 'Curso eliminado', alumnos: [] }, ab = c.estado === 'abierto';
  var est = !c.bancoId ? ['Sin cuestionario', 'plain'] : c.estado === 'nuevo' ? ['Sin abrir', 'plain'] : !ab ? ['Cerrado', 'plain'] : c.modo === 'ausentes' ? ['Abierto para ausentes', 'warn'] : ['Abierto', 'good'];
  var acciones = '<div class="row">' +
    (ab ? '<button class="btn primary big" data-act="clase-estado" data-id="' + c.id + '" data-v="cerrado">Cerrar cuestionario</button>'
      : c.bancoId && c.estado === 'nuevo' ? '<button class="btn primary" data-act="clase-estado" data-id="' + c.id + '" data-v="abierto">Abrir ahora</button>'
      : c.bancoId ? '<button class="btn" data-act="clase-estado" data-id="' + c.id + '" data-v="abierto">Reabrir en clase</button><button class="btn" data-act="clase-estado" data-id="' + c.id + '" data-v="abierto" data-aus="1">Reabrir para ausentes</button>'
      : '<button class="btn primary" data-act="ir-asis" data-id="' + c.cursoId + '">Tomar asistencia</button>') + '</div>';
  var mas = '<div class="row">' + (c.bancoId && c.estado !== 'nuevo' ? '<button class="btn" data-act="ir-res" data-id="' + c.id + '">Resultados</button>' : '') +
    '<button class="btn" data-act="clase-editar" data-id="' + c.id + '">Editar</button>' + confirmar('clase:' + c.id, 'Eliminar', 'clase-borrar', 'data-id="' + c.id + '"') + '</div>';
  return '<article class="card' + (ab ? ' open' : '') + '"><div class="card-head"><h2>' + esc(c.titulo) + '</h2><span class="pill ' + est[1] + '">' + est[0] + '</span></div>' +
    '<p class="meta"><b>' + fmtDate(c.fecha) + '</b> · ' + esc(cu.nombre) + ' · ' + (c.bancoId ? c.porAlumno + ' preguntas por alumno · ' + c.segundos + ' s cada una · ' + c.hechos + ' de ' + cu.alumnos.length + ' terminaron' : 'solo asistencia') + '</p>' +
    (ab ? acciones + '<div class="live" id="vivo-' + c.id + '" aria-live="polite">' + vVivo(d.vivo[c.id]) + '</div>' + mas : acciones + mas) + '</article>';
}
function vClases() {
  var d = S.doc, p = d.p;
  if (d.fc) return vClaseForm();
  if (!p.cursos.length) return '<p class="empty">Primero cargá un curso en la pestaña Cursos.</p>';
  var abiertas = p.clases.filter(function (c) { return c.estado === 'abierto'; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
  var h = '<div class="stack">';
  if (abiertas.length) h += '<section class="stack ahora"><h2>Abierto ahora</h2>' + abiertas.map(tarjetaClase).join('') + '</section>';
  h += '<button class="btn big' + (abiertas.length ? '' : ' primary') + '" data-act="clase-nueva">Nueva clase</button>';
  if (p.cursos.length > 1) h += '<div class="field"><label for="s-fcurso">Mostrar</label><select id="s-fcurso"><option value="">Todos los cursos</option>' + opciones(p.cursos, d.fcurso, function (c) { return [c.id, c.nombre]; }) + '</select></div>';
  var lista = p.clases.filter(function (c) { return c.estado !== 'abierto' && (!d.fcurso || c.cursoId === d.fcurso); }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
  if (!lista.length && !abiertas.length) h += '<p class="empty">No hay clases en este cuatrimestre. Creá la primera.</p>';
  h += lista.map(tarjetaClase).join('');
  return h + selPer() + '</div>';
}
function vClaseForm() {
  var f = S.doc.fc, p = S.doc.p, ed = !!f.id;
  return '<form class="card" id="f-clase" novalidate><h2>' + (ed ? 'Editar clase' : 'Nueva clase') + '</h2>' +
    (ed ? '' : '<div class="field"><label for="fc-banco">Preguntas</label><select id="fc-banco">' + opciones(p.bancos, '', function (b) { return [b.id, b.titulo + ' (' + b.n + ' preguntas)']; }) +
      '<option value="">Sin cuestionario (solo asistencia)</option></select>' + (p.bancos.length ? '' : '<p class="hint">Todavía no cargaste preguntas: andá a la pestaña Preguntas. Sin preguntas, la clase sirve solo para asistencia.</p>') + '</div>') +
    '<div class="field"><label for="fc-titulo">Tema de la clase</label><input type="text" id="fc-titulo" value="' + esc(f.titulo || '') + '" placeholder="' + (ed ? '' : 'Si lo dejás vacío, usa el tema de las preguntas') + '" autocomplete="off"></div>' +
    (ed ? '' : '<fieldset class="field"><legend class="lbl-like">Cursos</legend><div class="checks">' + p.cursos.map(function (c) {
      return '<label class="check"><input type="checkbox" name="fc-curso" value="' + c.id + '"' + (p.cursos.length === 1 ? ' checked' : '') + '> ' + esc(c.nombre) + '</label>'; }).join('') +
      '</div><p class="hint">Se crea una clase por cada curso marcado, con las mismas preguntas.</p></fieldset>') +
    '<div class="two"><div class="field"><label for="fc-fecha">Fecha de la clase</label><input type="date" id="fc-fecha" value="' + esc(f.fecha) + '"></div>' +
    '<div class="field"><label for="fc-seg">Segundos por pregunta</label><input type="number" id="fc-seg" min="5" max="120" step="5" inputmode="numeric" value="' + f.segundos + '"></div></div>' +
    '<div class="field"><span class="lbl-like" id="por-lbl">Preguntas por alumno</span><div class="seg per" role="group" aria-labelledby="por-lbl">' + [5, 6, 7, 8, 9, 10].map(function (n) {
      return '<button type="button" data-act="por" data-v="' + n + '" aria-pressed="' + (n === f.por) + '">' + n + '</button>'; }).join('') + '</div>' +
    '<p class="hint">A cada alumno le tocan esas preguntas al azar, distintas para cada uno. Cada cuestionario vale 100 puntos, tenga 5 o 10.</p></div>' +
    '<div class="row"><button type="submit" class="btn primary">' + (ed ? 'Guardar cambios' : 'Crear clase') + '</button><button type="button" class="btn" data-act="cancelar">Cancelar</button></div></form>';
}

/* ----- bancos de preguntas ----- */
function previa(texto, una) {
  if (!String(texto || '').trim()) return '';
  var p = parseBlock(texto), h = '';
  if (p.questions.length && !p.errors.length) h += '<p class="msg ok">' + (una ? 'Pregunta lista' : p.questions.length + (p.questions.length === 1 ? ' pregunta lista' : ' preguntas listas')) + '</p>';
  else if (!p.errors.length) h += '<p class="msg err">No encontré preguntas. Cada opción va en su renglón, con una letra o un número adelante: a) b) c)</p>';
  p.errors.forEach(function (e) { h += '<p class="msg err">' + esc(e) + '</p>'; });
  p.warnings.forEach(function (w) { h += '<p class="msg wrn">' + esc(w) + '</p>'; });
  if (una && p.questions.length > 1) h += '<p class="msg err">Acá va una sola pregunta.</p>';
  p.questions.forEach(function (q, i) { h += '<div class="pq"><b>' + (i + 1) + '. ' + esc(q.text) + '</b>' + listaOpciones(q.options, q.correct) + '</div>'; });
  return h;
}
function listaOpciones(ops, ok) { return '<ol type="a">' + ops.map(function (o, j) { return '<li' + (j === ok ? ' class="c"' : '') + '>' + esc(o) + (j === ok ? ' (correcta)' : '') + '</li>'; }).join('') + '</ol>'; }
function aTexto(q) { return q.texto + '\n' + q.opciones.map(function (o, i) { return (i === q.correcta ? '*' : '') + 'abcdefghi'[i] + ') ' + o; }).join('\n'); }
var AYUDA_FORMATO = '<p class="hint">Pegá todas juntas. Cada opción va en su renglón con la letra adelante, y la correcta lleva un asterisco (*).</p><pre class="fmt">1. ¿Cuántos son los sacramentos?\na) Cinco\n*b) Siete\nc) Diez</pre>';
function vBancos() {
  var d = S.doc, p = d.p, h;
  if (d.fb) return '<form class="card" id="f-banco" novalidate><h2>Nuevas preguntas</h2>' +
    '<div class="field"><label for="fb-titulo">Tema</label><input type="text" id="fb-titulo" placeholder="Ej.: Los sacramentos" autocomplete="off"></div>' +
    '<div class="field"><label for="fb-texto">Preguntas</label>' + AYUDA_FORMATO + '<textarea id="fb-texto" data-previa="prev" rows="10" spellcheck="false" placeholder="Pegá acá las preguntas. Conviene cargar unas 20 por tema."></textarea></div>' +
    '<div id="prev" class="stack"></div><div class="row"><button type="submit" class="btn primary">Guardar</button><button type="button" class="btn" data-act="cancelar">Cancelar</button></div></form>';
  if (d.banco) {
    var b = d.banco;
    h = '<div class="stack"><button class="btn ghost" data-act="cancelar" style="align-self:flex-start">← Todos los temas</button><h2>' + esc(b.titulo) + '</h2>' +
      '<p class="hint">Si una pregunta salió mal, corregila o anulala: las notas de quienes ya rindieron se recalculan solas.</p>';
    b.preguntas.forEach(function (q, i) {
      if (d.edq === q.id) { h += '<form class="card" id="f-preg" novalidate><h3>Corregir la pregunta ' + (i + 1) + '</h3><textarea id="fp-texto" data-previa="prev-q" data-una="1" rows="6" spellcheck="false">' + esc(aTexto(q)) + '</textarea>' +
        '<div id="prev-q" class="stack"></div><div class="row"><button type="submit" class="btn primary">Guardar</button><button type="button" class="btn" data-act="preg-editar" data-id="">Cancelar</button></div></form>'; return; }
      h += '<article class="card"><div class="card-head"><b>' + (i + 1) + '. ' + esc(q.texto) + '</b>' + (q.anulada ? '<span class="pill crit">Anulada</span>' : '') + '</div>' + listaOpciones(q.opciones, q.correcta) +
        '<div class="row"><button class="btn" data-act="preg-editar" data-id="' + q.id + '">Corregir</button><button class="btn" data-act="preg-anular" data-id="' + q.id + '" data-v="' + (q.anulada ? '' : '1') + '">' + (q.anulada ? 'Volver a usar' : 'Anular') + '</button></div></article>';
    });
    return h + '<form class="card" id="f-mas" novalidate><h3>Agregar preguntas a este tema</h3><div class="field"><label for="fm-titulo">Tema</label><input type="text" id="fm-titulo" value="' + esc(b.titulo) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="fm-texto">Preguntas nuevas</label><textarea id="fm-texto" data-previa="prev-m" rows="6" spellcheck="false" placeholder="Mismo formato de pegado"></textarea></div><div id="prev-m" class="stack"></div>' +
      '<div class="row"><button type="submit" class="btn primary">Guardar</button></div></form></div>';
  }
  h = '<div class="stack"><button class="btn primary big" data-act="banco-nuevo">Nuevas preguntas</button>' +
    '<p class="hint">Cargá las preguntas de cada tema una sola vez. Después las usás en todos los cursos que quieras desde la pestaña Clases.</p>';
  if (!p.bancos.length) h += '<p class="empty">Todavía no cargaste preguntas.</p>';
  p.bancos.forEach(function (b) {
    h += '<article class="card"><div class="card-head"><h2>' + esc(b.titulo) + '</h2><span class="pill">' + b.n + ' preguntas</span></div>' +
      '<p class="meta">' + (b.usos ? 'Usado en ' + b.usos + (b.usos === 1 ? ' clase' : ' clases') : 'Todavía sin usar') + (b.anuladas ? ' · ' + b.anuladas + ' anuladas' : '') + '</p>' +
      '<div class="row"><button class="btn" data-act="banco-ver" data-id="' + b.id + '">Ver y corregir</button>' + (b.usos ? '' : confirmar('banco:' + b.id, 'Eliminar', 'banco-borrar', 'data-id="' + b.id + '"')) + '</div></article>';
  });
  return h + '</div>';
}

/* ----- resultados ----- */
function vResultados() {
  var d = S.doc, lista = conCuestionario();
  if (!lista.length) return '<div class="stack">' + selPer() + '<p class="empty">Cuando abras el primer cuestionario, acá vas a ver cómo le fue a cada curso.</p></div>';
  var h = '<div class="stack">' + selPer() + '<div class="field"><label for="s-res">Clase</label><select id="s-res">' + opciones(lista, d.resId, function (c) {
    return [c.id, fmtDate(c.fecha) + ' · ' + c.titulo + ' · ' + (cursoDe(c.cursoId) || {}).nombre]; }) + '</select></div>';
  var r = d.res;
  if (!r) return h + '<p class="empty">Cargando…</p></div>';
  var hechos = r.filas.filter(function (f) { return f.e === 'listo'; }), del = r.filas.length;
  var prom = hechos.length ? Math.round(hechos.reduce(function (s, f) { return s + f.puntos; }, 0) / hechos.length) : null;
  h += '<div class="tiles"><div class="tile"><b>' + hechos.length + '/' + del + '</b><span>terminaron</span></div>' +
    '<div class="tile"><b>' + (prom === null ? '–' : prom) + '</b><span>puntos promedio (de 100)</span></div>' +
    '<div class="tile"><b>' + r.filas.reduce(function (s, f) { return s + (f.salidas || 0); }, 0) + '</b><span>salidas de pantalla</span></div></div>';
  var vistas = r.preguntas.filter(function (q) { return q.vistas; }).sort(function (a, b) { return a.ok / a.vistas - b.ok / b.vistas; });
  if (vistas.length) {
    h += '<section class="card"><h2>Lo que más costó</h2><p class="meta">De menos a más aciertos, entre los alumnos a los que les tocó cada pregunta. Lo de arriba conviene retomarlo.</p>';
    vistas.forEach(function (q) {
      var pc = q.ok / q.vistas;
      h += '<div class="qbar"><div class="lbl"><span>' + esc(q.texto) + (q.anulada ? ' <span class="pill crit">Anulada</span>' : '') + '</span><b>' + q.ok + ' de ' + q.vistas + '</b></div><div class="track"><i class="' + nivel(pc) + '" style="width:' + Math.round(pc * 100) + '%"></i></div></div>';
    });
    var sin = r.preguntas.length - vistas.length;
    h += (sin ? '<p class="hint">' + sin + (sin === 1 ? ' pregunta no le tocó a nadie.' : ' preguntas no le tocaron a nadie.') + '</p>' : '') + '</section>';
  }
  h += '<section class="card"><h2>Por alumno</h2><div class="tbl-wrap"><table><thead><tr><th>Alumno</th><th class="n">Nota</th><th class="n">Seg.</th><th class="n">Salidas</th><th></th></tr></thead><tbody>';
  r.filas.forEach(function (f) {
    if (f.e === 'no') { h += '<tr><td>' + esc(f.nombre) + '</td><td class="n"><span class="pill plain">Sin responder</span></td><td class="n">–</td><td class="n">–</td><td></td></tr>'; return; }
    h += '<tr><td>' + esc(f.nombre) + (f.enCasa ? ' <span class="pill plain">en casa</span>' : '') + (f.e === 'rindiendo' ? ' <span class="pill warn">rindiendo</span>' : '') + (f.dup ? '<br><small class="hint">Mismo teléfono que ' + esc(f.dup) + '</small>' : '') + '</td>' +
      '<td class="n"><span class="pill ' + nivel(f.aciertos / Math.max(1, f.total)) + '">' + f.aciertos + ' de ' + f.total + '</span></td><td class="n">' + (f.seg === null ? '–' : String(f.seg).replace('.', ',')) + '</td><td class="n">' + f.salidas + '</td>' +
      '<td class="n">' + confirmar('int:' + f.intentoId, 'Reiniciar', 'intento-reiniciar', 'data-id="' + f.intentoId + '"') + '</td></tr>';
  });
  return h + '</tbody></table></div><p class="hint">Reiniciar borra el intento de ese alumno para que pueda rendir de nuevo.</p></section></div>';
}

/* ----- asistencia ----- */
var CELDA = { '-': ['–', 'none', 'sin tomar'], P: ['P', 'good', 'presente'], T: ['T', 'warn', 'tarde'], J: ['J', 'plain', 'justificado'], A: ['A', 'crit', 'ausente'], H: ['A', 'crit', 'ausente, rindió en casa'] };
var SIGUE = { '-': 'P', A: 'P', H: 'P', P: 'T', T: 'J', J: '' };
function vAsistencia() {
  var d = S.doc, p = d.p;
  if (!p.cursos.length) return '<p class="empty">Cargá un curso para ver su asistencia.</p>';
  var h = '<div class="stack">' + selPer() + '<div class="field"><label for="s-asis">Curso</label><select id="s-asis">' + opciones(p.cursos, d.asisCurso, function (c) { return [c.id, c.nombre]; }) + '</select></div>';
  var a = d.asis;
  if (!a) return h + '<p class="empty">Cargando…</p></div>';
  if (!a.clases.length) return h + '<p class="empty">Este curso todavía no tuvo clases en este cuatrimestre. Las clases preparadas y sin abrir no cuentan.</p></div>';
  h += '<section class="card"><div class="card-head"><h2>Resumen de ' + esc(a.curso) + '</h2><span class="pill">' + a.clases.length + (a.clases.length === 1 ? ' clase' : ' clases') + '</span></div>' +
    '<div class="tbl-wrap"><table><thead><tr><th>Alumno</th><th class="n">Asistencia</th><th class="n">Nota</th></tr></thead><tbody>' + a.filas.map(function (f) {
      return '<tr><td>' + esc(f.nombre) + '</td><td class="n">' + (f.pct === null ? '–' : '<span class="pill ' + nivel(f.pct / 100) + '">' + f.pct + '%</span> <small class="hint">' + f.presentes + ' de ' + f.clases + '</small>') + '</td>' +
        '<td class="n">' + (f.nota === null ? '–' : '<b>' + String(f.nota).replace('.', ',') + '</b>') + '</td></tr>'; }).join('') +
    '</tbody></table></div><p class="hint">La nota va de 1 a 10 y es el promedio de los cuestionarios que rindió. Es una sugerencia: la nota final la ponés vos.</p></section>';
  h += '<section class="card"><h2>Clase por clase</h2><div class="legend"><span><span class="pill good">P</span> presente</span><span><span class="pill warn">T</span> tarde</span><span><span class="pill plain">J</span> justificado</span><span><span class="pill crit">A</span> ausente</span></div>' +
    (a.clases.some(function (c) { return c.sinTomar; }) ? '<p class="hint"><span class="pill plain">–</span> clase sin cuestionario donde todavía no tomaste asistencia: no cuenta hasta que la marques.</p>' : '') +
    '<p class="hint">Tocá una celda para cambiarla: presente, tarde, justificado, y de vuelta. El número de abajo es lo que sacó en el cuestionario.</p>' +
    '<div class="tbl-wrap"><table class="grid"><thead><tr><th>Alumno</th>' + a.clases.map(function (c) {
      var x = fmtDate(c.fecha).split(' ');
      return '<th class="d" title="' + esc(c.titulo) + '">' + x[0] + '<br>' + x[1] +
        (c.sinTomar ? '<button class="todos" data-act="marca-todos" data-id="' + c.id + '" aria-label="Marcar a todos presentes el ' + fmtDate(c.fecha) + '">Todos presentes</button>' : '') + '</th>';
    }).join('') + '</tr></thead><tbody>';
  a.filas.forEach(function (f) {
    h += '<tr><td>' + esc(f.nombre) + '</td>' + f.celdas.map(function (c, i) {
      var k = CELDA[c.k];
      return '<td><button class="cell-btn ' + k[1] + '" data-act="marca" data-c="' + a.clases[i].id + '" data-a="' + f.id + '" data-k="' + c.k + '" aria-label="' + esc(f.nombre) + ', ' + fmtDate(a.clases[i].fecha) + ': ' + k[2] + '">' + k[0] + '</button>' +
        '<small class="nota">' + (c.k === 'H' ? 'casa ' : '') + (c.nota || '&nbsp;') + '</small></td>'; }).join('') + '</tr>';
  });
  h += '</tbody></table></div></section>';
  return h + '<div class="stack"><button class="btn primary big" data-act="copiar-asis">Copiar planilla</button><p class="hint">Se pega directo en Google Sheets o Excel, con la fecha y el tema de cada clase como columnas.</p><div id="copy-msg"></div></div></div>';
}
function asisTSV(a) {
  var filas = [['Alumno'].concat(a.clases.map(function (c) { return fmtFull(c.fecha) + ' - ' + c.titulo; }), ['Presentes', 'Clases', 'Asistencia', 'Nota'])];
  a.filas.forEach(function (f) {
    filas.push([f.nombre].concat(f.celdas.map(function (c) {
      return c.k === '-' ? '' : c.k === 'H' ? 'A (rindió en casa ' + c.nota.replace('/', ' de ') + ')' : c.k + (c.nota ? ' (' + c.nota.replace('/', ' de ') + ')' : ''); }),
      [f.presentes, f.clases, f.pct === null ? '' : f.pct + '%', f.nota === null ? '' : String(f.nota).replace('.', ',')]));
  });
  return filas.map(function (r) { return r.map(function (x) { return String(x).replace(/[\t\n]/g, ' '); }).join('\t'); }).join('\n');
}

/* ----- tabla y cursos ----- */
function vTablaDoc() {
  var d = S.doc;
  if (!d.p.cursos.length) return '<p class="empty">Todavía no hay cursos cargados.</p>';
  return '<div class="stack">' + selPer() + ((d.alcance || 'curso') === 'curso' ? '<div class="field"><label for="s-tabla">Curso</label><select id="s-tabla">' + opciones(d.p.cursos, d.tablaCurso, function (c) { return [c.id, c.nombre + (c.oculta ? ' (oculta para los alumnos)' : '')]; }) + '</select></div>' : '') +
    vTabla(d.tabla, d.alcance || 'curso', false) + '</div>';
}
function vCursos() {
  var d = S.doc, p = d.p, h = '<div class="stack">';
  if (d.cf) h += '<form class="card" id="f-curso" novalidate><h2>Nuevo curso</h2><div class="field"><label for="c-nombre">Nombre del curso</label><input type="text" id="c-nombre" placeholder="Ej.: 3° B" autocomplete="off"></div>' +
    '<div class="field"><label for="c-alumnos">Alumnos</label><p class="hint">Un nombre por renglón. Podés pegar la lista completa.</p><textarea id="c-alumnos" rows="8" placeholder="Apellido y nombre"></textarea></div>' +
    '<div class="row"><button type="submit" class="btn primary">Guardar curso</button><button type="button" class="btn" data-act="cancelar">Cancelar</button></div></form>';
  else h += '<button class="btn primary big" data-act="curso-nuevo">Nuevo curso</button>';
  if (!p.cursos.length && !d.cf) h += '<p class="empty">Todavía no hay cursos cargados.</p>';
  p.cursos.forEach(function (c) {
    var ab = d.cursoAbierto === c.id;
    h += '<article class="card"><div class="card-head"><h2>' + esc(c.nombre) + '</h2><span class="pill">' + c.alumnos.length + ' alumnos</span></div>' +
      '<div class="pinbox"><div><span class="meta">PIN para entrar</span><b>' + c.pin + '</b></div><div class="pinlado"><span class="meta">Vale hasta las ' + hora(c.vence) + '</span>' +
      '<button class="btn" data-act="pin-nuevo" data-id="' + c.id + '">Generar otro</button></div></div>' +
      '<p class="hint">Solo vos ves este número. Decilo en clase: cambia solo cada 4 horas, y el anterior deja de servir.</p>' +
      '<div class="row"><button class="btn" data-act="curso-abrir" data-id="' + (ab ? '' : c.id) + '">' + (ab ? 'Ocultar alumnos' : 'Ver y editar alumnos') + '</button>' +
      '<button class="btn" data-act="curso-tabla" data-id="' + c.id + '">' + (c.oculta ? 'Mostrar la tabla a los alumnos' : 'Ocultar la tabla a los alumnos') + '</button></div>';
    if (ab) {
      h += '<div class="alumnos">' + c.alumnos.map(function (a) {
        if (d.eda === a.id) return '<form class="row" id="f-alumno" novalidate><input type="text" id="a-nombre" value="' + esc(a.nombre) + '" autocomplete="off" aria-label="Nombre del alumno"><button type="submit" class="btn primary">Guardar</button><button type="button" class="btn" data-act="alumno-editar" data-id="">Cancelar</button></form>';
        return '<div class="row al"><span>' + esc(a.nombre) + '</span><span class="row"><button class="btn ghost" data-act="alumno-editar" data-id="' + a.id + '">Corregir</button>' + confirmar('al:' + a.id, 'Dar de baja', 'alumno-baja', 'data-id="' + a.id + '"') + '</span></div>';
      }).join('') + '</div><p class="hint">Dar de baja saca al alumno de las listas pero conserva sus notas.</p>' +
        '<form class="stack" id="f-mas-al" novalidate><div class="field"><label for="m-alumnos">Agregar alumnos</label><textarea id="m-alumnos" rows="3" placeholder="Un nombre por renglón"></textarea></div><div class="row"><button type="submit" class="btn primary">Agregar</button>' +
        confirmar('curso:' + c.id, 'Eliminar curso', 'curso-borrar', 'data-id="' + c.id + '"') + '</div></form>';
    }
    h += '</article>';
  });
  var anio = p.hoy.slice(0, 4);
  return h + '<form class="card" id="f-corte" novalidate><h2>Cuatrimestres</h2><p class="meta">La tabla de posiciones, la asistencia y la nota se calculan por cuatrimestre.</p>' +
    '<div class="field" style="max-width:260px"><label for="corte">El segundo cuatrimestre empieza el</label><input type="date" id="corte" value="' + anio + '-' + p.corte + '"></div>' +
    '<div class="row"><button type="submit" class="btn">Guardar fecha</button></div></form></div>';
}

/* ----- control en vivo: se refresca solo mientras hay un cuestionario abierto ----- */
function sondear() {
  var d = S.doc;
  if (S.rol !== 'docente' || !d.tk || !d.p || document.hidden) return;
  if (d.tab === 'cursos' && !d.cf && !d.cursoAbierto && d.p.cursos.some(function (c) { return c.vence - d.p.ahora < Date.now() - d.cargado; })) { recargar().catch(function () {}); return; }   // venció un PIN: trae el nuevo
  if (d.tab !== 'clases' || d.fc) return;
  d.p.clases.filter(function (c) { return c.estado === 'abierto'; }).forEach(function (c) {
    call('vivo', { claseId: c.id }, true).then(function (v) { d.vivo[c.id] = v; var e = $('vivo-' + c.id); if (e) e.innerHTML = vVivo(v); }, function () {});
  });
}
setInterval(sondear, 5000);

/* ================= marco y eventos ================= */
function render() {
  if (S.rol === 'alumno' && S.al.v === 'run' && S.al.run) { app.innerHTML = vRun(); return; }
  /* El alumno no ve el acceso del docente arriba: el docente entra con el enlace terminado en #docente
     o con "Acceso docente", al pie de la lista de cursos. */
  var h = '<header class="top"><div class="brand"><h1>Evaluá</h1>' + (S.rol === 'docente' ? '<span class="pill">Docente</span>' : '') +
    (DEMO ? '<span class="pill warn">Demostración</span>' : '') + '</div></header>';
  if (DEMO) h += '<p class="note">Demostración: el servidor está simulado dentro de este navegador y los datos quedan solo en este dispositivo.</p>';
  app.innerHTML = h + (S.rol === 'docente' ? vDocente() : vAlumno());
}
function arrancar() {
  render();
  if (S.rol === 'docente') return S.doc.tk ? recargar().then(cargarTab) : Promise.resolve();
  var a = S.al;
  if (a.v === 'run') return Promise.resolve();
  if (a.tk && a.alumnoId) return irHome();
  if (a.cursoId) { a.v = 'pin'; render(); return Promise.resolve(); }
  return irCursos();
}

var A = {
  rol: function (d) { S.rol = d.v; S.confirm = null; try { history.replaceState(null, '', '#' + d.v); } catch (e) {} return arrancar(); },
  preguntar: function (d) { S.confirm = d.clave; render(); },
  cancelar: function () { var d = S.doc; d.fc = d.fb = d.banco = d.cf = null; render(); },
  /* alumno */
  'elegir-curso': function (d) { S.al.cursoId = d.id; S.al.cursoNombre = d.n; S.al.v = 'pin'; render(); var p = $('pin'); if (p) p.focus(); },
  'otro-curso': function () { return irCursos(); },
  'elegir-alumno': function (d) { return todo([{ a: 'soy', alumnoId: d.id }, { a: 'inicio' }]).then(function (r) { S.al.alumnoId = d.id; S.al.nombre = d.n; ponerHome(r[1]); }); },
  'al-home': function () { return irHome(); },
  'al-tabla': function () { return call('tabla').then(function (t) { S.al.tabla = t; S.al.alcance = 'curso'; S.al.v = 'tabla'; render(); }); },
  alcance: function (d) { if (S.rol === 'docente') S.doc.alcance = d.v; else S.al.alcance = d.v; render(); },
  intro: function (d) { S.al.clase = S.al.home.clases.filter(function (c) { return c.id === d.id; })[0]; S.al.v = 'intro'; render(); },
  empezar: function (d) { S.al.claseId = d.id; return call('empezar', { claseId: d.id }).then(ponerPregunta); },
  responder: function (d) { responder(Number(d.di)); },
  reintentar: function () { return mandarRespuesta(); },
  revision: function (d) { return call('revision', { claseId: d.id }).then(function (r) { S.al.rev = r; S.al.v = 'rev'; render(); }); },
  /* docente */
  salir: function () { S.doc = { tk: null, tab: 'clases', vivo: {} }; guardado('ev-doc', null, sessionStorage); S.rol = 'alumno'; return arrancar(); },
  tab: function (d) { var x = S.doc; x.tab = d.v; x.fc = x.fb = x.banco = x.cf = null; S.confirm = null; render(); sondear(); return cargarTab(); },
  'clase-nueva': function () { S.doc.fc = { fecha: S.doc.p.hoy, segundos: 20, por: 5 }; render(); },
  'clase-editar': function (d) { var c = claseDe(d.id); S.doc.fc = { id: c.id, titulo: c.titulo, fecha: c.fecha, segundos: c.segundos || 20, por: c.porAlumno || 5 }; render(); },
  por: function (d) { S.doc.fc.por = Number(d.v); document.querySelectorAll('[data-act="por"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === d.v)); }); },
  'clase-estado': function (d) { return hacer('clase.estado', { id: d.id, estado: d.v, ausentes: !!d.aus }, d.v === 'abierto' ? (d.aus ? 'Abierto para los ausentes.' : 'Cuestionario abierto.') : 'Cuestionario cerrado.'); },
  'clase-borrar': function (d) { return hacer('clase.borrar', { id: d.id }, 'Clase eliminada.'); },
  'ir-res': function (d) { S.doc.tab = 'resultados'; S.doc.resId = d.id; render(); return cargarRes(); },
  'ir-asis': function (d) { S.doc.tab = 'asistencia'; S.doc.asisCurso = d.id; render(); return cargarAsis(); },
  'banco-nuevo': function () { S.doc.fb = true; render(); },
  'banco-ver': function (d) { return cargarBanco(d.id); },
  'banco-borrar': function (d) { return hacer('banco.borrar', { id: d.id }, 'Tema eliminado.'); },
  'preg-editar': function (d) { S.doc.edq = d.id || null; render(); var t = $('fp-texto'); if (t) $('prev-q').innerHTML = previa(t.value, true); },
  'preg-anular': function (d) { return todo([{ a: 'pregunta.anular', id: d.id, anulada: !!d.v }, { a: 'banco.ver', id: S.doc.banco.id }, pPanel()]).then(function (r) { aviso(d.v ? 'Pregunta anulada. Notas recalculadas.' : 'La pregunta vuelve a contar.'); S.doc.p = r[2]; S.doc.cargado = Date.now(); ponerBanco(r[1]); }); },
  'intento-reiniciar': function (d) {
    var x = S.doc;
    return todo([{ a: 'intento.reiniciar', id: d.id }, pPanel(), { a: 'resultados', claseId: x.resId }]).then(function (r) { S.confirm = null; aviso('Intento reiniciado.'); x.res = r[2]; ponerPanel(r[1]); });
  },
  marca: function (d) { var x = S.doc; return todo([{ a: 'marca', claseId: d.c, alumnoId: d.a, estado: SIGUE[d.k] }, { a: 'asistencia', cursoId: x.asisCurso, periodo: x.per }]).then(function (r) { x.asis = r[1]; render(); }); },
  'marca-todos': function (d) { var x = S.doc; return todo([{ a: 'marca.todos', claseId: d.id }, { a: 'asistencia', cursoId: x.asisCurso, periodo: x.per }]).then(function (r) { x.asis = r[1]; render(); }); },
  'copiar-asis': function () {
    var tsv = asisTSV(S.doc.asis), listo = function (ok) {
      var m = $('copy-msg'); if (!m) return;
      m.innerHTML = ok ? '<p class="msg ok">Planilla copiada. Pegala en la primera celda de una hoja de cálculo.</p>'
        : '<p class="msg wrn">Este navegador no dejó copiar. Mantené apretado el texto de abajo, seleccioná todo y copialo.</p><textarea rows="6" readonly>' + esc(tsv) + '</textarea>';
    };
    try { navigator.clipboard.writeText(tsv).then(function () { listo(true); }, function () { listo(false); }); } catch (e) { listo(false); }
  },
  'curso-nuevo': function () { S.doc.cf = true; render(); },
  'curso-abrir': function (d) { S.doc.cursoAbierto = d.id || null; S.doc.eda = null; render(); },
  'curso-tabla': function (d) { var c = cursoDe(d.id); return hacer('curso.guardar', { id: c.id, nombre: c.nombre, oculta: !c.oculta }, c.oculta ? 'Los alumnos vuelven a ver la tabla.' : 'Tabla oculta para este curso.'); },
  'curso-borrar': function (d) { return hacer('curso.borrar', { id: d.id }, 'Curso eliminado.'); },
  'pin-nuevo': function (d) { return hacer('pin.nuevo', { cursoId: d.id }, 'PIN nuevo. El anterior ya no sirve.'); },
  'alumno-editar': function (d) { S.doc.eda = d.id || null; render(); var i = $('a-nombre'); if (i) i.focus(); },
  'alumno-baja': function (d) { return hacer('alumno.guardar', { id: d.id, baja: true }, 'Alumno dado de baja.'); }
};

var F = {   // formularios
  'f-pin': function () { var pin = val('pin').trim(); if (!/^\d{4}$/.test(pin)) { aviso('El PIN son 4 números.', 'err'); return; } return entrar(pin); },
  'f-login': function () { return todo([{ a: 'login', clave: val('clave') }, pPanel()]).then(function (r) { S.doc.tk = r[0].tk; guardado('ev-doc', r[0].tk, sessionStorage); ponerPanel(r[1]); }); },
  'f-clase': function () {
    var f = S.doc.fc, cursos = [];
    document.querySelectorAll('input[name="fc-curso"]:checked').forEach(function (c) { cursos.push(c.value); });
    return todo([{ a: 'clase.guardar', id: f.id || '', bancoId: val('fc-banco'), titulo: val('fc-titulo'), cursoIds: cursos, fecha: val('fc-fecha'), segundos: val('fc-seg'), porAlumno: f.por }, pPanel()])
      .then(function (r) { S.doc.fc = null; aviso(f.id ? 'Clase guardada.' : cursos.length > 1 ? 'Se crearon ' + cursos.length + ' clases.' : 'Clase creada. Abrila cuando empiece.'); ponerPanel(r[1]); });
  },
  'f-banco': function () { return todo([{ a: 'banco.guardar', titulo: val('fb-titulo'), texto: val('fb-texto') }, pPanel()]).then(function (r) { S.doc.fb = null; aviso('Preguntas guardadas.'); ponerPanel(r[1]); }); },
  'f-mas': function () { var b = S.doc.banco; return todo([{ a: 'banco.guardar', id: b.id, titulo: val('fm-titulo'), texto: val('fm-texto') }, { a: 'banco.ver', id: b.id }, pPanel()]).then(function (r) { aviso('Guardado.'); S.doc.p = r[2]; S.doc.cargado = Date.now(); ponerBanco(r[1]); }); },
  'f-preg': function () { return todo([{ a: 'pregunta.guardar', id: S.doc.edq, texto: val('fp-texto') }, { a: 'banco.ver', id: S.doc.banco.id }]).then(function (r) { aviso('Pregunta corregida. Notas recalculadas.'); ponerBanco(r[1]); }); },
  'f-curso': function () { return todo([{ a: 'curso.guardar', nombre: val('c-nombre'), alumnos: val('c-alumnos') }, pPanel()]).then(function (r) { S.doc.cf = null; aviso('Curso guardado.'); ponerPanel(r[1]); }); },
  'f-alumno': function () { return hacer('alumno.guardar', { id: S.doc.eda, nombre: val('a-nombre') }, 'Nombre corregido.').then(function () { S.doc.eda = null; render(); }); },
  'f-mas-al': function () { var c = cursoDe(S.doc.cursoAbierto); if (!val('m-alumnos').trim()) { aviso('Escribí al menos un nombre.', 'err'); return; } return hacer('curso.guardar', { id: c.id, nombre: c.nombre, oculta: c.oculta, alumnos: val('m-alumnos') }, 'Alumnos agregados.'); },
  'f-corte': function () { return hacer('config.guardar', { corte: val('corte').slice(5) }, 'Fecha guardada.'); }
};

function correr(f, x) { try { var r = f(x); if (r && r.catch) r.catch(fallo); } catch (e) { fallo(e); } }
document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-act]');
  if (!b || !A[b.dataset.act]) return;
  if (b.dataset.act !== 'preguntar' && S.confirm && S.confirm !== b.dataset.clave) S.confirm = null;
  correr(A[b.dataset.act], b.dataset);
});
document.addEventListener('submit', function (ev) { ev.preventDefault(); if (F[ev.target.id]) correr(F[ev.target.id]); });
document.addEventListener('input', function (ev) { var t = ev.target; if (t.dataset && t.dataset.previa) $(t.dataset.previa).innerHTML = previa(t.value, !!t.dataset.una); });
document.addEventListener('change', function (ev) {
  var t = ev.target, d = S.doc;
  if (t.id === 's-per') { d.per = t.value; correr(function () { return recargar().then(cargarTab); }); }
  if (t.id === 's-fcurso') { d.fcurso = t.value; render(); sondear(); }
  if (t.id === 's-res') { d.resId = t.value; correr(cargarRes); }
  if (t.id === 's-asis') { d.asisCurso = t.value; correr(cargarAsis); }
  if (t.id === 's-tabla') { d.tablaCurso = t.value; correr(cargarTabla); }
});
document.addEventListener('visibilitychange', function () {
  if (S.rol === 'alumno' && S.al.v === 'run' && document.hidden) call('salida', { claseId: S.al.claseId }, true).catch(function () {});
});
window.addEventListener('hashchange', function () { var r = location.hash === '#docente' ? 'docente' : 'alumno'; if (r !== S.rol && S.al.v !== 'run') { S.rol = r; correr(arrancar); } });
if (DEMO) {   // sin servidor configurado: carga el servidor simulado y sus datos de ejemplo
  var sd = document.createElement('script');
  sd.src = 'demo.js';
  sd.onload = function () { correr(arrancar); };
  sd.onerror = function () { app.innerHTML = '<p class="empty">Falta configurar la dirección del servidor en index.html.</p>'; };
  document.head.appendChild(sd);
} else correr(arrancar);
