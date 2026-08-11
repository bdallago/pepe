# Registro de correcciones

> Convención (sistema documental estándar de Beno): arriba un resumen del **estado actual** con
> fecha; abajo el **historial** completo en entradas de 1-2 líneas, de la más reciente a la más
> vieja; el detalle largo va a [`archivo/`](archivo/), no acá. Lo mantiene `/actualizar`.
>
> Se llama **registro** y no "bitácora" a propósito: en Pepe, Bitácora es una sección del
> producto (con datos reales del usuario y una tool `escribir_bitacora` que escribe en firme).
> Esto otro es el historial de bugs y correcciones del desarrollo.

## Estado actual (2026-08-11)

**Sin bugs conocidos abiertos.** La app está en producción con las tres pantallas de balance
diciendo el mismo número y el invariante `suma(por proyecto) === balance general` cerrando exacto
en ARS y en USD.

La tanda del 2026-08-11 salió toda del mismo lugar: implementar el reparto por fecha destapó
correcciones en cascada, y la mayoría **no fallaban a la vista** — devolvían números plausibles o
frases seguras y equivocadas. Es el modo de fallar que más caro sale en este proyecto (ver el BOM
de la key de Groq, 16 horas caído en silencio) y por eso todas se verificaron midiendo contra la
base real, no leyendo.

Queda **una deuda conocida, sin dueño y fuera de la app**: el workflow del repo
`bdallago/pepe-respaldos` todavía no recorre el bucket `adjuntos`, así que esos bytes no se están
respaldando. Del lado de Pepe está todo hecho desde hace días.

## Historial

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
