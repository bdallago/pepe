-- ============================================================
-- Clasificación de movimientos: el histórico primero (spec 6.1).
--
-- El orden de resolución que pide el spec arranca sin modelo: si la
-- descripción ya apareció antes, se usa la categoría de esa vez. Para
-- que eso sea instantáneo de verdad —y no una lectura de las últimas
-- N filas resuelta en la aplicación— la comparación tiene que poder
-- apoyarse en un índice.
--
-- De ahí la columna generada: la normalización es determinística, así
-- que conviene calcularla una vez al escribir y no en cada consulta.
--
-- Qué se normaliza y qué no:
--   - Fuera mayúsculas, acentos y puntuación: "Suscripción a Vercel" y
--     "suscripcion a vercel" son lo mismo.
--   - **Los números se conservan.** "Netflix" y "Netflix 2" pueden ser
--     cosas distintas. De las dos formas se puede errar, pero un match
--     de más pone una categoría equivocada que hay que notar, y un
--     match de menos solo deja el campo vacío como estaba.
--
-- `translate` en vez de `unaccent`: hace lo mismo para el castellano y
-- evita depender de una extensión más. Todo lo que se usa acá es
-- IMMUTABLE, que es lo que exige una columna generada.
-- ============================================================

alter table public.movements
  add column descripcion_normalizada text
  generated always as (
    btrim(
      regexp_replace(
        lower(
          translate(
            descripcion,
            'áéíóúüñÁÉÍÓÚÜÑ',
            'aeiouunAEIOUUN'
          )
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    )
  ) stored;

-- El índice del match. Lleva `user_id` adelante porque toda consulta de
-- la app pasa por RLS y filtra por usuario primero.
create index movements_descripcion_normalizada_idx
  on public.movements (user_id, descripcion_normalizada);

-- ------------------------------------------------------------
-- Sugerencia por histórico.
--
-- Devuelve las categorías con las que se cargó antes esa misma
-- descripción, de la más usada a la menos usada. Se cuenta y no se
-- toma la última a propósito: un error de tipeo de la semana pasada no
-- tiene que convertirse en la sugerencia de todos los meses. Ante
-- empate en cantidad, gana la más reciente.
--
-- `security invoker` + RLS: cada quien ve solo su propio histórico.
-- ------------------------------------------------------------
create or replace function public.sugerir_categoria_historico(
  p_descripcion text
)
returns table (
  category_id uuid,
  tipo public.tipo_movimiento,
  veces bigint,
  ultima date
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
  )
  select
    m.category_id,
    -- El tipo de la carga más reciente con esa categoría.
    (array_agg(m.tipo order by m.fecha desc, m.created_at desc))[1] as tipo,
    count(*) as veces,
    max(m.fecha) as ultima
  from public.movements m, buscada b
  where m.descripcion_normalizada = b.texto
    and length(b.texto) >= 2
  group by m.category_id
  order by veces desc, ultima desc
  limit 5;
$$;

comment on function public.sugerir_categoria_historico(text) is
  'Paso 1 de la clasificación de movimientos: qué categoría usé antes para esta misma descripción. Sin modelo.';
