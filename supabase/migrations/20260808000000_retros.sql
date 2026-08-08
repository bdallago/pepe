-- ============================================================
-- Retros por proyecto (spec 6.5).
--
-- La retro se pide a demanda ("cerrá Gentius"), el modelo devuelve un
-- borrador estructurado y Beno decide si lo guarda. Las lecciones
-- candidatas que salen de ahí van a `inbox` como tipo 'retro' y siguen
-- el camino normal de confirmación; **este texto no**: es el documento
-- que Beno leyó y aprobó, no una propuesta pendiente.
--
-- Por qué tabla propia y no una entrada de bitácora:
--
--   - La bitácora es registro de lo que pensó **ese día**. Una retro es
--     el cierre de un proyecto entero y se busca por proyecto, no por
--     fecha.
--   - Si viviera en `daily_log`, el pase de extracción de lecciones la
--     volvería a mandar al modelo para sacarle lecciones — y las
--     lecciones de la retro ya se extrajeron en el mismo pase que la
--     generó. Sería trabajo repetido y propuestas duplicadas.
--
-- El texto se guarda en cuatro campos y no en un markdown suelto porque
-- esa es la estructura que pide el spec ("qué funcionó, qué no, cuánto
-- costó realmente") y porque así la pantalla no tiene que parsear la
-- salida del modelo para mostrarla.
-- ------------------------------------------------------------

create table public.retros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- La fecha en que se cerró el proyecto, editable. `date` y no
  -- timestamptz: se maneja como string 'YYYY-MM-DD' en todo el repo.
  fecha date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,

  titulo text not null check (length(trim(titulo)) > 0),
  que_funciono text not null default '',
  que_no_funciono text not null default '',
  -- Lectura en prosa de la plata: el número exacto ya está en los
  -- movimientos y se recalcula solo. Acá va lo que el número no dice.
  costo_real text not null default '',
  -- Cierre libre. Lo único que el modelo escribe sin estructura.
  conclusion text not null default '',

  -- Snapshot del balance al momento de cerrar, congelado igual que los
  -- montos de `movements`: la retro dice lo que costó **cuando se
  -- cerró**. Recalcularlo con los movimientos de hoy cambiaría el
  -- sentido de un documento ya aprobado.
  balance_ars numeric(14, 2),
  balance_usd numeric(14, 2),

  -- Qué modelo la redactó. Sirve para releerla dentro de un año y saber
  -- con qué se hizo; null si Beno la escribió a mano.
  modelo text,

  -- Archivar en vez de borrar, como todo el módulo de aprendizaje.
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un proyecto puede tener más de una retro (se cierra una etapa, se
-- reabre, se vuelve a cerrar), así que no hay unique. El índice es el de
-- la consulta real: las retros vigentes de un proyecto, de la más nueva
-- a la más vieja.
create index retros_project_idx
  on public.retros (user_id, project_id, fecha desc)
  where archivado_en is null;

create trigger retros_set_updated_at
  before update on public.retros
  for each row execute function public.set_updated_at();

comment on table public.retros is
  'Cierre de proyecto redactado por el modelo y aprobado por el usuario (spec 6.5). El texto se guarda acá; las lecciones candidatas van por inbox.';

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del módulo.
-- ------------------------------------------------------------
alter table public.retros enable row level security;

create policy "retros_select_own" on public.retros
  for select to authenticated
  using (auth.uid() = user_id);

create policy "retros_insert_own" on public.retros
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "retros_update_own" on public.retros
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "retros_delete_own" on public.retros
  for delete to authenticated
  using (auth.uid() = user_id);
