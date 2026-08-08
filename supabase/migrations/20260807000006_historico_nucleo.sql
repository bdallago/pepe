-- ============================================================
-- El histórico también matchea ignorando el mes.
--
-- Medido contra los movimientos reales el 2026-08-07: la comparación
-- exacta fallaba justamente en el caso para el que existe. Las cargas
-- recurrentes se describen con el período adentro —"Claude Pro - Julio",
-- "Vercel Pro - Junio", "API de Fútbol - Mayo"— así que la descripción
-- normalizada **nunca** se repite: cada mes es un texto distinto y todo
-- caía al modelo. El paso 1 del spec quedaba muerto en la práctica.
--
-- El núcleo es la descripción sin el mes ni el año del final. Con eso,
-- "claude pro agosto" encuentra "claude pro julio" y la categoría sale
-- del histórico, sin modelo, como pide el spec.
--
-- Se busca primero por texto exacto y recién después por núcleo, y la
-- función dice cuál de las dos matcheó: no es lo mismo "ya lo cargaste
-- así tres veces" que "se parece a algo que cargaste". La interfaz lo
-- redacta distinto.
--
-- Se recortan **solo mes y año, y solo al final**. Un "mayo" en el medio
-- puede ser un apellido, y recortar por todos lados convertiría
-- descripciones distintas en el mismo núcleo.
-- ============================================================

-- ------------------------------------------------------------
-- El núcleo de una descripción ya normalizada.
--
-- IMMUTABLE porque se usa dentro de un índice.
-- ------------------------------------------------------------
create or replace function public.nucleo_descripcion(p_normalizada text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select nullif(
    btrim(
      regexp_replace(
        p_normalizada,
        '(\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|20[0-9]{2}))+$',
        '',
        'g'
      )
    ),
    ''
  );
$$;

comment on function public.nucleo_descripcion(text) is
  'Descripción normalizada sin el mes ni el año del final: "claude pro julio" → "claude pro".';

create index movements_nucleo_idx
  on public.movements (user_id, public.nucleo_descripcion(descripcion_normalizada));

-- ------------------------------------------------------------
-- Sugerencia por histórico, en dos niveles.
-- ------------------------------------------------------------
-- `create or replace` no alcanza: cambia la lista de columnas de salida
-- y Postgres no deja redefinir el tipo de retorno de una función que ya
-- existe. Hay que borrarla y crearla de nuevo.
drop function if exists public.sugerir_categoria_historico(text);

create function public.sugerir_categoria_historico(
  p_descripcion text
)
returns table (
  category_id uuid,
  tipo public.tipo_movimiento,
  veces bigint,
  ultima date,
  -- true = la descripción es idéntica; false = coincide el núcleo.
  exacto boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with buscada as (
    select btrim(
      regexp_replace(
        lower(translate(p_descripcion, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
        '[^a-z0-9]+', ' ', 'g'
      )
    ) as texto
  ),
  candidatos as (
    select
      m.category_id,
      m.tipo,
      m.fecha,
      m.created_at,
      m.descripcion_normalizada = b.texto as exacto
    from public.movements m, buscada b
    where length(b.texto) >= 2
      and (
        m.descripcion_normalizada = b.texto
        or public.nucleo_descripcion(m.descripcion_normalizada)
             = public.nucleo_descripcion(b.texto)
      )
  ),
  -- Si hubo alguna coincidencia exacta, las aproximadas no se miran:
  -- el texto idéntico siempre es mejor evidencia que el parecido.
  filtrados as (
    select * from candidatos
    where exacto or not exists (select 1 from candidatos where exacto)
  )
  select
    f.category_id,
    (array_agg(f.tipo order by f.fecha desc, f.created_at desc))[1] as tipo,
    count(*) as veces,
    max(f.fecha) as ultima,
    bool_or(f.exacto) as exacto
  from filtrados f
  group by f.category_id
  order by veces desc, ultima desc
  limit 5;
$$;

comment on function public.sugerir_categoria_historico(text) is
  'Paso 1 de la clasificación de movimientos: qué categoría usé antes para esta descripción, exacta o ignorando el mes. Sin modelo.';
