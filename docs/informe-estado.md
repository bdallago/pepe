# Pepe — informe de estado

> ⚠ **Es una foto del 2026-08-09, no un documento vivo.** Se deja tal cual
> porque su valor es haber auditado el repo contra el código en un momento
> concreto; reescribirlo lo destruiría. Lo que cambió desde entonces y
> contradice partes de este informe:
>
> - El **conector MCP remoto** existe, tiene OAuth 2.1 y **ocho tools**
>   (`docs/conector-mcp.md`).
> - `tipo_bandeja` ya no tiene cinco valores: se le sumaron
>   `nota_de_adjunto`, `movimiento_dictado` y `leccion_dictada`.
> - `sugerir_categoria_historico` toma un `p_user_id` opcional.
> - Lo que viene está en `docs/superpowers/specs/2026-08-10-*`.
>
> Sigue vigente lo de la sección 5.3 sobre el limitador de Groq como
> estado de módulo, y lo del enum `categorizacion` que nada produce.

| | |
|---|---|
| **Fecha** | 2026-08-09 |
| **Rama** | `agentes-ola-1` |
| **Último commit** | `374d99b11f7179cc1f27539f14b2f243f5d12762` — *"Agente de vencimientos proximos"* |
| **Árbol de trabajo** | limpio salvo `docs/superpowers/plans/2026-08-09-agentes-ola-1.md` (2 líneas agregadas, una nota de verificación) |
| **Verificación corrida para este informe** | `npm run typecheck` ✅ y `npm run lint` ✅ pasan sin salida. `npm run build` **no** se corrió. |

**Qué es Pepe.** App personal de un solo usuario (Beno), en producción en
`https://pepe-beno.vercel.app`. Next.js 15.5 (App Router) + TypeScript +
Supabase (Postgres/Auth/Storage) + Tailwind/shadcn, deploy en Vercel Pro.
Tres secciones: **Finanzas**, **Aprendizaje** y **Bitácora**. `projects` es
la entidad raíz de todas: los movimientos, las lecciones y la bitácora
cuelgan de un proyecto.

**Cómo se leyó esto.** Todo lo que se afirma acá sale de leer el archivo
citado. Los conteos de la sección 3 salen de consultar la REST API de
Supabase de producción con la service role key. Lo que no se pudo
verificar está en la sección 6, marcado como tal.

---

## 1. Inventario de IA

### 1.0 La forma que tienen todas las llamadas

**Todas** las llamadas a un modelo del lado de Pepe pasan por una sola
función: `completarJSON()` en `src/lib/llm.ts:326`. No hay ninguna
excepción — se rastrearon todos los llamadores y son siete.

Características que valen para las siete, verificadas en el cuerpo de
`completarJSON`:

- **Proveedor: Groq**, endpoint `https://api.groq.com/openai/v1/chat/completions`
  (`llm.ts:81`).
- **La key sale de `GROQ_API_KEY`**, leída por `groqApiKey()` en
  `src/lib/env.ts:51`. `llm.ts` empieza con `import "server-only"`
  (línea 1), así que un import descuidado desde un componente cliente
  rompe el build en vez de filtrar la credencial. Está declarada en
  `.env.example` y en `.env.local`.
- **No hay tool-calling ni function-calling.** El cuerpo del pedido
  (`llm.ts:367-379`) manda `model`, `temperature`, `max_tokens`,
  `reasoning_effort` (opcional), `response_format: {type:"json_object"}` y
  `messages`. **No manda `tools`.** O sea: **ningún modelo de Pepe puede
  invocar ninguna función.** Devuelve un JSON y se acabó.
- **Salida validada con Zod** antes de tocar la base (`llm.ts:463`). Si no
  valida, se lanza `ErrorLLM` de tipo `esquema`; **no se reintenta** a
  propósito (`llm.ts:447-451`).
- **Limitador propio, por modelo**: 28 pedidos/minuto (`REQUESTS_POR_MINUTO`,
  `llm.ts:84`) y un techo de tokens/minuto distinto por modelo
  (`TOKENS_POR_MINUTO`, `llm.ts:104`). La reserva se estima antes de salir
  y se corrige con el `usage` de la respuesta (`llm.ts:441`).
- **Reintentos con backoff exponencial + jitter** ante 429 y 5xx,
  respetando `retry-after` (`llm.ts:401-415`, `backoff()` en `llm.ts:503`).
- **Timeout por intento** con `AbortController` (`conTimeout()`, `llm.ts:532`).

Los tres modelos declarados (`llm.ts:35`, `:42`, `:67`):

| Constante | Modelo | Uso real hoy |
|---|---|---|
| `MODELO_CHICO` | `llama-3.1-8b-instant` | clasificación, extracción, aviso de zombie, recepcionista |
| `MODELO_GRANDE` | `llama-3.3-70b-versatile` | **ninguno.** Verificado: solo aparece en `llm.ts` |
| `MODELO_RAZONADOR` | `openai/gpt-oss-120b` | generar lecciones, sugerir estudio, retro |

### 1.1 Las siete funciones

#### A. Clasificador de movimientos — `sugerirConModelo()`

