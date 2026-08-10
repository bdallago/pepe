-- ============================================================
-- Presupuestos (spec docs/superpowers/specs/2026-08-10-presupuestos-design.md,
-- sección "Esquema"). Es la etapa 0: el esquema, la tarifa y los
-- multiplicadores. No llama a ningún modelo y ya sirve sola — hoy Beno no
-- tiene dónde guardar un presupuesto.
--
-- Lo que este archivo NO crea porque ya existe:
--
--   - `public.tipo_cliente`, `rate_runs` y `rate_references`, que se
--     adelantaron en `20260810000002_tarifas_referencia.sql` para que el
--     cron de referencias se pudiera construir en paralelo.
--   - `projects.fecha_inicio` / `fecha_fin` (`20260810000001`), que es lo
--     que se llena al convertir un presupuesto aceptado en proyecto.
--   - El enum `public.moneda`, el mismo que usa `movements`.
--
-- Los dos enums nuevos SÍ pueden vivir acá, al revés de lo que pasó en
-- `20260810001000_adjuntos_enums.sql`: la restricción de Postgres es de
-- `alter type ... add value` (el valor agregado no se puede usar hasta
-- que commitea la transacción), no de `create type`. Un tipo recién
-- creado se usa sin problema en la misma transacción. Acá no se le agrega
-- ningún valor a ningún enum existente, así que no hace falta partir el
-- archivo.
--
-- Convención del esquema: tablas y claves foráneas en inglés, columnas y
-- enums en español.
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------

-- Los cuatro estados del ciclo de vida. `borrador` y `enviado` son los
-- dos momentos antes de que el cliente conteste; `aceptado` y
-- `descartado` son terminales y los dos enseñan, por eso ninguno borra la
-- fila.
create type public.estado_presupuesto as enum (
  'borrador', 'enviado', 'aceptado', 'descartado'
);

-- Los tres motivos son los que dijo Beno, textuales, más una bolsa. No se
-- inventan categorías: el punto de este campo es que él pueda releer por
-- qué se le cayeron los presupuestos, y una taxonomía que no sea suya no
-- le sirve para eso. Cada uno apunta a otra cosa: `no_era_lo_que_queria`
-- a la estimación, `quedo_desactualizado` al proceso (se cruza con los
-- días entre enviado y resuelto), `no_prospero` a casi nada.
create type public.motivo_descarte as enum (
  'no_era_lo_que_queria', 'quedo_desactualizado', 'no_prospero', 'otro'
);

