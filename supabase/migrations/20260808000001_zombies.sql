-- ============================================================
-- Detección de suscripciones zombie (spec 6.2) y su configuración.
--
-- La detección es **SQL puro, sin modelo**, como pide el spec. El modelo
-- solo redacta el aviso más adelante, y ni siquiera es imprescindible.
--
-- Tres cosas que salieron de mirar los datos reales el 2026-08-08 y que
-- cambian el diseño respecto de la letra del spec:
--
-- 1. **No hay ninguna recurrencia declarada.** Los cuatro gastos que se
--    repiten de verdad —Claude Pro, Vercel Pro, Verificado de Twitter,
--    Google Ads— viven como movimientos sueltos. Un detector que mire
--    solo `recurrences` no encontraría nada nunca. Por eso acá se
--    detecta sobre `movements`, agrupando por núcleo de descripción, y
--    las recurrencias declaradas se cruzan después.
--
-- 2. **Los cuatro son compartidos** (`project_id is null`). La regla del
--    spec —"gastos cuyo proyecto asociado no tiene actividad reciente"—
--    no le aplica a ninguno. Decisión de Beno: un gasto compartido se
--    mide contra la actividad de **toda la app**. Si hace meses que no
--    tocás nada, la suscripción que le sirve a todo sobra igual.
--
-- 3. **Contar cargos no sirve, hay que contar meses.** "Google Ads" son
--    cuatro cargos del mismo mes: es una campaña, no una suscripción.
--    Por eso el criterio es meses distintos con cargo, no cantidad de
--    movimientos.
--
-- Y una trampa que hay que esquivar sí o sí: **el propio cargo de la
-- suscripción no puede contar como actividad**. Si contara, toda
-- suscripción se mantendría viva sola —se paga, luego hay actividad,
-- luego no es zombie— y el detector no dispararía jamás.
-- ============================================================

-- ------------------------------------------------------------
-- settings: configuración por usuario.
--
-- Una fila por usuario, creada al vuelo la primera vez que se guarda.
-- Arranca con esta sola preferencia; es el lugar donde va a ir cayendo
-- lo que hoy son constantes y mañana Beno quiera tocar sin redesplegar.
-- ------------------------------------------------------------
create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Cuántos días sin actividad hacen sospechoso a un gasto recurrente.
  -- 90 por defecto: tres ciclos de una suscripción mensual. Con menos,
  -- un proyecto que descansa un verano se llena de falsos positivos.
  dias_inactividad_zombie integer not null default 90
    check (dias_inactividad_zombie between 15 and 730),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

comment on table public.settings is
  'Preferencias del usuario que no son datos de dominio. Una fila por usuario.';

alter table public.settings enable row level security;

create policy "settings_select_own" on public.settings
  for select to authenticated
  using (auth.uid() = user_id);

