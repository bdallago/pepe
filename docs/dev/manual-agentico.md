# Pepe — manual agéntico

Para modelos que van a tocar este código. Denso a propósito.

**Qué complementa.** `AGENTS.md` dice **por qué** las cosas son como son y
qué no hay que romper; este manual dice **dónde está cada cosa y qué toca
cuando la movés**. Si los dos se contradicen, gana `AGENTS.md`.

**No es generado: se edita a mano.** Lo mantiene `/actualizar` cuando una
funcionalidad cambia de forma — pantalla nueva, action nueva, tabla nueva.
Este proyecto **no tiene índice estructural generado** y no hace falta uno:
`rg` sobre `src/` alcanza.

**Ruta de lectura para un agente que llega:** este manual (qué hay y dónde)
→ `AGENTS.md` (por qué, y las trampas) → el spec de la feature en
`docs/superpowers/specs/` si existe.

---

## Las siete reglas que aplican a todo

Están desarrolladas en `AGENTS.md`; acá van en una línea para poder
chequearlas rápido antes de escribir código.

1. **El tipo de cambio se congela.** `movements` guarda el par ARS/USD y
   la tasa usada. Nunca recalcular montos históricos. La única
   recotización de la app es `efectuarMovimiento()`.
2. **El prorrateo se calcula al vuelo.** `project_id = null` es
   compartido. Nunca se guardan filas duplicadas. Invariante:
   `suma(balance por proyecto) === balance general`.
3. **Archivar, no borrar.** Todo el módulo de aprendizaje lleva
   `archivado_en`. Lo archivado sale de las listas pero **sigue en la
   búsqueda**.
4. **Nada se escribe sin confirmación.** Lo que produce un modelo va a
   `inbox` como `pendiente`. Las excepciones son dos y tienen nombre:
   `agentes/bitacora.ts` y `escribir_bitacora` del conector, porque ahí el
   texto es de Beno y no hay producción de modelo.
5. **Ninguna feature de LLM puede ser bloqueante.** Si Groq está caído la
   app anda entera en manual. El buscador sin embedding no es un error.
6. **Si se puede resolver sin modelo, se resuelve sin modelo.** Fechas,
   nombres de proyecto, rangos y el formato telegráfico son
   determinísticos.
7. **Tablas y FKs en inglés, columnas y enums en castellano.**
   `movements.descripcion`, `lessons.categoria`. No lo "arregles" en una
   tabla sola.

Y dos convenciones de código: las Server Actions devuelven
`ActionResult<T>` (`{ok, data} | {ok, error}`) y **nunca lanzan** para
errores esperables; `createAdminClient()` saltea RLS y solo lo usan los
crons, la cotización forzada y el conector MCP.

---

## Finanzas

### Movimientos

| | |
|---|---|
| **Qué hace** | Ingresos y egresos con el par ARS/USD congelado al cargar. |
| **Dónde se usa** | `/movimientos`, más la carga rápida con `Ctrl+K`. |
| **Entrypoints** | `lib/actions/movements.ts`: `crearMovimiento`, `actualizarMovimiento`, `borrarMovimiento`, `efectuarMovimiento`. |
| **Lógica** | `lib/fx.ts` (`congelarMontos`, `montoEnMoneda`), `lib/schemas.ts` (`movementSchema`). |
| **Estado** | `movements`, y el archivo del comprobante en el bucket privado `comprobantes`. |

**Trampas.** El formulario muestra ARS y USD a la vez y el campo que se
escribe define `moneda_origen`; el efecto que recalcula el derivado
**excluye a propósito** `monto_ars`/`monto_usd` de sus dependencias
(`movement-form.tsx`), porque incluirlos pisaría lo que se está tipeando.
Y las Server Actions **no pisan la tasa que manda el formulario**: el
usuario puede forzar una cotización distinta.

### Proyectos y prorrateo