-- ------------------------------------------------------------
-- quotes
--
-- ⚠ REGLA 1 APLICADA A OTRA TABLA: `tarifa_hora`, `multiplicador`,
-- `tasa_usada`, `tasa_fecha` y `horas_por_semana` son **una foto del
-- momento y no se recalculan nunca**. Al releer un presupuesto de marzo
-- tiene que decir lo que decía en marzo: ni el total, ni la conversión,
-- ni el precio por hora se vuelven a calcular con los valores de hoy. Es
-- el mismo criterio con el que `movements` congela `tasa_usada` y con el
-- que `retros` congela su balance.
--
-- La consecuencia práctica es que **no hace falta guardar los bytes del
-- PDF**: congeladas las entradas, la misma fila renderiza el mismo
-- documento hoy y en dos años.
--
-- Y la única recotización posible es explícita y crea una fila nueva:
-- descartar el viejo como `quedo_desactualizado` y generar otro con
-- `reemplaza_a` apuntando al anterior. No hay un botón que "actualice" un
-- presupuesto ya mandado, porque eso reescribiría un documento que el
-- cliente ya tiene en la mano.
-- ------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Correlativo por usuario. Es lo que dice el PDF: "Presupuesto Nº 7".
  -- Lo asigna la app al guardar; no hay secuencia en la base porque una
  -- secuencia global se saltea números y acá el número se muestra.
  numero integer not null check (numero > 0),

  -- El proyecto, **solo cuando prospera**. Null hasta que se acepta.
  --
  -- `on delete restrict` y no `set null`: si el proyecto se pudiera
  -- borrar, un presupuesto aceptado quedaría con `project_id` en null y
  -- violaría el check de más abajo, así que el delete fallaría igual pero
  -- con un mensaje peor. Como `project_id` solo está lleno en los
  -- aceptados, el restrict muerde exactamente en el caso que hay que
  -- proteger. Y el camino normal para un proyecto es archivarlo
  -- (`projects.archivado_en`), no borrarlo — regla 4.
  project_id uuid references public.projects (id) on delete restrict,

  -- Texto libre, sin tabla `clients`: a unos pocos presupuestos por año,
  -- un CRM son cinco tablas para ahorrar tipear un nombre.
  cliente_nombre text not null check (length(trim(cliente_nombre)) > 0),
  -- Lo que elige el multiplicador.
  cliente_tipo public.tipo_cliente not null,

  titulo text not null check (length(trim(titulo)) > 0),
  resumen_alcance text not null default '',

  -- Lo que Beno pegó o dictó. Es la entrada del modelo y es contra esto
  -- que se verifican las anclas de los ítems, por substring normalizado.
  -- Es `text` y no un puntero a un archivo a propósito: cuando exista el
  -- módulo de adjuntos, el texto extraído del PDF se concatena acá y esta
  -- columna no cambia.
  pedido_texto text not null default '',

  -- Un presupuesto, una moneda. Multi-moneda por ítem queda afuera.
  moneda public.moneda not null,

  -- CONGELADAS. La tarifa de Beno y el multiplicador del tipo de cliente
  -- tal como estaban en `settings` en el momento de guardar. El histórico
  -- de su tarifa no necesita tabla: esta serie de filas *es* el
  -- histórico, con cada valor pegado al presupuesto en el que se usó.
  tarifa_hora numeric(14, 2) not null check (tarifa_hora > 0),
  multiplicador numeric(6, 3) not null check (multiplicador > 0),

  -- CONGELADAS, y solo si hubo conversión: si `moneda` coincide con
  -- `settings.tarifa_moneda` no hay tasa y las dos quedan en null. Mismos
  -- nombres de columna que `movements`. `tasa_fecha` puede ser anterior a
  -- `fecha`: es la que devolvió `fx_rate_for_date`, o sea la de ese día o
  -- la última anterior.
  tasa_usada numeric(16, 4) check (tasa_usada > 0),
  tasa_fecha date,

  -- Suma de las horas de los ítems al guardar, editable a mano después.
  -- No es una columna generada justamente porque se puede pisar.
  horas_estimadas numeric(10, 2) not null default 0 check (horas_estimadas >= 0),
  -- CONGELADA: con qué se convirtió horas → semanas. Si mañana Beno
  -- cambia su dedicación semanal en Ajustes, los plazos que ya prometió
  -- no se mueven.
  horas_por_semana numeric(5, 2) not null check (horas_por_semana between 1 and 80),
  semanas_estimadas numeric(8, 2) not null default 0 check (semanas_estimadas >= 0),

  -- El precio final. Editable a mano, porque a veces el número que sale
  -- de la cuenta no es el número que uno quiere mandar. La cuenta
  -- (`horas × tarifa_hora × multiplicador`) vive en
  -- `src/lib/presupuestos.ts` y no pasa por ningún modelo.
  total_origen numeric(16, 2) not null check (total_origen >= 0),

  -- `date` y no timestamptz: se maneja como string 'YYYY-MM-DD' en todo
  -- el repo (ver src/lib/dates.ts).
  fecha date not null
    default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  validez_dias integer not null default 15 check (validez_dias > 0),

  -- Si las horas van al PDF. Default false a propósito: mostrarlas
  -- convierte la charla en una discusión de tarifa horaria, que es justo
  -- el mecanismo por el que hoy le cobra a todos el precio del cliente
  -- más chico. El switch existe por si en algún cliente conviene.
  mostrar_horas boolean not null default false,

  -- Texto libre. La app lo precarga desde `settings.condiciones_default`.
  condiciones text not null default '',

  estado public.estado_presupuesto not null default 'borrador',
  enviado_en date,
  resuelto_en date,
  motivo_descarte public.motivo_descarte,
  -- Lo que enseña de un descarte 'otro' está acá, no en el enum.
  motivo_detalle text,

  -- La cadena "quedó desactualizado → hice otro". `on delete set null`:
  -- borrar el viejo no tiene por qué llevarse puesto el nuevo.
  reemplaza_a uuid references public.quotes (id) on delete set null,

  -- Qué modelo estimó el esfuerzo, o null si se cargó a mano. Sirve para
  -- releerlo dentro de un año y saber con qué se hizo, igual que
  -- `retros.modelo`.
  modelo text,

  -- Regla 4: el borrado por defecto es archivado.
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, numero),

  -- Mismo criterio que `artifacts` —`(estado = 'completado') =
  -- (fecha_completado is not null)`— y que `sessions`: las dos cosas o
  -- ninguna, nunca una sola.
  constraint quotes_descarte_con_motivo
    check ((estado = 'descartado') = (motivo_descarte is not null)),

  -- Fuerte a propósito: **aceptar un presupuesto ES crear o elegir el
  -- proyecto**. Sin esto, "aceptado" queda como un rótulo que no cambia
  -- nada, y la mitad de la gracia era que el presupuesto entrara a Pepe
  -- como proyecto con su `fecha_inicio`.
  constraint quotes_aceptado_con_proyecto
    check ((estado = 'aceptado') = (project_id is not null)),

  -- Calcado de `inbox`: `(estado in ('pendiente','pospuesto')) =
  -- (resuelto_en is null)`. Un presupuesto resuelto sin fecha de
  -- resolución rompe el análisis que justifica el descarte con motivo
  -- (días entre enviado y resuelto).
  constraint quotes_resuelto_con_fecha
    check ((estado in ('aceptado', 'descartado')) = (resuelto_en is not null)),

  -- **No hay check que exija `enviado_en`**, y es deliberado: un
  -- presupuesto se puede descartar sin haberlo mandado nunca ("quedó
  -- desactualizado" antes de enviarlo es un caso real y es de los que más
  -- enseñan). Lo único que se pide es que, si están las dos fechas, estén
  -- en orden — el mismo criterio que `recurrences` y que
  -- `projects_fechas_coherentes`.
  constraint quotes_fechas_coherentes
    check (enviado_en is null or resuelto_en is null or resuelto_en >= enviado_en),

  -- Las dos o ninguna, nunca una sola.
  constraint quotes_tasa_completa
    check ((tasa_usada is null) = (tasa_fecha is null)),

  constraint quotes_no_se_reemplaza_a_si_mismo
    check (reemplaza_a is null or reemplaza_a <> id)
);

