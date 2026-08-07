-- ============================================================
-- Fecha de arranque del plan, por track.
--
-- La app de origen la guardaba como un valor suelto de configuración
-- (`meta.startDate`), global para toda la app. Acá va por track: cada
-- uno puede empezar cuando empieza, que es más fiel a que las cadencias
-- son independientes.
--
-- La necesitan la vista de Hoy (para el estado "el plan todavía no
-- arrancó") y la proyección de la semana.
--
-- Nullable a propósito: un track recién creado todavía no arrancó, y eso
-- es distinto de haber arrancado hoy.
-- ============================================================

alter table public.tracks
  add column fecha_inicio date;

-- Los dos tracks importados arrancaron el 2026-07-14, que es el
-- `meta.startDate` del export.
update public.tracks
set fecha_inicio = '2026-07-14'
where slug in ('pm', 'dev')
  and fecha_inicio is null;
