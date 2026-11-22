/* Evaluá: servidor en Supabase (Edge Function). Acá no hay reglas: las reglas están en core.js (se copia como core.mjs al publicar).
   Cada pedido corre en una transacción con turno global: lee las tablas, corre las reglas en memoria y guarda solo lo que cambió.
   Así las reglas (síncronas, pensadas para una planilla) funcionan igual, y dos pedidos nunca se pisan. */
import postgres from "npm:postgres@3.4.4";
import { api, TABLAS } from "./core.mjs";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 4, prepare: false });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ZONA = "America/Argentina/Buenos_Aires";
const fmtHoy = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
// deno-lint-ignore no-explicit-any
type Fila = Record<string, string>;

async function conTurno(req: unknown) {
  // deno-lint-ignore no-explicit-any
  return await sql.begin(async (tx: any) => {
    const tIni = Date.now();
    await tx`select pg_advisory_xact_lock(727272)`;
    const tLock = Date.now() - tIni;
    const ahora = Date.now(), nombres = Object.keys(TABLAS);
    // Una sola consulta trae todas las tablas y la memoria rápida (un solo viaje a la base).
    const partes = nombres.map((t) => `'${t}', (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from public."${t}" q)`).join(", ");
    const [{ j }] = await tx.unsafe(
      `select jsonb_build_object(${partes}, 'kv', (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from public.kv q where x > ${ahora})) as j`,
    );
    const todo = typeof j === "string" ? JSON.parse(j) : j;
    const data: Record<string, Fila[]> = {}, sucio: Record<string, Set<string>> = {};
    nombres.forEach((t) => { data[t] = todo[t]; sucio[t] = new Set(); });
    const mem = new Map<string, { v: string; x: number }>(), kvSucio = new Set<string>();
    todo.kv.forEach((r: { k: string; v: string; x: number | string }) => mem.set(r.k, { v: r.v, x: Number(r.x) }));

    const fila = (t: string, o: Record<string, unknown>) => {
      const r: Fila = {};
      TABLAS[t].forEach((k: string) => { const v = o[k]; r[k] = v === undefined || v === null ? "" : String(v); });
      return r;
    };
    const ctx = {
      now: () => Date.now(),
      hoy: () => fmtHoy.format(new Date()),
      rand: () => crypto.randomUUID(),
      lock: (f: () => void) => f(),   // el turno global ya garantiza que nadie más escribe
      cache: {
        get: (k: string) => { const e = mem.get(k); return e && e.x > Date.now() ? e.v : null; },
        put: (k: string, v: unknown, ttl: number) => { mem.set(k, { v: String(v), x: Date.now() + ttl * 1000 }); kvSucio.add(k); },
        remove: (k: string) => { mem.delete(k); kvSucio.add(k); },
      },
      db: {
        all: (t: string) => data[t],
        get: (t: string, id: string) => data[t].find((r) => r.id === id) || null,
        insert: (t: string, o: Record<string, unknown>) => ctx.db.insertMany(t, [o]),
        insertMany: (t: string, os: Record<string, unknown>[]) => os.forEach((o) => { const r = fila(t, o); data[t].push(r); sucio[t].add(r.id); }),
        update: (t: string, id: string, p: Record<string, unknown>) => {
          const r = data[t].find((x) => x.id === id);
          if (!r) return false;
          Object.keys(p).forEach((k) => { if (TABLAS[t].includes(k)) r[k] = String(p[k]); });
          sucio[t].add(id);
          return true;
        },
        remove: (t: string, id: string) => { data[t] = data[t].filter((r) => r.id !== id); sucio[t].add(id); },
      },
    };

    const t0 = Date.now();
    const out = api(ctx, req);
    out.ms = Date.now() - t0;

    // Guardar lo que cambió, todo en un solo viaje a la base: por cada id tocado, si sigue en memoria se escribe y si no, se quita.
    // Los datos van entre $tag$...$tag$ con una marca al azar que no aparece en ellos, así no hay forma de colar SQL.
    const lit = (txt: string) => {
      let tag = "q" + crypto.randomUUID().replace(/-/g, "");
      while (txt.includes(tag)) tag += "x";
      return `$${tag}$${txt}$${tag}$`;
    };
    const lista = (xs: string[]) => "array[" + xs.map(lit).join(",") + "]::text[]";
    const orden: string[] = [];
    for (const t of nombres) {
      if (!sucio[t].size) continue;
      const cols: string[] = TABLAS[t], porId = new Map(data[t].map((r) => [r.id, r]));
      const sube = [...sucio[t]].filter((id) => porId.has(id)).map((id) => porId.get(id));
      const baja = [...sucio[t]].filter((id) => !porId.has(id));
      if (baja.length) orden.push(`delete from public."${t}" where id = any(${lista(baja)})`);
      if (sube.length) {
        const set = cols.filter((c) => c !== "id").map((c) => `"${c}" = excluded."${c}"`).join(", ");
        orden.push(`insert into public."${t}" select * from jsonb_populate_recordset(null::public."${t}", ${lit(JSON.stringify(sube))}::jsonb) on conflict (id) do update set ${set}`);
      }
    }
    if (kvSucio.size) {
      const sube = [...kvSucio].filter((k) => mem.has(k)).map((k) => ({ k, v: mem.get(k)!.v, x: mem.get(k)!.x }));
      const baja = [...kvSucio].filter((k) => !mem.has(k));
      if (baja.length) orden.push(`delete from public.kv where k = any(${lista(baja)})`);
      if (sube.length) orden.push(`insert into public.kv select * from jsonb_populate_recordset(null::public.kv, ${lit(JSON.stringify(sube))}::jsonb) on conflict (k) do update set v = excluded.v, x = excluded.x`);
    }
    if (orden.length) await tx.unsafe(orden.join(";\n"));
    if (Math.random() < 0.02) await tx`delete from public.kv where x < ${ahora}`;   // de vez en cuando, limpiar lo vencido
    out.lock = tLock; out.tx = Date.now() - tIni;   // para medir: espera del turno y tiempo total dentro de la transacción
    return out;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const cab = { ...CORS, "Content-Type": "application/json" };
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Pedido desconocido." }), { status: 405, headers: cab });
    const out = await conTurno(JSON.parse(await req.text()));
    return new Response(JSON.stringify(out), { headers: cab });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: "Hubo un problema en el servidor. Probá de nuevo." }), { headers: cab });
  }
});