-- Son unos pocos presupuestos por año, así que estos índices son por el
-- orden de lectura y no por velocidad. El que sí es funcional es el
-- `unique (user_id, numero)` de arriba.
create index quotes_user_fecha_idx
  on public.quotes (user_id, fecha desc)
  where archivado_en is null;

create index quotes_project_idx
  on public.quotes (user_id, project_id)
  where project_id is not null;

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

comment on table public.quotes is
  'Presupuestos. tarifa_hora, multiplicador, tasa_usada, tasa_fecha y horas_por_semana quedan CONGELADOS al guardar y no se recalculan nunca (regla 1).';

comment on column public.quotes.pedido_texto is
  'Lo que pegó o dictó el usuario. Es la entrada del modelo y contra esto se verifica el ancla de cada ítem.';

-- ------------------------------------------------------------
-- quote_items
--
-- El `ancla` es el corazón del control antiinvención: la cita literal del
-- pedido en la que se apoya la estimación. Acá se puede hacer algo que
-- las otras features de la app no pueden — **verificarla por código**:
-- normalizada (minúsculas, sin acentos, espacios colapsados) tiene que
-- aparecer como substring de `quotes.pedido_texto` normalizado.
--
-- Un ancla que no verifica **no descarta el ítem en silencio**. El ítem
-- llega con `ancla_verificada = false` y la pantalla lo marca en rojo. Es
-- el mismo criterio del estado `error` de la bandeja: lo que no valida
-- queda visible, no desaparece.
-- ------------------------------------------------------------
create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,

  orden integer not null check (orden >= 0),

  -- El entregable, y la vara es la de 6.3: dice QUÉ SE ENTREGA, con
  -- nombre y apellido. "Desarrollo backend" es un rótulo; "Endpoint de
  -- importación del CSV de productos, con validación y reporte de
  -- errores" es un entregable.
  titulo text not null check (length(trim(titulo)) > 0),
  detalle text not null default '',
  horas numeric(8, 2) not null check (horas >= 0),

  -- 'modelo' | 'manual'. Texto con check y no enum, igual que
  -- `rate_runs.fuente` y `rate_references.unidad` de este mismo módulo:
  -- son dos valores de procedencia que no viajan a ninguna otra tabla.
  -- Al tocar un campo del ítem, la pantalla lo pasa a 'manual' — el mismo
  -- comportamiento que la sugerencia de categoría, que se apaga apenas
  -- Beno elige a mano.
  origen text not null default 'manual' check (origen in ('modelo', 'manual')),

  -- Null en los ítems cargados a mano: una estimación propia no necesita
  -- citarse a sí misma.
  ancla text,
  ancla_verificada boolean not null default false,
  confianza text check (confianza in ('alta', 'media', 'baja')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- El unique ya deja el índice por el que se leen los ítems de un
  -- presupuesto, así que no hace falta ninguno más.
  --
  -- ⚠ Ojo al reordenar desde la app: con un unique no diferible, mover el
  -- ítem 3 al lugar 1 no se puede hacer con dos updates sueltos. Hay que
  -- renumerar en una sola sentencia (o correrlos primero a un rango
  -- alto). No es diferible a propósito: un unique `deferrable` no sirve
  -- para `on conflict`, que es lo que usa el guardado.
  unique (quote_id, orden),

  -- Sin cita no hay nada que verificar. Evita el "verificada" que no se
  -- apoya en ningún texto.
  constraint quote_items_verificada_necesita_ancla
    check (ancla is not null or ancla_verificada = false)
);