| | |
|---|---|
| **Archivo** | `src/lib/clasificacion.ts:137` (orquestador: `sugerirClasificacion()`, `clasificacion.ts:220`) |
| **Qué hace** | Sugiere tipo (ingreso/egreso) y categoría a partir de la descripción de un movimiento. |
| **Cómo se dispara** | **Solo desde la UI, automáticamente mientras se escribe.** `src/components/movimientos/movement-form.tsx:178-215`: un `useEffect` con debounce de 600 ms (`ESPERA_SUGERENCIA_MS`, línea 87) hace `POST /api/movimientos/sugerir`. Solo al **crear** (no al editar) y solo si Beno no eligió tipo/categoría a mano. |
| **Llamadas al modelo** | **Cero o una.** Primero corre `buscarEnHistorico()` (`clasificacion.ts:78`), que es un RPC de SQL puro (`sugerir_categoria_historico`). **Solo si el histórico no encontró nada** se llama al modelo (`clasificacion.ts:234`). |
| **Tools que puede invocar** | Ninguna. |
| **¿Escribe en la base?** | **No.** La sugerencia llega precargada al formulario. El punto de confirmación es el propio formulario: `movement-form.tsx` + la Server Action `crearMovimiento` en `src/lib/actions/movements.ts`. Por eso **no pasa por `inbox`** — decisión documentada en `AGENTS.md` §6.c. |
| **Modelo** | `MODELO_CHICO`, `maxTokens: 80`, `reintentos: 1`, `timeoutMs: 15_000` (`clasificacion.ts:180-186`). |
| **Si falla** | **Nunca lanza.** El `catch` en `clasificacion.ts:210` loguea y devuelve `null`. El route handler (`src/app/api/movimientos/sugerir/route.ts:57-62`) captura cualquier error y devuelve `ok(null)` con HTTP 200. El formulario queda como estaba. Si el modelo inventa una categoría que no existe, se descarta (`clasificacion.ts:197`). |

#### B. Extracción de lecciones desde la bitácora — `extraerLeccionesPendientes()`

| | |
|---|---|
| **Archivo** | `src/lib/extraccion.ts:141` |
| **Qué hace** | Lee cada entrada de `daily_log` que nunca se miró y le pide al modelo que decida si contiene una lección y la reescriba autocontenida. |
| **Cómo se dispara** | Botón en la bandeja: `src/components/bandeja/bandeja-view.tsx:378` (`correrPase()`) → `POST /api/bandeja/extraer` (`src/app/api/bandeja/extraer/route.ts`, `maxDuration = 300`). **No hay cron.** |
| **Llamadas al modelo** | **Bucle: hasta 25 por corrida** (`LOTE_POR_CORRIDA`, `extraccion.ts:38`), una por entrada de bitácora. Corta solo a los 240 s (`PRESUPUESTO_MS`, `extraccion.ts:41`). Es retomable: la pantalla vuelve a llamar si `restantes > 0`. |
| **Tools** | Ninguna. |
| **¿Escribe en la base?** | Escribe en `inbox` (tabla de propuestas), **nunca en `lessons`**. El punto de confirmación es `aceptarLeccion()` en `src/lib/actions/inbox.ts:107`, disparado por la bandeja. |
| **Modelo** | `MODELO_CHICO`, `maxTokens: 700` (`extraccion.ts:191-196`). |
| **Si falla** | **Salida inválida (`esquema`)** → fila en `inbox` con `estado = 'error'` y `error_detalle`, visible en la bandeja (`extraccion.ts:249-265`). **Cuota/red/timeout** → corta el pase, devuelve `interrumpidoPor` y lo hecho queda (`extraccion.ts:268-273`). |

> **Detalle no obvio:** la fila de `inbox` sigue apuntando a la entrada de
> bitácora de origen incluso después de aceptar (`inbox.ts:164-182`). El
> vínculo hacia la lección creada va en `payload.lesson_id`. Repuntarla
> rompía el pase, que busca lo ya mirado por `entidad_tabla = 'daily_log'`.

#### C. Generar lecciones sobre un tema — `generarLecciones()`

| | |
|---|---|
| **Archivo** | `src/lib/generacion.ts:139` |
| **Qué hace** | Beno pide *"lecciones sobre pricing aplicado a Gentius"* y el modelo propone hasta 5, sin repetir las que ya existen ni las que ya están esperando en la bandeja. |
| **Cómo se dispara** | **Dos caminos.** (1) Botón en Lecciones: `src/components/aprendizaje/generar-lecciones.tsx:58` → `POST /api/lecciones/generar`. (2) **El agente `lecciones_tema`**: `src/lib/agentes/despacho.ts:390`. |
| **Llamadas al modelo** | **Una sola.** No hay lote ni reintento parcial: o sale entera o no sale. |
| **Tools** | Ninguna. |
| **¿Escribe?** | `inbox` con `tipo = 'leccion_sugerida'`. Confirmación en `aceptarLeccion()` (`inbox.ts:107`); la lección nace con `origen = 'generada'` (`inbox.ts:47-51`). |
| **Modelo** | `MODELO_RAZONADOR`, `esfuerzo: "medium"`, `temperatura: 0.5`, `maxTokens: 3500` (`generacion.ts:194-208`). |
| **Si falla** | **Lanza `ErrorLLM`.** El route handler lo traduce a un mensaje legible con 500 (`api/lecciones/generar/route.ts:69-72`); el agente lo captura en `api/agentes/interpretar/route.ts:73-80` y devuelve un aviso. Escribir lecciones a mano sigue andando. |

#### D. Sugerir qué estudiar — `sugerirQueEstudiar()`

| | |
|---|---|
| **Archivo** | `src/lib/sugerencias.ts:96` |
| **Qué hace** | Mira 90 días de actividad (proyectos, egresos por categoría, últimas lecciones, estado de los tracks) y propone hasta 4 cosas para estudiar, cada una con un **ancla** al dato que la justifica. |
| **Cómo se dispara** | (1) Botón en `/aprendizaje/sugerencias`: `src/components/aprendizaje/sugerencias-view.tsx:63` → `POST /api/aprendizaje/sugerir`. (2) **El agente `estudio`**: `despacho.ts:39`. |
| **Llamadas al modelo** | **Una.** Si el contexto sale vacío devuelve `[]` **sin gastar la llamada** (`sugerencias.ts:101-105`). |
| **Tools** | Ninguna. |
| **¿Escribe?** | **No escribe nada.** Es la única salida de modelo que se muestra directo, sin bandeja, y se puede porque no toca ninguna tabla. Ni siquiera se guarda: al recargar no está. Lo único que escribe es el botón aparte "convertir en sesión" (`crearSesionDesdeSugerencia`, `src/lib/actions/study.ts`). |
| **Modelo** | `MODELO_RAZONADOR`, `esfuerzo: "medium"`, `temperatura: 0.4`, `maxTokens: 3500`. |
| **Si falla** | Lanza; el handler lo traduce a un toast. El resto de Aprendizaje anda igual. |

