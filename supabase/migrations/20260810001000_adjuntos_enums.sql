-- ============================================================
-- Adjuntos: los enums.
--
-- Van en su propia migración y antes que la tabla por una razón de
-- Postgres, no de prolijidad: `alter type ... add value` agrega el valor
-- dentro de la transacción de la migración, pero **ese valor no se puede
-- usar hasta que la transacción commitea**. Si la tabla, un check o un
-- insert que lo usa vivieran en el mismo archivo, el push fallaría con
-- "unsafe use of new value of enum type". Separado, el archivo siguiente
-- arranca con los valores ya visibles.
--
-- Diseño en `docs/superpowers/specs/2026-08-10-adjuntos-design.md`.
--
-- ⚠ Si el `db push` llegara a fallar con "unsafe use of new value of enum
-- type", es que la CLI metió los dos archivos en una sola transacción:
-- aplicá este primero y solo (`--include-all` hasta esta versión) y
-- después el otro. Nada de acá depende de nada de allá.
-- ============================================================

-- Qué pase le toca al archivo. Lo decide el MIME, en código y sin modelo:
-- que haya un PDF o una imagen es un hecho, no una interpretación.
create type public.tipo_adjunto as enum ('pdf', 'imagen');

-- 'no_procesable' NO es un error y por eso es un valor aparte: un PDF
-- escaneado sin capa de texto y una captura borrosa son respuestas
-- correctas del pase ("acá no hay nada que leer"), no fallas. Mezclarlos
-- con 'error' haría que la pantalla pidiera reintentar algo que va a dar
-- siempre lo mismo.
create type public.estado_adjunto as enum (
  'pendiente', 'procesando', 'listo', 'no_procesable', 'error'
);

-- Una captura propone una ENTRADA DE BITÁCORA, no una lección. "Esto me
-- contestó un cliente" es algo que pasó. Y como entrada de bitácora, el
-- pase de extracción que ya existe la mira después y, si tiene una
-- lección adentro, la propone: ese camino no hay que construirlo.
alter type public.tipo_bandeja add value if not exists 'nota_de_adjunto';

-- De dónde salió una lección que entró por un archivo. El PDF no
-- necesita un tipo de bandeja nuevo —una lección propuesta por un modelo
-- ya es 'leccion_sugerida'— pero sí necesita que la lección se acuerde de
-- que no salió ni de la bitácora ni de un tema pedido a mano.
alter type public.origen_leccion add value if not exists 'adjunto';