| | |
|---|---|
| **Qué hace** | `projects` es la entidad raíz de **toda** la app, no solo de finanzas. Los gastos sin proyecto se reparten entre los que estaban **vivos en la fecha de cada gasto**. |
| **Dónde se usa** | `/proyectos`, `/proyectos/[slug]`, y el panel de Ajustes. |
| **Entrypoints** | `lib/actions/projects.ts`: `crearProyecto`, `actualizarProyecto`, `borrarProyecto`, `alternarProyectoActivo` (el botón Cerrar/Reabrir de Ajustes). |
| **Lógica** | `lib/prorrateo.ts`: `estaVivo()`, `calcularParticipaciones(projects, fecha)`, `memoParticipaciones()`, `cortesDelReparto()`, `repartirPorRestoMayor()`. `lib/balances.ts` consume todo eso. |
| **Estado** | `projects`, con la ventana `fecha_inicio`/`fecha_fin`. **La columna `activo` ya no existe** (borrada el 2026-08-11). |

**Trampas.** ⚠ **La ventana es la única fuente de verdad**: no hay
bandera. `estaVivo(p, fecha)` es lo que antes decía `activo`, pero contra
una fecha, y es **inclusivo en las dos puntas**. `fecha_inicio` nula es
"desde siempre", `fecha_fin` nula es "sigue abierto".
⚠ **`calcularParticipaciones(projects, fecha)` no tiene default en
`fecha`, a propósito**: un default a hoy dejaría compilar un call site
olvidadizo que repartiría el histórico entero con la foto de hoy — el bug
original, y de los que no se ven porque contesta números plausibles.
⚠ **El reparto vive entero en `prorrateo.ts` y hay TRES caminos que lo
usan**: la grilla (`calcularBalances`), el encabezado del proyecto
(`calcularBalancesProyecto`) y las filas (`imputarAProyecto`). Los tres
pasan por `repartirEntreParticipantes()`, que devuelve un **`Map` por
`projectId`** y no un array posicional, justamente para que ninguno pueda
desalinear el emparejamiento. Si alguno vuelve a redondear por fracción
(`round2(monto * fraccion)`), las tres pantallas dejan de decir el mismo
número — ya pasó, ver el registro de correcciones.
⚠ **Las dos monedas se reparten por separado.** Derivar una de la otra
reintroduce el problema y además tocaría un monto congelado.
⚠ **En Ajustes, el botón mira `fecha_fin` y el badge mira `estaVivo()`.**
Son dos preguntas distintas y unificarlas hace que un cierre no se pueda
deshacer el mismo día. No lo "arregles".
⚠ **Nunca filtres proyectos por su ventana para decidir si se puede
*escribir* sobre ellos** — la ventana decide quién participa del
prorrateo, nada más. Esa confusión causó dos bugs (`lib/bitacora.ts` lo
documenta, y `agentes/despacho.ts` lo repitió: mandaba a "Compartido" en
silencio los gastos de un proyecto cerrado).

### Categorías, recurrencias y cotización

| | |
|---|---|
| **Categorías** | `/ajustes`. `lib/actions/categories.ts`. Tabla `categories`, con `tipo` que ata la categoría a ingreso o egreso. Se archivan, no se borran. |
| **Recurrencias** | `/recurrentes`. `lib/actions/recurrences.ts` + `lib/recurrences.ts`. Tabla `recurrences`. `generarPendientes` materializa los movimientos planificados. **Al 2026-08-10 hay cero recurrencias declaradas.** |
| **Cotización** | Cron diario `/api/cron/fx`. `lib/fx-server.ts` lee, `lib/actions/fx.ts` fuerza una actualización manual desde Ajustes. Tabla `fx_rates`, **global y sin dueño**. La regla es "la de esa fecha o la última anterior" (`fx_rate_for_date`). |

### Clasificación automática (spec 6.1)

| | |
|---|---|
| **Qué hace** | Propone tipo y categoría al cargar un movimiento. |
| **Dónde se usa** | El formulario, vía `/api/movimientos/sugerir`; y el agente de movimientos. |
| **Lógica** | `lib/clasificacion.ts`. **Orden no negociable**: `sugerir_categoria_historico` (SQL, contra índice) y **solo si no encontró nada**, el modelo chico. |
| **Estado** | Lee `movements` y `categories`. No escribe nada. |

