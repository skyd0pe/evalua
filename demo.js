/* Modo demostración: el servidor (core.js) corre dentro del navegador y guarda en este dispositivo.
   Este archivo solo se carga cuando API_URL está vacía; con el servidor real configurado, no se usa. */
(function () {
  var KEY = 'evalua-demo-v1', g = null, ctx = null;
  function ok(a, d) { var r = api(ctx, Object.assign({ a: a }, d)); if (!r.ok) throw new Error(a + ': ' + r.error); return r.d; }
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch (e) {} }
  // Antes de cada pedido relee lo guardado: así dos pestañas (docente y alumno) ven los mismos datos.
  function cargar() {
    var leido = null;
    try { leido = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (leido && leido.d && leido.c) g = leido;
    var nuevo = !g;
    if (nuevo) g = { d: {}, c: {} };
    ctx = memCtx(g.d, g.c);
    if (nuevo) { sembrar(); guardar(); }
  }
  cargar();
  window.demoApi = function (body) {
    var out;
    cargar();
    try { out = api(ctx, body); } catch (e) { console.error(e); out = { ok: false, error: 'Error interno de la demostración: ' + e.message }; }
    guardar();
    return out;
  };

  function sembrar() {
    var SAC = '1. ¿Cuántos son los sacramentos de la Iglesia?\na) Cinco\n*b) Siete\nc) Diez\nd) Doce\n\n2. ¿Cuál es el primer sacramento que se recibe?\n*a) Bautismo\nb) Confirmación\nc) Eucaristía\nd) Reconciliación\n\n' +
      '3. ¿Qué sacramento celebramos en la Misa?\na) Unción de los enfermos\nb) Orden sagrado\n*c) Eucaristía\nd) Matrimonio\n\n4. ¿Cuáles son los sacramentos de iniciación cristiana?\n*a) Bautismo, Confirmación y Eucaristía\nb) Bautismo, Matrimonio y Orden\nc) Reconciliación y Unción\nd) Confirmación y Matrimonio\n\n' +
      '5. ¿Qué sacramento perdona los pecados cometidos después del Bautismo?\na) Confirmación\n*b) Reconciliación\nc) Matrimonio\nd) Orden sagrado\n\n6. ¿Qué sacramento fortalece la fe con el don del Espíritu Santo?\n*a) Confirmación\nb) Matrimonio\nc) Unción de los enfermos\nd) Reconciliación\n\n' +
      '7. ¿Qué sacramento se da a quienes están gravemente enfermos?\na) Confirmación\nb) Bautismo\n*c) Unción de los enfermos\nd) Orden sagrado\n\n8. ¿Cuáles son los sacramentos al servicio de la comunidad?\na) Bautismo y Confirmación\nb) Eucaristía y Reconciliación\nc) Unción y Reconciliación\n*d) Orden sagrado y Matrimonio\n\n' +
      '9. ¿Qué elemento se usa en el Bautismo?\n*a) El agua\nb) El pan\nc) La sal\nd) El incienso\n\n10. ¿Qué sacramentos se reciben una sola vez?\na) Eucaristía y Reconciliación\n*b) Bautismo, Confirmación y Orden sagrado\nc) Matrimonio y Unción\nd) Todos';
    var PAR = '1. ¿En qué evangelio aparece la parábola del hijo pródigo?\na) Mateo\nb) Marcos\n*c) Lucas\nd) Juan\n\n2. En la parábola del sembrador, ¿qué representa la semilla?\n*a) La Palabra de Dios\nb) Los discípulos\nc) El Imperio romano\nd) Las buenas obras\n\n' +
      '3. ¿Quién ayuda al hombre herido en el camino de Jerusalén a Jericó?\na) Un sacerdote\nb) Un levita\n*c) Un samaritano\nd) Un fariseo\n\n4. ¿Cuántas ovejas deja el pastor para ir a buscar a la que se perdió?\na) 9\nb) 12\nc) 90\n*d) 99\n\n' +
      '5. ¿Con qué compara Jesús el Reino de los Cielos por su comienzo pequeño?\n*a) Un grano de mostaza\nb) Una red de pesca\nc) Un tesoro escondido\nd) Una perla\n\n6. ¿Qué hace el padre cuando el hijo pródigo vuelve?\na) Lo reta\n*b) Hace una fiesta\nc) Lo manda a trabajar\nd) No lo recibe';
    var PEN = '1. ¿Qué se celebra en Pentecostés?\n*a) La venida del Espíritu Santo\nb) La resurrección de Jesús\nc) El nacimiento de Jesús\nd) La Última Cena\n\n2. Según la tradición, ¿quién escribió los Hechos de los Apóstoles?\na) Pedro\nb) Pablo\n*c) Lucas\nd) Juan\n\n' +
      '3. ¿Cómo aparece el Espíritu Santo en Pentecostés según los Hechos?\na) Como una paloma\n*b) Como lenguas de fuego\nc) Como una nube\nd) Como un arcoíris\n\n4. ¿Quién le predica a la multitud el día de Pentecostés?\na) Pablo\nb) Santiago\nc) Esteban\n*d) Pedro\n\n' +
      '5. ¿Cuántos días después de Pascua se celebra Pentecostés?\na) 7\nb) 12\nc) 40\n*d) 50\n\n6. ¿Dónde estaban reunidos los discípulos?\na) En Nazaret\n*b) En Jerusalén\nc) En Roma\nd) En Belén';
    function dia(n) { var d = new Date(); d.setDate(d.getDate() + n); d.setHours(10, 0, 0, 0); return d; }
    function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    ctx.db.insert('Config', { id: 'clave', valor: 'demo' });
    var t = ok('login', { clave: 'demo', device: 'siembra' }).tk, T = function (a, d) { return ok(a, Object.assign({ t: t }, d)); }, n = 0;
    T('curso.guardar', { nombre: '1° A', alumnos: 'Agustina Benítez\nBautista Romero\nCamila Sosa\nFranco Medina\nJulieta Acosta\nLautaro Giménez\nMartina Paz\nTomás Ferreyra' });
    T('curso.guardar', { nombre: '2° B', alumnos: 'Abril Molina\nBruno Castro\nDelfina Ortiz\nFelipe Silva\nIgnacio Morales\nLucía Herrera\nSantino Vega' });
    T('banco.guardar', { titulo: 'Las parábolas del Reino', texto: PAR });
    T('banco.guardar', { titulo: 'Los sacramentos', texto: SAC });
    T('banco.guardar', { titulo: 'Pentecostés', texto: PEN });
    var p = T('panel'), cursos = p.cursos.map(function (c) { return c.id; }), b = {};
    p.bancos.forEach(function (x) { b[x.titulo] = x.id; });
    function buenas(bancoId) { var m = {}; ctx.db.all('Preguntas').forEach(function (q) { if (q.bancoId === bancoId) m[q.texto] = JSON.parse(q.opciones)[Number(q.correcta)]; }); return m; }
    // Da una clase "de verdad" a través del servidor: abre, hace rendir a cada alumno y cierra.
    function dar(titulo, cuando, faltan, aMedias) {
      ctx.t = cuando.getTime();
      t = ok('login', { clave: 'demo', device: 'siembra' }).tk;   // sesión nueva a la hora simulada (de madrugada, las 10 de hoy quedan a más de 6 h)
      T('clase.guardar', { cursoIds: cursos, bancoId: b[titulo], fecha: iso(cuando), segundos: 20, porAlumno: 5 });
      var pan = T('panel'), ok1 = buenas(b[titulo]);
      pan.clases.filter(function (c) { return c.fecha === iso(cuando) && c.bancoId === b[titulo]; }).forEach(function (cl) {
        var cu = pan.cursos.filter(function (c) { return c.id === cl.cursoId; })[0];
        T('clase.estado', { id: cl.id, estado: 'abierto' });
        cu.alumnos.forEach(function (a, i) {
          if ((i + n) % 5 < faltan) return;
          var e = ok('entrar', { cursoId: cu.id, pin: cu.pin, device: 'tel-' + a.id, alumnoId: a.id }), nivel = .45 + ((i * 7 + n * 3) % 10) / 20;
          var q = ok('empezar', { t: e.tk, claseId: cl.id }), k = 0;
          while (!q.fin && !(aMedias && i === 5 && k === 2)) {
            ctx.t += 4000 + ((i + k) % 5) * 1500;
            var bien = q.opciones.indexOf(ok1[q.texto]), acierta = ((i * 3 + k * 5 + n) % 10) / 10 < nivel;
            q = ok('responder', { t: e.tk, claseId: cl.id, pos: q.pos, di: acierta ? bien : (bien + 1) % q.opciones.length });
            k++;
          }
        });
        if (!aMedias) T('clase.estado', { id: cl.id, estado: 'cerrado' });
        n++;
      });
    }
    dar('Las parábolas del Reino', dia(-14), 1, false);
    dar('Los sacramentos', dia(-7), 1, false);
    ctx.t = dia(-10).getTime();
    t = ok('login', { clave: 'demo', device: 'siembra' }).tk;
    T('clase.guardar', { cursoIds: [cursos[0]], titulo: 'Visita a la parroquia', fecha: iso(dia(-10)) });
    dar('Pentecostés', dia(0), 3, true);                    // la clase de hoy queda abierta, con algunos sin rendir
    ctx.t = null;
    t = ok('login', { clave: 'demo', device: 'siembra' }).tk;
    T('clase.guardar', { cursoIds: cursos, bancoId: b['Los sacramentos'], titulo: 'Repaso de sacramentos', fecha: iso(dia(7)), segundos: 20, porAlumno: 8 });
    ctx.db.all('Alumnos').forEach(function (a) { ctx.db.update('Alumnos', a.id, { vinculo: '' }); });   // los teléfonos de la siembra no existen: quien pruebe la demostración elige su nombre
    Object.keys(g.c).forEach(function (k) { delete g.c[k]; });   // sesiones y PIN de la siembra: afuera
  }
})();
