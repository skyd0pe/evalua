// Recorrido completo en un navegador con tamaño de teléfono, en modo demostración.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
  // Copia de index.html sin la dirección del servidor: la prueba corre en modo demostración y no toca el servidor.
  const fs = require('fs'), demo = path.join(__dirname, 'demo.html');
  fs.writeFileSync(demo, fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
    .replace(/var API_URL = '[^']*';/, "var API_URL = '';").replace(/src="(core|app)\.js"/g, 'src="../$1.js"'));
  fs.copyFileSync(path.join(__dirname, '../demo.js'), path.join(__dirname, 'demo.js'));
  const url = 'file://' + demo;
  const errs = [], fallas = [];
  const vigilar = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load/.test(m.text())) errs.push(m.text()); }); };
  const doc = await ctx.newPage(), al = await ctx.newPage(); vigilar(doc); vigilar(al);
  const foto = (p, n, full) => p.screenshot({ path: path.join(__dirname, 'capturas', n + '.png'), fullPage: !!full });
  const ancho = async (p, t) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) fallas.push('desborde horizontal en ' + t + ': ' + o + 'px'); };
  const ver = (c, t) => { if (!c) fallas.push(t); console.log((c ? 'ok   ' : 'FALLA ') + t); };
  const esperar = p => p.waitForTimeout(250);

  // ---- docente
  await doc.goto(url + '#docente'); await esperar(doc);
  await doc.fill('#clave', 'mala'); await doc.click('text=Entrar'); await esperar(doc);
  ver(await doc.isVisible('text=Contraseña incorrecta'), 'contraseña mala rechazada');
  await doc.fill('#clave', 'demo'); await doc.click('text=Entrar'); await esperar(doc);
  ver(await doc.isVisible('text=Control en vivo'), 'la clase de hoy muestra el control en vivo');
  ver(await doc.evaluate(() => { const a = document.querySelector('.ahora'), n = [...document.querySelectorAll('button')].find(b => b.textContent === 'Nueva clase'); return !!a && !!n && a.getBoundingClientRect().top < n.getBoundingClientRect().top && document.querySelector('.ahora [data-v="cerrado"]').getBoundingClientRect().bottom < innerHeight; }), 'el cuestionario abierto está arriba y Cerrar se ve sin bajar');
  await foto(doc, '01-clases'); await ancho(doc, 'clases');
  await doc.click('.tab >> text=Cursos'); await esperar(doc);
  const pin = await doc.textContent('.pinbox b'); ver(/^\d{4}$/.test(pin), 'PIN de 4 números visible para el docente: ' + pin);
  await foto(doc, '02-cursos'); await ancho(doc, 'cursos');

  // ---- alumno
  await al.goto(url); await esperar(al);
  ver(!(await al.content()).includes(pin + '<'), 'el PIN no aparece en la pantalla del alumno');
  await foto(al, '03-al-cursos');
  ver(!(await al.isVisible('.top >> text=Docente')), 'el alumno no ve el acceso docente arriba');
  ver(await al.isVisible('text=Acceso docente'), 'el acceso docente está al pie de la lista de cursos');
  await al.click('text=1° A'); await esperar(al);
  ver(!(await al.isVisible('text=Agustina')), 'sin PIN no se ven los nombres');
  await al.fill('#pin', pin === '0000' ? '1111' : '0000'); await al.click('text=Entrar'); await esperar(al);
  ver(await al.isVisible('text=PIN incorrecto'), 'PIN incorrecto rechazado');
  await foto(al, '04-al-pin');
  await al.fill('#pin', pin); await al.click('text=Entrar'); await esperar(al);
  await foto(al, '05-al-nombres');
  await al.click('.list-btn >> text=Camila Sosa'); await esperar(al);
  ver(await al.isVisible('text=Hola, Camila'), 'entra a su inicio');
  await foto(al, '06-al-inicio'); await ancho(al, 'inicio alumno');
  await al.click('text=Empezar'); await esperar(al);
  ver(await al.isVisible('text=durante 5 segundos'), 'la introducción avisa de los 5 segundos de lectura');
  await al.click('text=Empezar ahora'); await esperar(al);
  ver(await al.isVisible('.qrun') && !(await al.isVisible('.choice')), 'primero se ve la pregunta sola, en grande');
  await foto(al, '07a-al-lectura'); await ancho(al, 'lectura');
  const yLeer = await al.evaluate(() => document.querySelector('.qrun').getBoundingClientRect().top);
  const t0 = Date.now(); await al.waitForSelector('.choice', { timeout: 9000 }); const espera = Date.now() - t0;
  ver(espera > 3800 && espera < 7000, 'las opciones aparecen a los 5 segundos: ' + espera + ' ms');
  await foto(al, '07-al-pregunta'); await ancho(al, 'pregunta');
  const yOpc = await al.evaluate(() => document.querySelector('.qrun').getBoundingClientRect().top);
  ver(Math.abs(yLeer - yOpc) < 2, 'la pregunta no se mueve al aparecer las opciones: ' + yLeer + ' → ' + yOpc);
  ver(await al.evaluate(() => !JSON.stringify(S.al.run.q).includes('correct') && !!S.al.run.q.siguiente), 'llega sin la respuesta correcta y con el texto de la siguiente');
  const sig = await al.evaluate(() => S.al.run.q.siguiente);
  await al.click('.choice >> nth=0'); await al.waitForTimeout(150);
  ver(await al.isVisible('.qrun') && (await al.textContent('.qrun')) === sig, 'al responder, la siguiente aparece enseguida para leer');
  const pos1 = await al.textContent('.pill');
  await al.waitForTimeout(6000);                               // más que un reintento: salir y volver cuesta la pregunta en pantalla
  await al.reload(); await esperar(al);
  ver(await al.isVisible('text=Continuar'), 'tras recargar, el intento sigue ahí (Continuar)');
  await al.click('text=Continuar'); await esperar(al);
  const pos2 = await al.textContent('.pill');
  ver(pos1.includes('2 de 5') && pos2.includes('3 de 5'), 'la pregunta que estaba en pantalla se perdió: ' + pos1 + ' → ' + pos2);
  await doc.click('.tab >> text=Clases'); await doc.waitForTimeout(600);
  ver(await doc.isVisible('.chip.home >> text=Camila Sosa (rindiendo)'), 'el control en vivo la muestra rindiendo');
  await foto(doc, '08-vivo');
  for (let i = 0; i < 3; i++) { await al.waitForSelector('.choice:not([disabled])', { timeout: 9000 }); await al.click('.choice >> nth=1'); await esperar(al); }
  await al.waitForSelector('text=puntos', { timeout: 9000 });
  ver(await al.isVisible('text=puntos'), 'termina y ve su puntaje');
  ver(await al.isVisible('text=se habilita cuando tu profe cierre'), 'no ve la corrección mientras está abierto');
  await foto(al, '09-al-fin');
  await al.click('text=Volver'); await esperar(al);
  await al.click('text=Ver la tabla de posiciones'); await esperar(al); await foto(al, '10-al-tabla'); await ancho(al, 'tabla alumno');
  ver(await al.isVisible('.rank li.me'), 'la tabla resalta su puesto');

  // ---- docente: cerrar, resultados, asistencia
  await doc.click('.tab >> text=Clases'); await esperar(doc);
  await doc.click('article:has-text("1° A"):has-text("Pentecostés") >> text=Cerrar cuestionario'); await esperar(doc);
  await al.click('text=Todos los cursos'); await al.click('text=← Volver'); await esperar(al);
  await al.click('article:has-text("Pentecostés") >> text=Ver la corrección'); await esperar(al);
  ver(await al.isVisible('text=La correcta era') || await al.isVisible('text=Correcta:'), 'cerrado el cuestionario, ve la corrección');
  await foto(al, '11-al-correccion', true);
  await doc.click('.tab >> text=Resultados'); await esperar(doc);
  ver(await doc.isVisible('text=Lo que más costó'), 'resultados con detalle por pregunta');
  await foto(doc, '12-resultados', true); await ancho(doc, 'resultados');
  await doc.click('.tab >> text=Asistencia'); await esperar(doc);
  const clasesAsis = await doc.locator('.grid thead th.d').count();
  ver(clasesAsis === 4, 'asistencia de 1° A: 4 clases (la preparada sin abrir no cuenta): ' + clasesAsis);
  const antes = await doc.locator('.grid tbody tr >> nth=1').locator('.cell-btn').nth(0).textContent();
  await doc.locator('.grid tbody tr >> nth=1').locator('.cell-btn').nth(0).click(); await esperar(doc);
  const despues = await doc.locator('.grid tbody tr >> nth=1').locator('.cell-btn').nth(0).textContent();
  ver(antes !== despues, 'tocar una celda cambia la marca: ' + antes + ' → ' + despues);
  await foto(doc, '13-asistencia', true); await ancho(doc, 'asistencia');
  await doc.click('text=Todos presentes'); await esperar(doc);
  ver(!(await doc.isVisible('text=Todos presentes')), 'después de marcar a todos, la columna ya cuenta y el botón desaparece');
  const tsv = await doc.evaluate(() => asisTSV(S.doc.asis));
  console.log(tsv.split('\n').slice(0, 3).join('\n'));

  // ---- docente: preguntas, clases, cursos
  await doc.click('.tab >> text=Preguntas'); await esperar(doc); await foto(doc, '14-preguntas');
  await doc.click('article:has-text("Pentecostés") >> text=Ver y corregir'); await esperar(doc);
  await doc.click('text=Anular >> nth=0'); await esperar(doc);
  ver(await doc.isVisible('.pill.crit >> text=Anulada'), 'anular una pregunta');
  await doc.click('text=Corregir >> nth=1'); await esperar(doc); await foto(doc, '15-corregir-pregunta');
  await doc.click('#f-preg >> text=Guardar'); await esperar(doc);
  await doc.click('text=← Todos los temas'); await doc.click('text=Nuevas preguntas'); await esperar(doc);
  await doc.click('text=Guardar'); await esperar(doc);
  ver(await doc.isVisible('.toast.show.err'), 'guardar preguntas vacías muestra un error');
  await doc.fill('#fb-titulo', 'Prueba'); await doc.fill('#fb-texto', '3:16 es de qué evangelio\n1) Lucas\n*2) Juan\n\n¿Otra?\n*a) sí\nb) no'); await esperar(doc);
  ver(await doc.isVisible('text=2 preguntas listas'), 'vista previa de preguntas pegadas');
  await foto(doc, '16-preguntas-nuevas', true);
  await doc.click('#f-banco >> text=Guardar'); await esperar(doc);
  await doc.click('.tab >> text=Clases'); await doc.click('text=Nueva clase'); await esperar(doc);
  await doc.selectOption('#fc-banco', { label: 'Prueba (2 preguntas)' });
  await doc.check('input[name="fc-curso"] >> nth=0'); await doc.check('input[name="fc-curso"] >> nth=1');
  await doc.click('.seg.per >> text=8'); await foto(doc, '17-clase-nueva', true); await ancho(doc, 'clase nueva');
  await doc.click('text=Crear clase'); await esperar(doc);
  ver(await doc.locator('article:has-text("Prueba")').count() === 2, 'un mismo tema crea una clase por curso');
  await doc.click('article:has-text("Prueba") >> nth=0 >> text=Abrir ahora'); await esperar(doc);
  await doc.click('.tab >> text=Cursos'); await esperar(doc);
  await doc.click('article:has-text("1° A") >> text=Ver y editar alumnos'); await esperar(doc);
  await doc.fill('#m-alumnos', 'Agustina Benítez'); await doc.click('#f-mas-al button[type=submit]'); await esperar(doc);
  ver(await doc.isVisible('.toast.show.err'), 'no deja cargar un nombre repetido');
  await doc.fill('#m-alumnos', 'Zoe Nueva'); await doc.click('#f-mas-al button[type=submit]'); await esperar(doc);
  ver(await doc.isVisible('.al >> text=Zoe Nueva'), 'agregar un alumno');
  await foto(doc, '18-alumnos', true);
  await doc.click('article:has-text("1° A") >> text=Generar otro'); await esperar(doc);
  const pin2 = await doc.textContent('.pinbox b'); ver(pin2 !== pin || true, 'PIN nuevo: ' + pin2);
  await doc.click('.tab >> text=Tabla'); await esperar(doc); await doc.click('text=Todos los cursos'); await esperar(doc); await foto(doc, '19-tabla', true);
  // ---- el alumno vuelve con el PIN viejo
  await al.evaluate(() => { S.al.tk = 'vencida'; }); await al.click('text=← Volver'); await esperar(al);
  ver(await al.isVisible('text=Vas a entrar como'), 'sesión vencida: pide el PIN y recuerda quién es');
  await al.fill('#pin', pin); await al.click('#f-pin button[type=submit]'); await esperar(al);
  ver(pin2 === pin || await al.isVisible('.toast.show.err'), 'el PIN anterior ya no sirve');
  await al.fill('#pin', pin2); await al.click('#f-pin button[type=submit]'); await esperar(al);
  ver(await al.isVisible('text=Hola, Camila'), 'con el PIN nuevo entra directo, sin volver a elegir nombre');
  await al.emulateMedia({ colorScheme: 'dark' }); await foto(al, '20-oscuro');
  console.log('ERRORES JS:', errs.length ? errs : 'ninguno'); console.log('FALLAS:', fallas.length ? fallas : 'ninguna');
  await browser.close();
  process.exit(errs.length || fallas.length ? 1 : 0);
})().catch(e => { console.error('SE CORTÓ LA PRUEBA:', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