create trigger quote_items_set_updated_at
  before update on public.quote_items
  for each row execute function public.set_updated_at();

comment on table public.quote_items is
  'Entregables de un presupuesto. `ancla` es la cita literal del pedido que justifica el ítem; `ancla_verificada` dice si aparece de verdad en quotes.pedido_texto.';

-- ------------------------------------------------------------
-- quote_assumptions y quote_questions
--
-- Dos tablas chicas en vez de dos arrays `jsonb`: los supuestos van al
-- PDF y se editan uno por uno, y las preguntas se van tachando a medida
-- que el cliente contesta. Un `jsonb` que se edita ítem por ítem es un
-- `jsonb` que quería ser una tabla.
--
-- La distinción entre las dos es del prompt y no es cosmética: lo que el
-- modelo está asumiendo va en supuestos, y lo que no entendió va en
-- preguntas. Nunca en un ítem con horas inventadas.
--
-- Las tres tablas hijas **no llevan `archivado_en`**, y no es un olvido
-- de la regla 4: lo que se archiva es el presupuesto, que es la entidad.
-- Un supuesto que se saca mientras se edita el borrador no es historia
-- que preservar, es una línea que no va. El `on delete cascade` de
-- `quote_id` los sigue al presupuesto si alguna vez se borra de verdad.
-- ------------------------------------------------------------
create table public.quote_assumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  orden integer not null check (orden >= 0),
  texto text not null check (length(trim(texto)) > 0),
  created_at timestamptz not null default now(),
  unique (quote_id, orden)
);

comment on table public.quote_assumptions is
  'Lo que el presupuesto da por sentado y va escrito en el PDF (que el cliente aporta el contenido, los accesos, el hosting…).';

create table public.quote_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  orden integer not null check (orden >= 0),
  texto text not null check (length(trim(texto)) > 0),
  created_at timestamptz not null default now(),
  unique (quote_id, orden)
);

comment on table public.quote_questions is
  'Lo que hay que preguntarle al cliente antes de cerrar el número. Sale de lo que el modelo NO entendió, que es donde tiene que ir y no en un ítem con horas.';

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del esquema.
--
-- `rate_runs` y `rate_references` no lo siguen —van sin `user_id`, como
-- `fx_rates`, porque una tarifa de mercado no es de nadie—, pero un
-- presupuesto sí es de su dueño.
-- ------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_assumptions enable row level security;
alter table public.quote_questions enable row level security;

create policy "quotes_select_own" on public.quotes
  for select to authenticated
  using (auth.uid() = user_id);

