-- ============================================================
-- El log de uso: qué le pide Beno a la app y qué le contesta.
--
-- Beno lo pidió con estas palabras: *"log de lo que pido, log de lo que la
-- app devuelve y análisis y resolución en base a eso"*. Hasta hoy no
-- quedaba grabado en ningún lado — lo único que había eran ocho
-- `console.*` que van a los logs de Vercel, que son efímeros y que ningún
-- agente puede consultar después.
--
-- ── Por qué es una tabla y no un archivo ─────────────────────────────
--
-- La app corre en Vercel, o sea sin disco: un archivo se pierde con la
-- invocación. Y el punto de esto es poder mirarlo **días después**, que es
-- justo lo que el log de una plataforma no da.
--
-- ── Por qué además es una cola de triage ─────────────────────────────
--
-- Las tres últimas columnas (`revisado_en`, `veredicto`, `nota`) son el
-- análisis, y viven **al lado del hecho** y no en un documento aparte. Un
-- documento se desincroniza; una columna no puede. Es el mismo patrón que
-- `inbox`: la fila nace sin resolver y alguien la resuelve.
--
-- ── Las dos superficies, y por qué las dos ───────────────────────────
--
-- `caja` es la pantalla de agentes; `conector` son las once tools del MCP
-- remoto. Lo que más falta medir es **qué tool elige Claude** —los pasos
-- 10 a 19 del plan de pruebas—, y eso solo pasa por el conector: loguear
-- únicamente la caja perdería justo lo que se viene a probar.
--
-- ⚠ **Esta tabla NO entra en `TABLAS` del respaldo**, a diferencia de todo
-- el resto del esquema. Es diagnóstico y no dominio: si se pierde entera,
-- no se pierde ni un peso, ni una lección, ni una entrada de bitácora. Lo
-- que sí crece sin techo es su volumen, y meterla adentro del
-- `respaldo.json` —que se reescribe entero todos los días y se commitea—
-- inflaría cada commit del repo de respaldos con datos que nadie va a
-- restaurar. La desviación está anotada en AGENTS.md, al lado de la regla
-- que dice que toda tabla nueva va a `TABLAS`.
-- ============================================================

create type public.veredicto_uso as enum (
  -- Contestó lo que había que contestar.
  'ok',
  -- Contestó mal, o no contestó. Es lo que se convierte en trabajo.
  'defecto',
  -- Contestó bien pero se podía mejor. No urge, pero se acumula.
  'mejora',
  -- Una prueba, un tanteo, algo que no cuenta. Existe para que el que
  -- mira la cola pueda sacar filas sin tener que mentir sobre ellas.
  'ruido'
);

create type public.superficie_uso as enum ('caja', 'conector');

create table public.agent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now(),

  superficie public.superficie_uso not null,

  -- Lo que se pidió, en una línea y legible: la frase de la caja o el
  -- nombre de la tool. Es la columna que se lee de un vistazo en la cola;
  -- el detalle completo va en `entrada`.
  pedido text not null,

  -- La entrada entera: la frase con sus adjuntos y su destino forzado, o
  -- los argumentos de la tool.
  entrada jsonb not null default '{}'::jsonb,

  -- Lo que devolvió la app. Para la caja es la `RespuestaAgente`; para el
  -- conector, el texto de la respuesta.
  salida jsonb,

  -- Solo `caja`: qué decidió el recepcionista (destino, argumento,
  -- confianza) y si lo resolvió `atajo.ts` sin llamar al modelo.
  --
  -- ⚠ Es la columna que más importa de la tabla: sin ella el log dice qué
  -- contestó la app, pero no **por qué**, y una derivación equivocada se
  -- ve idéntica a una correcta con el argumento mal leído.
  decisiones jsonb,

  duracion_ms integer,

  -- El error, si la respuesta no salió. Que quede acá y no solo en la
  -- consola es la mitad del sentido de esta tabla.
  error text,

  -- ── El triage ──────────────────────────────────────────────
  revisado_en timestamptz,
  veredicto public.veredicto_uso,
  nota text,

  -- Un veredicto sin fecha o una fecha sin veredicto son medias
  -- revisiones, y una media revisión se lee después como si estuviera
  -- hecha. Mismo criterio que `sessions.teoria_hecha`/`teoria_fecha`.
  constraint agent_log_revision_completa
    check ((revisado_en is null) = (veredicto is null))
);

comment on table public.agent_log is
  'Qué se le pidió a la app y qué contestó, más el análisis. Diagnóstico, no dominio: NO entra al respaldo. Ver AGENTS.md.';

-- La cola se lee siempre igual: lo no revisado, de lo más nuevo a lo más
-- viejo. El índice parcial cubre exactamente eso y no crece con lo ya
-- resuelto, que es la mayoría con el tiempo.
create index agent_log_pendientes_idx
  on public.agent_log (user_id, creado_en desc)
  where revisado_en is null;

create index agent_log_creado_idx on public.agent_log (user_id, creado_en desc);

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del esquema.
-- ------------------------------------------------------------
alter table public.agent_log enable row level security;

create policy "agent_log_select_own" on public.agent_log
  for select to authenticated
  using (auth.uid() = user_id);

create policy "agent_log_insert_own" on public.agent_log
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "agent_log_update_own" on public.agent_log
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agent_log_delete_own" on public.agent_log
  for delete to authenticated
  using (auth.uid() = user_id);
