-- ============================================================
-- Estado automático de artefactos.
--
-- Hasta acá `artifacts.estado` era 100 % manual: nadie lo tocaba y los
-- catorce artefactos quedaban en 'no_empezado' para siempre aunque Beno
-- terminara las sesiones que los producen. Un tablero que no se mueve
-- solo se deja de mirar.
--
-- Tres decisiones que no se leen del esquema y que hay que saber antes
-- de tocar esto:
--
-- 1. **La columna va del lado del bloque** (`blocks.artifact_id`), no al
--    revés. Los catorce artefactos mapean contra los quince bloques, así
--    que a primera vista parece 1:1 — pero no lo es: "Queries SQL sobre
--    usage_events" (`pm-art-3`) es el entregable de la Semana 3 **y** de
--    la Semana 4 del track de PM, que son dos bloques distintos. Con la
--    columna del lado del artefacto ese caso no entra, y es un caso
--    real, no hipotético. Del lado del bloque entra sin inventar tabla
--    intermedia: muchos bloques, un artefacto.
--
-- 2. **Se deriva de `aplicacion_hecha`, NUNCA de `teoria_hecha`.** Un
--    artefacto es la salida aplicada —el refactor documentado, el
--    backlog en Jira, el informe—, no la lectura que lo precede. La
--    regla 5 del proyecto existe justamente porque leer la teoría y
--    aplicarla no son lo mismo, y este es el lugar donde confundirlas
--    saldría más caro: marcaría "completado" un entregable que no
--    existe. Por eso el trigger de `sessions` de más abajo escucha
--    `update of ... aplicacion_hecha` y no menciona `teoria_hecha` en
--    ningún lado.
--
-- 3. **El check `(estado = 'completado') = (fecha_completado is not
--    null)` se queda exactamente como está.** Es la decisión, y es
--    deliberada: no se relaja, no se reemplaza por un trigger y no se
--    borra. Convive con el estado derivado porque la derivación trae su
--    propia fecha real —`max(aplicacion_fecha)` de las sesiones que lo
--    completaron—, así que un 'completado' derivado nunca queda sin
--    fecha. La tentación era aflojarlo, y sería al revés de lo que pide
--    la situación: ahora hay MÁS caminos que escriben ese par (la
--    pantalla, el override, la derivación) que cuando el check se
--    escribió, no menos. Cuantas más manos tocan el par, más falta hace
--    lo único que garantiza que no se separen.
--
--    El único caso en que no hay fecha real es el override manual a
--    'completado' sin ninguna sesión aplicada. Ahí se usa `current_date`,
--    que es el día en que Beno lo declaró terminado: es un dato honesto,
--    no un relleno para contentar al check.
-- ============================================================

-- ------------------------------------------------------------
-- Las dos columnas nuevas.
-- ------------------------------------------------------------

alter table public.blocks
  add column artifact_id uuid references public.artifacts (id) on delete set null;

create index blocks_artifact_idx on public.blocks (artifact_id);

comment on column public.blocks.artifact_id is
  'Artefacto que produce este bloque. Nullable: hay bloques sin entregable. Varios bloques pueden apuntar al mismo artefacto (Semana 3 y Semana 4 comparten las queries SQL).';

alter table public.artifacts
  add column estado_manual public.estado_artefacto;

comment on column public.artifacts.estado_manual is
  'Override de Beno. Null = el estado se deriva de las sesiones aplicadas; no null = gana esto hasta que lo suelte poniéndolo en null.';

-- ------------------------------------------------------------
-- Backfill del vínculo, por slug.
--
-- Va por slug y no por id: los ids son distintos en cada base y esta
-- migración tiene que poder correr en una restaurada desde el respaldo.
-- Los slugs, en cambio, vienen del export de la app de estudio y son
-- justamente lo que hace idempotente al importador.
--
-- El mapeo se armó leyendo los nombres reales el 2026-08-10 (2 tracks,
-- 15 bloques, 14 artefactos). Los quince bloques tienen entregable; el
-- único artefacto que aparece dos veces es `pm-art-3`.
-- ------------------------------------------------------------

