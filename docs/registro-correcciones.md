# Registro de correcciones

> Convención (sistema documental estándar de Beno): arriba un resumen del **estado actual** con
> fecha; abajo el **historial** completo en entradas de 1-2 líneas, de la más reciente a la más
> vieja; el detalle largo va a [`archivo/`](archivo/), no acá. Lo mantiene `/actualizar`.
>
> Se llama **registro** y no "bitácora" a propósito: en Pepe, Bitácora es una sección del
> producto (con datos reales del usuario y una tool `escribir_bitacora` que escribe en firme).
> Esto otro es el historial de bugs y correcciones del desarrollo.

## Estado actual (2026-08-11)

**En producción no hay bugs conocidos abiertos.** La app sigue con las tres pantallas de balance
diciendo el mismo número y el invariante `suma(por proyecto) === balance general` cerrando exacto
en ARS y en USD.

**`docs/superpowers/plans/2026-08-11-operar-conversando.md` está TERMINADO —las once tareas— y
MERGEADO A `main` el 2026-08-11**, con `typecheck`, `lint` y `build` limpios. La ola 1 arregla dos
bugs que **sí llegaron a producción** —el sumidero de bitácora y el proyecto del movimiento—,
agrega el destino `proyecto` y recalibra el recepcionista midiendo. La ola 2 suma
tres tools al conector (`registrar_nota`, `registrar_proyecto`, `registrar_presupuesto`) y sus
tres tipos de bandeja. La migración `20260812000000_bandeja_dictados.sql` está aplicada.

Todo verificado corriendo, no leyendo: las tres tarjetas nuevas renderizadas contra el server real
con una sesión de admin, y las tres actions de aceptación invocadas por HTTP. El presupuesto
dictado salió en **5.750.000 ARS = 115 h × 20.000 × 2,5**, calculado por la app y no por el modelo.
Los datos de prueba se borraron y la base quedó como estaba.

⚠ **De ese trabajo salió el hallazgo metodológico de la sesión, y vale más que cualquiera de los
bugs**: el plan se escribió midiendo y aun así trajo **ocho defectos**, todos silenciosos. Los
ocho los encontró una revisión que **corrió el código**; ninguno se veía leyendo. Están listados
en la sección "Correcciones de la ejecución" del plan, que **gana sobre el código que figura en
sus tareas**.

La tanda del 2026-08-11 salió toda del mismo lugar: implementar el reparto por fecha destapó
correcciones en cascada, y la mayoría **no fallaban a la vista** — devolvían números plausibles o
frases seguras y equivocadas. Es el modo de fallar que más caro sale en este proyecto (ver el BOM
de la key de Groq, 16 horas caído en silencio) y por eso todas se verificaron midiendo contra la
base real, no leyendo.

Queda **una deuda conocida, sin dueño y fuera de la app**: el workflow del repo
`bdallago/pepe-respaldos` todavía no recorre el bucket `adjuntos`, así que esos bytes no se están
respaldando. Del lado de Pepe está todo hecho desde hace días.

## Historial

- **2026-08-11 — El destino `proyecto` decía "Cambié la ventana" sin haber cambiado nada.** Corriendo
  el criterio de aceptación contra la app: la frase del fallo 1 dejaba el cierre en 20/07 cuando pedía
  31/07, y contestaba igual que si lo hubiera movido. Dos causas apiladas. Una, el lector se comía la
  **segunda** fecha: Beno escribe las dos marcas ("…01/04/26 apertura y 31/07/26…") pero **el
  recepcionista reformatea el argumento** a `"Proder 01/04/26 - 31/07/26"`, sin ninguna, y sin marcas
  se leía una sola. Dos, y peor: la respuesta no comparaba contra lo que había. Ahora dos fechas
  sueltas se leen como apertura y cierre, y si nada cambió la respuesta lo dice — esa red se queda
  aunque el lector esté arreglado.