#### E. Retro de proyecto — `generarRetro()`

| | |
|---|---|
| **Archivo** | `src/lib/retro.ts:177` |
| **Qué hace** | La llamada más pesada. Recibe todo el contexto del proyecto (balances calculados del lado nuestro, hasta 120 movimientos, hasta 100 lecciones, bitácora recortada a 9000 caracteres) y devuelve cuatro secciones más una lista de lecciones candidatas. |
| **Cómo se dispara** | (1) Botón en la pantalla del proyecto: `src/components/proyectos/retro-panel.tsx:86` → `POST /api/proyectos/retro`. (2) **El agente `retro`**: `despacho.ts:316`. |
| **Llamadas al modelo** | **Una.** |
| **Tools** | Ninguna. |
| **¿Escribe?** | **Camino partido a propósito.** Las lecciones candidatas van a `inbox` con `tipo = 'retro'` (`retro.ts:287`) y se confirman con `aceptarLeccion()`. **El texto de la retro no se guarda**: vuelve como borrador editable y recién con "Guardar" pasa a `retros` (`src/lib/actions/retros.ts`). El balance se congela al guardar. |
| **Modelo** | `MODELO_RAZONADOR`, `esfuerzo: "medium"`, `temperatura: 0.4`, `maxTokens: 4500`, `timeoutMs: 180_000` (`retro.ts:243-269`). |
| **Si falla** | Lanza; nada queda a medio escribir. |

> El prompt de `retro.ts:99-146` **enumera uno por uno los errores de
> invención concretos** en vez de decir "no inventes". Está así porque la
> primera corrida inventó plazos, procesos faltantes y consecuencias no
> registradas. Es la salvaguarda antiinvención más específica del repo.

#### F. Aviso de suscripción zombie — `escanearZombies()`

| | |
|---|---|
| **Archivo** | `src/lib/zombies.ts:98` |
| **Qué hace** | **La detección es SQL puro** (`detectar_zombies`, `supabase/migrations/20260808000001_zombies.sql:90`). El modelo **solo redacta el texto del aviso**. |
| **Cómo se dispara** | (1) **Cron diario**, `vercel.json`: `GET /api/cron/zombies` a las `30 12 * * *`, autenticado con `CRON_SECRET` y corriendo con `createAdminClient()` (saltea RLS) porque no hay sesión. (2) **El agente `suscripciones`**: `despacho.ts:62`, con el cliente del usuario. |
| **Llamadas al modelo** | **Bucle: una por candidato detectado** (`zombies.ts:135-207`). Hoy el detector devuelve 0 candidatos (verificado, ver §3). |
| **Tools** | Ninguna. |
| **¿Escribe?** | `inbox` con `tipo = 'zombie'`. Confirmación en `aceptarZombie()` (`inbox.ts:257`) y `rechazarItemBandeja()` (`inbox.ts:193`). |
| **Modelo** | `MODELO_CHICO`, `maxTokens: 250`. |
| **Si falla** | **Es la única función con degradación total escrita en código.** Si no hay modelo o falla, usa `avisoDeCodigo()` (`zombies.ts:267`), que dice lo mismo con menos vueltas, y sigue. Solo lanza si falla la base. |

> Dos particularidades del zombie que no se repiten en ningún otro tipo:
> el rechazo **conserva `clave_dedupe`** (`inbox.ts:343`) para no volver a
> proponerlo nunca, y el aceptado silencia **solo hasta que aparezca un
> cargo posterior a la resolución** (`silenciado()`, `zombies.ts:234`).

#### G. Recepcionista de agentes — `decidirDestino()`

| | |
|---|---|
| **Archivo** | `src/lib/agentes/recepcionista.ts:114` |
| **Qué hace** | Lee una frase en castellano y decide a cuál de nueve destinos va, con un argumento de texto libre y una confianza de 0 a 1. |
| **Cómo se dispara** | `POST /api/agentes/interpretar` (`src/app/api/agentes/interpretar/route.ts`, `maxDuration = 300`), desde `<CajaAgente>` (`src/components/agentes/caja-agente.tsx:56`). Dos superficies: la pantalla de inicio (`src/app/(app)/page.tsx:16`) y un diálogo global con **Ctrl/⌘+J** (`src/components/agentes/atajo-global.tsx`, montado en `src/app/(app)/layout.tsx:69`). |
| **Llamadas al modelo** | **Una para decidir**, y después **el especialista puede hacer la suya** (retro, lecciones sobre un tema, estudio y suscripciones llaman al modelo de nuevo). O sea: una frase puede costar **dos llamadas**, la segunda al razonador. **Se saltea la llamada del recepcionista** cuando Beno elige una opción de una pregunta (`route.ts:55-57`). |
| **Tools** | Ninguna. **Resolver el nombre de un proyecto a un id es determinístico**, sin modelo: `resolverProyecto()` en `src/lib/agentes/resolver.ts:16`. |
| **¿Escribe?** | El recepcionista no. Los especialistas escriben lo que ya escribían (`inbox`). **No hay ningún camino de escritura nuevo** en esta capa. |
| **Modelo** | `MODELO_CHICO`, `temperatura: 0`, `maxTokens: 120`. |
| **Si falla** | Sin `GROQ_API_KEY` contesta un aviso y no rompe (`route.ts:44-50`). Cualquier excepción se traduce a un aviso con HTTP 200 (`route.ts:73-80`). Si la confianza baja de 0.6 (`UMBRAL_CONFIANZA`, `tipos.ts:43`) **pregunta con tres opciones concretas en vez de adivinar**. |

