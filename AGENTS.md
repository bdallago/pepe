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

### 6.b Los límites de Groq, medidos disparando contra la cuenta

⚠ **Esta sección decía que el techo de 30 pedidos/minuto del spec no
existía y que el real era 1000. Era falso**, y estuvo escrito así entre
el 2026-08-07 y el 2026-08-09. El 1000 es el techo **diario** de pedidos
de dos de los modelos; se confundió con uno por minuto. `REQUESTS_POR_MINUTO
= 28` en `lib/llm.ts` siempre estuvo bien.

Medido el 2026-08-09 disparando pedidos reales, no leyendo documentación:
45 llamadas mínimas seguidas al modelo chico entran **exactamente 30** y
de la 31 en adelante son todas 429, en 12 segundos. Repetido con el
razonador: idéntico. **Los 30 por minuto del spec son reales.**

| modelo | ped./min | ped./día | tok./min | tok./día |
|---|---|---|---|---|
| `llama-3.1-8b-instant` | **30** | 14 400 | **6000** | 500 000 |
| `llama-3.3-70b-versatile` | 30 | 1000 | **12 000** | 100 000 |
| `openai/gpt-oss-120b` | **30** | 1000 | **8000** | 200 000 |

En negrita lo verificado a mano; el resto es la documentación oficial,
que coincidió con todo lo medible.

**Los pedidos se cuentan por día, no por minuto**, y eso se lee en los
propios headers: 1000 pedidos con `x-ratelimit-reset-requests: 1m26.4s`,
y 86400 ÷ 1000 = 86,4. Es un balde que gotea a lo largo del día. **Y hay
un techo diario de tokens** que los headers no informan.

La ventana de 429 se recupera sola: al minuto siguiente ya contesta 200.

**Que esto no te frena es una conclusión medida, no un supuesto.** Un
gasto dictado gasta 800-1500 tokens y 2-3 pedidos, así que el techo
diario del modelo chico da para ~330 gastos por día. Lo único que puede
tocar un techo de verdad es el **backfill histórico de una casilla de
mail**: 2000 mails son 67 minutos solo por el ritmo de pedidos y unos
tres días por el techo diario de tokens. Se resuelve con un pase por
lotes y retomable, no pagando — pagar cuesta centavos por mes a esta
escala y lo único que compra es sacarse el techo de 30/minuto.

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
cliente exija cambios sin fin"); `qwen/qwen3.6-27b` no devolvió JSON
válido **con ese prompt**. De ahí `MODELO_RAZONADOR`.

⚠ **Ojo con lo de qwen: la frase de arriba decía "ni siquiera devolvió
JSON válido" y se leía como una propiedad del modelo. No lo es.** Medido
el 2026-08-10, `qwen/qwen3.6-27b` responde bien con
`response_format: json_object`. Lo que falló el 08 fue esa combinación de
prompt y modelo, no su capacidad de devolver JSON.

Importa porque **qwen es el único modelo de la cuenta que lee
imágenes**: los otros tres contestan HTTP 400 (`messages[0].content must
be a string`) apenas les mandás el array multimodal. Descartarlo por una
frase mal generalizada habría dejado sin salida el caso de las capturas.
Ninguno de los cuatro lee PDF.

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

### 6.f Los zombies se detectan sobre movimientos, no sobre recurrencias

El spec dice "gastos recurrentes cuyo **proyecto asociado** no tiene
actividad reciente". Medido contra los datos reales el 2026-08-08, esa
frase no detecta nada, por dos motivos:

1. **No hay ninguna recurrencia declarada.** Los cuatro gastos que se
   repiten de verdad —Claude Pro, Vercel Pro, Verificado de Twitter,
   Google Ads— son movimientos sueltos. Por eso `detectar_zombies`
   agrupa `movements` por `nucleo_descripcion` (el mismo mecanismo de
   6.c) y cruza `recurrences` después, no antes.
2. **Los cuatro son compartidos** (`project_id is null`), así que no
   tienen proyecto contra el cual medir. Decisión de Beno: un gasto
   compartido se mide contra la actividad de **toda la app**.

**Se cuentan meses con cargo, no cargos.** "Google Ads" son cuatro
cargos del mismo mes: es una campaña, no una suscripción. El criterio
es `count(meses distintos) >= 2`.