- **2026-08-11 — El fallo 3 del conector no fue un error del modelo, y por eso la corrección fue
  darle capacidad.** Ante *"cargá todo lo que charlamos sobre el Agente de RRHH"*, Claude **se frenó
  solo**: explicó que ese proyecto no existía y que el conector no podía crearlo, y avisó que lo que
  iba a cargar era **un resumen suyo y no la voz de Beno** — que es exactamente la condición bajo la
  cual `escribir_bitacora` tiene permiso de escribir directo, detectada sola. Faltaba capacidad, no
  criterio. De ahí salieron `registrar_proyecto`, `registrar_presupuesto` y `registrar_nota`; esta
  última es la que **sostiene** la excepción de `escribir_bitacora`, porque hasta que existió un
  resumen del modelo no tenía a dónde ir.
- **2026-08-11 — El botón de aceptar de una tarjeta nueva nace apagado para siempre.** El `disabled`
  cae a `!mostrada`, que es `borrador ?? propuesta`, o sea `null` para todo lo que no sea una
  lección. Lo mismo con `faltaProyecto`, que le pediría un proyecto a un ítem que **es** el proyecto.
  Sumar un tipo de tarjeta toca cinco lugares y cuatro fallan en silencio; están listados en el
  manual agéntico.
- **2026-08-11 — La pregunta de "¿de qué proyecto?" podía quedarse sin salida.** `reemplazarNombre()`
  hacía `.replace()` con el nombre **ya limpiado**, y `limpiarNombre()` cambia `[.,;:]` por espacios
  y colapsa los repetidos: contra `"cerrá  Mi   App  S.A."` el nombre leído es `"Mi App S A"`, que no
  está literal en el argumento. El replace devolvía el texto igual, la respuesta volvía a no resolver
  y la app repreguntaba lo mismo **para siempre**. La red es prependear el slug, no appendearlo: al
  final lo pierde la primera marca de ventana.
- **2026-08-11 — El prompt del recepcionista mandaba `"cerrá Proder"` a `retro` a propósito.** El
  bullet decía textual `Ej: "cerrá Proder"`, así que la colisión con el destino `proyecto` no era
  previsible: estaba escrita. Corregido para que `retro` hable del documento y no del cierre.
  Medido antes y después con dieciséis frases: el piso quedó intacto y las tres frases que fallaron
  el 2026-08-10 se arreglaron juntas.
- **2026-08-11 — `leerFecha()` recortaba al pasado las fechas de un proyecto.** `"30/12"` volvía
  como diciembre **del año pasado** y `"2027-01-15"` como hoy, las dos en silencio. Está bien para
  bitácora y movimientos —registran lo que ya pasó— y mal para una ventana, que se puede abrir el
  mes que viene: ahora hay `{ futuro: true }` y el destino `proyecto` es el único que lo pasa.
- **2026-08-11 — La bitácora era el sumidero de todo lo que la app no sabe hacer.** Tiene el gancho
  léxico más ancho y es el único destino que escribe directo: un pedido no cubierto terminaba en una
  fila escrita, y pasó — pedir las fechas de dos proyectos dejó dos entradas con el contenido
  `"Proder"` y `"El Prode"`. Ahora `pareceAnotacion()` pregunta en vez de escribir.
- **2026-08-11 — El movimiento buscaba el proyecto solo en la descripción extraída.** "Anotame
  -20usd en Claude Code en el proyecto Gentius" tiene descripción `"Claude Code"`, así que "Gentius"
  nunca entraba en la comparación y el gasto se iba a Compartido en silencio. Ahora se busca en el
  texto entero y, si no se sabe, se pregunta.
- **2026-08-11 — Ocho defectos del plan de "operar conversando", todos silenciosos y todos hallados
  corriendo código.** Los más caros: los regex de verbos no matcheaban **ninguna forma acentuada**
  (`\b` de JS se define contra `\w`, que excluye "á"), así que `cerrar`/`reabrir`/`crear`/`renombrar`
  caían todos al default; y con una sola marca de apertura la fecha se escribía en `cierre`, o sea
  que un proyecto que arranca el mes que viene nacía cerrado. Ninguno llegó a producción. El detalle
  está en el plan.