**Trampas.** `movements.descripcion_normalizada` es una **columna
generada**; su expresión y `normalizarDescripcion()` tienen que dar
exactamente lo mismo. El match tiene dos niveles —texto idéntico y
**núcleo** (la descripción sin el mes)— y la función devuelve `exacto`
para que la UI redacte distinto. `p_user_id` es opcional y solo lo usa el
conector, que saltea RLS.

---

## Aprendizaje

| | |
|---|---|
| **Qué hace** | Tracks → bloques → sesiones, con **teoría y aplicación por separado**. Más artefactos, repaso y roadmap. |
| **Dónde se usa** | `/aprendizaje` y sus seis subpantallas: `artefactos`, `lecciones`, `repaso`, `roadmap`, `semana`, `sugerencias`. |
| **Entrypoints** | `lib/actions/study.ts`: `alternarTeoria`, `alternarAplicacion`, `cambiarEstadoArtefacto`, `actualizarTrack`, `crearSesionDesdeSugerencia`. |
| **Lógica** | `lib/aprendizaje.ts` (puro, sin `server-only`), `lib/sesiones.ts`, `lib/quiz.ts`. |
| **Estado** | `tracks`, `blocks`, `sessions`, `artifacts`. |

**Trampas.** Hay checks en la base: `teoria_hecha = (teoria_fecha is not
null)` y lo mismo para aplicación — al marcar se setea la fecha, al
desmarcar se pone null, **nunca uno sin el otro**. Igual con
`artifacts`: `(estado = 'completado') = (fecha_completado is not null)`.
Las sesiones que salen de una sugerencia nacen **sin bloque** y el Roadmap
las junta en un grupo "Agregadas"; sin ese grupo no aparecerían. Y
`tracks.activo` **no es** `projects.activo`: un track en pausa es una
decisión de estudio.

### Lecciones y el buscador

| | |
|---|---|
| **Qué hace** | Búsqueda híbrida: full-text en español + similitud vectorial, fusionados con Reciprocal Rank Fusion. |
| **Dónde se usa** | `/aprendizaje/lecciones`, `/api/lecciones/buscar`, el agente `buscador` y la tool `buscar_lecciones` del conector. |
| **Entrypoints** | `lib/actions/lessons.ts` (`reindexarLeccion`), `/api/lecciones/indexar`. |
| **Lógica** | RPC `buscar_lecciones_hibrido`, `lib/embeddings.ts`. |
| **Estado** | `lessons` (con `busqueda` tsvector y `embedding` vector(768)). |

**Trampas.** El modelo es **`multilingual-e5-base` q8, 768 dimensiones**, y
**exige los prefijos `"query: "` y `"passage: "`** — sin eso la calidad se
cae. El índice es **HNSW y no IVFFlat**. Los pesos (266 MB) **no van al
repo**: los baja `npm run descargar:modelo` dentro del build. El full-text
usa **OR y no AND** a propósito. El RPC es `security invoker` y **no
recibe usuario**: desde el conector hay que filtrar después (ver
`rankearLecciones` en `lib/mcp/datos.ts`).

---

## La bandeja

| | |
|---|---|
| **Qué hace** | El portón por donde entra **todo lo que propone un modelo**, para finanzas y aprendizaje por igual. |
| **Dónde se usa** | `/bandeja`, más el icono con contador al lado de Ajustes. |
| **Entrypoints** | `lib/actions/inbox.ts`: `aceptarLeccion`, `aceptarNotaDeAdjunto`, `aceptarMovimientoDictado`, `aceptarZombie`, `rechazarItemBandeja`, `posponerItemBandeja`, `descartarErrorBandeja`. |
| **Lógica** | `components/bandeja/bandeja-view.tsx` (una tarjeta por tipo). |
| **Estado** | `inbox`. `tipo_bandeja` tiene 8 valores; `estado_bandeja`, 5. |

