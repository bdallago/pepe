-- ============================================================
-- Módulo de aprendizaje y bitácora.
--
-- Fusiona dentro de esta app el contenido de la app de estudio que
-- vivía aparte (tracks, bloques, sesiones, artefactos y bitácora) y
-- agrega las dos piezas nuevas: lecciones con búsqueda semántica y una
-- bandeja de propuestas pendientes de confirmación.
--
-- Convención heredada del esquema de finanzas: tablas y claves foráneas
-- en inglés, columnas y enums en español. Toda tabla lleva user_id y
-- queda aislada por RLS (migración siguiente).
--
-- Nada de acá toca las tablas de finanzas.
-- ============================================================

-- pgvector para la búsqueda semántica de lecciones. Va al esquema
-- `extensions`, que es donde Supabase pone las extensiones, así que el
-- tipo y los operadores se referencian calificados.
create extension if not exists "vector" with schema extensions;

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------
create type public.categoria_leccion as enum (
  'tecnica', 'producto', 'comercial', 'proceso', 'personal'
);

-- 'importada' = extraída de la bitácora vieja; 'generada' = propuesta por
-- el modelo sobre un tema; 'retro' = salió del cierre de un proyecto.
-- Las generadas se marcan distinto en la interfaz: son hipótesis, no
-- experiencia vivida.
create type public.origen_leccion as enum (
  'manual', 'importada', 'generada', 'retro'
);

create type public.estado_artefacto as enum (
  'no_empezado', 'en_curso', 'completado'
);

create type public.tipo_bandeja as enum (
  'categorizacion', 'zombie', 'leccion_sugerida', 'leccion_extraida', 'retro'
);

-- 'pospuesto' es para los zombies que decido mirar más adelante (6.2) y
-- 'error' para cuando la salida del modelo no valida contra el esquema:
-- queda visible en la bandeja en vez de descartarse en silencio (5).
create type public.estado_bandeja as enum (
  'pendiente', 'aceptado', 'rechazado', 'pospuesto', 'error'
);

-- ------------------------------------------------------------
-- projects: pasa a ser la entidad raíz de toda la app, no solo de
-- finanzas. Solo se le agrega el archivado.
--
-- Archivar en vez de borrar: un proyecto cerrado sale de las listas pero
-- sus lecciones siguen participando de la búsqueda semántica y del
-- contexto de las retros. El conocimiento no se pierde.
-- ------------------------------------------------------------
alter table public.projects
  add column archivado_en timestamptz;

create index projects_archivado_idx
  on public.projects (user_id)
  where archivado_en is null;

-- ------------------------------------------------------------
-- tracks
--
-- `slug` es el id estable del export ('pm', 'dev'). Es lo que hace
-- idempotente al importador: correrlo dos veces actualiza en vez de
-- duplicar.
--
-- `cadencia` son los días de la semana en que toca el track, 1 = lunes ..
-- 7 = domingo (ISO). Cada track tiene la suya, independiente del otro.
-- ------------------------------------------------------------
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre text not null check (length(trim(nombre)) > 0),
  cadencia smallint[] not null default '{1,2,3,4,5,6,7}'
    check (cadencia <@ array[1,2,3,4,5,6,7]::smallint[]),
  color text not null default '#008F8F' check (color ~* '^#[0-9a-f]{6}$'),
  activo boolean not null default true,
  orden integer not null default 0,
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index tracks_user_idx on public.tracks (user_id, orden);

create trigger tracks_set_updated_at
  before update on public.tracks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- blocks
--
-- Agrupador entre track y sesión. En el track de producto son semanas y
-- en el de desarrollo son bloques temáticos, así que el nombre genérico
-- es a propósito: aplanarlo a un número de semana perdería el título, el
-- subtítulo y la bibliografía de cada uno.
--
-- `fuentes` es el array de bibliografía tal como venía: [{t, u}].
-- ------------------------------------------------------------
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  slug text not null,
  titulo text not null check (length(trim(titulo)) > 0),
  subtitulo text,
  fuentes jsonb not null default '[]'::jsonb,
  orden integer not null default 0,
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index blocks_track_idx on public.blocks (track_id, orden);

create trigger blocks_set_updated_at
  before update on public.blocks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- sessions
--
-- El progreso es DOBLE a propósito: leer la teoría y aplicarla no son lo
-- mismo, y esa distinción es el punto de la app. Un solo campo `estado`
-- no puede representar "leí el 14 pero todavía no lo apliqué".
--
-- `teoria_texto` / `teoria_link` / `consigna` son tres cosas distintas y
-- se guardan separadas, no concatenadas en una descripción.
-- ------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  block_id uuid references public.blocks (id) on delete set null,
  slug text not null,
  titulo text not null check (length(trim(titulo)) > 0),
  teoria_texto text,
  teoria_link text,
  consigna text,
  orden integer not null default 0,

  teoria_hecha boolean not null default false,
  teoria_fecha date,
  aplicacion_hecha boolean not null default false,
  aplicacion_fecha date,

  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  -- La fecha solo tiene sentido si el paso está hecho, y viceversa.
  check (teoria_hecha = (teoria_fecha is not null)),
  check (aplicacion_hecha = (aplicacion_fecha is not null))
);

create index sessions_track_idx on public.sessions (track_id, orden);
create index sessions_block_idx on public.sessions (block_id, orden);

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- artifacts
--
-- Entregables de portfolio por track. `estado` es un enum de tres
-- valores, no un booleano: "en curso" es un estado real y es el del
-- único artefacto arrancado.
-- ------------------------------------------------------------
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  slug text not null,
  nombre text not null check (length(trim(nombre)) > 0),
  estado public.estado_artefacto not null default 'no_empezado',
  fecha_completado date,
  url text,
  orden integer not null default 0,
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  check ((estado = 'completado') = (fecha_completado is not null))
);

