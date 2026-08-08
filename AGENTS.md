<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Guía del proyecto

**Pepe**: app personal de un solo usuario con tres secciones — Finanzas,
Aprendizaje y Bitácora.

Nació como app de balance de ingresos y egresos por proyecto
(`prompt-app-gastos.md`, sigue siendo la fuente de verdad de esa parte).
El 2026-08-07 absorbió una segunda app de estudio que vivía aparte
(React + Vite + localStorage); el spec de esa fusión está en
`E:\Beno\Downloads\spec-pepe-migracion.md`.

`projects` es la **entidad raíz de toda la app**, no solo de finanzas: las
lecciones y la bitácora también cuelgan de un proyecto.

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # build de producción (baja el modelo si falta)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit

npm run descargar:modelo      # pesos del modelo de embeddings (266 MB)
npm run backfill:embeddings   # embeddings faltantes, por lotes y retomable
npm run import:colmena        # importador de la app de estudio (histórico)
```

Para aplicar migraciones y regenerar tipos hace falta el access token de
Supabase (`SUPABASE_ACCESS_TOKEN=sbp_…`, lo tiene Beno):

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase db push --linked
SUPABASE_ACCESS_TOKEN=… npx supabase gen types typescript \
  --project-id thlocwmhxzqkmmnxmunf --schema public
```

Al regenerar tipos hay que **volver a pegar a mano** el bloque de alias
del final de `database.types.ts`. Y ojo: el generador **no** agrega
`| null` a los argumentos con `default null` de las funciones RPC. No
lo parchees en el archivo generado —se pierde en la próxima corrida—:
pasá `?? undefined` en el call site, que omite el parámetro y deja que
Postgres aplique su default.

No hay suite de tests versionada. Antes de dar algo por terminado, corré
`npm run typecheck && npm run lint && npm run build`.

Para probar las pantallas privadas hace falta una sesión, y la app entra
**solo con Google OAuth**, así que no se puede automatizar el login. La
vuelta que funciona: pedirle a Supabase un magic link de admin con la
service role key, seguir el `action_link` con `redirect: "manual"` (el 303
trae los tokens en el fragmento) y armar a mano la cookie de
`@supabase/ssr` — `sb-<ref>-auth-token`, valor `"base64-" + base64(JSON)`,
partida en chunks de 3180 caracteres. Con eso Playwright entra sin tocar
ninguna credencial.

Ojo: el `hashed_token` de `generate_link` **no** se canjea por
`POST /auth/v1/verify` (ese espera el OTP crudo y devuelve `otp_expired`).

Y ojo con la forma de la respuesta: según la versión de GoTrue, el link
viene en `action_link` **en la raíz** o bajo `properties.action_link`.
Al 2026-08-07 es en la raíz. Leé los dos.

**No corras `npm run build` con un `next dev` vivo**: comparten `.next` y
se pisan (`PageNotFoundError: Cannot find module for page`). Si el dev
quedó con el manifiesto viejo después de editar muchos archivos, tira
`__webpack_modules__[moduleId] is not a function` en rutas que están bien;
se arregla bajando el dev, borrando `.next` y volviendo a levantar.

## Versión de Next

El proyecto está **pineado a Next 15.5.x** porque el spec lo pide, aunque
`create-next-app@latest` instale Next 16. `package.json` tiene `overrides`
para `postcss` y `sharp`: sin eso, las deps transitivas de Next 15 arrastran
tres advisories high y `npm audit fix` te empuja a Next 16. Si tocás
versiones, verificá que `npm audit` siga en cero.

## Reglas de dominio que no son obvias leyendo un archivo suelto

### 1. El tipo de cambio se congela (`src/lib/fx.ts`)

`movements` guarda `monto_ars`, `monto_usd`, `tasa_usada` y `tasa_fecha`
congelados en el momento de la carga. **Nunca recalcular montos históricos
con la cotización actual.**

- La tasa aplicable a una fecha es la de esa fecha o **la última anterior**
  (`fx_rate_for_date` en la base, `resolverTasa` en el cliente).
- `congelarMontos()` es el único lugar donde se arma el par ARS/USD.
- La **única** recotización de la app es `efectuarMovimiento()`: al pasar
  un planificado a efectuado se recalcula contra la fecha real.
