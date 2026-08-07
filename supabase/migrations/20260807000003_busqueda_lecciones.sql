-- ============================================================
-- Búsqueda de lecciones: semántica + full-text en español.
--
-- Dos cambios respecto del esquema original:
--
-- 1. El embedding pasa de 384 a 768 dimensiones. La idea era usar
--    `gte-small`, el modelo nativo de las Edge Functions de Supabase,
--    pero es solo inglés. Probado contra datos reales en español,
--    `multilingual-e5-small` (384) acertó 2 de 4 consultas con márgenes
--    de 0.005 —ruido— y `multilingual-e5-base` (768) acertó 4 de 4.
--    Se migra ahora que la tabla está vacía; más adelante costaría
--    recalcular todo.
--
-- 2. Se agrega full-text en español. No es semántico, pero es
--    instantáneo, no depende de ningún modelo y encuentra por palabra
--    exacta. Es la red cuando el embedding falla, está frío o trunca.
-- ============================================================

-- ------------------------------------------------------------
-- 768 dimensiones
--
-- El índice se recrea, no se puede alterar el tipo de una columna
-- indexada. La tabla está vacía, así que no hay nada que recalcular.
-- ------------------------------------------------------------
drop index if exists public.lessons_embedding_idx;

alter table public.lessons
  alter column embedding type extensions.vector(768);

create index lessons_embedding_idx
  on public.lessons
  using hnsw (embedding extensions.vector_cosine_ops);

-- ------------------------------------------------------------
-- Full-text en español
--
-- `to_tsvector` con la configuración escrita como literal es inmutable,
-- que es lo que exige una columna generada. El título pesa más que el
-- cuerpo: si escribí "pricing" en el título, la lección es sobre eso.
-- ------------------------------------------------------------
alter table public.lessons
  add column busqueda tsvector
  generated always as (
    setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(contenido, '')), 'B')
  ) stored;

create index lessons_busqueda_idx on public.lessons using gin (busqueda);

-- ------------------------------------------------------------
-- Búsqueda híbrida
--
-- Combina los dos rankings con Reciprocal Rank Fusion: cada resultado
-- suma 1/(k + puesto) por cada lista en la que aparece. Se eligió RRF y
-- no una suma ponderada de scores porque los dos puntajes no son
-- comparables entre sí —una similitud coseno de 0.83 y un ts_rank de
-- 0.12 no están en la misma escala— y normalizarlos a mano habría
-- metido una constante arbitraria más.
--
-- Lo bueno de RRF acá: una lección que sale segunda en las dos listas le
-- gana a una que sale primera en una sola. Con un corpus chico, donde el
-- semántico es flojo, eso hace que el full-text lo sostenga.
--
-- Los archivados SÍ participan: un proyecto cerrado no ensucia las
-- listas de la interfaz, pero su conocimiento sigue siendo buscable.
-- `security invoker` deja que RLS haga el filtrado por usuario.
-- ------------------------------------------------------------
create or replace function public.buscar_lecciones_hibrido(
  p_consulta text,
  p_embedding extensions.vector(768) default null,
  p_limite integer default 10,
  -- 60 es el valor del paper original de RRF. Amortigua el peso de los
  -- primeros puestos para que un solo ranking no domine.
  p_k integer default 60
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
  puntaje double precision,
  similitud double precision,
  rank_texto double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with consulta as (
    select
      case
        when coalesce(trim(p_consulta), '') = '' then null
        else websearch_to_tsquery('spanish', p_consulta)
      end as tsq
  ),
  por_texto as (
    select
      l.id,
      row_number() over (order by ts_rank_cd(l.busqueda, c.tsq) desc) as puesto,
      ts_rank_cd(l.busqueda, c.tsq)::double precision as rank_texto
    from public.lessons l, consulta c
    where c.tsq is not null and l.busqueda @@ c.tsq
    limit greatest(p_limite, 1) * 4
  ),
  por_vector as (
    select
      l.id,
      row_number() over (
        order by l.embedding operator(extensions.<=>) p_embedding
      ) as puesto,
      (1 - (l.embedding operator(extensions.<=>) p_embedding))::double precision
        as similitud
    from public.lessons l
    where p_embedding is not null and l.embedding is not null
    order by l.embedding operator(extensions.<=>) p_embedding
    limit greatest(p_limite, 1) * 4
  )
  select
    l.id,
    l.project_id,
    l.fecha,
    l.titulo,
    l.contenido,
    l.categoria,
    l.origen,
    l.archivado_en,
    coalesce(1.0 / (p_k + t.puesto), 0.0) + coalesce(1.0 / (p_k + v.puesto), 0.0)
      as puntaje,
    v.similitud,
    t.rank_texto
  from public.lessons l
  left join por_texto t on t.id = l.id
  left join por_vector v on v.id = l.id
  where t.id is not null or v.id is not null
  order by puntaje desc, l.fecha desc
  limit greatest(p_limite, 1)
$$;

-- La función vieja quedaba con la firma de 384 y ya no compila contra la
-- columna nueva. La híbrida la reemplaza.
drop function if exists public.buscar_lecciones(extensions.vector, integer, double precision);