**Los nueve destinos** (`src/lib/agentes/tipos.ts:12`), con lo que hace cada
uno hoy en `despacho.ts`:

| Destino | Qué hace | ¿Llama al modelo? | ¿Escribe? |
|---|---|---|---|
| `consultas` | Balance general o por proyecto | no | no |
| `buscador` | Busca en `lessons` (RPC híbrido) **y** en `daily_log` (`ilike`) | no | no |
| `estudio` | `sugerirQueEstudiar()` (6.4) | **sí, razonador** | no |
| `retro` | `generarRetro()` (6.5) | **sí, razonador** | `inbox` |
| `lecciones_tema` | `generarLecciones()` (6.3) | **sí, razonador** | `inbox` |
| `suscripciones` | `escanearZombies()` (6.2) | sí, chico, por candidato | `inbox` |
| `vencimientos` | Recurrencias activas que vencen en 30 días | no | no |
| `movimientos` | **Stub**: "todavía no está, cargalo desde Movimientos" | no | no |
| `desconocido` | Aviso genérico | no | no |

### 1.2 Lo que no es Groq

- **Embeddings**: `src/lib/embeddings.ts` corre `Xenova/multilingual-e5-base`
  en q8 (768 dimensiones, 266 MB) **dentro del route handler de Vercel**,
  sin API externa. Se dispara desde `/api/lecciones/indexar` (que la
  bandeja llama sin esperar, `bandeja-view.tsx:268`) y desde
  `/api/lecciones/buscar`. Si falla, la búsqueda responde igual solo con
  full-text y **eso no se considera un error**.
- **Quiz**: `src/lib/quiz.ts` **no usa ningún modelo**, y el docstring lo
  dice explícitamente ("sin IA, sin API key, sin red"). Arma preguntas de
  opción múltiple con las sesiones ya completadas. El spec original decía
  que en la app vieja el quiz llamaba a la API de Anthropic.
- **Servidor MCP local**: `mcp/servidor.mts`, arrancado por Claude Code
  por stdio (`.mcp.json`), sin URL ni endpoint. Expone **cinco tools, todas
  de lectura**: `listar_proyectos`, `balance`, `leer_bitacora`,
  `buscar_lecciones`, `ver_roadmap`. Es el único lugar donde un modelo
  externo puede invocar funciones de Pepe, y ninguna escribe.

---

## 2. Esquema real

Copiado de `supabase/migrations/`. Se indica de qué migración sale cada
pieza. Las cuatro tablas tienen **RLS habilitado** (`20260101000001_rls.sql`
y `20260807000001_aprendizaje_rls.sql`), con políticas `auth.uid() = user_id`.

### `projects`

De `20260101000000_schema.sql:32`:

```sql
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  activo boolean not null default true,
  -- Peso relativo para repartir los gastos compartidos. 1 = partes iguales.
  peso_prorrateo numeric(12, 4) not null default 1 check (peso_prorrateo > 0),
  color text not null default '#6366f1' check (color ~* '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index projects_user_id_idx on public.projects (user_id);
create index projects_user_activo_idx on public.projects (user_id, activo);
```

Y de `20260807000000_aprendizaje.sql:59`:

```sql
alter table public.projects
  add column archivado_en timestamptz;

create index projects_archivado_idx
  on public.projects (user_id)
  where archivado_en is null;
```

### `daily_log`

De `20260807000000_aprendizaje.sql:210`:

```sql
create table public.daily_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  track_id uuid references public.tracks (id) on delete set null,
  slug text,
  fecha date not null,
  contenido text not null check (length(trim(contenido)) > 0),
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index daily_log_user_fecha_idx on public.daily_log (user_id, fecha desc);
create index daily_log_project_idx on public.daily_log (project_id, fecha desc);

create trigger daily_log_set_updated_at
  before update on public.daily_log
  for each row execute function public.set_updated_at();
```

**No tiene columna de embeddings ni índice de texto.** Es una diferencia
importante con `lessons` y tiene consecuencias (ver §5).

### `lessons`

De `20260807000000_aprendizaje.sql:240`:

```sql
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  movement_id uuid references public.movements (id) on delete set null,
  fecha date not null default current_date,
  titulo text not null check (length(trim(titulo)) > 0),
  contenido text not null check (length(trim(contenido)) > 0),
  categoria public.categoria_leccion not null,
  origen public.origen_leccion not null default 'manual',
  embedding extensions.vector(384),
  archivado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lessons_user_fecha_idx on public.lessons (user_id, fecha desc);
create index lessons_project_idx on public.lessons (project_id, fecha desc);
create index lessons_categoria_idx on public.lessons (user_id, categoria);

-- Cola de pendientes para el backfill de embeddings
create index lessons_sin_embedding_idx
  on public.lessons (user_id)
  where embedding is null;

create index lessons_embedding_idx
  on public.lessons
  using hnsw (embedding extensions.vector_cosine_ops);
```

**El embedding se migró después.** De `20260807000003_busqueda_lecciones.sql:25`:

```sql
drop index if exists public.lessons_embedding_idx;

alter table public.lessons
  alter column embedding type extensions.vector(768);

create index lessons_embedding_idx
  on public.lessons
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.lessons
  add column busqueda tsvector
  generated always as (
    setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(contenido, '')), 'B')
  ) stored;

create index lessons_busqueda_idx on public.lessons using gin (busqueda);
```

> **Columna de embeddings: sí. Dimensión: 768** (`extensions.vector(768)`),
> índice **HNSW** con `vector_cosine_ops`. Nace `null` a propósito:
> escribir una lección nunca depende de que el embedding salga. Hay además
> una columna generada `busqueda tsvector` con full-text en español, con el
> título pesando más (`setweight ... 'A'`) que el cuerpo (`'B'`).

Enums relevantes (`20260807000000_aprendizaje.sql:24`):