- Las Server Actions no pisan la tasa que manda el formulario: el usuario
  puede forzar una cotización distinta a propósito.

### 2. El prorrateo se calcula al vuelo (`src/lib/prorrateo.ts`, `src/lib/balances.ts`)

`project_id = null` es gasto compartido. Se reparte entre los proyectos
**activos** por `peso_prorrateo`, **sin guardar filas duplicadas**.

Invariante: `suma(balance de cada proyecto) === balance general`. Se
sostiene con `repartirPorRestoMayor()`, que reparte centavos enteros —
redondear cada fracción por separado lo rompe. La pantalla de Proyectos
verifica el invariante en pantalla.

Excepción real y documentada: sin proyectos activos no hay entre quiénes
repartir. Eso sale por `Balances.compartidoSinRepartir` y la UI lo avisa.

### 3. Moneda de origen vs. derivada

El formulario muestra ARS y USD a la vez. El campo que se escribe define
`moneda_origen` (importe real); el otro es derivado. En
`movement-form.tsx`, el efecto que recalcula el derivado **excluye a
propósito** `monto_ars`/`monto_usd` de sus dependencias: incluirlos haría
que se dispare con cada tecla y pise lo que se está escribiendo.

### 4. Archivar en vez de borrar

Todas las entidades del módulo de aprendizaje (`projects`, `lessons`,
`tracks`, `blocks`, `sessions`, `artifacts`, `daily_log`) llevan
`archivado_en` y **el borrado por defecto es archivado**.

Los archivados se excluyen de las listas de la interfaz, pero **siguen
participando de la búsqueda**: un proyecto cerrado no tiene que ensuciar
las pantallas, pero su conocimiento no se pierde. El delete real existe
solo como acción explícita y separada.

### 5. El progreso de una sesión es doble

`sessions` tiene `teoria_hecha`/`teoria_fecha` y
`aplicacion_hecha`/`aplicacion_fecha` por separado. Leer la teoría y
aplicarla **no son lo mismo**, y esa distinción es el punto de la sección
de Aprendizaje. Un solo campo `estado` no puede representar "leí el 14
pero todavía no lo apliqué".

Hay checks en la base: `teoria_hecha = (teoria_fecha is not null)` y lo
mismo para aplicación. Al marcar se setea la fecha, al desmarcar se pone
en null. Nunca uno sin el otro. Lo mismo con `artifacts`:
`(estado = 'completado') = (fecha_completado is not null)`.

### 6. Nada se escribe sin confirmación

Todo lo que propone un modelo va a la tabla `inbox` con estado
`pendiente`. **Ninguna función escribe en las tablas de dominio sin que
Beno apriete un botón.** `clave_dedupe` (con índice único sobre lo no
resuelto) es lo que hace que los procesos por lotes se puedan reintentar
sin duplicar propuestas.

La bandeja no es una sección: es el portón por donde entra todo lo que
propone un modelo, para finanzas y para aprendizaje por igual. Vive como
icono con contador al lado de Ajustes.

Su diseño es requisito del spec, no cosmética: **un ítem por vez, sin
scroll, todo con teclado** (A aceptar, R rechazar, P posponer, E editar;
swipe en mobile) y la acción **aplicada en optimista**, antes de que
conteste el servidor. Si revisar veinte propuestas cuesta veinte clicks,
la bandeja se abandona y todo el diseño de confirmación humana pierde
sentido. Por lo mismo, **el embedding de la lección aceptada no se
espera**: la pantalla lo dispara contra `/api/lecciones/indexar` y sigue.

**Al aceptar, la fila de bandeja sigue apuntando a la entidad de
origen.** Antes se repuntaba a la lección creada, y eso rompía el pase
de extracción: busca lo ya mirado por `entidad_tabla = 'daily_log'`, así
que apenas aceptabas una propuesta su entrada volvía a parecer sin mirar
y la corrida siguiente la proponía de nuevo. Estuvo latente desde la
etapa 6 y se vio el 2026-08-08, la primera vez que se aceptó algo: el
pase duplicó las cuatro lecciones. El vínculo hacia la lección creada va
en `payload.lesson_id`.

