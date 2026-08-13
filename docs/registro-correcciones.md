# Registro de correcciones

> Convención (sistema documental estándar de Beno): arriba un resumen del **estado actual** con
> fecha; abajo el **historial** completo en entradas de 1-2 líneas, de la más reciente a la más
> vieja; el detalle largo va a [`archivo/`](archivo/), no acá. Lo mantiene `/actualizar`.
>
> Se llama **registro** y no "bitácora" a propósito: en Pepe, Bitácora es una sección del
> producto (con datos reales del usuario y una tool `escribir_bitacora` que escribe en firme).
> Esto otro es el historial de bugs y correcciones del desarrollo.

## Estado actual (2026-08-13)

**En producción no hay bugs conocidos abiertos.** La app sigue con las tres pantallas de balance
diciendo el mismo número y el invariante `suma(por proyecto) === balance general` cerrando exacto
en ARS y en USD. Verificado el 2026-08-12 corriendo el código de prorrateo de la app: general
**$302.411**, Proder $469.472, Gentius −$12.333, El Prode de Beno −$154.728.

**Desde el 2026-08-12 este documento dejó de ser la única red, y el 2026-08-13 dejó de depender de
que alguien se acuerde de correrla.** Hay `npm test` (69 casos, ninguno toca Groq ni la base) y
`npm run medir:recepcionista`, que tabula destino, confianza, literalidad del argumento y
**oscilación entre corridas**; el piso da **11/11 en verde**. Ahora además: `npm run medir
<familia>` mide **los trece prompts** y no solo el recepcionista, `npm run verificar:doc` cruza los
números que la documentación afirma contra el código, y **`.githooks/pre-commit` corre `npm test`
antes de cada commit**. Lo que antes se descubría usando la app y se anotaba acá, ahora en buena
parte lo agarra un comando que corre solo.

⚠ **El hallazgo del 2026-08-13, y es el mismo de siempre visto desde el otro lado.** Las trece
familias del arnés dieron **13/13 en verde con 42 llamadas reales**, y aun así la corrida encontró
cinco cosas: **cuatro eran de los jueces y una de una fixture, ninguna de un prompt.** Dos títulos
que son afirmaciones discutibles se marcaban como rótulos, un porcentaje calculado se marcaba como
invención, y un PNG de 1×1 se comió tres HTTP 400. La lección: **un arnés recién escrito mide su
propia calibración antes que la del sistema**, y eso solo se ve corriéndolo. El corolario de
diseño quedó en el código —la corrida guarda la salida cruda y el juicio se calcula al reportar,
así que refinar un juez no cuesta ni una llamada—.

⚠ **Y el linter de deriva nació con cuatro rojos**, todos ciertos: AGENTS.md decía **11 módulos
`server-only` cuando eran 15**, 11 prompts cuando eran 13, `VERSION_RESPALDO` en 3 cuando vale 4, y
el corredor decía "~32 min" donde el manual decía ~50. Ninguno se veía leyendo; los cuatro son
números que viven en dos lados.

⚠ **El hallazgo metodológico de esta jornada:** de los cinco defectos registrados abajo, **cuatro
los encontró la ejecución de un plan que se había escrito midiendo** — incluido un test escrito
para fallar que pasaba, y un `git commit` encadenado detrás de un pipe que hacía que el typecheck
nunca frenara nada. Ninguno se veía leyendo. Es la tercera jornada seguida en que pasa lo mismo, y
la conclusión ya no es sobre este plan sino sobre el método: **escribir el plan midiendo no
sustituye ejecutarlo.**

**El subconjunto explícito de proyectos quedó CERRADO Y EN PRODUCCIÓN el 2026-08-12** (migración
`20260812000001_compartido_entre.sql` aplicada, tipos regenerados, commit `ff15eb2`). La tabla
`movement_projects` tiene **0 filas y eso es correcto**: sin filas manda el reparto por ventana de
fecha, así que no se movió ni un peso.

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

**La etapa 3 de presupuestos quedó cerrada el 2026-08-11** con la tabla de conversión
(`lib/presupuestos/conversion.ts`, pura, cero tokens). Verificada corriendo: 32 chequeos del
cálculo y el panel renderizado contra el server real con ocho presupuestos sembrados, incluido uno
archivado para comprobar que cuenta en la conversión y **no** en la lista. Los datos de prueba se
borraron y `quotes` volvió a cero.