create policy "settings_insert_own" on public.settings
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "settings_update_own" on public.settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "settings_delete_own" on public.settings
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- El detector.
--
-- `security definer` y con `p_user_id` explícito porque lo llama el cron,
-- que corre sin sesión y con la service role key. Todas las consultas de
-- adentro filtran por ese usuario a mano.
--
-- Devuelve candidatos, no verdades: cada uno va a la bandeja y lo
-- confirma Beno.
-- ------------------------------------------------------------
create or replace function public.detectar_zombies(
  p_user_id uuid,
  p_dias integer default null,
  -- Hasta cuántos días después del último cargo se considera que la
  -- suscripción sigue viva. Dos ciclos y monedas: si hace más de eso que
  -- no aparece, ya está dada de baja y no hay nada que avisar.
  p_dias_vigencia integer default 75
)
returns table (
  nucleo text,
  descripcion_ultima text,
  project_id uuid,
  category_id uuid,
  meses_con_cargo bigint,
  primer_cargo date,
  ultimo_cargo date,
  monto_ars numeric,
  monto_usd numeric,
  moneda_origen public.moneda,
  monto_origen numeric,
  -- Última señal de vida del proyecto (o de toda la app, si el gasto es
  -- compartido), sin contar los cargos recurrentes.
  ultima_actividad date,
  dias_sin_actividad integer,
  -- La recurrencia declarada que le corresponde, si existe. Es lo único
  -- que se puede "dar de baja" desde la app.
  recurrence_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with config as (
    select coalesce(
      p_dias,
      (select s.dias_inactividad_zombie from public.settings s
        where s.user_id = p_user_id),
      90
    ) as dias
  ),

  -- Egresos efectuados del usuario, con su núcleo.
  egresos as (
    select
      m.*,
      public.nucleo_descripcion(m.descripcion_normalizada) as nucleo
    from public.movements m
    where m.user_id = p_user_id
      and m.tipo = 'egreso'
      and m.estado = 'efectuado'
      and public.nucleo_descripcion(m.descripcion_normalizada) is not null
  ),

  -- Un cargo por mes: si hay varios en el mismo mes se toma el último.
  -- Esto es lo que distingue una suscripción de una campaña de ads.
  por_mes as (
    select distinct on (e.nucleo, date_trunc('month', e.fecha))
      e.nucleo,
      date_trunc('month', e.fecha)::date as mes,
      e.fecha,
      e.descripcion,
      e.project_id,
      e.category_id,
      e.monto_ars,
      e.monto_usd,
      e.moneda_origen,
      e.monto_origen
    from egresos e
    order by e.nucleo, date_trunc('month', e.fecha), e.fecha desc
  ),

  recurrentes as (
    select
      pm.nucleo,
      count(*) as meses_con_cargo,
      min(pm.fecha) as primer_cargo,
      max(pm.fecha) as ultimo_cargo,
      (array_agg(pm.descripcion order by pm.fecha desc))[1] as descripcion_ultima,
      (array_agg(pm.project_id order by pm.fecha desc))[1] as project_id,
      (array_agg(pm.category_id order by pm.fecha desc))[1] as category_id,
      (array_agg(pm.monto_ars order by pm.fecha desc))[1] as monto_ars,
      (array_agg(pm.monto_usd order by pm.fecha desc))[1] as monto_usd,
      (array_agg(pm.moneda_origen order by pm.fecha desc))[1] as moneda_origen,
      (array_agg(pm.monto_origen order by pm.fecha desc))[1] as monto_origen
    from por_mes pm
    group by pm.nucleo
    having count(*) >= 2
  ),

  -- Los núcleos que son gasto recurrente. Sus cargos NO cuentan como
  -- actividad: una suscripción que se paga sola no es señal de que el
  -- proyecto esté vivo.
  nucleos_recurrentes as (
    select r.nucleo from recurrentes r
  ),

  -- Actividad real por proyecto: movimientos que no son cargos
  -- recurrentes, lecciones y entradas de bitácora.
  actividad_proyecto as (
    select project_id, max(fecha) as ultima from (
      select e.project_id, e.fecha
      from egresos e
      where e.nucleo not in (select nucleo from nucleos_recurrentes)
      union all
      select m.project_id, m.fecha
      from public.movements m
      where m.user_id = p_user_id and m.tipo = 'ingreso'
      union all
      select l.project_id, l.fecha
      from public.lessons l where l.user_id = p_user_id
      union all
      select d.project_id, d.fecha
      from public.daily_log d where d.user_id = p_user_id
    ) t
    where t.project_id is not null
    group by project_id
  ),

  -- Y la de toda la app, para los gastos compartidos.
  actividad_global as (
    select max(ultima) as ultima from actividad_proyecto
  )

  select
    r.nucleo,
    r.descripcion_ultima,
    r.project_id,
    r.category_id,
    r.meses_con_cargo,
    r.primer_cargo,
    r.ultimo_cargo,
    r.monto_ars,
    r.monto_usd,
    r.moneda_origen,
    r.monto_origen,
    act.ultima as ultima_actividad,
    (current_date - act.ultima)::integer as dias_sin_actividad,
    rec.id as recurrence_id
  from recurrentes r
  cross join config c
  -- Para un gasto con proyecto, la actividad de ese proyecto; para uno
  -- compartido, la de toda la app.
  left join lateral (
    select case
      when r.project_id is null then (select ultima from actividad_global)
      else (select ap.ultima from actividad_proyecto ap
             where ap.project_id = r.project_id)
    end as ultima
  ) act on true
  left join public.recurrences rec
    on rec.user_id = p_user_id
   and public.nucleo_descripcion(
         btrim(regexp_replace(
           lower(translate(rec.descripcion, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
           '[^a-z0-9]+', ' ', 'g'))
       ) = r.nucleo
  where
    -- Sigue viva: el cargo apareció hace poco.
    current_date - r.ultimo_cargo <= p_dias_vigencia
    -- Y lo que paga no muestra señales de vida.
    and act.ultima is not null
    and current_date - act.ultima > c.dias
  order by r.ultimo_cargo desc;
$$;

comment on function public.detectar_zombies(uuid, integer, integer) is
  'Gastos recurrentes cuyo proyecto (o toda la app, si son compartidos) no muestra actividad. SQL puro, sin modelo (spec 6.2). Los cargos recurrentes no cuentan como actividad.';
