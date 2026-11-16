/* Evaluá: conexión con Google Sheets.
   Este archivo va en el editor de Apps Script de la planilla, junto con Core.gs (una copia exacta de core.js).
   Acá no hay reglas: solo leer y escribir la planilla. Las reglas están en Core.gs.

   Puesta en marcha (una sola vez):
   1. En la planilla: Extensiones > Apps Script. Pegar este archivo como Code.gs y core.js como Core.gs.
   2. Ejecutar la función `preparar`. Crea las pestañas y una contraseña de docente en la pestaña Config.
   3. Implementar > Nueva implementación > Aplicación web. Ejecutar como: yo. Acceso: cualquier persona.
   4. Copiar la dirección que termina en /exec y pegarla en API_URL, al principio de index.html. */

function hojasDb_(cache) {
  var ss = SpreadsheetApp.getActive(), memo = {}, hojas = {};
  function hoja(t) {
    if (hojas[t]) return hojas[t];
    var h = ss.getSheetByName(t);
    if (!h) {
      h = ss.insertSheet(t);
      h.getRange(1, 1, h.getMaxRows(), TABLAS[t].length).setNumberFormat('@');   // todo como texto: así "0042" y "2027-03-08" no cambian
      h.getRange(1, 1, 1, TABLAS[t].length).setValues([TABLAS[t]]).setFontWeight('bold');
      h.setFrozenRows(1);
    }
    var cab = h.getRange(1, 1, 1, TABLAS[t].length).getDisplayValues()[0];      // agrega columnas nuevas si la tabla creció
    if (cab.join('|') !== TABLAS[t].join('|')) {
      h.getRange(1, 1, h.getMaxRows(), TABLAS[t].length).setNumberFormat('@');
      h.getRange(1, 1, 1, TABLAS[t].length).setValues([TABLAS[t]]).setFontWeight('bold');
    }
    return (hojas[t] = h);
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
      var h = hoja(t), n = h.getLastRow(), cols = TABLAS[t];
      var v = n > 1 ? h.getRange(2, 1, n - 1, cols.length).getDisplayValues() : [];
      memo[t] = v.map(function (r, i) {
        var o = {};
        cols.forEach(function (k, j) { o[k] = r[j]; });
        return o;
      }).filter(function (o) { return o.id !== ''; });
      return memo[t];
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
      return true;
    },
    /* Borrar vacía el renglón en vez de eliminarlo, para que los demás no cambien de lugar. */
    remove: function (t, id) {
      var n = renglon(t, id);
      if (!n) return;
      hoja(t).getRange(n, 1, 1, TABLAS[t].length).clearContent();
      cache.remove('fila:' + t + ':' + id);
      delete memo[t];
    }
  };
  return db;
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
  var out;
  try { out = api(contexto_(), JSON.parse(e.postData.contents)); }
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
