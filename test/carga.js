// Prueba de carga: hace rendir a todos los alumnos de un curso al mismo tiempo y mide demoras y errores.
//   node test/carga.js https://REF.supabase.co/functions/v1/api CLAVE_DE_DOCENTE
//   node test/carga.js local            (contra las reglas en memoria, para probar este mismo script)
// Usa la primera clase ABIERTA que encuentre. Deja intentos reales: correrla sobre un curso de prueba de 35 alumnos.
const [, , URL_, CLAVE = 'x', PAUSA = '2500'] = process.argv;
if (!URL_) { console.error('Falta la dirección. Ver el comentario al principio del archivo.'); process.exit(1); }
const tiempos = [], errores = [];
let post;
if (URL_ === 'local') {
  const { api, memCtx } = require('../core.js'), ctx = memCtx();
  ctx.db.insert('Config', { id: 'clave', valor: CLAVE });
  post = async b => api(ctx, b);
  const t = api(ctx, { a: 'login', clave: CLAVE, device: 'pc' }).d.tk;
  api(ctx, { a: 'curso.guardar', t, nombre: 'Prueba', alumnos: Array.from({ length: 35 }, (_, i) => 'Alumno ' + String(i + 1).padStart(2, '0')).join('\n') });
  api(ctx, { a: 'banco.guardar', t, titulo: 'T', texto: Array.from({ length: 20 }, (_, i) => `${i + 1}. P${i}\n*a) x\nb) y\nc) z`).join('\n\n') });
  const p = api(ctx, { a: 'panel', t }).d;
  api(ctx, { a: 'clase.guardar', t, cursoIds: [p.cursos[0].id], bancoId: p.bancos[0].id, fecha: p.hoy, segundos: 20, porAlumno: 8 });
  api(ctx, { a: 'clase.estado', t, id: api(ctx, { a: 'panel', t }).d.clases[0].id, estado: 'abierto' });
} else post = b => fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b), redirect: 'follow' }).then(r => r.json());

async function pedir(a, d) {
  const t0 = Date.now();
  try { const r = await post(Object.assign({ a }, d)); tiempos.push({ a, ms: Date.now() - t0 }); if (!r.ok) { errores.push(a + ': ' + r.error); return null; } return r.d; }
  catch (e) { errores.push(a + ': ' + e.message); return null; }
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const s = await pedir('login', { clave: CLAVE, device: 'carga' });
  if (!s) { console.error('No pude entrar como docente:', errores[0]); process.exit(1); }
  const p = await pedir('panel', { t: s.tk }), clase = p.clases.find(c => c.estado === 'abierto');
  if (!clase) { console.error('No hay ninguna clase abierta.'); process.exit(1); }
  const curso = p.cursos.find(c => c.id === clase.cursoId), pausa = URL_ === 'local' ? 0 : Number(PAUSA);
  console.log(`Clase "${clase.titulo}" de ${curso.nombre}: ${curso.alumnos.length} alumnos a la vez`);
  const t0 = Date.now();
  const hechos = await Promise.all(curso.alumnos.map(async (al, i) => {
    await dormir(Math.random() * pausa);                                     // no todos tocan en el mismo milisegundo
    const e = await pedir('entrar', { cursoId: curso.id, pin: curso.pin, device: 'carga-' + i, alumnoId: al.id });
    if (!e) return false;
    await pedir('inicio', { t: e.tk });
    let q = await pedir('empezar', { t: e.tk, claseId: clase.id });
    while (q && !q.fin) { await dormir(pausa * (.4 + Math.random())); q = await pedir('responder', { t: e.tk, claseId: clase.id, pos: q.pos, di: Math.floor(Math.random() * q.opciones.length) }); }
    return !!(q && q.fin);
  }));
  const por = {};
  tiempos.forEach(x => (por[x.a] = por[x.a] || []).push(x.ms));
  console.log('pedido      cantidad  mediana   p95     máx (ms)');
  Object.keys(por).forEach(a => { const v = por[a].sort((x, y) => x - y), q = f => v[Math.min(v.length - 1, Math.floor(v.length * f))];
    console.log(a.padEnd(12) + String(v.length).padStart(7) + String(q(.5)).padStart(9) + String(q(.95)).padStart(8) + String(v[v.length - 1]).padStart(8)); });
  console.log(`Terminaron ${hechos.filter(Boolean).length} de ${curso.alumnos.length} en ${Math.round((Date.now() - t0) / 1000)} s. Errores: ${errores.length}`);
  [...new Set(errores)].slice(0, 8).forEach(e => console.log('  ' + e));
  process.exit(errores.length ? 1 : 0);
})();
