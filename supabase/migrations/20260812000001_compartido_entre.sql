-- ============================================================
-- El gasto compartido entre un subconjunto explícito de proyectos.
--
-- Beno lo pidió con estas palabras: *"este gasto es un compartido entre
-- y, z y u proyecto"*. Hasta hoy no se podía guardar —`movements.project_id`
-- es una sola columna, así que un gasto es de un proyecto o es de todos
-- los que estaban vivos ese día— y el spec del reparto por fecha lo dejó
-- explícitamente afuera.
--
-- ⚠ **Esta tabla NO cambia el default.** Un compartido sin filas acá se
-- sigue repartiendo por ventana de fecha, exactamente como antes. Las
-- filas son una **anulación explícita** para el gasto que la tenga, y
-- por eso la tabla puede entrar sin tocar un solo número de los que hay
-- cargados: al aplicarla, los 15 compartidos de hoy quedan sin filas y
-- se reparten igual que ayer.
--
-- ── Por qué lo explícito le gana a la ventana de fecha ───────────────
--
-- Un subconjunto guardado acá se usa **tal cual, sin filtrar por
-- `estaVivo()`**. La ventana de fecha existe justamente porque *no* hay
-- una declaración de Beno; cuando la hay, filtrarla encima convertiría
-- "de estos tres" en "de los que yo diga que además sigan abiertos", que
-- es otra cosa y no es lo que él pidió. Si elige un proyecto cerrado a
-- esa fecha, está diciendo que ese proyecto tiene que cargar su parte, y
-- es su decisión.
--
-- El invariante `suma(balance por proyecto) === balance general` se
-- mantiene: el monto se sigue repartiendo entero, solo cambia entre
-- quiénes.
-- ============================================================

create table public.movement_projects (
  movement_id uuid not null references public.movements(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,

  -- Redundante con `movements.user_id`, y a propósito: es lo que permite
  -- que las políticas de RLS sean las mismas cuatro de siempre en vez de
  -- un `exists` contra `movements` en cada una.
  user_id uuid not null references auth.users(id) on delete cascade,

  creado_en timestamptz not null default now(),

  primary key (movement_id, project_id)
);

comment on table public.movement_projects is
  'Subconjunto explícito de proyectos entre los que se reparte un gasto compartido. Sin filas, el reparto es por ventana de fecha (el default). Ver AGENTS.md §2.';

-- El reparto recorre los compartidos y pregunta por su subconjunto, así
-- que el acceso siempre es por movimiento. La PK ya cubre ese orden.
create index movement_projects_project_idx
  on public.movement_projects (project_id);

-- ------------------------------------------------------------
-- Solo para gastos compartidos, y con esto garantizado en la base.
--
-- Un movimiento con `project_id` puesto no pasa por el reparto en
-- ningún caso (AGENTS.md §2), así que un subconjunto ahí no se leería
-- nunca: sería una fila que promete algo que no pasa. Un `check` no
-- puede mirar otra tabla, de ahí el trigger.
--
-- Va también en el `update` de `movements`: sin eso, asignarle un
-- proyecto a un compartido que ya tenía subconjunto dejaría las filas
-- huérfanas de sentido, calladas.
-- ------------------------------------------------------------
create or replace function public.movimiento_es_compartido()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.movements m
    where m.id = new.movement_id and m.project_id is not null
  ) then
    raise exception
      'Solo un gasto compartido (project_id nulo) puede tener un subconjunto de proyectos.';
  end if;
  return new;
end;
$$;

create trigger movement_projects_solo_compartidos
  before insert or update on public.movement_projects
  for each row execute function public.movimiento_es_compartido();

create or replace function public.limpiar_subconjunto_al_imputar()
returns trigger
language plpgsql
as $$
begin
  -- Si el movimiento deja de ser compartido, su subconjunto pierde todo
  -- sentido: se borra en vez de quedar como basura que nadie lee.
  if new.project_id is not null and old.project_id is null then
    delete from public.movement_projects where movement_id = new.id;
  end if;
  return new;
end;
$$;

create trigger movements_limpiar_subconjunto
  after update of project_id on public.movements
  for each row execute function public.limpiar_subconjunto_al_imputar();

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del esquema.
-- ------------------------------------------------------------
alter table public.movement_projects enable row level security;

create policy "movement_projects_select_own" on public.movement_projects
  for select to authenticated
  using (auth.uid() = user_id);

create policy "movement_projects_insert_own" on public.movement_projects
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "movement_projects_update_own" on public.movement_projects
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "movement_projects_delete_own" on public.movement_projects
  for delete to authenticated
  using (auth.uid() = user_id);
