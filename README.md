# Evaluá

Cuestionarios cortos para evaluar en cada clase: el docente abre un cuestionario, cada alumno responde desde su teléfono contra reloj, y quedan la nota, la asistencia y una tabla de puntos por cuatrimestre.

## Cómo está armado

| Archivo | Qué es | Dónde corre |
|---|---|---|
| `index.html`, `app.js` | La pantalla. No guarda datos ni corrige. | GitHub Pages |
| `core.js` | Las reglas: PIN, sesiones, corrección, tiempo, asistencia, puntos. | Supabase (dentro de la función `api`), tests y demo |
| `supabase/functions/api/index.ts` | La función de Supabase: abre una transacción, carga las tablas, corre `core.js` y guarda lo que cambió. Sin reglas. | Supabase Edge Functions |
| `supabase/schema.sql` | Las tablas (RLS activado y sin políticas: solo la función accede). | Postgres de Supabase |
| `supabase/desplegar.sh` | Publica la función. | Tu PC o GitHub Actions |
| `demo.js` | Servidor simulado con datos de ejemplo. Solo se carga si `API_URL` está vacía. | Navegador |
| `test/` | Tests de las reglas, recorrido en navegador y prueba de carga. | Node |

Los datos (alumnos, preguntas con su respuesta correcta, respuestas, contraseña) viven solo en Supabase. En este repositorio no hay ningún dato.

**Cómo funciona un pedido.** Las reglas de `core.js` son síncronas y trabajan sobre tablas en memoria. Cada pedido a la función: toma un turno global (`pg_advisory_xact_lock`), trae todas las tablas en una sola consulta, corre las reglas y guarda en un solo viaje solo las filas que cambiaron. Por eso dos pedidos nunca se pisan. La "memoria rápida" de antes (sesiones, intentos en curso, límites de intentos) es la tabla `kv`, con vencimiento. Mientras el volumen sea el de un aula, cada pedido tarda unas decenas de milisegundos dentro de la base.

## Puesta en marcha

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Correr `supabase/schema.sql` en el **SQL Editor**.
3. En la tabla `Config`, agregar la fila `id = clave` con la contraseña de docente en `valor`, y la fila `id = corte`, `valor = 07-15` (día en que empieza el segundo cuatrimestre).
4. Crear un token en [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) y publicar la función: `SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<ref del proyecto> supabase/desplegar.sh`.
5. En `index.html`, poner en `API_URL` la dirección `https://<ref>.supabase.co/functions/v1/api?forceFunctionRegion=<región del proyecto>`.
6. En GitHub: **Settings > Pages**, publicar la rama `main`.

## Publicación automática

Cada vez que cambia `core.js` o `supabase/` en `main`, GitHub corre los tests y, si pasan, publica la función (`.github/workflows/publicar-supabase.yml`). Para activarla: **Settings > Secrets and variables > Actions > New repository secret**, nombre `SUPABASE_ACCESS_TOKEN`, valor el token de la cuenta. Ese token da control sobre todos tus proyectos de Supabase: guardalo solo ahí, y para cortarlo revocalo en la página de tokens. Sin el secreto, la automatización corre los tests y avisa que no publicó.

## Pruebas

```
node --test test/core.test.js                          # reglas
node test/ui.js                                        # recorrido completo en Chrome, modo demostración (necesita Playwright)
node test/carga.js local                               # 35 alumnos a la vez contra las reglas en memoria
node test/carga.js https://<ref>.supabase.co/functions/v1/api CLAVE   # lo mismo contra Supabase, con una clase abierta de un curso de prueba
```

## Reglas principales

- **PIN por curso:** 4 números al azar, válidos 4 horas. Solo lo ve el docente; se renueva cuando abre su panel después de vencido.
- **Cuestionario:** el servidor manda una pregunta por vez, sin la respuesta correcta, mide el tiempo y guarda cada respuesta al instante. Recargar no reinicia el intento y cuesta la pregunta que estaba en pantalla.
- **Puntos:** cada cuestionario vale hasta 100, tenga 5 o 10 preguntas. La tabla es por cuatrimestre.
- **Asistencia:** P presente, T tarde (cuenta), J justificado (no cuenta), A ausente. Rendir "para ausentes" suma puntos pero sigue ausente. Una clase preparada y sin abrir no es una falta.
- **Velocidad:** la pantalla junta en una sola llamada lo que serían varias (`lote`), y la función corre en la misma región que la base (`forceFunctionRegion`), así los viajes a la base son cortos.
- **Nota sugerida:** promedio de los cuestionarios rendidos, de 1 a 10.
