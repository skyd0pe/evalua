-- Evaluá: tablas del servidor. Cada columna es texto, igual que las pestañas de la planilla; las reglas (core.js) convierten.
-- RLS activado y sin políticas: solo la función `api` (con la conexión directa) puede leer y escribir.
create table if not exists public."Config" (
  "id" text primary key,
  "valor" text not null default ''
);
alter table public."Config" enable row level security;
create table if not exists public."Cursos" (
  "id" text primary key,
  "nombre" text not null default '',
  "ocultarTabla" text not null default ''
);
alter table public."Cursos" enable row level security;
create table if not exists public."Alumnos" (
  "id" text primary key,
  "cursoId" text not null default '',
  "nombre" text not null default '',
  "activo" text not null default '',
  "vinculo" text not null default ''
);
alter table public."Alumnos" enable row level security;
create table if not exists public."Bancos" (
  "id" text primary key,
  "titulo" text not null default ''
);
alter table public."Bancos" enable row level security;
create table if not exists public."Preguntas" (
  "id" text primary key,
  "bancoId" text not null default '',
  "texto" text not null default '',
  "opciones" text not null default '',
  "correcta" text not null default '',
  "anulada" text not null default ''
);
alter table public."Preguntas" enable row level security;
create table if not exists public."Clases" (
  "id" text primary key,
  "cursoId" text not null default '',
  "bancoId" text not null default '',
  "titulo" text not null default '',
  "fecha" text not null default '',
  "segundos" text not null default '',
  "porAlumno" text not null default '',
  "estado" text not null default '',
  "modo" text not null default ''
);
alter table public."Clases" enable row level security;
create table if not exists public."Intentos" (
  "id" text primary key,
  "claseId" text not null default '',
  "alumnoId" text not null default '',
  "inicio" text not null default '',
  "fin" text not null default '',
  "orden" text not null default '',
  "aciertos" text not null default '',
  "total" text not null default '',
  "enCasa" text not null default '',
  "salidas" text not null default '',
  "device" text not null default '',
  "resp" text not null default ''
);
alter table public."Intentos" enable row level security;
create table if not exists public."Marcas" (
  "id" text primary key,
  "claseId" text not null default '',
  "alumnoId" text not null default '',
  "estado" text not null default ''
);
alter table public."Marcas" enable row level security;
create table if not exists public."Pines" (
  "id" text primary key,
  "pin" text not null default '',
  "vence" text not null default ''
);
alter table public."Pines" enable row level security;
create index if not exists intentos_clase on public."Intentos" ("claseId");
create index if not exists alumnos_curso on public."Alumnos" ("cursoId");
create index if not exists clases_curso on public."Clases" ("cursoId");
create index if not exists preguntas_banco on public."Preguntas" ("bancoId");
-- Memoria rápida (sesiones, estado de intentos, límites): clave, valor y vencimiento en milisegundos.
create table if not exists public.kv (k text primary key, v text not null, x bigint not null);
alter table public.kv enable row level security;
create index if not exists kv_x on public.kv (x);