**La vara del extractor es baja a propósito, y no es la misma que la de
6.3 y 6.5.** Ahí el modelo inventa y lo genérico es relleno; acá
reescribe lo que Beno vivió y escribió. Los dos errores no cuestan
igual: un falso positivo se descarta con una tecla, un falso negativo es
una lección suya que no ve nunca. La calibración original decía "ante la
duda, no hay lección" y descartó sola 2 de 6 entradas reales; Beno se
quedó con las seis. El prompt ahora dice **"ante la duda, proponela"** y
pide respetar su formulación en vez de mejorarla. No lo vuelvas a
apretar.

El enum de estados tiene dos valores más allá de los obvios: `pospuesto`
(para los zombies que se miran más adelante) y `error` (cuando la salida
del modelo no valida contra el esquema — queda visible en la bandeja en
vez de descartarse en silencio).

### 6.b El límite de Groq que muerde son los tokens, y es por modelo

El spec pide un limitador propio de **30 requests/minuto**. Medido contra
la cuenta real el 2026-08-07, ese no es el techo que se toca: el tier
gratuito corta antes por tokens. El pase de extracción gasta entre 600 y
1000 tokens por entrada, así que come un 429 en la cuarta llamada, con el
contador de pedidos en 4 de **1000** (ese es el techo real de pedidos, no
30).

**El techo de tokens es por modelo y son distintos entre sí.** Leído de
los headers `x-ratelimit-limit-tokens` el 2026-08-08:

| modelo | tokens/minuto |
|---|---|
| `llama-3.1-8b-instant` | 6000 |
| `llama-3.3-70b-versatile` | 12000 |
| `openai/gpt-oss-120b` | 8000 |

Por eso `lib/llm.ts` lleva **una ventana por modelo**. Antes había un
balde único y global de 5500, que frenaba a la retro contra el techo del
modelo más chico —uno que ni siquiera estaba usando—. Si agregás un
modelo, agregalo a la tabla `TOKENS_POR_MINUTO`: lo que no está ahí cae
al techo más conservador.

La reserva de tokens se hace estimando (largo del prompt / 3 +
`max_tokens`) y se **corrige con el `usage` de la respuesta**: sin esa
corrección se reserva siempre el máximo de salida y el limitador frena
de más. Con los modelos de razonamiento eso se nota, porque `max_tokens`
tiene que ser holgado y lo real suele ser la mitad.

### 6.c El histórico le gana al modelo, y matchea ignorando el mes

Al cargar un movimiento se sugiere tipo y categoría en **este orden
exacto**: primero `sugerir_categoria_historico` (SQL puro, contra
índice), y **solo si no encontró nada** se llama al modelo. No es por
ahorrar tokens: es que las decisiones de Beno le ganen siempre a las de
un modelo. Como cada movimiento confirmado entra al histórico, el paso 2
se llama cada vez menos.

La comparación exacta sola **no alcanza**, y eso se midió: las cargas
recurrentes se describen con el período adentro ("Claude Pro - Julio",
"Vercel Pro - Junio"), así que la descripción normalizada nunca se
repite y todo caía al modelo. Por eso hay dos niveles — texto idéntico
primero, y si no, el **núcleo** (la descripción sin el mes ni el año del
final). La función devuelve `exacto` para que la interfaz diga cuál de
los dos fue: "como las 3 veces anteriores" no es lo mismo que "como los
meses anteriores".

`movements.descripcion_normalizada` es una **columna generada**. Su
expresión y `normalizarDescripcion()` en `src/lib/clasificacion.ts`
tienen que dar exactamente lo mismo; si tocás una, tocá la otra.

La sugerencia **nunca decide**: llega precargada al formulario y se
apaga apenas Beno elige tipo o categoría a mano. El formulario es el
"panel de confirmación" que pide la sección 6 del spec, por eso esto no
pasa por `inbox`.

### 6.d Contra la generalidad, el techo era el modelo

`lib/llm.ts` tiene **tres** modelos, no dos, y el tercero se agregó
midiendo. Generar lecciones sobre un tema (6.3) con
`llama-3.3-70b-versatile` devolvía rótulos —"Establecer límites de
soporte", "Priorizar la documentación", "Revisar contratos"—, que es
exactamente lo que el prompt prohíbe. Agregarle ejemplos en contraste al
prompt **no movió la aguja**: el techo era el modelo.

