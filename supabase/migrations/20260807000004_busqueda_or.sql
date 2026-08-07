-- ============================================================
-- El full-text pasa de AND a OR.
--
-- `websearch_to_tsquery` une los términos con AND, así que buscar
-- "base de datos pausada" exigía las tres palabras y no encontraba una
-- lección que dice "pausa el proyecto ... toca la base". Para un
-- buscador de notas propias eso es peor que inútil: uno no se acuerda
-- de las palabras exactas que escribió, se acuerda del tema.
--
-- Con OR, la precisión la da el ranking y no el filtro: `ts_rank_cd`
-- pondera cuántos términos matchearon y a qué distancia, así que la
-- lección que tiene las tres palabras sigue saliendo antes que la que
-- tiene una. Y en la híbrida, RRF castiga a las que solo aparecen en
-- una de las dos listas.
--
-- Se conserva `websearch_to_tsquery` como punto de partida (entiende
-- comillas para frase exacta y "-" para negación) y se le cambia el
-- operador; parsear la consulta a mano habría perdido eso.
-- ============================================================

create or replace function public.buscar_lecciones_hibrido(
  p_consulta text,
  p_embedding extensions.vector(768) default null,
  p_limite integer default 10,
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
        -- El cast a text y vuelta es la forma barata de cambiarle el
        -- operador sin reimplementar el parser.
        else nullif(
          replace(websearch_to_tsquery('spanish', p_consulta)::text, '&', '|'),
          ''
        )::tsquery
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