- **2026-08-11 — El argumento de una pregunta podía tirar el movimiento a la basura.** Viaja como
  `"<texto> — <slug>"` y `route.ts` lo capaba en 300: una frase de 298 producía un argumento de 317
  → HTTP 400 → "No pude procesar eso", y había que retipear todo. Subido a 1100.
- **2026-08-11 — Tres caminos de cálculo daban tres números distintos.** La grilla decía que Proder
  tenía US$ 330,96, el encabezado de su pantalla 330,91 y la suma de las filas 330,91: la grilla
  repartía centavos enteros y los otros dos redondeaban por fracción. Se unificó moviendo el reparto
  entero a `prorrateo.ts`; ahora los tres dan idéntico, con diferencia cero exacta.
- **2026-08-11 — El chequeo que debía atrapar eso pasaba por suerte.** Comparaba contra `< 0.05` y
  la diferencia real era `0.04999999999995453`: pasaba por representación de punto flotante, no por
  margen. Se arregló la causa en vez de aflojar la vara.
- **2026-08-11 — `sugerencias.ts` pedía una columna que estaba por borrarse.** Un
  `select("id, nombre, activo")` que ningún grep veía (es un literal) y que el typecheck solo habría
  detectado después de regenerar los tipos. Como ese call site ignora `.error` y usa `data ?? []`,
  habría dejado la sugerencia de qué estudiar diciendo "Proyecto archivado" para todos los
  proyectos, sin quejarse.
- **2026-08-11 — El conector le mentía al modelo sobre los gastos compartidos.** Contestaba "Proder
  no participa del reparto" cuando $146.228 de sus $154.728 de egresos son su parte prorrateada — el
  94,5 %. Preguntaba "¿participa hoy?" cuando lo que hacía falta era "¿algo de esto lleva parte de
  un compartido?". Se corrigió en las dos superficies (local y remoto) con un flag nuevo.
- **2026-08-11 — Cargar un gasto en un proyecto cerrado lo mandaba a "Compartido" en silencio.**
  `despacho.ts` filtraba por estado al resolver el proyecto. Le pasó a Beno el 2026-08-10 con
  Gentius. Un gasto de un proyecto cerrado va a ese proyecto: para eso se cerró en esa fecha.
- **2026-08-11 — El recuadro que simula el prorrateo de un presupuesto mentía dos veces.** Simulaba
  contra `hoy` cuando la fecha del formulario es editable y es la que se inserta; y al arreglarlo,
  mostraba rangos idénticos para decisiones distintas (retroceder al 01/04 alcanza 15 gastos y al
  01/06 alcanza 7). Ahora, cuando el rango cruza más de un régimen, dice en palabras que no hay un
  reparto solo en vez de inventar un número.
- **2026-08-11 — El botón de cerrar y reabrir un proyecto no existía.** `alternarProyectoActivo`
  estaba escrita en las actions desde siempre y nunca había estado enganchada a ninguna pantalla.
  Se enganchó, y mira `fecha_fin` mientras el badge mira `estaVivo()`: son dos preguntas distintas y
  unificarlas impedía deshacer un cierre el mismo día.
- **2026-08-11 — El formulario de proyecto no validaba las fechas cruzadas.** Poner el cierre antes
  del inicio no lo frenaba el formulario: lo frenaba Postgres, y lo que veía Beno era el texto crudo
  de una violación de check constraint. Ahora lo dice en castellano.
- **2026-08-11 — `mcp/servidor.mts` comparaba `> 0` donde los otros cuatro avisos comparan `!== 0`.**
  Con un ingreso compartido sin repartir el neto da negativo y ese aviso —solo ese— no aparecía.