```sql
create type public.categoria_leccion as enum (
  'tecnica', 'producto', 'comercial', 'proceso', 'personal'
);

create type public.origen_leccion as enum (
  'manual', 'importada', 'generada', 'retro'
);
```

### `inbox`

De `20260807000000_aprendizaje.sql:302`:

```sql
create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo public.tipo_bandeja not null,
  payload jsonb not null,
  estado public.estado_bandeja not null default 'pendiente',
  entidad_tabla text,
  entidad_id uuid,
  clave_dedupe text,
  -- Solo para 'pospuesto': hasta cuándo no mostrarlo.
  posponer_hasta timestamptz,
  -- Para 'error': qué falló al validar la salida del modelo.
  error_detalle text,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  check ((estado in ('pendiente', 'pospuesto')) = (resuelto_en is null))
);

-- La cola de triage: un ítem por vez, el más viejo primero.
create index inbox_pendientes_idx
  on public.inbox (user_id, creado_en)
  where estado in ('pendiente', 'pospuesto');

create index inbox_entidad_idx
  on public.inbox (user_id, entidad_tabla, entidad_id);

create unique index inbox_dedupe_key
  on public.inbox (user_id, clave_dedupe)
  where clave_dedupe is not null and estado in ('pendiente', 'pospuesto');
```

Con los enums (`20260807000000_aprendizaje.sql:40`):

```sql
create type public.tipo_bandeja as enum (
  'categorizacion', 'zombie', 'leccion_sugerida', 'leccion_extraida', 'retro'
);

create type public.estado_bandeja as enum (
  'pendiente', 'aceptado', 'rechazado', 'pospuesto', 'error'
);
```

**Notas sobre `inbox`:**

- No hay FK sobre `entidad_tabla`/`entidad_id`: apunta a tablas distintas
  según el tipo.
- El índice único de dedupe **cubre solo lo no resuelto**. Una vez resuelto
  un ítem, un candidato nuevo con la misma clave puede volver a aparecer —
  salvo en los zombies, donde el código conserva la clave a propósito.
- **`'categorizacion'` es un valor del enum que nada produce hoy.**
  Verificado: no hay ningún `insert` con ese tipo en el repo. Quedó del
  diseño del spec, antes de decidir que el clasificador confirma en el
  formulario y no en la bandeja.

---

## 3. Datos cargados hoy

Consultado el 2026-08-09 contra la base de producción
(`thlocwmhxzqkmmnxmunf`) vía REST API con la service role key.

### Proyectos: 3

| Nombre | slug | activo | archivado | peso_prorrateo |
|---|---|---|---|---|
| El Prode de Beno | `el-prode-de-beno` | sí | no | 1.0000 |
| Gentius | `gentius` | **no** | no | 1.0000 |
| Proder | `proder` | sí | no | 1.0000 |

### Lecciones: 6

Las seis son `origen = 'importada'` — o sea, **todas salieron del pase de
extracción sobre la bitácora**, ninguna se escribió a mano, ninguna salió de
`generarLecciones` (6.3) ni de una retro (6.5). Las seis pertenecen a
**Gentius**. Ninguna está archivada. **Las seis tienen embedding**
(0 filas con `embedding is null`).

| Fecha | Título | Categoría |
|---|---|---|
| 2026-07-14 | Scrum como marco de trabajo | proceso |
| 2026-07-16 | Autoevaluación como PO | proceso |
| 2026-07-17 | Debería haber backlog antes de planificar el sprint | tecnica |
| 2026-07-17 | Distinción entre roles en autogestión del producto | producto |
| 2026-07-17 | Uso de JIRA para planificar sprints y backlog | tecnica |
| 2026-07-22 | Entender los artefactos de Scrum | proceso |

### Bitácora: 6 entradas

Del 2026-07-14 al 2026-07-22. **Las seis son de Gentius** y las seis tienen
`track_id` apuntando al mismo track. Todas traen `slug` del tipo
`log-1784070432455`, o sea que **las seis vienen del importador de la app de
estudio**: no hay ni una sola entrada escrita dentro de Pepe.

### Resto de la base

| Tabla | Filas |
|---|---|
| `movements` | 22 |
| `categories` | 11 (las del seed) |
| `recurrences` | **0** |
| `tracks` | 2 (Product Manager, Dev · Auditoría Gentius) |
| `blocks` | 15 |
| `sessions` | 70 |
| `artifacts` | 14 |
| `retros` | **0** |
| `fx_rates` | 160 |
| `inbox` | 6 |

### `inbox`: 6 filas, todas resueltas

Las seis son `tipo = 'leccion_extraida'`, `estado = 'aceptado'`,
`entidad_tabla = 'daily_log'`, `clave_dedupe = null`. Creadas el 2026-08-07
(4) y el 2026-08-08 (2). **La bandeja está vacía**: no hay nada pendiente.

### Detección de zombies: 0 candidatos hoy

Se ejecutó `detectar_zombies(p_user_id)` con sus defaults y devolvió `[]`.
Encaja con los datos: el umbral de inactividad por defecto es **90 días**
(`20260808000001_zombies.sql:123-129`, configurable por usuario en
`public.settings`) y la última señal de actividad no recurrente es del
2026-07-22 (bitácora), o sea 18 días. Por eso el cron diario nunca propuso
nada y la bandeja está vacía.

**Lectura de conjunto:** hay datos reales de finanzas (22 movimientos,
abril a julio) y datos reales de estudio importados, pero **el uso dentro de
Pepe es casi nulo**: cero entradas de bitácora escritas en la app, cero
retros guardadas, cero recurrencias declaradas, cero lecciones escritas a
mano o generadas.

---

## 4. Estado de la migración

**Fuente:** se leyó `E:\Beno\Downloads\spec-pepe-migracion.md` completo (sí
se pudo acceder), y se cotejó contra `git log --oneline` y el código.

