-- ------------------------------------------------------------
-- Tarifas de referencia del mercado
--
-- Sale del spec de presupuestos
-- (docs/superpowers/specs/2026-08-10-presupuestos-design.md).
--
-- Se adelanta el resto del esquema de presupuestos a propósito: es la
-- única pieza que necesita el cron de referencias, y separándola el cron
-- se puede construir en paralelo con el resto sin que dos frentes toquen
-- las mismas migraciones ni regeneren `database.types.ts` a la vez.
--
-- Las dos tablas van **sin `user_id`**, igual que `fx_rates`: una tarifa
-- de mercado no es de nadie. Lectura para cualquier autenticado,
-- escritura solo por service role, que es quien corre el cron.
-- ------------------------------------------------------------

-- El tipo de cliente también lo usa `quotes` más adelante. Se crea acá
-- porque `rate_references.segmento` lo necesita ahora.
create type public.tipo_cliente as enum ('particular', 'pyme', 'empresa');

-- ------------------------------------------------------------
-- rate_runs: una fila por corrida del cron, ande o no ande
--
-- Existe para que un scraper roto se vea. Parsear el `const DATA` de una
-- página de WordPress se rompe el día que la rediseñen, y el modo de
-- fallar que importa evitar es el silencioso: seguir mostrando el precio
-- de hace ocho meses como si fuera el de hoy.
-- ------------------------------------------------------------
create table public.rate_runs (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('flamahaus', 'salancy')),
  -- Cuándo corrió, no de cuándo es el dato de la fuente.
  fecha date not null,
  estado text not null check (
    estado in ('ok', 'sin_cambios', 'sospechoso', 'error')
  ),
  -- En castellano y entendible: esto se lee el día que algo falló.
  motivo text,
  filas integer,
  -- sha256 de lo parseado. Es lo que distingue "no cambió" de "no pude leer".
  huella text,
  -- `modified_gmt` en flamahaus, la máxima marca temporal en salancy.
  -- Sirve para separar "rediseñaron la página" de "se cayó el fetch".
  marca_origen text,
  -- Solo cuando el estado es 'sospechoso', para poder mirar qué llegó.
  crudo jsonb,
  corrido_en timestamptz not null default now(),
  unique (fuente, fecha)
);

create index rate_runs_recientes_idx on public.rate_runs (fuente, fecha desc);

-- ------------------------------------------------------------
-- rate_references: los valores, con histórico
--
-- El histórico no es acopio: en Argentina, ver cómo se movió la
-- referencia es lo que dice cuándo hay que subir la tarifa.
--
-- **La referencia vigente para una fecha es la última fila con
-- `fecha <= X`**, exactamente el criterio de `fx_rate_for_date`. Por eso
-- una corrida sin cambios no escribe filas: si escribiera, un año serían
-- 52 filas idénticas y el histórico dejaría de mostrar los saltos.
-- ------------------------------------------------------------
create table public.rate_references (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,
  -- La corrida que la trajo.
  fecha date not null,
  -- 'desarrollo-web-hora', 'landing', 'salario-junior'…
  clave text not null,
  -- Null en salancy: un sueldo no tiene tipo de cliente.
  segmento public.tipo_cliente,
  unidad text not null check (unidad in ('hora', 'mes', 'proyecto')),
  monto_ars numeric(16, 2) not null check (monto_ars > 0),
  unique (fuente, fecha, clave, segmento)
);

create index rate_references_lookup_idx
  on public.rate_references (clave, segmento, fecha desc);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.rate_runs enable row level security;
alter table public.rate_references enable row level security;

-- Cualquiera con sesión puede leerlas: no hay nada privado en una tarifa
-- de mercado. Escribir es solo del cron, que usa la service role y por
-- lo tanto saltea RLS; no hace falta ninguna policy de insert.
create policy "rate_runs lectura" on public.rate_runs
  for select to authenticated using (true);

create policy "rate_references lectura" on public.rate_references
  for select to authenticated using (true);