update public.blocks b
   set artifact_id = a.id
  from public.artifacts a
 where a.user_id = b.user_id
   and (b.slug, a.slug) in (
     -- Track de Product Manager
     ('pm-w1', 'pm-art-1'),   -- Scrum y ceremonias      -> Backlog Scrum en Jira
     ('pm-w2', 'pm-art-2'),   -- Historias de usuario    -> Historias con criterios
     ('pm-w3', 'pm-art-3'),   -- SQL (SQLBolt)           -> Queries sobre usage_events
     ('pm-w4', 'pm-art-3'),   -- SQL (Mode)              -> el MISMO artefacto
     ('pm-w5', 'pm-art-4'),   -- KPIs y métricas         -> Árbol de KPIs
     ('pm-w6', 'pm-art-5'),   -- Caso de negocio         -> Caso de negocio
     ('pm-w7', 'pm-art-7'),   -- Power BI                -> Dashboard en Power BI
     ('pm-w8', 'pm-art-6'),   -- Ciclo permanente        -> Retrospectivas
     -- Track de Dev (auditoría de Gentius)
     ('dev-b1', 'dev-art-1'), -- Calidad y refactoring   -> Refactor documentado
     ('dev-b2', 'dev-art-2'), -- Seguridad               -> Informe de seguridad
     ('dev-b3', 'dev-art-3'), -- Base de datos           -> Optimización de DB
     ('dev-b4', 'dev-art-4'), -- Arquitectura            -> Diagrama + escalabilidad
     ('dev-b5', 'dev-art-5'), -- Testing                 -> Suite de tests
     ('dev-b6', 'dev-art-6'), -- Red y web               -> Anatomía de una request
     ('dev-b7', 'dev-art-7')  -- Loops                   -> Doc de loops
   );

-- ------------------------------------------------------------
-- La derivación.
--
-- Sobre las sesiones de los bloques que apuntan al artefacto, sin
-- contar lo archivado (regla 4: archivar saca de las pantallas):
--
--   ninguna aplicada        -> no_empezado
--   algunas aplicadas       -> en_curso
--   todas aplicadas         -> completado
--
-- Un artefacto sin ningún bloque asociado queda en 'no_empezado', que es
-- la verdad: no hay actividad de la cual derivar nada.
-- ------------------------------------------------------------

create or replace function public.estado_artefacto_derivado(p_artifact_id uuid)
returns public.estado_artefacto
language sql
stable
set search_path = public
as $$
  with pasos as (
    select s.aplicacion_hecha
      from public.sessions s
      join public.blocks b on b.id = s.block_id
     where b.artifact_id = p_artifact_id
       and s.archivado_en is null
       and b.archivado_en is null
  )
  select case
    when (select count(*) from pasos) = 0
      then 'no_empezado'::public.estado_artefacto
    when (select count(*) from pasos where aplicacion_hecha) = 0
      then 'no_empezado'::public.estado_artefacto
    when (select count(*) from pasos where aplicacion_hecha)
       = (select count(*) from pasos)
      then 'completado'::public.estado_artefacto
    else 'en_curso'::public.estado_artefacto
  end;
$$;

comment on function public.estado_artefacto_derivado(uuid) is
  'Estado de un artefacto según las sesiones APLICADAS de sus bloques. Nunca mira teoria_hecha: un artefacto es la salida aplicada, no la lectura.';