create policy "quotes_insert_own" on public.quotes
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "quotes_update_own" on public.quotes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "quotes_delete_own" on public.quotes
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "quote_items_select_own" on public.quote_items
  for select to authenticated
  using (auth.uid() = user_id);

create policy "quote_items_insert_own" on public.quote_items
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "quote_items_update_own" on public.quote_items
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "quote_items_delete_own" on public.quote_items
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "quote_assumptions_select_own" on public.quote_assumptions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "quote_assumptions_insert_own" on public.quote_assumptions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "quote_assumptions_update_own" on public.quote_assumptions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "quote_assumptions_delete_own" on public.quote_assumptions
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "quote_questions_select_own" on public.quote_questions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "quote_questions_insert_own" on public.quote_questions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "quote_questions_update_own" on public.quote_questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "quote_questions_delete_own" on public.quote_questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- settings: la tarifa, los multiplicadores y los datos del emisor.
--
-- El comentario de `settings` en `20260808000001_zombies.sql` decía que
-- es "el lugar donde va a ir cayendo lo que hoy son constantes y mañana
-- Beno quiera tocar sin redesplegar". Es acá.
-- ------------------------------------------------------------
alter table public.settings
  -- Arranca en **null a propósito**: sin tarifa cargada, la pantalla de
  -- presupuestos pide cargarla antes que nada, en vez de inventarle un
  -- valor por defecto y que Beno cotice con él sin darse cuenta.
  add column tarifa_hora numeric(14, 2) check (tarifa_hora > 0),
  add column tarifa_moneda public.moneda not null default 'ARS',

  -- Los defaults 1 / 2 / 3 no son un número redondo elegido a ojo: son la
  -- escalera medida en el tarifario de flamahaus, donde `A = 3×C` y
  -- `B = 2×C` se cumplen en **93 de 93 filas** con tolerancia de un peso.
  -- El cron la vuelve a verificar en cada corrida; si algún día deja de
  -- cumplirse, estos defaults se quedan sin el respaldo que los justifica.
  add column multiplicador_particular numeric(6, 3) not null default 1
    check (multiplicador_particular > 0),
  add column multiplicador_pyme numeric(6, 3) not null default 2
    check (multiplicador_pyme > 0),
  add column multiplicador_empresa numeric(6, 3) not null default 3
    check (multiplicador_empresa > 0),

  -- Default 20 y no 40: Beno tiene tres proyectos vivos y trabaja solo.
  -- Un default de 40 promete plazos que no se cumplen, y un plazo
  -- incumplido en un presupuesto cuesta más que uno holgado.
  add column horas_por_semana numeric(5, 2) not null default 20
    check (horas_por_semana between 1 and 80),

  -- Contra qué fila de flamahaus se compara su tarifa. Un solo tarifario
  -- de referencia por vez: un aviso que compara contra trece cosas no
  -- dice nada.
  add column servicio_referencia text not null default 'desarrollo-web-hora',
  -- Contra qué escalón de salancy. Es preferencia y no constante porque
  -- **Beno no va a ser junior para siempre**, y un aviso calibrado contra
  -- el escalón equivocado se calla justo cuando más falta hace.
  add column seniority_referencia text not null default 'junior',

  -- Encabezado del PDF.
  add column emisor_nombre text,
  add column emisor_contacto text,
  -- Se precarga en `quotes.condiciones` al armar el presupuesto; después
  -- cada uno lleva el suyo congelado. Ej: "50 % al aceptar, 50 % a la
  -- entrega".
  add column condiciones_default text;

-- `particular ≤ pyme ≤ empresa` atrapa el error de tipeo. Si algún día
-- Beno quiere romper el orden, se cae este check y se discute.
alter table public.settings
  add constraint settings_multiplicadores_ordenados
  check (multiplicador_particular <= multiplicador_pyme
     and multiplicador_pyme <= multiplicador_empresa);

comment on column public.settings.tarifa_hora is
  'La tarifa hora de Beno. Null = todavía no la cargó; la pantalla la pide en vez de inventar un default. Cada presupuesto se queda con una copia congelada.';

comment on column public.settings.horas_por_semana is
  'Cuántas horas por semana le dedica. Convierte horas → semanas; el modelo no lo sabe y por eso tiene prohibido hablar de plazos.';