**Trampas.** Su diseño es requisito del spec, no cosmética: **un ítem por
vez, sin scroll, todo con teclado** (A/R/P/E, swipe en mobile) y la acción
**aplicada en optimista**. El embedding de la lección aceptada **no se
espera**. ⚠ **Al aceptar, `entidad_tabla`/`entidad_id` NO se repuntan** a
la entidad creada — el vínculo hacia adelante va en el payload; repuntarlos
rompió el pase de extracción una vez. `clave_dedupe` se libera al resolver,
**salvo en los zombies**, donde se conserva a propósito.
`categorizacion` es un valor del enum que **nada produce**.

---

## Lo que corre solo, o casi

| Función | Dónde | Qué escribe | Nota |
|---|---|---|---|
| **Extracción de lecciones de la bitácora** | `/api/bandeja/extraer`, botón en la bandeja | `inbox` (`leccion_extraida`) | `lib/extraccion.ts`. **Vara baja a propósito**: "ante la duda, proponela". No apretar. |
| **Generar lecciones sobre un tema** (6.3) | `/api/lecciones/generar` | `inbox` (`leccion_sugerida`) | `lib/generacion.ts`. Razonador. La vara: el título tiene que ser **una afirmación discutible, no un rótulo**. |
| **Sugerir qué estudiar** (6.4) | `/api/aprendizaje/sugerir` | **nada** | `lib/sugerencias.ts`. Única salida de modelo que se muestra directa, porque no escribe. No se guarda: al recargar no está. |
| **Retro de proyecto** (6.5) | `/api/proyectos/retro` | `inbox` + `retros` al guardar | `lib/retro.ts`. El texto vuelve como **borrador editable**; `balance_ars`/`balance_usd` se **congelan** al guardar. |
| **Zombies** | Cron diario `/api/cron/zombies` | `inbox` (`zombie`) | `lib/zombies.ts` + RPC `detectar_zombies`. Detecta sobre **movimientos**, no sobre recurrencias. Umbral 90 días, vigencia 75. |
| **Adjuntos** | `/api/adjuntos/procesar` | `inbox` + `attachments` | `lib/adjuntos.ts`. Retomable por adjunto y por trozo. Solo `qwen` lee imágenes; ninguno lee PDF. |
| **Tarifas de referencia** | Cron semanal `/api/cron/tarifas` | `rate_runs`, `rate_references` | `lib/tarifas.ts`. **Avisa, nunca cambia la tarifa.** |
| **Respaldo** | Cron externo (GitHub Actions) → `/api/cron/respaldo` y `/api/cron/comprobantes` | nada | `lib/respaldo.ts`. Única lectura que **no filtra lo archivado** y la única que pagina de a 1000. |

---

## Presupuestos

| | |
|---|---|
| **Qué hace** | Estima **esfuerzo, nunca precio**; el precio lo calcula la app con la tarifa de Ajustes. |
| **Dónde se usa** | `/presupuestos`, `/presupuestos/nuevo`, `/presupuestos/[id]`, `/presupuestos/[id]/pdf`. |
| **Entrypoints** | `lib/actions/presupuestos.ts`: `crearPresupuesto`, `actualizarPresupuesto`, `marcarEnviado`, `aceptarPresupuesto`, `descartarPresupuesto`, `archivarPresupuesto`. Estimación en `/api/presupuestos/estimar`. |
| **Lógica** | `lib/presupuestos/`, `lib/presupuestos-server.ts`. |
| **Estado** | `quotes`, `quote_items`, `quote_assumptions`, `quote_questions`. |

**Trampas.** Cada entregable trae una **cita literal del pedido**,
verificada por código. La moneda se congela y se congela **una sola vez**.
Aceptar un presupuesto crea un proyecto. El PDF es una hoja de impresión,
no una librería.
⚠ **El recuadro que simula cómo queda el prorrateo usa la fecha del
formulario, no `hoy`** — es editable y es la que se inserta. Y cuando esa
ventana cruza más de un régimen de reparto (hay proyectos que abren o
cierran en el medio), **no muestra porcentajes: muestra una línea que dice
que no hay un reparto solo**. Es deliberado: mostrar rangos daba números
idénticos para decisiones distintas (retroceder al 01/04 alcanza 15 gastos
y al 01/06 alcanza 7, y el panel imprimía lo mismo). Honestidad, no
completitud.