**El propio cargo de la suscripción no cuenta como actividad.** Si
contara, toda suscripción se mantendría viva sola —se paga, luego hay
movimiento, luego el proyecto está activo— y el detector no dispararía
nunca. Los núcleos recurrentes se excluyen del cálculo de actividad.

Hay un segundo filtro, `p_dias_vigencia` (75 días): si hace más de dos
ciclos que no aparece el cargo, la suscripción ya está dada de baja y no
hay nada que avisar.

**El rechazo de un zombie conserva `clave_dedupe`, al revés que todo el
resto de la bandeja.** Como la detección es una consulta sobre todo el
histórico, el gasto va a seguir apareciendo en cada corrida; la fila
resuelta es lo único que se acuerda de que Beno ya dijo que no. El spec
lo pide con todas las letras: "y no me lo vuelve a mostrar".

Aceptado y rechazado silencian distinto, y la diferencia importa:
rechazado (falso positivo) es para siempre; aceptado ("la di de baja")
vale **hasta que aparezca un cargo posterior a la resolución**. Seguir
pagando algo que creías dado de baja es justo el caso en que más
necesitás el aviso.

Aceptar un zombie **desactiva la recurrencia declarada si existe**; si
no existe —el caso de hoy— no da de baja nada y la pantalla lo dice, en
vez de fingir que hizo algo.

### 6.g Los adjuntos entran sin pasar por el recepcionista

Tres de las quince frases reales de Beno empiezan pegando un archivo. El
diseño está en `docs/superpowers/specs/2026-08-10-adjuntos-design.md`; lo
que hay que saber para no romperlo es esto.

**Con adjunto no se llama al recepcionista, y ese es el punto.** Que haya
un archivo es un **hecho**, no una interpretación, y qué pase le toca lo
dice el MIME. Así el prompt de vidrio de §9 **no se toca ni hay que
volver a medirlo**. Si alguna vez aparece la tentación de agregarle al
prompt una línea sobre archivos, la respuesta es que no hace falta: las
líneas léxicas que hoy mandan "pdf" / "capturas" / "te paso" a
`desconocido` siguen sirviendo para el caso distinto y real de nombrar un
archivo **sin** pegarlo.

Es además la contención de la inyección por prompt, que acá pesa más que
en el MCP (§8) porque un PDF bajado de internet sí es material de
terceros: nada del contenido llega al recepcionista, **este camino no
tiene rama de movimientos** y todo termina en `inbox` como `pendiente`.
El peor caso posible sigue siendo una propuesta basura.

**`attachments` es una antesala, no una tabla de dominio.** Que exista
una fila no cambia ni un peso de un balance, ni una lección, ni una
entrada de bitácora. Y adentro de `texto_extraido` conviven dos cosas de
naturaleza distinta: de un PDF es **extracción mecánica**, de una imagen
es **producción de un modelo**. Por eso una captura no escribe nunca
directo en `daily_log`, aunque se parezca a lo que hace
`agentes/bitacora.ts`: ahí el texto es de Beno palabra por palabra y acá
no.

**Varios archivos por mensaje, y el pase es retomable por adjunto.** Beno
escribió "te paso capturas", en plural. Cada adjunto es su propia unidad
de trabajo y su propio estado, así que **si la tercera falla, las dos
primeras ya están en la bandeja**. Adentro de un PDF vale lo mismo por
trozo: `trozos_hechos` y `resumenes` se persisten llamada a llamada, o
"retomable" sería mentira —una corrida cortada volvería a pagar las
quince llamadas que ya hizo—. `resumenes` no estaba en el spec y es lo
que sostiene esa propiedad.

Y los dos cortes se tratan distinto, que es lo que hace que la pantalla
no entre en un bucle: **por tiempo** vuelve a llamar sola, **por falla
del modelo** frena y ofrece un botón. Lo dice `cortePorTiempo` en el
reporte, no el texto del mensaje.

| Falla | Qué pasa |
|---|---|
| La salida no valida contra el esquema | Ese adjunto queda en `error` con el detalle, se deja una fila de `inbox` en `error` y **el pase sigue** con los demás |
| Cuota, red o timeout | El adjunto vuelve a `pendiente` y el pase corta. El archivo ya está guardado |
| PDF sin capa de texto | `no_procesable`, **cero llamadas al modelo** |
| Captura ilegible | El modelo contesta `legible: false`. `no_procesable`, y no se propone nada |

**Medido el 2026-08-10 contra Groq, corriendo el pase real:**