**El gasto compartido entre un subconjunto explícito de proyectos está implementado** (2026-08-11):
migración `20260812000001_compartido_entre.sql`, motor, formulario, las dos superficies de MCP y el
respaldo. Verificado con 25 chequeos que corren el código, incluido el invariante con subconjuntos
mezclados y que **el default no se movió**. ⚠ **La migración todavía no está aplicada**: hace falta
el `SUPABASE_ACCESS_TOKEN`, que tiene Beno.

**No queda ninguna deuda conocida fuera de la app.** La que estaba anotada acá —que el workflow de
`bdallago/pepe-respaldos` no recorría el bucket `adjuntos`— era **falsa**: ver el historial.

## Historial

- **2026-08-13 — Dictar el subconjunto no era "falta una feature": ensuciaba el histórico.** Medido
  antes de construirlo, `"-15000 hosting compartido entre Proder y Gentius"` dejaba
  `descripcion: "hosting compartido entre Proder y Gentius"`. Esa columna alimenta
  `descripcion_normalizada`, o sea toda la sugerencia de categoría por histórico (regla 6.c): el
  daño no era la ausencia de la feature, era el gasto quedando cargado con basura adentro. Por eso
  la cola se parte **antes** de la extracción.
- **2026-08-13 — El server encontró un caso que los tests unitarios no.** Con la fecha **después**
  de la cola (`"…y Gentius 13/08"`) el último tramo no resolvía a ningún proyecto y —por la
  condición de todo-o-nada— no se activaba nada: el reparto se perdía y la fecha se quedaba adentro
  de la descripción. Las cinco frases telegráficas reales de Beno tienen la fecha al final, así que
  ahora se rescata. Trece tests puros pasaban y el caso apareció recién contra el server real.
- **2026-08-13 — Cuatro afirmaciones falsas en la propia documentación, encontradas por un linter
  que se escribió para eso.** 15 módulos `server-only` donde decía 11, 13 prompts donde decía 11,
  `VERSION_RESPALDO` en 4 donde lo último escrito era 3, y el costo de `--todo`. El chequeo que las
  atrapa tiene una propiedad que vale más que la lista: **que su regex no matchee también es una
  falla**, o se apagaría solo la primera vez que alguien reescriba el párrafo.
- **2026-08-13 — El chequeo de números inventados marcaba en rojo el trabajo bien hecho.** Aplicado
  a toda salida, marcó un `"60,7 %"` de las observaciones —que es `981.400 / 1.615.900`, o sea
  exactamente el cruce que el prompt pide— y dos números propuestos en una consigna y en una
  lección. Pasó a ser **opt-in por familia**, con el texto que cada prompt promete apoyar en los
  datos. La regla que queda: **un arnés con rojos permanentes entrena a ignorar el rojo**, así que
  un juez que no distingue proponer de afirmar es peor que no tenerlo.
- **2026-08-13 — La vara del título confundía el arranque con el predicado.** `pareceRotulo()`
  marcaba `"Priorizar infraestructura sobre desarrollo externo no garantiza rentabilidad"` y
  `"Documentar el impacto de cada cambio en horas evita negociaciones largas"`: las dos arrancan con
  un infinitivo de consejo y las dos **afirman algo discutible**, que es lo que el prompt pide. Lo
  que distingue a un rótulo no es cómo empieza sino que no trae predicado. Los dos títulos entraron
  al corpus del test.
- **2026-08-13 — La fixture de la captura era una imagen que Groq no acepta.** El PNG mínimo de 1×1
  devolvió tres `HTTP 400: "Image must have at least 2 pixels in each dimension"`. Ahora es ruido de
  64×64 con semilla fija, generado en código: sin dependencias, sin binarios en el repo y sin que el
  ruido cambie entre corridas —que mezclaría la inestabilidad del modelo con la de la entrada—.
