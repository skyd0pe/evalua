/* Evaluá: conexión con Google Sheets.
   Este archivo va en el editor de Apps Script de la planilla, junto con Core.gs (una copia exacta de core.js).
   Acá no hay reglas: solo leer y escribir la planilla. Las reglas están en Core.gs.

   Puesta en marcha (una sola vez):
   1. En la planilla: Extensiones > Apps Script. Pegar este archivo como Code.gs y core.js como Core.gs.
   2. Ejecutar la función `preparar`. Crea las pestañas y una contraseña de docente en la pestaña Config.
   3. Implementar > Nueva implementación > Aplicación web. Ejecutar como: yo. Acceso: cualquier persona.
   4. Copiar la dirección que termina en /exec y pegarla en API_URL, al principio de index.html. */

/* Copia de las pestañas en la memoria rápida de Google (CacheService). Leer la planilla cuesta 0,2 a 0,5 segundos por
   pestaña; la memoria rápida, casi nada. Cada pestaña tiene una "versión": al escribir desde la app, o al editar la planilla
   a mano (onEdit, abajo), la versión cambia y la copia vieja deja de usarse. Intentos no se copia: cambia con cada respuesta. */
var EN_MEMORIA = ['Config', 'Cursos', 'Alumnos', 'Bancos', 'Preguntas', 'Clases', 'Marcas', 'Pines'];
var TROZO = 40000, VIVE = 600;          // la memoria rápida guarda hasta 100 KB por clave; la copia dura 10 minutos como mucho

function hojasDb_(cache) {
  var ss = SpreadsheetApp.getActive(), memo = {}, hojas = null, listas = {}, vers = null;
  function hoja(t) {
    if (listas[t]) return listas[t];
    if (!hojas) { hojas = {}; ss.getSheets().forEach(function (x) { hojas[x.getName()] = x; }); }   // todas de una vez
    var h = hojas[t];
    if (!h) {
      h = hojas[t] = ss.insertSheet(t);
      h.getRange(1, 1, h.getMaxRows(), TABLAS[t].length).setNumberFormat('@');   // todo como texto: así "0042" y "2027-03-08" no cambian
      h.getRange(1, 1, 1, TABLAS[t].length).setValues([TABLAS[t]]).setFontWeight('bold');
      h.setFrozenRows(1);
    }
    var kc = 'cab:' + t, esperada = TABLAS[t].join('|');                     // agrega columnas nuevas si la tabla creció
    if (cache.get(kc) !== esperada) {                                          // (se revisa una vez cada 6 horas, no en cada pedido)
      var cab = h.getRange(1, 1, 1, TABLAS[t].length).getDisplayValues()[0];
      if (cab.join('|') !== esperada) {
        h.getRange(1, 1, h.getMaxRows(), TABLAS[t].length).setNumberFormat('@');
        h.getRange(1, 1, 1, TABLAS[t].length).setValues([TABLAS[t]]).setFontWeight('bold');
      }
      cache.put(kc, esperada, 21600);
    }
    return (listas[t] = h);
  }
  function copiable(t) { return EN_MEMORIA.indexOf(t) >= 0; }
  function version(t) {
    if (!vers) vers = cache.getAll(EN_MEMORIA.map(function (x) { return 'ver:' + x; })) || {};   // todas de una vez
    var v = vers['ver:' + t];
    if (!v) { v = Utilities.getUuid().slice(0, 8); cache.put('ver:' + t, v, 21600); vers['ver:' + t] = v; }
    return v;
  }
  /* Después de escribir: primero se asegura que la planilla tenga lo nuevo, después cambia la versión. */
  function cambio(t) {
    if (!copiable(t)) return;
    SpreadsheetApp.flush();
    var v = Utilities.getUuid().slice(0, 8);
    cache.put('ver:' + t, v, 21600);
    if (vers) vers['ver:' + t] = v;
  }
  function copiaGuardada(t, v) {
    var k = 'dat:' + t + ':' + v + ':', p = cache.get(k + 0);
    if (p === null || p === undefined) return null;
    var i = p.indexOf('|'), n = Number(p.slice(0, i)), txt = p.slice(i + 1);
    if (n > 1) {
      var claves = [];
      for (var j = 1; j < n; j++) claves.push(k + j);
      var m = cache.getAll(claves) || {};
      for (j = 1; j < n; j++) { if (typeof m[k + j] !== 'string') return null; txt += m[k + j]; }
    }
    try { return JSON.parse(txt); } catch (e) { return null; }
  }
  function guardarCopia(t, v, filas) {
    var txt = JSON.stringify(filas), n = Math.max(1, Math.ceil(txt.length / TROZO)), o = {}, k = 'dat:' + t + ':' + v + ':';
    if (n > 20) return;                                                        // demasiado grande: se sigue leyendo de la planilla
    for (var j = 0; j < n; j++) o[k + j] = (j ? '' : n + '|') + txt.slice(j * TROZO, (j + 1) * TROZO);
    try { cache.putAll(o, VIVE); } catch (e) { console.warn('No se pudo guardar la copia de ' + t + ': ' + e); }
  }
  function fila(t, o) { return TABLAS[t].map(function (k) { var v = o[k]; return v === undefined || v === null ? '' : String(v); }); }
  /* Dónde está cada renglón. Los renglones nunca se mueven (borrar solo los vacía), así que el número guardado sigue valiendo;
     igual se verifica que la primera celda tenga el id antes de escribir. */
  function renglon(t, id) {
    var h = hoja(t), k = 'fila:' + t + ':' + id, n = Number(cache.get(k));
    if (n > 1 && n <= h.getLastRow() && h.getRange(n, 1).getDisplayValue() === id) return n;
    var ids = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 1).getDisplayValues() : [];
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) { cache.put(k, String(i + 2), 21600); return i + 2; }
    return 0;
  }
  var db = {
    all: function (t) {
      if (memo[t]) return memo[t];
      var cols = TABLAS[t], v = copiable(t) ? version(t) : null, filas = v ? copiaGuardada(t, v) : null;
      if (!filas) {
        var h = hoja(t), n = h.getLastRow();
        filas = (n > 1 ? h.getRange(2, 1, n - 1, cols.length).getDisplayValues() : []).filter(function (r) { return r[0] !== ''; });
        if (v) guardarCopia(t, v, filas);
      }
      memo[t] = filas.map(function (r) {
        var o = {};
        cols.forEach(function (k, j) { o[k] = r[j] === undefined ? '' : r[j]; });
        return o;
      });
      return memo[t];
    },
    /* Un renglón por id. Las pestañas copiadas salen de la copia; Intentos, del renglón (el número queda guardado). */
    get: function (t, id) {
      if (memo[t] || copiable(t)) return db.all(t).filter(function (o) { return o.id === id; })[0] || null;
      var n = renglon(t, id);
      if (!n) return null;
      var r = hoja(t).getRange(n, 1, 1, TABLAS[t].length).getDisplayValues()[0], o = {};
      TABLAS[t].forEach(function (k, j) { o[k] = r[j]; });
      return o.id === id ? o : null;
    },
    insert: function (t, o) { db.insertMany(t, [o]); },
    /* Agregar renglones es lo único que necesita turno: dos alumnos agregando a la vez se pisarían. */
    insertMany: function (t, os) {
      if (!os.length) return;
      var h = hoja(t), filas = os.map(function (o) { return fila(t, o); }), l = LockService.getScriptLock();
      l.waitLock(30000);
      try {
        var desde = h.getLastRow() + 1, max = h.getMaxRows();
        if (desde + filas.length > max - 20) {                                     // antes de quedarse sin renglones, agrega más ya con formato de texto
          h.insertRowsAfter(max, 500 + filas.length);
          h.getRange(max + 1, 1, 500 + filas.length, TABLAS[t].length).setNumberFormat('@');
        }
        h.getRange(desde, 1, filas.length, TABLAS[t].length).setValues(filas);
        SpreadsheetApp.flush();
        os.forEach(function (o, i) { cache.put('fila:' + t + ':' + o.id, String(desde + i), 21600); });
      } finally { l.releaseLock(); }
      delete memo[t];
      cambio(t);
    },
    /* Cambia solo las celdas pedidas, sin tocar el resto del renglón. */
    update: function (t, id, p) {
      var n = renglon(t, id), h = hoja(t);
      if (!n) return false;
      Object.keys(p).forEach(function (k) {
        var c = TABLAS[t].indexOf(k);
        if (c >= 0) h.getRange(n, c + 1).setValue(String(p[k]));
      });
      if (memo[t]) memo[t].forEach(function (o) { if (o.id === id) Object.keys(p).forEach(function (k) { o[k] = String(p[k]); }); });
      cambio(t);
      return true;
    },
    /* Borrar vacía el renglón en vez de eliminarlo, para que los demás no cambien de lugar. */
    remove: function (t, id) {
      var n = renglon(t, id);
      if (!n) return;
      hoja(t).getRange(n, 1, 1, TABLAS[t].length).clearContent();
      cache.remove('fila:' + t + ':' + id);
      delete memo[t];
      cambio(t);
    }
  };
  return db;
}

