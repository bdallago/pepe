-- ============================================================
-- Las ventanas de vida de los tres proyectos.
--
-- `fecha_inicio` y `fecha_fin` existen desde
-- `20260810000001_proyectos_fechas.sql` y hasta hoy no las leyó nadie.
-- Con este dato cargado, el reparto de gastos compartidos puede pasar a
-- calcularse contra la fecha de cada gasto en vez de contra la foto de
-- los proyectos activos de hoy.
--
-- Las fechas las dio Beno el 2026-08-10. Del 20/07 dijo "el 20/07 o por
-- ahí": queda corregible desde la pantalla de Ajustes.
--
-- ⚠ Esta migración **no** borra la columna `activo`, y eso es
-- deliberado. Si las dos cosas pasaran juntas habría un momento —entre
-- el `alter table` y el deploy del código que lee las fechas— en el que
-- los tres proyectos quedarían sin ventana y sin bandera, o sea "vivos
-- siempre", y Gentius se comería un tercio de los 15 gastos compartidos.
-- La columna se borra en `20260810100001`, varios commits después, con
-- el código ya leyendo fechas.
--
-- Se escribe por `slug` y no por `id`: los uuid son de la base de Beno y
-- no sobrevivirían a un `db reset` sobre otro proyecto.
-- ============================================================

update public.projects set fecha_inicio = '2026-04-01', fecha_fin = '2026-07-20'
  where slug in ('proder', 'el-prode-de-beno');

update public.projects set fecha_inicio = '2026-07-01', fecha_fin = null
  where slug = 'gentius';