| # | Etapa del spec | Estado | Evidencia |
|---|---|---|---|
| 1 | Reconocimiento | **Terminada** | — |
| 2 | Esquema (tablas nuevas + vector + RLS) | **Terminada** | `20260807000000_aprendizaje.sql`, `…_rls.sql` |
| 3 | Importación de La Colmena | **Terminada** | commit `a47b2dd`; 2 tracks / 15 blocks / 70 sessions / 6 entradas en la base, todas con `slug` del export |
| 3.1 | Extracción de lecciones desde el log | **Terminada** | `lib/extraccion.ts`; 6 propuestas creadas y aceptadas |
| 4 | Interfaz (Finanzas / Aprendizaje / Bitácora) | **Terminada** | `src/app/(app)/` tiene las tres secciones |
| 5 | Buscador semántico | **Terminada, con desvío documentado** | ver abajo |
| 6 | Extracción + pantalla de revisión | **Terminada** | `components/bandeja/bandeja-view.tsx` |
| 7 | Clasificador de transacciones | **Terminada** | `lib/clasificacion.ts` + `sugerir_categoria_historico` |
| 8 | Funciones de LLM (6.3, 6.4, 6.5) | **Terminada** | `generacion.ts`, `sugerencias.ts`, `retro.ts` |
| 9 | Cron de zombies | **Terminada** | `vercel.json` + `api/cron/zombies` + `detectar_zombies` |
| 10 | Export completo y limpieza del nombre | **Terminada** | `lib/respaldo.ts`, commits `73864db` y `d410543` |
| 12 | MCP nativo (*"NO ahora"* según el spec) | **A medias, empezada igual** | 5 tools de lectura en `mcp/servidor.mts`; las escrituras no |

**Desvíos verificados respecto del spec, todos deliberados:**

- **§6.6 pedía `gte-small` de las Edge Functions de Supabase, 384
  dimensiones.** Se usa `multilingual-e5-base` q8, 768 dimensiones,
  corriendo en un route handler de Next. El spec autorizaba avisar si la
  calidad no era aceptable, y `embeddings.ts:16-23` documenta la medición
  que lo justifica (gte-small es solo inglés).
- **§6.2 decía detectar zombies por "el proyecto asociado".** Se detecta
  agrupando `movements` por núcleo de descripción, porque no hay ninguna
  recurrencia declarada (verificado: `recurrences` tiene 0 filas).
- **§8 decía que el CSV "pasa a ser" un JSON.** Conviven los dos.
- **§12 decía no empezar el MCP.** Se empezó, con un criterio nuevo escrito
  en `AGENTS.md` §8: el corte no es temporal sino por quién escribe.

**Lo que quedó fuera del spec y se construyó igual:** toda la capa de
agentes (spec propio del 2026-08-09, ver §5). El spec de migración es
explícito en §11: *"No hay agentes autónomos"*. La capa nueva no los viola
—ninguno escribe sin confirmación— pero **es trabajo que el spec de
migración no contempla**.

---

## 5. Lo que está roto o a medias

### 5.1 La ola 1 de agentes: qué dice el plan y qué existe

Documentos: `docs/superpowers/specs/2026-08-09-agentes-design.md` (diseño,
"aprobado") y `docs/superpowers/plans/2026-08-09-agentes-ola-1.md` (plan de
12 tareas). **Todos los checkboxes del plan siguen en `- [ ]`**, pero el
`git log` muestra que las tareas 1 a 11 se commitearon.

| Task | Qué pedía | Estado real |
|---|---|---|
| 1 | `tipos.ts` | ✅ `src/lib/agentes/tipos.ts` |
| 2 | `resolver.ts` | ✅ `src/lib/agentes/resolver.ts` |
| 3 | `recepcionista.ts` | ✅ `src/lib/agentes/recepcionista.ts` |
| 4–7 | `despacho.ts`, seis ramas | ✅ `src/lib/agentes/despacho.ts` (con una séptima rama, ver abajo) |
| 8 | route handler | ✅ `src/app/api/agentes/interpretar/route.ts` |
| 9–10 | `<CajaAgente>` + inicio | ✅ montado en `src/app/(app)/page.tsx:16` |
| 11 | atajo global | ✅ `atajo-global.tsx`, montado en `layout.tsx:69` — **pero con Ctrl+J, no Ctrl+K** |
| **12** | **Calibración con 20 frases reales de Beno** | ❌ **sin hacer.** No hay commit. El docstring del recepcionista dice *"medido con diez frases reales"* (de la verificación de la Task 3), no veinte, y la meta declarada del plan es 18/20. |

**Lo que se agregó y no está en ningún documento:**

- **El agente `vencimientos`** (commit `374d99b`, `despacho.ts:84`). La
  palabra "vencimientos" **no aparece ni en el spec ni en el plan**: cero
  ocurrencias en ambos archivos. Es un séptimo agente sin diseño escrito.
- **El buscador mira también la bitácora** (commit `2bdbe79`,
  `buscarEnBitacora()` en `despacho.ts:474`). Tampoco está en el plan.
- **El atajo pasó de Ctrl+K a Ctrl+J** (commit `26748d9`) porque Ctrl+K ya
  era la carga rápida de movimientos.

### 5.2 Lo que está roto o inconsistente hoy

Ordenado por cuánto importa.

**a) `"qué me toca hoy"` no contesta qué toca hoy.** El spec de agentes
dice que el agente de estudio termina en *"Roadmap y sugerencias"* y reusa
*"`aprendizaje.ts`, 6.4"*. En el código, la rama `estudio`
(`despacho.ts:39`) **solo llama a `sugerirQueEstudiar()` (6.4)** y
`despacho.ts` **no importa `lib/aprendizaje.ts` en ninguna parte**
(verificado). O sea: `computeToday()` —que existe, en
`aprendizaje.ts:203`, y es exactamente lo que responde "qué me toca hoy"—
no se usa. Peor: **"qué me toca hoy" es una de las tres frases de ejemplo
que la propia caja sugiere** (`caja-agente.tsx:128`) y que el fallback de
`desconocido` repite (`despacho.ts:417`). Hoy esa frase gasta una llamada
al **razonador** con 3500 tokens de presupuesto y devuelve otra cosa.