| Caso | Resultado |
|---|---|
| Captura de WhatsApp en español (1170×1600) | **2198 + ~670 tokens**, ~3 s. Transcripción fiel: nombres, orden y el "340 legajos" |
| Tres capturas seguidas | **62 s**, con el limitador esperando 31 s antes de la tercera. **Sin un solo 429** |
| Ruido puro | `legible: false` y describió lo que había. **No inventó ninguna conversación** |
| PDF de 4 páginas | 1 trozo con el chico + 1 síntesis con el razonador, 3 s, 4 lecciones propuestas |
| PDF sin capa de texto | `no_procesable` en 0 s, sin tocar el modelo |

Ojo con el número que cambia respecto del spec: son **~2 capturas por
minuto, no 3**. El spec midió con un prompt más corto; con el real la
reserva es de ~3570 tokens contra un techo de 7300. Seis capturas son
unos dos minutos y medio, que sigue entrando en el presupuesto de 240 s
de una corrida.

**La vara del PDF es la de 6.3, no la del extractor de bitácora.** La
vara baja de §6 existe porque el extractor reescribe lo que Beno vivió y
escribió. Un PDF de un tercero no es eso: es material ajeno del que el
modelo **produce** afirmaciones, y ahí el falso positivo cuesta lo mismo
que en 6.3. Las reglas de título de `lib/adjuntos.ts` y las de
`lib/generacion.ts` están escritas dos veces a propósito —el contexto es
distinto— pero **son la misma vara**: si se afloja una, hay que aflojar
la otra.

**El caso C del spec (presupuestos) no entra, y se contesta con la
verdad.** Un test sobre un string en `agentes/adjuntos.ts` detecta la
palabra, guarda el archivo igual y dice que la app todavía no sabe hacer
presupuestos. Cero tokens. Va en código y no en el prompt por lo que dice
§9.

### 7. Ninguna feature de LLM puede ser bloqueante

Si Groq está caído o se acabó la cuota, **la app sigue funcionando entera
en modo manual**. Cargar un gasto, escribir una lección y registrar la
bitácora tienen que andar sin el modelo, siempre. El error se muestra
discreto y no interrumpe el flujo.

Lo mismo vale para el buscador: si el embedding falla o tarda, la
búsqueda responde igual solo con full-text y **eso no es un error**.

### 8. El MCP se construye en dos tiempos, y el corte está en quién escribe

La sección 12 del spec pide un servidor MCP nativo para operar Pepe
desde Claude Code, y dice que hay que esperar a que Beno use la app con
datos reales. La razón es buena —la forma de las herramientas depende de
cómo pide las cosas, y sin uso se diseñan sobre suposiciones— pero
tomada al pie de la letra se muerde la cola: **el MCP puede ser
justamente lo que haga que la use.** Cargar un gasto llenando un
formulario compite mal contra decirlo en una línea.

Por eso el corte no es temporal, es por **quién termina escribiendo en
la base** (decidido con Beno el 2026-08-09):

- **Ahora, las lecturas.** Balance, búsqueda de lecciones, bitácora,
  roadmap. No escriben nada, así que no tienen que resolver la regla
  número uno y si el diseño sale torcido se rehace sin costo.
- **Ahora también, las escrituras que solo proponen.** Un tool que deja
  la fila en `inbox` como `pendiente` **no viola la regla 6**: sigue
  siendo Beno el que aprieta el botón, en la misma bandeja de siempre.
  No hay que inventar un mecanismo de confirmación nuevo; ya existe.
- **Después, con uso encima**, la escritura directa —si alguna vez se
  quiere— y absorber 6.3, 6.4 y 6.5. Ahí sí hace falta haber medido.

La regla que ordena todo esto: **un tool de MCP que escriba en una tabla
de dominio sin pasar por `inbox` es una violación de la regla 6**, no un
atajo. Si aparece la tentación, la respuesta es proponer, no escribir.

**El servidor es local y por stdio** (`mcp/servidor.mts`, lo arranca
Claude Code; `.mcp.json` lo declara). No es una ruta de la app, y eso
fue una decisión de seguridad de Beno: un `/api/mcp` público es un
endpoint de internet donde lo único que te separa de un atacante es un
token estático, y si se filtra una vez el que lo tenga se lleva todo el
detalle financiero sin que te enteres. Local no tiene URL, así que no
tiene superficie. El acceso desde afuera no hacía falta: Claude Code
corre en su máquina.

