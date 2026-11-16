/* Evaluá: conexión con Google Sheets.
   Este archivo va en el editor de Apps Script de la planilla, junto con Core.gs (una copia exacta de core.js).
   Acá no hay reglas: solo leer y escribir la planilla. Las reglas están en Core.gs.

   Puesta en marcha (una sola vez):
   1. En la planilla: Extensiones > Apps Script. Pegar este archivo como Code.gs y core.js como Core.gs.
   2. Ejecutar la función `preparar`. Crea las pestañas y una contraseña de docente en la pestaña Config.
   3. Implementar > Nueva implementación > Aplicación web. Ejecutar como: yo. Acceso: cualquier persona.
   4. Copiar la dirección que termina en /exec y pegarla en API_URL, al principio de index.html. */

function hojasDb_() {
  var ss = SpreadsheetApp.getActive(), memo = {};
  function hoja(t) {
    var h = ss.getSheetByName(t);
    if (!h) {
      h = ss.insertSheet(t);
      h.getRange(1, 1, h.getMaxRows(), TABLAS[t].length).setNumberFormat('@');   // todo como texto: así "0042" y "2027-03-08" no cambian
      h.getRange(1, 1, 1, TABLAS[t].length).setValues([TABLAS[t]]).setFontWeight('bold');
      h.setFrozenRows(1);
    }
    return h;
  }
  function fila(t, o) { return TABLAS[t].map(function (k) { var v = o[k]; return v === undefined || v === null ? '' : String(v); }); }
  var db = {
    all: function (t) {
      if (memo[t]) return memo[t];
      var v = hoja(t).getDataRange().getDisplayValues(), cols = TABLAS[t];
      memo[t] = v.slice(1).map(function (r, i) {
        var o = { _fila: i + 2 };
        cols.forEach(function (k, j) { o[k] = r[j]; });
        return o;
      }).filter(function (o) { return o.id !== ''; });
      return memo[t];
    },
    insert: function (t, o) {
      var h = hoja(t), max = h.getMaxRows();
      if (h.getLastRow() > max - 20) {                                            // antes de quedarse sin renglones, agrega más ya con formato de texto
        h.insertRowsAfter(max, 500);
        h.getRange(max + 1, 1, 500, TABLAS[t].length).setNumberFormat('@');
      }
      h.appendRow(fila(t, o));                                                    // appendRow es atómico: dos alumnos a la vez no se pisan
      delete memo[t];
    },
    update: function (t, id, p) {
      var o = db.all(t).filter(function (r) { return r.id === id; })[0];
      if (!o) return;
      Object.keys(p).forEach(function (k) { o[k] = String(p[k]); });
      hoja(t).getRange(o._fila, 1, 1, TABLAS[t].length).setValues([fila(t, o)]);
    },
    remove: function (t, id) {
      var o = db.all(t).filter(function (r) { return r.id === id; })[0];
      if (!o) return;
      hoja(t).deleteRow(o._fila);
      delete memo[t];
    }
  };
  return db;
}

function contexto_() {
  var cache = CacheService.getScriptCache(), zona = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return {
    db: hojasDb_(),
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