Medido el 2026-08-08 con el prompt real, mismo sistema y mismo usuario:
`openai/gpt-oss-120b` con `reasoning_effort: "medium"` devolvió
afirmaciones discutibles ("Cobrar por cada versión mayor evita que el
cliente exija cambios sin fin"); `qwen/qwen3.6-27b` ni siquiera devolvió
JSON válido. De ahí `MODELO_RAZONADOR`.

**Las tres funciones de 6.3 a 6.5 usan el razonador.** La retro empezó
con llama y se pasó el mismo día, por decisión explícita de Beno: pagar
latencia y tokens a cambio de calidad, sin salirse del tier gratuito.
Con llama las lecciones candidatas salían desparejas ("Es importante
evaluar el gasto en herramientas"); con el razonador salen con el número
adentro ("El 70 % de la facturación proviene de dos clientes").

**El contrapeso del razonamiento es que confabula más**, y en una retro
eso importa más que en ninguna otra parte: es un documento que se relee
dentro de un año. La primera corrida inventó un "plazo previsto" que no
existía, procesos que supuestamente faltaron y consecuencias que nadie
registró. Por eso la regla antiinvención del prompt de `lib/retro.ts`
**enumera los errores concretos uno por uno** en vez de decir "no
inventes": el modelo respeta la lista, no el principio. Si tocás ese
prompt, no la borres.

`MODELO_GRANDE` quedó sin usar en la app, pero se deja: es el que hay
que agarrar si aparece un caso con entrada enorme donde el razonamiento
no compre nada.

Ojo con el presupuesto: **los tokens de razonamiento se descuentan de
`max_tokens`** y del techo por minuto. Con 1800 la lista de 6.3 volvía
truncada a una sola lección; por eso 3500 ahí y 4500 en la retro.
Quedarse corto no degrada la respuesta: la trunca, no valida contra el
esquema y se pierde la llamada entera. Por lo mismo, el contexto de la
retro tiene **presupuesto de caracteres para la bitácora**
(`PRESUPUESTO_BITACORA_CHARS`): es la única parte de la entrada que
puede crecer sin límite.

Y por lo mismo el limitador tiene una salida de emergencia: si una sola
llamada estima más que el techo del minuto, esperar no lo arregla —el
minuto siguiente tiene el mismo techo—, así que con la ventana vacía
sale igual.

### 6.e Las tres funciones de 6.3 a 6.5 no comparten camino

- **6.3 generar lecciones** y **6.5 retro** dejan propuestas en `inbox`
  (`leccion_sugerida` y `retro`). Se aceptan en la bandeja como
  cualquier otra cosa; lo único que cambia es el `origen` con el que
  nace la lección: `generada` y `retro` respectivamente.
- **6.4 sugerir qué estudiar** es la única salida de un modelo que se
  muestra directamente, sin bandeja. Se puede porque **no escribe nada**.
  Lo único que toca la base es convertir una sugerencia en sesión, y eso
  es un botón aparte. Las sugerencias tampoco se guardan: al recargar no
  están, a propósito.
- **El texto de la retro no se guarda solo.** Vuelve a pantalla como
  borrador editable y recién con "Guardar" pasa a la tabla `retros`. Las
  lecciones candidatas, en cambio, ya quedaron esperando en la bandeja.

El `balance_ars` / `balance_usd` de `retros` se **congela** al guardar,
con el mismo criterio que el tipo de cambio de `movements`: la retro
dice lo que el proyecto costó cuando se cerró. Nunca recalcularlo al
leerla.

Las sesiones que salen de 6.4 nacen **sin bloque** y al final del track:
no son parte del temario importado y meterlas en un bloque existente
mentiría sobre de dónde salieron. El Roadmap las junta en un grupo
"Agregadas" — sin ese grupo no aparecerían en ninguna parte, porque esa
pantalla agrupa por bloque.

Y la regla que rige las tres, escrita en los prompts y verificada
midiendo: **el título tiene que ser una afirmación discutible, no un
rótulo.** Si podría estar en la tapa de cualquier libro de negocios,
está mal.

### 7. Ninguna feature de LLM puede ser bloqueante

Si Groq está caído o se acabó la cuota, **la app sigue funcionando entera
en modo manual**. Cargar un gasto, escribir una lección y registrar la
bitácora tienen que andar sin el modelo, siempre. El error se muestra
discreto y no interrumpe el flujo.

Lo mismo vale para el buscador: si el embedding falla o tarda, la
búsqueda responde igual solo con full-text y **eso no es un error**.

## Búsqueda de lecciones

Híbrida: full-text en español + similitud vectorial, fusionados con
**Reciprocal Rank Fusion** (`buscar_lecciones_hibrido`). No es una suma
ponderada a propósito: los dos puntajes no son comparables entre sí.

- El full-text usa **OR, no AND**. `websearch_to_tsquery` une con AND y
  exigía todas las palabras; uno no se acuerda de las palabras exactas
  que escribió, se acuerda del tema. La precisión la da `ts_rank_cd`, no
  el filtro.
- El modelo es **`multilingual-e5-base` q8, 768 dimensiones**, corriendo
  en un route handler de Vercel. Medido contra datos reales en español:
  `gte-small` y `multilingual-e5-small` acertaron 2/4 con márgenes de
  ruido; el base, 3/4 en q8 y 4/4 en fp32 (indesplegable, 1.1 GB).
- **E5 exige los prefijos `"query: "` y `"passage: "`.** Sin eso la
  calidad se cae. No es opcional.
- El índice es **HNSW y no IVFFlat**: IVFFlat se entrena sobre datos ya
  cargados y calibra `lists` contra la cantidad de filas, así que sobre
  una tabla que arranca vacía nacería mal calibrado.
- Los pesos (266 MB) **no van al repo** — es público y GitHub rechaza
  archivos de más de 100 MB. Los baja `npm run descargar:modelo` dentro
  del build, y `next.config.ts` los mete al bundle con
  `outputFileTracingIncludes`.

> Medición del 2026-08-07, con 6 entradas de bitácora reales y 4
> lecciones sintéticas: **el full-text solo acertó 5/5**, mejor que
> cualquier configuración de embeddings. Con un corpus chico el semántico
> aporta poco; su caso real es la consulta cuyas palabras no aparecen en
> el texto ("cuándo sumar gente al equipo" → "Contratar temprano"), que
> el full-text no encuentra. **Volver a medir cuando haya lecciones
> reales cargadas.**

## Cookies de sesión y el HTTP 431

El `dev` y el `start` levantan Node con
`--max-http-header-size=32768` (vía `cross-env`). No es decorativo: en
`localhost` las cookies **se comparten entre todos los puertos**, así que
los otros proyectos que tengas corriendo suman al mismo header y con el
default de 16 KB el server contesta **431 Request Header Fields Too
Large** apenas volvés del OAuth.

Por el mismo motivo, `signInWithOAuth` **no** manda `access_type:
offline` ni `prompt: consent`: eso hace que Google emita un refresh token
que Supabase guarda dentro de la cookie de sesión (`provider_token` +
`provider_refresh_token`). La app no usa ninguno de los dos. Si alguna vez
hace falta llamar a una API de Google en nombre del usuario, hay que
volver a activarlos y guardar esos tokens fuera de la cookie.

## Fechas

Las columnas `date` se manejan siempre como strings `"YYYY-MM-DD"`. Nunca
`new Date(iso)` a secas: eso parsea en UTC y en Argentina devuelve el día
anterior. Usá los helpers de `src/lib/dates.ts`, que trabajan a mediodía
local.

## Sistema de diseño

Los tokens de `globals.css` no son genéricos: salen del ADN que comparten
los otros proyectos de Beno (Voltio, HRKit/Gentius y su portfolio).

- **Fondo crema, nunca blanco puro.** Las superficies son tono sobre tono
  (`--oat` de página, `--crema` de tarjeta). Si aparece `#fff` en una
  superficie, está mal.
- **Verde profundo de tinta** (`--cambodia`), **teal de marca**
  (`--teal`, el `#236E6D` que aparece igual en Voltio y HRKit) y **un solo
  acento cálido** (`--mango`).
- Modo oscuro **elegido, no volteado**: verde-negro derivado del cambodia.
  Un gris neutro rompe la familia.

Tipografía: **Fira Sans + Fira Code**, las del portfolio. La clase
`.cifra` pone Fira Code con figuras tabulares en montos, fechas y
cotizaciones — no es decorativo, es un libro de cuentas y las columnas de
plata tienen que alinear en vertical.

> Cuidado con los reemplazos masivos: cambiar `tabular-nums` por `cifra`
> en todo el repo rompe la propia definición en `globals.css`
> (`font-variant-numeric: cifra`). Excluí el CSS de ese tipo de `sed`.

## Gráficos

La paleta está en `globals.css` (`--chart-1..8`, `--chart-ingreso`,
`--chart-egreso`) y **está validada** con el validador de la skill
`dataviz` contra las superficies reales: `#FFFDF5` en claro y `#1B241E`
en oscuro.

**Si cambiás el fondo, revalidá.** El contraste se mide contra la
superficie, no en abstracto: al pasar de blanco a crema hubo que correr
el validador de nuevo.

- Los ocho tonos categóricos se asignan **en orden fijo, nunca ciclados**.
  A partir del octavo, todo va a "Otras". Los dos primeros son los de
  marca. Peor par adyacente: ΔE 15.9 en claro, 13.0 en oscuro.
- Ingresos/egresos usan el par de marca **teal↔naranja** (ΔE 15.9 para
  daltonismo, 29.1 de visión normal). Verde/rojo, lo esperable en
  finanzas, mide 6.9 y está descartado.
- **El teal de marca no sirve como color de datos.** `#236E6D` tiene croma
  0.072 contra un piso de 0.1: como marca de gráfico se lee gris. El
  `--chart-1` es `#008F8F`, el mismo tono con la croma subida.
- En modo claro, amarillo y magenta quedan bajo 3:1. Por eso el gráfico de
  torta lleva siempre la lista con nombre y monto al lado: la identidad no
  puede depender solo del color.

El selector de color de proyecto en Ajustes ofrece **estos mismos ocho
tonos** y no un picker libre, justamente para que los gráficos no se
llenen de colores sin validar.

Recharts necesita colores concretos, no variables CSS: `useChartTheme()`
las lee del documento y las relee cuando cambia el tema.

## Convenciones

- **Tablas y claves foráneas en inglés, columnas y enums en español.**
  `movements.descripcion`, `lessons.categoria`, `daily_log.contenido`.
  Suena raro pero es consistente en todo el esquema; no lo "arregles" en
  una tabla sola.
- Todo el texto de la UI en **español rioplatense**, igual que los
  identificadores del dominio (`fecha`, `descripcion`, `monto_origen`).
- Las tablas del módulo de aprendizaje llevan `slug`: es el id que traía
  el export de la app vieja y es lo que hace **idempotente** al
  importador (`upsert` sobre `(user_id, slug)`).
- Formato `es-AR` vía `src/lib/format.ts`. ARS sin decimales, USD con dos.
- El CSV se exporta con `;` y BOM: es lo que Excel en configuración
  argentina abre sin pasar por el asistente de importación.
- Server Actions devuelven `ActionResult<T>` (`{ ok, data } | { ok, error }`),
  nunca lanzan para errores esperables.
- `createAdminClient()` saltea RLS. Solo lo usan el cron y la
  actualización forzada de cotización.

## Seguridad

El repo es **público**. `.gitignore` cubre `.env*` (salvo `.env.example`),
`.vercel`, `.supabase`, claves, certificados y dumps de base. Antes de
commitear algo nuevo que pueda tener secretos, verificá que esté cubierto.

También quedan afuera, y no por secretos:

- `colmena-backup-*.json` — el export de la app de estudio. Son entradas
  personales de bitácora, no van a un repo público.
- `.modelos/` — los pesos del modelo de embeddings (266 MB). GitHub
  rechaza archivos de más de 100 MB; los baja el build.

`npm audit` tiene que quedar en **cero**. `@huggingface/transformers`
arrastra `onnxruntime-node` → `adm-zip`, que trae tres advisories high;
está resuelto con un `override` a `^0.6.0` en `package.json`, al lado de
los de `postcss` y `sharp`. Si tocás dependencias, verificá que siga en
cero: `npm audit fix --force` te downgradea `transformers`.