create index artifacts_track_idx on public.artifacts (track_id, orden);

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- daily_log
--
-- La bitácora: qué hice y qué aprendí ese día. Cuelga de un proyecto
-- (el conocimiento pertenece a un producto) y opcionalmente de un track.
--
-- `slug` guarda el id del export para que el importador sea idempotente.
-- ------------------------------------------------------------
create table public.daily_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  track_id uuid references public.tracks (id) on delete set null,
  slug text,
  fecha date not null,
  contenido text not null check (length(trim(contenido)) > 0),
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index daily_log_user_fecha_idx on public.daily_log (user_id, fecha desc);
create index daily_log_project_idx on public.daily_log (project_id, fecha desc);

create trigger daily_log_set_updated_at
  before update on public.daily_log
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- lessons
--
-- `movement_id` ata una lección a la transacción que la originó (la
-- tabla de transacciones se llama `movements` en este esquema).
--
-- El embedding se llena aparte, por Edge Function, así que arranca nulo:
-- escribir una lección nunca puede depender de que el embedding salga.
-- ------------------------------------------------------------
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  movement_id uuid references public.movements (id) on delete set null,
  fecha date not null default current_date,
  titulo text not null check (length(trim(titulo)) > 0),
  contenido text not null check (length(trim(contenido)) > 0),
  categoria public.categoria_leccion not null,
  origen public.origen_leccion not null default 'manual',
  embedding extensions.vector(384),
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lessons_user_fecha_idx on public.lessons (user_id, fecha desc);
create index lessons_project_idx on public.lessons (project_id, fecha desc);
create index lessons_categoria_idx on public.lessons (user_id, categoria);

-- Cola de pendientes para el backfill de embeddings: barata y siempre
-- chica, porque se vacía a medida que la Edge Function los completa.
create index lessons_sin_embedding_idx
  on public.lessons (user_id)
  where embedding is null;

-- HNSW y no IVFFlat, a propósito:
--   - IVFFlat necesita entrenarse sobre datos ya cargados y su parámetro
--     `lists` se calibra contra la cantidad de filas. Acá el índice se
--     crea sobre una tabla vacía y crece de a poco, así que arrancaría
--     mal calibrado y habría que reconstruirlo cada tanto.
--   - HNSW se construye incremental, no necesita entrenamiento y tiene
--     mejor recall con pocas filas.
-- El costo de HNSW es más memoria y escrituras más lentas: irrelevante
-- con este volumen. Coseno porque gte-small devuelve vectores donde lo
-- que importa es la dirección, no la magnitud.
create index lessons_embedding_idx
  on public.lessons
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger lessons_set_updated_at
  before update on public.lessons
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- inbox
--
-- Todo lo que un modelo propone y espera confirmación mía. NADA se
-- escribe en las tablas de dominio sin pasar por acá y sin que yo
-- apriete un botón.
--
-- `entidad_tabla` + `entidad_id` apuntan al registro al que aplica la
-- propuesta (la transacción a categorizar, la recurrencia sospechada de
-- zombie, la entrada de bitácora de la que salió la lección). Sin FK:
-- apunta a tablas distintas según el tipo.
--
-- `clave_dedupe` es lo que hace idempotentes al job de zombies y al pase
-- de extracción: si el proceso se corta y se reintenta, la propuesta ya
-- creada choca contra el índice único en vez de duplicarse. Solo aplica
-- a lo no resuelto — una vez que resolví un ítem, un candidato nuevo con
-- la misma clave sí puede volver a aparecer.
-- ------------------------------------------------------------
create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo public.tipo_bandeja not null,
  payload jsonb not null,
  estado public.estado_bandeja not null default 'pendiente',
  entidad_tabla text,
  entidad_id uuid,
  clave_dedupe text,
  -- Solo para 'pospuesto': hasta cuándo no mostrarlo.
  posponer_hasta timestamptz,
  -- Para 'error': qué falló al validar la salida del modelo.
  error_detalle text,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  check ((estado in ('pendiente', 'pospuesto')) = (resuelto_en is null))
);

-- La cola de triage: un ítem por vez, el más viejo primero.
create index inbox_pendientes_idx
  on public.inbox (user_id, creado_en)
  where estado in ('pendiente', 'pospuesto');

create index inbox_entidad_idx
  on public.inbox (user_id, entidad_tabla, entidad_id);

create unique index inbox_dedupe_key
  on public.inbox (user_id, clave_dedupe)
  where clave_dedupe is not null and estado in ('pendiente', 'pospuesto');

-- ------------------------------------------------------------
-- Búsqueda semántica de lecciones.
--
-- Los archivados SÍ participan: un proyecto cerrado no ensucia las
-- listas de la interfaz, pero su conocimiento sigue siendo buscable.
-- ------------------------------------------------------------
create or replace function public.buscar_lecciones(
  p_embedding extensions.vector(384),
  p_limite integer default 10,
  p_umbral double precision default 0.0
)
returns table (
  id uuid,
  project_id uuid,
  fecha date,
  titulo text,
  contenido text,
  categoria public.categoria_leccion,
  origen public.origen_leccion,
  archivado_en timestamptz,
  similitud double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    l.id,
    l.project_id,
    l.fecha,
    l.titulo,
    l.contenido,
    l.categoria,
    l.origen,
    l.archivado_en,
    1 - (l.embedding operator(extensions.<=>) p_embedding) as similitud
  from public.lessons l
  where l.embedding is not null
    and 1 - (l.embedding operator(extensions.<=>) p_embedding) >= p_umbral
  order by l.embedding operator(extensions.<=>) p_embedding
  limit greatest(p_limite, 1)
$$;
