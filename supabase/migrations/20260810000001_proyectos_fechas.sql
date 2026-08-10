-- ============================================================
-- Fechas de inicio y fin en proyectos.
--
-- Las dos nullable: hay proyectos que arrancaron antes de que existiera
-- la app y proyectos que no terminaron. Un `not null` acá obligaría a
-- inventar una fecha, que es peor que no tenerla.
--
-- ⚠ LA CONSECUENCIA GRANDE, Y NO ES EN ESTE ARCHIVO
--
-- Hoy `calcularParticipaciones(projects)` (`src/lib/prorrateo.ts`) **no
-- recibe ninguna fecha**. Filtra por `activo` —una columna booleana, sin
-- historia— y aplica ese reparto a TODO el histórico. O sea que un gasto
-- compartido de marzo se reparte hoy entre los proyectos que están
-- activos HOY, aunque en marzo alguno todavía no existiera y otro ya
-- estuviera cerrado.
--
-- Con `fecha_inicio` y `fecha_fin` eso se puede hacer bien: un gasto de
-- marzo se reparte entre los que estaban vivos en marzo. Es más correcto
-- y además es **más estable** —el pasado deja de moverse cada vez que se
-- archiva o se abre un proyecto—, que es la misma razón por la que el
-- tipo de cambio se congela (regla 1) y por la que la retro congela su
-- balance.
--
-- Pero hay que decirlo con todas las letras: **eso CAMBIA los balances
-- por proyecto que Beno viene mirando.** No los totales —el balance
-- general suma el compartido una sola vez y no depende del reparto— pero
-- sí cuánto le toca a cada proyecto, hacia atrás, en todo el histórico.
-- No es un bug que se arregla: es un número que hoy dice una cosa y va a
-- decir otra.
--
-- **Esta migración sola no cambia nada.** Agrega dos columnas que nadie
-- lee todavía; con las dos en null el comportamiento es idéntico al de
-- hoy. El cambio de comportamiento es del código —`prorrateo.ts` y
-- `balances.ts`, que habría que pasarles la fecha del movimiento— y es
-- una decisión aparte, con su propia verificación del invariante
-- `suma(balance de cada proyecto) === balance general`.
-- ============================================================

alter table public.projects
  add column fecha_inicio date,
  add column fecha_fin date;

-- Si están las dos, tienen que estar en ese orden. Un proyecto que
-- termina antes de empezar es un error de tipeo, no un dato.
alter table public.projects
  add constraint projects_fechas_coherentes
  check (fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio);

comment on column public.projects.fecha_inicio is
  'Cuándo arrancó el proyecto. Nullable: los que empezaron antes que la app no la tienen.';

comment on column public.projects.fecha_fin is
  'Cuándo terminó. Null = sigue abierto. Junto con fecha_inicio permite prorratear un gasto compartido entre los proyectos que estaban vivos en la fecha del gasto, en vez de entre los activos de hoy (ver el encabezado de esta migración).';
