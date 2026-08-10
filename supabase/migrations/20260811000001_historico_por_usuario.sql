-- ============================================================
-- `sugerir_categoria_historico` acepta un usuario explícito.
--
-- La función es `security invoker` y hasta hoy se apoyaba enteramente en
-- RLS para no mezclar los movimientos de dos personas. Eso alcanza
-- mientras la llamen el formulario y la caja, que hablan con la base con
-- la identidad de Beno.
--
-- El conector MCP remoto no. Sus tools no tienen una sesión de Supabase:
-- el token que presentan es un `pepe_at_…` emitido por la propia app, y
-- del otro lado hay un cliente con la service role key, que **saltea
-- RLS** (el porqué está desarrollado en `src/lib/mcp/datos.ts`). Sin un
-- filtro explícito, esta función le contestaría al conector con el
-- histórico de todos los usuarios.
--
-- Hoy hay un solo usuario, así que la fila que devuelve es la misma. Se
-- arregla igual, y por dos razones que no dependen de eso: la regla que
-- ordena `mcp/datos.ts` es que **ninguna consulta salga sin filtrar por
-- usuario**, y el día que esa premisa cambie nadie se va a acordar de
-- venir a mirar acá.
--
-- ## Por qué el parámetro es opcional
--
-- Para no tocar los dos call sites que ya andan
-- (`lib/clasificacion.ts`, vía el formulario y la caja): con RLS
-- puesta, filtrar de nuevo sería redundante. `null` significa
-- "confiá en RLS", que es exactamente lo que pasaba antes.
--
-- ## Por qué drop y no `create or replace`
--
-- Agregar un argumento no reemplaza la función: crea una **sobrecarga**.
-- Con la vieja todavía viva, `sugerir_categoria_historico(p_descripcion
-- => …)` pasaría a ser una llamada ambigua y fallaría en runtime, sin
-- que nada lo avise al aplicar la migración. Hay que borrar la de un
-- argumento.
--
-- El cuerpo es el de `20260807000006_historico_nucleo.sql` con una sola
-- línea agregada. Los dos niveles de match —texto idéntico primero,
-- núcleo (la descripción sin el mes) después— y el orden por veces y
-- luego por fecha quedan intactos: son la regla, y sigue viviendo acá.
--
-- Efecto lateral bienvenido: `movements_nucleo_idx` está sobre
-- `(user_id, nucleo_descripcion(...))`, así que pasarle el usuario le
-- deja usar la primera columna del índice en vez de descartarla.
-- ============================================================

drop function if exists public.sugerir_categoria_historico(text);

create function public.sugerir_categoria_historico(
  p_descripcion text,
  -- null = no filtrar acá y dejar que RLS haga su trabajo.
  p_user_id uuid default null
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
      and (p_user_id is null or m.user_id = p_user_id)
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

comment on function public.sugerir_categoria_historico(text, uuid) is
  'Paso 1 de la clasificación de movimientos: qué categoría usé antes para esta descripción, exacta o ignorando el mes. Sin modelo. p_user_id null = confiar en RLS.';