-- La fecha que sostiene al check cuando el estado sale derivado: el día
-- en que se aplicó la última sesión que faltaba. Es un dato real, no una
-- fecha de conveniencia.
create or replace function public.fecha_artefacto_derivada(p_artifact_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  select max(s.aplicacion_fecha)
    from public.sessions s
    join public.blocks b on b.id = s.block_id
   where b.artifact_id = p_artifact_id
     and s.aplicacion_hecha
     and s.archivado_en is null
     and b.archivado_en is null;
$$;

comment on function public.fecha_artefacto_derivada(uuid) is
  'Fecha de la última sesión aplicada del artefacto. Es la fecha_completado cuando el estado se deriva.';

-- ------------------------------------------------------------
-- Se congela como override SOLO lo que la derivación perdería.
--
-- Prender una automatización no puede empezar tirando el dato que había:
-- si Beno marcó algo a mano y las sesiones no lo sostienen, gana lo suyo.
-- Pero el `where` compara **contra la derivación**, no contra
-- 'no_empezado', y esa diferencia importa: al 2026-08-10 el único
-- artefacto arrancado es "Backlog Scrum en Jira" ('en_curso'), y sus
-- sesiones ya dicen 'en_curso' solas (4 de 5 aplicadas). Congelarlo por
-- las dudas lo dejaría clavado ahí para siempre y no pasaría nunca a
-- 'completado' al aplicar la quinta, que es exactamente lo que esta
-- migración vino a arreglar. Con esta condición no se crea ningún
-- override hoy: se crearían solo si algún día hubiera un desacuerdo real.
-- ------------------------------------------------------------

update public.artifacts a
   set estado_manual = a.estado
 where a.estado_manual is null
   and a.estado is distinct from public.estado_artefacto_derivado(a.id);

-- ------------------------------------------------------------
-- El resolvedor: la ÚNICA cosa que escribe `estado` y
-- `fecha_completado`.
--
-- Es un trigger BEFORE sobre `artifacts` y no un cálculo repartido por
-- la app a propósito: con un solo lugar que escribe el par, el check de
-- arriba nunca puede saltar por un camino que alguien olvidó.
--
-- **Escribir `estado` a mano vale como override.** La pantalla de hoy
-- hace `update artifacts set estado = …` y todavía no conoce
-- `estado_manual`; si el trigger le pisara el valor, el botón dejaría de
-- funcionar el día que se aplique esta migración y nadie entendería por
-- qué. Entonces se interpreta lo obvio: si cambia `estado` y no cambia
-- `estado_manual`, es alguien decidiendo a mano, y eso se guarda como
-- override. Soltar el override es poner `estado_manual` en null
-- explícitamente.
-- ------------------------------------------------------------

create or replace function public.resolver_estado_artefacto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Los IF van anidados y no en una condición sola: en un BEFORE INSERT
  -- `old` no está asignado y PL/pgSQL evalúa la condición entera como una
  -- expresión SQL, sin cortocircuito, así que nombrar `old.estado` en el
  -- mismo `and` reventaría con "record old is not assigned yet".
  if tg_op = 'UPDATE' then
    -- Alguien escribió `estado` directamente: es una decisión manual.
    if new.estado is distinct from old.estado
       and new.estado_manual is not distinct from old.estado_manual then
      new.estado_manual := new.estado;
    end if;
  elsif tg_op = 'INSERT' then
    -- Alta con estado explícito (el importador de la app de estudio).
    if new.estado <> 'no_empezado' and new.estado_manual is null then
      new.estado_manual := new.estado;
    end if;
  end if;

  if new.estado_manual is not null then
    new.estado := new.estado_manual;
  else
    new.estado := public.estado_artefacto_derivado(new.id);
  end if;

  -- El par estado/fecha se escribe siempre junto, que es lo que el check
  -- exige. La fecha real primero; `current_date` solo para el override
  -- manual a 'completado' sin sesiones que lo respalden.
  if new.estado = 'completado' then
    new.fecha_completado := coalesce(
      public.fecha_artefacto_derivada(new.id),
      new.fecha_completado,
      current_date
    );
  else
    new.fecha_completado := null;
  end if;

  return new;
end;
$$;

create trigger artifacts_resolver_estado
  before insert or update on public.artifacts
  for each row execute function public.resolver_estado_artefacto();

-- ------------------------------------------------------------
-- Los disparadores: qué hace que el artefacto se vuelva a mirar.
--
-- Los dos hacen un update vacío sobre `artifacts`; el que recalcula es
-- el trigger BEFORE de arriba. Es a propósito que el cálculo esté en un
-- solo lado.
-- ------------------------------------------------------------

create or replace function public.refrescar_artefacto(p_artifact_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.artifacts
     set updated_at = now()
   where id = p_artifact_id;
$$;

create or replace function public.sessions_refrescar_artefacto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nuevo uuid;
  v_viejo uuid;
begin
  if tg_op <> 'DELETE' then
    select b.artifact_id into v_nuevo
      from public.blocks b where b.id = new.block_id;
  end if;
  if tg_op <> 'INSERT' then
    select b.artifact_id into v_viejo
      from public.blocks b where b.id = old.block_id;
  end if;

  if v_nuevo is not null then
    perform public.refrescar_artefacto(v_nuevo);
  end if;
  if v_viejo is not null and v_viejo is distinct from v_nuevo then
    perform public.refrescar_artefacto(v_viejo);
  end if;

  return null;
end;
$$;

-- `update of` con la lista explícita: marcar la TEORÍA de una sesión no
-- despierta a nadie, y eso es la regla 5 escrita en el esquema.
create trigger sessions_refrescar_artefacto
  after insert or delete
     or update of block_id, aplicacion_hecha, aplicacion_fecha, archivado_en
  on public.sessions
  for each row execute function public.sessions_refrescar_artefacto();

create or replace function public.blocks_refrescar_artefacto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nuevo uuid;
  v_viejo uuid;
begin
  if tg_op <> 'DELETE' then v_nuevo := new.artifact_id; end if;
  if tg_op <> 'INSERT' then v_viejo := old.artifact_id; end if;

  if v_nuevo is not null then
    perform public.refrescar_artefacto(v_nuevo);
  end if;
  if v_viejo is not null and v_viejo is distinct from v_nuevo then
    perform public.refrescar_artefacto(v_viejo);
  end if;

  return null;
end;
$$;

create trigger blocks_refrescar_artefacto
  after insert or delete or update of artifact_id, archivado_en
  on public.blocks
  for each row execute function public.blocks_refrescar_artefacto();

-- ------------------------------------------------------------
-- Primera corrida: deja a los catorce con el estado que les toca hoy.
-- ------------------------------------------------------------

update public.artifacts set updated_at = now();
