# Evaluá

Cuestionarios cortos para evaluar en cada clase: el docente abre un cuestionario, cada alumno responde desde su teléfono contra reloj, y quedan la nota, la asistencia y una tabla de puntos por cuatrimestre.

## Cómo está armado

| Archivo | Qué es | Dónde corre |
|---|---|---|
| `index.html`, `app.js` | La pantalla. No guarda datos ni corrige. | GitHub Pages |
| `core.js` | Las reglas: PIN, sesiones, corrección, tiempo, asistencia, puntos. | Google Apps Script (copiado como `Core.gs`), tests y demo |
| `backend/Code.gs` | Lee y escribe la planilla de Google. Sin reglas. | Google Apps Script |
| `demo.js` | Servidor simulado con datos de ejemplo. Solo se carga si `API_URL` está vacía. | Navegador |
| `test/` | Tests de las reglas, del adaptador de Google, recorrido en navegador y prueba de carga. | Node |

Los datos (alumnos, preguntas con su respuesta correcta, respuestas, contraseña) viven solo en la planilla de Google. En este repositorio no hay ningún dato.

## Puesta en marcha

1. Crear una planilla de Google vacía. **Extensiones > Apps Script**.
2. Pegar `backend/Code.gs` como `Code.gs` y `core.js` como un archivo nuevo `Core.gs`.
3. Ejecutar la función `preparar` y aceptar el permiso. Crea las pestañas y una contraseña de docente en la pestaña **Config** (fila `clave`), que se puede cambiar ahí.
4. **Implementar > Nueva implementación > Aplicación web**. Ejecutar como: *yo*. Quién tiene acceso: *cualquier persona*.
5. Copiar la dirección que termina en `/exec` y pegarla en `API_URL`, al principio de `index.html`.
6. En GitHub: **Settings > Pages**, publicar la rama `main`.

Los cambios de `index.html` y `app.js` se publican solos en GitHub Pages. Los de `core.js` y `backend/` los publica en Google la automatización (ver abajo). A mano: pegarlos en el editor y publicar en **Implementar > Administrar las implementaciones > editar > Nueva versión** (así la dirección no cambia).

## Publicación automática

Cada vez que cambia `core.js` o `backend/` en `main`, GitHub corre los tests y, si pasan, sube el código al proyecto de Google y publica una versión nueva en la misma dirección (`.github/workflows/publicar-google.yml`). Usa [clasp](https://github.com/google/clasp), la herramienta oficial de Google.

Para activarla, una sola vez:

1. En [script.google.com/home/usersettings](https://script.google.com/home/usersettings), activar **API de Google Apps Script**.
2. En la PC (con [Node.js](https://nodejs.org) instalado), abrir una terminal y correr `npx @google/clasp@2.4.2 login`. Se abre Google: elegir la cuenta dueña de la planilla y tocar **Permitir**. Queda creado el archivo `.clasprc.json` en la carpeta del usuario (en Windows, `%USERPROFILE%\.clasprc.json`).
3. En GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Nombre: `CLASPRC_JSON`. Valor: todo el contenido de ese archivo (abrirlo con `notepad %USERPROFILE%\.clasprc.json`; empieza con `{` y termina con `}`). No sirve la dirección `https://accounts.google.com/...` que muestra la terminal: esa es solo para autorizar. Después, borrar el archivo de la PC.
4. Para probarla: pestaña **Actions > Publicar en Google > Run workflow**.

El secreto da acceso a los proyectos de Apps Script y a parte del Drive de esa cuenta. GitHub lo guarda cifrado y no lo pasa a cambios propuestos por otras personas. Para cortarlo: [myaccount.google.com/connections](https://myaccount.google.com/connections), quitar el acceso de clasp, y borrar el secreto en GitHub.

Sin el secreto, la automatización corre los tests y avisa que no publicó.

## Pruebas

```
node --test test/core.test.js test/adaptador.test.js   # reglas y adaptador (planilla simulada)
node test/ui.js                                        # recorrido completo en Chrome, modo demostración (necesita Playwright)
node test/carga.js local                               # 35 alumnos a la vez contra las reglas en memoria
node test/carga.js https://script.google.com/macros/s/XXXX/exec CLAVE   # lo mismo contra Google, sobre un curso de prueba
```

## Reglas principales

- **PIN por curso:** 4 números al azar, válidos 4 horas. Solo lo ve el docente; se renueva cuando abre su panel después de vencido.
- **Cuestionario:** el servidor manda una pregunta por vez, sin la respuesta correcta, mide el tiempo y guarda cada respuesta al instante. Recargar no reinicia el intento y cuesta la pregunta que estaba en pantalla.
- **Puntos:** cada cuestionario vale hasta 100, tenga 5 o 10 preguntas. La tabla es por cuatrimestre.
- **Asistencia:** P presente, T tarde (cuenta), J justificado (no cuenta), A ausente. Rendir "para ausentes" suma puntos pero sigue ausente. Una clase preparada y sin abrir no es una falta.
- **Nota sugerida:** promedio de los cuestionarios rendidos, de 1 a 10.