Ese diseño también contiene la **inyección por prompt**, que es más
probable que un ataque dirigido: si un texto de la base trae
instrucciones escondidas, el peor caso posible es una bandeja con
propuestas basura que se rechazan con una tecla. Nadie puede corromper
un movimiento porque no existe el camino.

**Ojo con lo que se puede importar.** El MCP no corre dentro de Next, así
que **no puede importar ninguno de los módulos marcados con
`server-only`** — son 11, entre ellos `queries.ts` — ni nada que use
`next/headers`. Lo que sí importa, y es lo que importa: los módulos
puros con las reglas de dominio (`aprendizaje`, `balances`, `prorrateo`,
`fx`, `dates`, `format`, `schemas`, `quiz`).

Para saber cuáles son, buscá el import y no la palabra:
`grep -lE '^import "server-only"' src/lib/*.ts`. Buscar el texto suelto
da falsos positivos — `aprendizaje.ts` menciona `server-only` en un
comentario justamente para decir que **no** lo usa. Por eso `mcp/datos.mts` reescribe **las
consultas**, que son triviales, y **ninguna regla**: el prorrateo sigue
teniendo un solo lugar donde vive.

Y por eso mismo `mcp/datos.mts` lee los proyectos igual que
`app/(app)/layout.tsx` —sin filtrar `archivado_en`, ordenados por
nombre—: filtrar ahí haría que el MCP conteste números distintos a los
de la pantalla.

### 9. La capa de agentes, y por qué su prompt es de vidrio

`src/lib/agentes/` es la puerta en castellano de la app: Beno escribe una
frase, el **recepcionista** la clasifica y el **despachador** llama al
especialista. Vive en la pantalla de inicio y en `Ctrl+J` (no `Ctrl+K`:
esa ya es la carga rápida de movimientos).

| Archivo | Qué |
|---|---|
| `agentes/tipos.ts` | Los doce destinos, el esquema de la decisión, la unión de respuestas |
| `agentes/recepcionista.ts` | Frase → lista ordenada de decisiones |
| `agentes/cadena.ts` | Las ejecuta en orden y contiene los fallos |
| `agentes/despacho.ts` | Un `case` por destino, cáscara sobre lo que ya existe |
| `agentes/resolver.ts`, `rango.ts`, `fechas.ts`, `movimientos.ts` | Resolución **determinística**: proyectos, tracks, rangos, fechas, el formato telegráfico |

**Regla que ordena todo: si algo se puede resolver sin modelo, se
resuelve sin modelo.** El signo de `-20usd Claude Code 06/08` dice que es
un egreso; el nombre de un proyecto se busca en tres filas; "el mes
pasado" es aritmética de calendario. Las cinco frases telegráficas reales
de Beno se parsean con **cero llamadas**.

**Multi-acción es seguro por una razón concreta**: nada entra al dominio
sin confirmación, así que una frase con tres pedidos son tres propuestas
y si la segunda falla quedan dos. No hay transacción que deshacer. La
excepción es `bitacora` y `tema_estudio`, que **escriben directo** — y
pueden hacerlo porque **no hay producción de un modelo**: el texto y el
título los pone Beno, el modelo solo recorta y fecha. Si a esos prompts
alguien les agrega "mejorá" o "resumí", el razonamiento deja de valer y
pasan a necesitar la bandeja.

#### El prompt del recepcionista es de vidrio. Cuatro veces medidas.

**Agregarle texto rompe casos que no tienen nada que ver, aunque no los
nombres.** No es una sospecha, son cuatro incidentes con medición:

1. Poner `"pricing"` como ejemplo subió la confianza de `"pricing"` suelto
   de 0.3 a 0.8.
2. Un párrafo más largo, sin nombrar ninguna ancla, subió `"Proder"` de
   0.3 a 0.8. **Diluir la regla mecánica alcanza.**
3. El mismo texto **movido de lugar** lo arregló: el bloque de confianza
   tiene que quedar **último**. La posición pesa tanto como el contenido.
4. Doce líneas en prosa subieron dos anclas a 0.8 **y** hicieron que el
   argumento de una frase telegráfica volviera reescrito y sin la fecha.
   Las mismas dos reglas en **seis líneas y léxicas** (listas de palabras,
   no descripciones) pasaron limpio.