---

## La capa de agentes (la caja)

| | |
|---|---|
| **Qué hace** | Beno escribe una frase, el **recepcionista** la clasifica y el **despachador** llama al especialista. |
| **Dónde se usa** | Pantalla de inicio y **`Ctrl+J`** (no `Ctrl+K`: esa es la carga rápida). |
| **Entrypoint** | `/api/agentes/interpretar`. |
| **Lógica** | `lib/agentes/`: `tipos.ts` (14 destinos), `recepcionista.ts`, `cadena.ts`, `despacho.ts`, y la resolución determinística en `resolver.ts`, `nombres.ts`, `rango.ts`, `fechas.ts`, `movimientos.ts`, `proyectos.ts`. |

⚠ **Al 2026-08-11 la ola 1 está terminada en la rama `operar-conversando`,
sin mergear ni desplegar; falta la ola 2 (las tres tools del conector).**
Lo que sigue describe el estado **de la rama**; `main` todavía tiene 13
destinos y no tiene salvaguarda de bitácora. El plan es
`docs/superpowers/plans/2026-08-11-operar-conversando.md` y su sección
"Correcciones de la ejecución" **gana sobre el código que figura en las
tareas**.

**Trampas.** ⚠ **El prompt del recepcionista es de vidrio: cuatro
incidentes medidos** donde agregarle texto rompió casos que ni nombraba.
Antes de tocarlo, medir; después, volver a medir. Si la regla se puede
resolver con un test sobre un string, va en `despacho.ts`. **Medir cuesta
~8 minutos por corrida**: el prompt son ~2275 tokens contra un techo de
5500/minuto, o sea 2 frases por minuto — y **cada línea que le agregues
sube ese costo**. Los dos agregados que pasaron limpios al primer intento
(`presupuesto` y `proyecto`) usaron la misma receta: pocas líneas,
**léxicas y no en prosa**, y todas **arriba** del bloque de confianza, que
queda último. Y antes de agregar un destino, buscá si el prompt ya dice lo
contrario en algún lado: el bullet de `retro` mandaba `"cerrá Proder"` a
`retro` **a propósito**.
⚠ **`bitacora` era el sumidero** —gancho léxico ancho + escribe directo—
y por eso `agentes/bitacora.ts` tiene ahora `pareceAnotacion()`: menos de
15 caracteres o menos de 3 palabras, **o** coincidencia **exacta** con el
nombre o slug de un proyecto o track, y se pregunta en vez de escribir. El
chequeo de nombre es exacto y **no** `resolverProyecto()`, que matchea
parcial: con parcial, cualquier anotación que mencione un proyecto caería
en la pregunta.
⚠ **`confirmado` es el que corta el bucle** de esa pregunta. Viaja del
browser al despachador y **no está en `decisionBase`** a propósito: si
estuviera, la salida de un modelo podría apagar la salvaguarda.
⚠ **`despacho.ts` ya NO filtra el proyecto por estado** al resolver un
movimiento dictado, y eso es deliberado: un gasto de un proyecto cerrado
va a ese proyecto, que para eso se cerró en esa fecha y no en otra.
⚠ **El proyecto de un movimiento sale del texto de trabajo entero**, no de
la descripción extraída, y si no se sabe **se pregunta** (Compartido es una
opción visible, no el default mudo). La respuesta viaja como
`"<texto> — <slug>"`, con el centinela `__compartido__`, y por eso
`route.ts` acepta `argumento` hasta **1100** y no 300: con 300 una frase
larga devolvía 400 y el movimiento se perdía.
⚠ **`agentes/proyectos.ts` es el módulo más frágil de esta área.** Lee sin
modelo qué se le pide a un proyecto; llevó cuatro vueltas de revisión y
tiene un bloque **"Lo que este lector no cubre"** al final con los bordes
que quedaron a propósito. La causa de fondo está escrita ahí: hace tres
pasadas sobre el string crudo con regex que sirven para propósitos
opuestos. **Leé ese bloque antes de tocarlo.**
⚠ **`leerFecha()` recorta al pasado salvo `{ futuro: true }`**, y el
destino `proyecto` es el único que lo pasa. Sin esa opción, `"30/12"` se
lee como diciembre **del año pasado** y `"2027-01-15"` como hoy — bien
para bitácora y movimientos, que registran lo que ya pasó; catastrófico y
silencioso para la ventana de un proyecto.
⚠ **`EXPRESIONES_DE_FECHA` se exporta desde `fechas.ts`** y se deriva de
las mismas listas que `REGLAS`. Hubo una copia a mano y se separó en los
dos sentidos: nació sin la regla de días de la semana y más ancha que el
original. No la vuelvas a copiar.