**b) El agente de estudio tira a la basura el `ancla`.**
`sugerencias.ts` obliga al modelo a devolver `ancla` y `consigna` como
campos separados, y el docstring (`sugerencias.ts:20-24`) explica que la
regla del spec *"nada de consejos genéricos"* **no se consigue con el
prompt sino mostrando el ancla en pantalla al lado de la sugerencia**. La
rama del agente mapea solo `{titulo, detalle: s.motivo}`
(`despacho.ts:54-57`): **el ancla y la consigna no llegan a la caja.** La
salvaguarda de calidad se pierde por ese camino.

**c) La caja no ofrece el link que su propio comentario promete.**
`despacho.ts:165-167` dice: *"Acá se usa ARS y la caja ofrece el link a la
pantalla, que sí tiene el conmutador"*. La caja **no ofrece ningún link**
para `clase: "texto"` (`caja-agente.tsx:216-229`: título, cuerpo y pie de
destino, nada más). Además la moneda queda **fija en ARS**, ignorando la
que Beno tiene elegida (`localStorage: app-gastos:moneda`).

**d) Mensaje engañoso en suscripciones.** `despacho.ts:66-71`: si
`propuestos === 0` y `detectados > 0` dice *"Las que detecté ya las habías
resuelto antes"*. Pero `propuestos` también da 0 cuando el insert choca
contra el dedupe (código 23505) porque el ítem **ya está pendiente en la
bandeja** (`zombies.ts:205`). En ese caso el mensaje afirma lo contrario de
lo que pasa.

**e) Overflow latente en `lecciones_tema`.** La rama arma el argumento de
sus propias opciones como `` `${tema} — ${p.slug}` `` (`despacho.ts:386`).
`tema` puede tener hasta 300 caracteres (`tipos.ts:35`) y el cuerpo del
route handler valida `argumento` con `.max(300)` (`route.ts:25`). Con un
tema largo, el reintento por opción devuelve **400 "Pedido inválido."**. La
caja solo trunca a 300 cuando el argumento viene `undefined`
(`caja-agente.tsx:50`), y acá viene definido.

**f) Comentarios que ya no describen el código.** `layout.tsx:66` sigue
diciendo *"Ctrl/⌘+K"* cuando el atajo es **Ctrl+J**. `page.tsx:12` dice
*"las seis cosas"* cuando hay siete destinos reales más un stub.
`retro.ts:41` y `generacion.ts:22` dicen *"modelo grande"* cuando las dos
usan `MODELO_RAZONADOR`; `api/proyectos/retro/route.ts:12` idem.

**g) `AGENTS.md` no menciona la capa de agentes.** Cero ocurrencias de
"recepcionista", "CajaAgente", "lib/agentes" o "Ctrl+J" en `AGENTS.md` ni
en `README.md` (verificado). La guía del proyecto describe el MCP en
detalle (§8) pero no la capa que se construyó encima esta semana.

**h) La receta de `AGENTS.md` §8 para encontrar los módulos `server-only`
quedó corta.** Dice *"son 11"* y da `grep -lE '^import "server-only"'
src/lib/*.ts`. Los 11 se verifican, pero ese glob **no entra a
subdirectorios**: `agentes/despacho.ts`, `agentes/recepcionista.ts` y
`agentes/resolver.ts` también son `server-only` y no aparecen. Son 14.

**i) `MODELO_GRANDE` y el enum `'categorizacion'` están declarados y no
los usa nada.** Los dos son deliberados según sus comentarios, pero son
superficie muerta que alguien puede tomar por viva.

### 5.3 Qué se va a romper después

- **El límite duro es 30 pedidos por minuto**, medido a mano el 2026-08-09
  (`AGENTS.md` §6.b) y respetado por el limitador con 28. Ese limitador es
  **estado de módulo** (`llm.ts:189`, `:201`), o sea que vale **por
  instancia de función serverless**. El propio comentario lo dice: *"si
  algún día hay varias en paralelo pegándole a Groq, esto se queda corto y
  hay que mover el contador a la base"*. El cron de zombies y la caja
  corren en instancias distintas. Hoy no muerde porque hay un solo usuario
  y 0 candidatos; muerde apenas haya volumen.
- **El agente `retro` es una llamada de hasta 180 segundos disparada por
  una frase suelta.** Basta que el recepcionista clasifique "cerrá esto"
  como `retro` con confianza ≥ 0.6 para quemar 4500 tokens del razonador
  (que tiene 8000/minuto y 1000 pedidos/día) y dejar hasta 6 lecciones en
  la bandeja. No hay confirmación previa a la llamada; sí la hay antes de
  escribir en `lessons`.
- **La búsqueda del agente en la bitácora es `ilike` sobre `contenido`
  sin índice.** `daily_log` no tiene ni `tsvector` ni embedding
  (verificado en la migración). Con 6 entradas no se nota; es un escaneo
  secuencial que crece lineal.
- **La medición de calidad del buscador está declarada como vencida.**
  `AGENTS.md` dice: *"Volver a medir cuando haya lecciones reales
  cargadas"*. Las 6 que hay son extraídas de la bitácora importada, no
  escritas dentro de Pepe.

---

## 6. Preguntas abiertas

### 6.1 Lo que no se pudo verificar

1. **`npm run build` no se corrió** (la consigna prohíbe tocar el repo más
   allá de este archivo, y el build baja el modelo de embeddings y escribe
   `.next`). `typecheck` y `lint` sí, y pasan limpios.
2. **Nada se probó en el navegador ni contra el deploy.** Entrar exige
   Google OAuth, que no se puede automatizar sin fabricar una sesión de
   admin. Todo lo dicho sobre la UI sale de leer los componentes.