Por eso: **antes de tocar ese prompt, medí; después de tocarlo, volvé a
medir.** El piso de regresión son las cuatro ambiguas sueltas
(`"Claude Code"`, `"Proder"`, `"pricing"`, `"Vercel Pro"`, todas por
debajo de 0.6) y las seis simples con **una sola acción** cada una. Y si
la regla que querés agregar se puede resolver con un test sobre un string
en `despacho.ts`, hacelo ahí — como `textoDelMovimiento()`.

**Lo que se mide no es el acierto, es el modo de fallar.** La calibración
del 2026-08-10 contra las quince frases reales de Beno pasó de 11/15 con
**cuatro errores silenciosos** a 14/15 con **cero**. Un destino
equivocado con confianza baja pregunta y se corrige; con confianza alta
te contesta cualquier cosa con seguridad. Lo segundo es lo inaceptable, y
aparecía justo en las frases que piden algo que la app no hace.

**El umbral de 0.6 es circular** y conviene saberlo: el prompt le enseña
el número al modelo y el código compara contra ese mismo número. No se
está midiendo incertidumbre, se le está pidiendo al modelo que elija de
qué lado caer. Explica por qué la calibración es tan frágil.

## Respaldo automático

Además del botón de Ajustes, hay un respaldo **diario y automático**:
`/api/cron/respaldo` (mismo contenido que `/api/respaldo`, pero con
`CRON_SECRET` y `createAdminClient()` porque corre sin usuario).

**No está en `vercel.json` a propósito.** El que lo agenda es un workflow
de GitHub Actions que vive en el repo privado `bdallago/pepe-respaldos`,
que es también donde se guarda. No es por falta de crons —la cuenta es
Pro— sino porque así **agendar y guardar son el mismo paso**: un cron de
Vercel tendría que pushear a GitHub por su cuenta, con un token de
GitHub guardado en Vercel y el disparador corriendo en la misma
plataforma que respalda.

Es un solo `respaldo.json` que se sobrescribe; **el archivo histórico es
el historial de git**. Y el workflow **valida antes de commitear** —HTTP
200, JSON parseable, marca `__pepe`, conteos distintos de cero—: como el
archivo es uno solo, un JSON roto committeado se llevaría puesto el
último respaldo bueno, en silencio, y te enterarías el día que lo
necesitás.

### Los comprobantes van al lado del JSON, no adentro

Los adjuntos de los movimientos viven en un bucket privado, no en la
base, así que el JSON no los cubría: la frase del encabezado de
`lib/respaldo.ts` era falsa para ellos. Ahora `/api/cron/respaldo` trae
el **inventario** (`.comprobantes`) y `/api/cron/comprobantes` las **URLs
firmadas** para bajarlos.

**Son dos rutas porque las URLs firmadas no pueden terminar en el repo.**
`respaldo.json` se commitea, y una credencial en el historial de git
queda publicada para siempre aunque venza en una hora. Lo que se guarda
no lleva firmas; lo que lleva firmas no se guarda.

**Los bytes se guardan como archivos sueltos, nunca en base64 adentro del
JSON.** `respaldo.json` se reescribe entero todos los días: un adjunto
adentro entra en el blob de cada día y git guardaría una copia nueva del
mismo PDF cada 24 horas, para siempre. Suelto, el path lleva un uuid y no
cambia nunca, así que git lo guarda una sola vez y el workflow ni lo
vuelve a bajar. Además base64 infla un 33 % y le saca a git la
posibilidad de comprimir.

Lo que sí es indispensable que viaje en el JSON es la **relación
comprobante ↔ movimiento**: un archivo suelto con nombre de uuid no le
sirve a nadie. Va en `.comprobantes.archivos[]` y se copia en
`comprobantes/MANIFIESTO.json`, al lado de los bytes.

El inventario cruza las dos direcciones y las trata distinto:

- **huérfano** (archivo sin movimiento): se respalda igual y se cuenta
  aparte. Pasa cuando se sube un comprobante y se cancela el formulario.
- **faltante** (movimiento cuyo archivo ya no está en el storage): el
  comprobante se perdió y ningún respaldo lo trae de vuelta, pero
  callárselo sería peor. El workflow lo convierte en un error visible y
  el job termina en rojo. La forma honesta de cerrar el aviso es dejar en
  `null` ese `comprobante_path`.