---

## Los dos MCP, que no se pisan

| | Local | Remoto |
|---|---|---|
| **Transporte** | stdio, lo arranca Claude Code | Streamable HTTP |
| **Dónde** | `mcp/servidor.mts` (`npm run mcp`), declarado en `.mcp.json` | `/api/mcp` |
| **Auth** | ninguna: no tiene URL, no tiene superficie | OAuth 2.1 con PKCE y registro dinámico |
| **Tools** | 5 de lectura | **8**: 5 leen, 2 proponen a `inbox`, 1 escribe directo |
| **Datos** | `mcp/datos.mts` | `src/lib/mcp/datos.ts` |

**Trampas del local.** ⚠ **No puede importar ningún módulo marcado con
`server-only`** ni nada que use `next/headers`. Para saber cuáles son,
buscá el import y no la palabra:
`grep -lE '^import "server-only"' src/lib/*.ts` — y ojo que ese glob **no
entra a subdirectorios** (`agentes/` tiene tres más). Reescribe **las
consultas**, nunca las reglas.

**Trampas del remoto.** El 401 con `WWW-Authenticate` es **obligatorio**:
Claude no honra ese header en un 200. `/api/mcp`, `/api/oauth/*` y
`/.well-known/*` están **fuera del middleware**. Las tools no ven el
cliente de Supabase crudo: reciben uno acotado por `user_id`, y el tipo
solo deja nombrar tablas con dueño. Detalle en `docs/conector-mcp.md`.

---

## Infra y datos

- **Supabase** ref `thlocwmhxzqkmmnxmunf` (inmutable). Migraciones en
  `supabase/migrations/`, aplicadas hasta `20260810100001_borrar_activo`.
  **Próxima libre: `20260812000000`** — numerala así o más alto, no más
  bajo: las dos del reparto por fecha quedaron con timestamp **anterior**
  a las `20260811…` que ya estaban aplicadas, y hubo que empujarlas con
  `supabase db push --linked --include-all`.
- **Vercel** proyecto `pepe-beno` → https://pepe-beno.vercel.app
- **Buckets privados**: `comprobantes` y `adjuntos`.
- **Verificación** (no hay suite de tests versionada):
  `npm run typecheck && npm run lint && npm run build`, más scripts
  temporales contra la base real que se corren, se confirman y **se
  borran**. Se corren con `npx tsx --conditions=react-server ./script.mts`
  **desde la raíz del repo**.
- ⚠ **No corras `npm run build` con un `next dev` vivo**: comparten
  `.next`. Y ojo: bajar el dev matando el wrapper de npm **deja vivo al
  hijo que escucha en el 3000**. Verificá por puerto, no por proceso.
- ⚠ Al regenerar `database.types.ts` hay que **volver a pegar a mano** el
  bloque de alias del final.
- ⚠ **En los scripts usá `process.exitCode = N`, nunca `process.exit(N)`**:
  en Windows, salir justo después de que se cierra el socket de Supabase
  crashea con un assert de libuv (`UV_HANDLE_CLOSING`). La salida ya se
  imprimió entera, así que parece un fallo del cálculo y no lo es.
- ⚠ **Al borrar una columna, primero desplegá el código que dejó de
  leerla.** La base es una sola y `main` está sirviendo: al revés,
  PostgREST contesta `42703` en `error` con `data: null`, y todo call site
  que no mire `.error` se queda sin datos **sin romperse**.