/* Si alguien edita la planilla a mano (por ejemplo, la contraseña en Config), la copia de esa pestaña deja de usarse al instante. */
function onEdit(e) {
  try {
    var t = e && e.range ? e.range.getSheet().getName() : '';
    if (EN_MEMORIA.indexOf(t) >= 0) CacheService.getScriptCache().remove('ver:' + t);
  } catch (err) {}
}

function contexto_() {
  var cache = CacheService.getScriptCache(), zona = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return {
    db: hojasDb_(cache),
    now: function () { return Date.now(); },
    hoy: function () { return Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd'); },
    rand: function () { return Utilities.getUuid(); },
    lock: function (f) {
      var l = LockService.getScriptLock();
      l.waitLock(10000);
      try { f(); } finally { l.releaseLock(); }
    },
    cache: {
      get: function (k) { return cache.get(k); },
      put: function (k, v, ttl) { cache.put(k, String(v), Math.min(21600, Math.max(1, Math.round(ttl)))); },
      remove: function (k) { cache.remove(k); }
    }
  };
}

function doPost(e) {
  var out, t0 = Date.now();
  try { out = api(contexto_(), JSON.parse(e.postData.contents)); out.ms = Date.now() - t0; }   // ms: lo que tardó el servidor, para medir
  catch (err) { console.error(err && err.stack || err); out = { ok: false, error: 'Hubo un problema en el servidor. Probá de nuevo.' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return ContentService.createTextOutput('Evaluá está funcionando.'); }

/* Ejecutar una sola vez desde el editor. */
function preparar() {
  var ctx = contexto_();
  Object.keys(TABLAS).forEach(function (t) { ctx.db.all(t); });
  if (!uno(ctx, 'Config', 'clave')) ctx.db.insert('Config', { id: 'clave', valor: Utilities.getUuid().replace(/-/g, '').slice(0, 12) });
  if (!uno(ctx, 'Config', 'corte')) ctx.db.insert('Config', { id: 'corte', valor: '07-15' });
  SpreadsheetApp.getActive().toast('Listo. La contraseña de docente está en la pestaña Config, fila "clave". Podés cambiarla ahí.');
}