Con los comprobantes el workflow **commitea primero y falla después**, al
revés que con las tablas: perder el respaldo del día entero porque un PDF
no bajó sería cambiar una pérdida chica por una grande. El mail de
GitHub llega lo mismo.

`VERSION_RESPALDO` pasó a **2** y el workflow lo usa de puerta: con
`version < 2` avisa y saltea el paso (la app todavía no se desplegó), con
`version >= 2` la falta de inventario es un error. Así no hay ventana
rota entre el merge y el deploy, ni un agujero permanente después.

### ⚠ El bucket `adjuntos` todavía no lo baja nadie

Con la etapa de adjuntos apareció un **segundo bucket privado**
(`adjuntos`, los archivos que Beno pega en la caja). Del lado de la app
está todo hecho: `VERSION_RESPALDO` pasó a **3**, `attachments` está en
`TABLAS`, `respaldo.json` trae `.adjuntos` con el inventario y
`/api/cron/comprobantes` devuelve las URLs firmadas bajo una clave
`adjuntos` **nueva y al lado de `archivos`**, para no cambiarle el
significado a una clave que el workflow ya usa.

**Falta el `for` del otro lado.** Hasta que el workflow de
`bdallago/pepe-respaldos` recorra también `adjuntos`, esos bytes no se
están guardando en ningún lado. Es un cambio de cinco líneas, calcado del
que ya hace con los comprobantes, y hay que hacerlo: un respaldo que uno
cree tener y no tiene es peor que no tenerlo.

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
  argentina abre sin pasar por el asistente de importación. **Convive con
  el respaldo JSON, no lo reemplaza**: el spec decía "pasa a ser", pero
  son dos usos distintos y Beno eligió quedarse con los dos. El JSON es
  la red de seguridad; el CSV es para mirar los movimientos en Excel.
- El **respaldo** (`lib/respaldo.ts`) es la única lectura de la app que
  **no filtra lo archivado**, y la única que pagina de a 1000. Sin
  paginar, una tabla de más de mil filas se exportaría cortada sin
  ningún error visible, que es la peor forma posible de fallar en un
  backup. Si agregás una tabla al esquema, agregala a `TABLAS`; si
  agregás un bucket, acordate de que `TABLAS` no lo cubre —ver "Los
  comprobantes van al lado del JSON"—.
- Server Actions devuelven `ActionResult<T>` (`{ ok, data } | { ok, error }`),
  nunca lanzan para errores esperables.
- `createAdminClient()` saltea RLS. Solo lo usan el cron y la
  actualización forzada de cotización.

## El nombre viejo

La app se llamó **"Balance de proyectos"** y el paquete, `app-gastos`.
El 2026-08-08 se limpió: título, metadata, login y `package.json` dicen
**Pepe**, y también se renombró la infraestructura:

| Dónde | Antes | Ahora |
|---|---|---|
| Repo | `bdallago/balance-proyectos` | `bdallago/pepe` |
| Vercel | proyecto `balance-proyectos` | proyecto `pepe-beno` |
| URL | `balance-proyectos.vercel.app` | **`pepe-beno.vercel.app`** |
| Supabase | proyecto `balance-proyectos` | proyecto `Pepe` |

`pepe.vercel.app` y casi todas las variantes cortas estaban tomadas por
terceros; `pepe-beno` estaba libre. El **ref de Supabase no cambió**
(`thlocwmhxzqkmmnxmunf`): es inmutable, así que renombrar el proyecto
allá es puramente cosmético y no toca ninguna URL de la base.

Al cambiar la URL hay que actualizar **`site_url` y `uri_allow_list` en
Supabase Auth** o el login deja de andar. Google OAuth **no** se toca:
apunta a la callback de Supabase, que no depende del dominio de la app.

Sobrevive una sola mención, **a propósito**: las claves de
`localStorage` (`app-gastos:moneda`, `app-gastos:ultimo-proyecto`).
Están escritas en el browser de Beno y renombrarlas no migra nada, solo
le resetea la moneda y el último proyecto elegidos. No las "arregles".

Lo mismo con **"HRKit"**, el nombre viejo de Gentius. El temario
importado se renombró (1 track, 8 bloques, 36 sesiones), pero **la
entrada de bitácora que lo menciona quedó intacta**: es registro de lo
que Beno pensó ese día y ese día el proyecto se llamaba así. Ojo: el
backup de origen sigue diciendo HRKit, así que **volver a correr
`npm run import:colmena` pisaría el renombre**.

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