- **2026-08-12 — Se commiteó `banco.ts` roto porque la verificación estaba detrás de un pipe.**
  El commit se encadenó con `npm run typecheck | tail && git commit`, y el pipe devuelve el exit
  code de `tail`, no el de `tsc`: el chequeo pasaba siempre. Arreglado en `033b0fd`. Regla que
  queda: **nunca encadenar una verificación detrás de un pipe.**
- **2026-08-12 — Un test escrito para fallar, pasaba.** El paso "verificá que el test falla" del
  plan usaba `estaVivo(p, "2026-99-99") === false`; como `estaVivo` compara strings,
  `"2026-99-99" > "2026-07-20"` y devolvía `false`, que era lo que la aserción afirmaba. El runner
  se validó después con una aserción genuinamente falsa.
- **2026-08-12 — El corredor del arnés no compilaba como `.ts`.** Sin `"type": "module"` en
  `package.json`, esbuild lo pasa a CJS y mueren los `await` de nivel superior. Va `.mts`, igual
  que `mcp/servidor.mts`. El `await` no era removible: `cargarEnvLocal()` tiene que correr antes de
  que se importe nada que lea `GROQ_API_KEY`, y un `import` estático se hoistea.
- **2026-08-12 — El `veredicto.ts` del plan no discriminaba la unión.** `if (corrida.error)` no
  angosta el tipo porque `string` no es un tipo unitario, así que `acciones` quedaba
  `AccionCruda[] | undefined` en la otra rama: 6 errores de `tsc`. Con `!== undefined` sí.
- **2026-08-12 — Sacar el bloque de confianza del prompt se midió, falló y se revirtió.**
  No es un bug sino el arnés funcionando, y es el resultado más valioso de la jornada: el bloque
  hacía **dos** cosas —fijaba la banda de confianza **y** anclaba qué destino elegir para una frase
  ambigua— y a `ambiguedad.ts` se había mudado solo la primera. Medido con
  `"el hosting de Vercel Pro"`: `suscripciones` 0.3 → `movimientos` 0.4, con ese 0.4 puesto por
  `acotarConfianza()` y no por el modelo. El detalle en AGENTS.md §9.
- **2026-08-11 — Se difirió por "falta de evidencia" una feature que Beno había pedido explícitamente.**
  Ante "hacé todo", el subconjunto explícito de proyectos se convirtió en una pregunta en vez de en
  código, con el argumento de que el caso ocurre cero veces en los datos de hoy. El argumento era
  correcto y la decisión no: medir para elegir **cómo** construir algo es distinto de medir para
  decidir **si** construir lo que ya te pidieron. Se implementó entero después. La regla que queda:
  cuando el pedido es explícito, la evidencia informa el diseño, no habilita el recorte.

- **2026-08-11 — La deuda del respaldo de `adjuntos` no existía, y estuvo anotada un día entero.**
  `AGENTS.md`, este registro y la memoria decían que faltaba el `for` del lado de
  `bdallago/pepe-respaldos` y que esos bytes no se guardaban en ningún lado. El workflow los baja
  desde el commit `06d9b7b` del 2026-08-10 (`bajar_bucket adjuntos adjunto …`), `respaldo.json`
  está en v3 y la última corrida agendada salió verde. Lo que confundió es que
  `adjuntos/MANIFIESTO.json` dice `total: 0` — porque **hoy no hay ningún adjunto en el bucket**.
  Un inventario en cero se leyó como "no funciona". La lección es la de siempre acá: verificar la
  premisa antes de anotar la deuda, y **una deuda que no existe cuesta igual que un bug**, porque
  manda a trabajar donde no hace falta.
- **2026-08-11 — Los números esperados del plan de pruebas quedaron viejos el mismo día en que se
  escribieron.** El plan (artifact del 2026-08-11) fijó los balances *antes* de que se desplegara
  el reparto por fecha, así que tres de sus veinte pasos esperan lo contrario de lo correcto:
  esperaba El Prode y Proder **activos** y Gentius **inactivo** —hoy es exactamente al revés—,
  Proder en `$463.306` (hoy `$469.472`) y Gentius en `$0` "porque está inactivo" (hoy `-$12.333`,
  y es el único vivo). Las tools contestan bien; lo que envejeció es el plan. El invariante cierra
  exacto: `469.472 − 12.333 − 154.728 = 302.411`.

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