3. **Ningún prompt se ejerció contra Groq.** Las calidades citadas
   (10/10 de destino, 3/4 de embeddings, etc.) son mediciones que están
   escritas en los docstrings del repo, no verificadas de nuevo acá.
4. **No se verificó la configuración de Vercel ni de Supabase Auth**
   (variables de entorno de producción, `site_url`, `uri_allow_list`).
5. **No se verificó el repo privado `bdallago/pepe-respaldos`**, donde
   según `AGENTS.md` vive el workflow que agenda y guarda el respaldo
   diario. No se pudo confirmar que corra.
6. **No se sabe si la Task 12 se decidió saltear o quedó pendiente.** No
   hay commit ni nota.

### 6.2 Decisiones tomadas en el código que nunca se discutieron

Esta es la parte que conviene llevar a la conversación de diseño: cosas
que alguien eligió y que no quedan registradas como elección en ningún
lado.

1. **El umbral de confianza es 0.6 y sale de la nada.**
   `tipos.ts:43` lo declara con el comentario *"Debajo de esto el
   recepcionista pregunta en vez de adivinar"*, y el prompt le dice al
   modelo que ponga "menos de 0.6" si duda y "entre 0.2 y 0.4" para
   nombres sueltos. O sea: **el modelo aprende el número del prompt y el
   código lo compara contra el mismo número.** No es una calibración, es
   una convención circular. Nadie midió qué tasa de preguntas produce.

2. **La ambigüedad se detecta con una regla gramatical inventada.**
   `recepcionista.ts:89-110`: *"¿tiene verbo conjugado? ¿tiene palabra de
   pregunta? Si las dos son no, la confianza va entre 0.2 y 0.4, sin
   excepción."* Es una teoría razonable sobre cómo escribe Beno, pero es
   **una teoría**, escrita dentro de un prompt, sin nadie que la haya
   validado más allá de diez frases.

3. **Los ejemplos del prompt son datos personales que cambian el
   comportamiento global.** El propio docstring lo documenta
   (`recepcionista.ts:44-48`): usar "pricing" como ejemplo **subió la
   confianza de "pricing" suelto de 0.3 a 0.8**, arruinando justo el caso
   que se estaba arreglando. O sea: el prompt tiene acoplamiento no local
   entre ejemplos, y hoy no hay ninguna suite que lo detecte. Es el
   argumento más fuerte a favor de la Task 12 pendiente.

4. **La bitácora se buscará con `ilike` y con una lista de stopwords
   escrita a mano.** `despacho.ts:428-435` tiene 50 palabras vacías del
   español hardcodeadas, y `despacho.ts:450` corta la consulta en **8
   palabras**. Ninguno de los dos números está justificado en ninguna
   parte, y la alternativa obvia —darle a `daily_log` la misma columna
   `tsvector` que ya tiene `lessons`— no aparece discutida en ningún lado.

5. **La moneda del agente de consultas es ARS y punto.**
   `despacho.ts:166`. El resto de la app tiene un conmutador ARS/USD con
   preferencia persistida. El comentario justifica la elección diciendo
   que la caja ofrece un link a la pantalla — link que no existe.

6. **`daily_log` no tiene embedding ni full-text, y `lessons` sí.** No hay
   ninguna nota que diga si eso fue una decisión o una omisión. Es
   relevante porque el spec original insistía en no perder conocimiento, y
   la bitácora es donde el conocimiento nace.

7. **El quiz dejó de usar un modelo y nadie lo anotó como decisión.** El
   spec de migración describe el quiz de La Colmena como *"modo quiz con
   repetición espaciada, que llama a la API de Anthropic vía una
   serverless function"*. En Pepe es 100 % local y determinístico
   (`quiz.ts:4-19`). Es un cambio de alcance real que solo vive en un
   docstring.

8. **El MCP se empezó contra la instrucción explícita del spec.** §12
   decía *"no forma parte de esta migración y no hay que empezarlo"*.
   `AGENTS.md` §8 argumenta bien por qué (*"tomada al pie de la letra se
   muerde la cola: el MCP puede ser justamente lo que haga que la use"*),
   pero es un cambio de criterio sobre un "no ahora" del dueño.

9. **La capa de agentes absorbe funciones del spec sin que el spec lo
   sepa.** El diseño de agentes dice en "Fuera de alcance": *"Escrituras
   del MCP local: quedan absorbidas por estos agentes"*. Hay ahora **tres
   superficies que hacen lo mismo** —la pantalla, el MCP y la caja— y
   ninguna documentación única que diga cuál manda.

10. **Un séptimo agente (`vencimientos`) entró sin pasar por diseño.**
    Y con él un número inventado: `DIAS_DE_VENCIMIENTO_PROXIMO = 30`
    (`despacho.ts:23`), justificado en su propio comentario, no acordado.
    Hoy contesta siempre "no se te viene nada" porque `recurrences` tiene
    **0 filas**: es un agente que, con los datos reales, no puede devolver
    nada distinto de vacío.

11. **La bandeja aplica en optimista y recarga la página entera.**
    `bandeja-view.tsx` está construida alrededor de que el triage se
    sienta instantáneo, pero el pase de extracción termina con
    `window.location.reload()` (`bandeja-view.tsx:410`). Convive un
    diseño de latencia cero con un full reload.

12. **Un fallo del modelo y un "no hay lección" quedan indistinguibles en
    los conteos.** Cuando el modelo dice `tiene_leccion: false`, se
    inserta una fila `estado = 'rechazado'` **como si Beno la hubiera
    rechazado** (`extraccion.ts:206-218`). Es lo que hace retomable el
    pase, pero significa que **el histórico de la bandeja no distingue lo
    que descartó el modelo de lo que descartó Beno**. Con los datos de
    hoy no se nota (las 6 filas son aceptadas), pero es una pérdida de
    información sobre la calidad del modelo justo en la tabla que
    existe para auditarlo.
