# Las cuatro redes que faltan — diseño

Cuatro cosas que quedaron ofrecidas el 2026-08-12 y que Beno pidió hacer
juntas el 2026-08-13. No son cuatro features: son **cuatro redes**. Ninguna
agrega una pantalla; las cuatro hacen visible algo que hoy falla en
silencio.

| # | Qué | Qué falla hoy en silencio |
|---|---|---|
| A | Linter de deriva documental | La doc afirma números que el código ya no dice. **Cuatro casos vivos, encontrados escribiendo este spec** |
| B | `npm test` en un hook | Se commitea con los tests rotos y nadie se entera hasta la próxima corrida a mano |
| C | Arnés para los otros prompts | **13 prompts, uno solo con red.** El de `retro.ts` está medido que confabula y produce un documento que se relee dentro de un año |
| D | Dictar el subconjunto de proyectos | Decirle *"compartido entre Proder y Gentius"* a la caja **te guarda esa frase adentro de la descripción** |

El orden no es arbitrario y no es de importancia: **cada etapa protege a la
siguiente.** A pone las afirmaciones de la doc bajo un test, B hace que ese
test corra sin que nadie se acuerde, C se apoya en B para no romperse, y D
—la única que toca el dominio— entra con las tres redes ya puestas.

---

## Lo que se midió antes de escribir este spec

Todo lo que sigue se corrió, no se leyó. Es lo que exige
`feedback-verificar-el-plan-ejecutandolo`, y encontró cuatro afirmaciones
falsas en la propia doc antes de escribir una línea de código.

| Medido | Valor real | Qué dice la doc |
|---|---|---|
| `BANCO.length` · `casosDelPiso().length` | 29 · 11 | 29 · 11 ✅ |
| `DESTINOS.length` | 14 | 14 ✅ |
| Prompt del recepcionista | 6887 caracteres · 128 líneas | igual ✅ |
| `tipo_bandeja` · `estado_bandeja` | 11 · 5 | 11 · 5 ✅ |
| Tools del conector | 11 | 11 ✅ |
| `npm test` | 30 en 1,04 s | 30 ✅ |
| **Módulos `server-only` en `src/lib/*.ts`** | **15** | AGENTS.md §8: *"son 11"* ❌ |
| **Prompts de sistema** | **13** (en 11 archivos, 13 `completarJSON`) | *"hay 11 prompts"* ❌ |
| **Costo de `--todo`** | 20 frases × 3 al modelo | el docstring del script dice *"~32 min"*, el manual *"~50"* ❌ |
| **`VERSION_RESPALDO`** | **4** | AGENTS.md dice *"pasó a 3"* en una línea narrativa ❌ |

Los cuatro ❌ son exactamente la clase de error que la etapa A viene a
hacer imposible, y ninguno se veía leyendo.

Y una medición que decide la etapa D entera:

```
frase: "-15000 hosting compartido entre Proder y Gentius"
  atajo      : telegrafico       (no llega al modelo)
  telegrafico: { monto: 15000, desc: 'hosting compartido entre Proder y Gentius' }
```

Hoy dictar el subconjunto **no es que no funcione: ensucia la
descripción**, que es la columna de la que sale `descripcion_normalizada` y
con ella toda la sugerencia de categoría por histórico (regla 6.c). El daño
no es no tener la feature; es el gasto que queda cargado con basura adentro.

---

## Etapa A — El linter de deriva documental

### El problema, con los cuatro casos que ya ocurrieron

AGENTS.md negó el techo de 30 pedidos/minuto de Groq durante **dos días**.
Afirmó que los adjuntos no se respaldaban durante **uno**. El artifact del
plan de pruebas tuvo **tres** números viejos. El manual agéntico decía ~32
minutos cuando eran ~50. Más los cuatro que encontró este spec.

El patrón es siempre el mismo: **un número que vive en dos lados**. Nadie
miente; el código cambia y la prosa se queda.

### La forma

Tres piezas, con el mismo corte que ya funcionó en el recepcionista
—datos, juicio puro, corredor—:

```
src/lib/deriva/hechos.ts        ← MIDE el código (importa módulos, cuenta archivos)
src/lib/deriva/afirmaciones.ts  ← DATOS: qué doc dice qué, con su regex
src/lib/deriva/verificar.ts     ← PURO: compara y devuelve los desvíos
tests/deriva.test.mts           ← lo corre en `npm test` (cero tokens, milisegundos)
npm run verificar:doc           ← el reporte con archivo:línea, para leerlo a mano
```

Una afirmación es una fila de datos:

```ts
{
  doc: "AGENTS.md",
  patron: /son (\d+), entre ellos `queries\.ts`/,
  hecho: "modulosServerOnly",
  porque: "El MCP no puede importarlos. Si el número crece y la doc no, " +
          "alguien va a importar uno y a descubrirlo en runtime.",
}
```

### Las cuatro decisiones que no son obvias

**1. Que la regex no matchee es TAMBIÉN una falla.** Es la propiedad más
importante del diseño. Un chequeo que deja de encontrar su línea porque
alguien reescribió el párrafo se apaga solo y en silencio — o sea que se
convierte en el mismo problema que vino a resolver. Sin match, el linter
grita *"esta afirmación ya no está en el doc: borrá el chequeo o volvé a
escribirla"*.

**2. Solo se lintean los documentos vivos.** AGENTS.md, `docs/README.md`,
`docs/dev/manual-agentico.md`, `docs/manual-humano.md`,
`docs/informe-estado.md`, `docs/conector-mcp.md`. **Los specs, los planes y
`docs/registro-correcciones.md` NO**: son documentos históricos y dicen lo
que era cierto ese día. Lintearlos obligaría a reescribir el pasado, que es
justo lo contrario de para qué existen.

**3. Solo entran números derivables del código, no medidos.** `29 frases`
es `BANCO.length`. `~50 minutos` es un cronómetro contra Groq y **no
entra**: no hay de dónde derivarlo y un chequeo que compara contra una
medición vieja no verifica nada. Por lo mismo queda afuera la tabla de
techos de Groq de §6.b —esos números son de la documentación de Groq, y los
de `TOKENS_POR_MINUTO` son nuestro margen; son dos cosas distintas, no una
deriva—.

**4. Donde la doc mezcla historia con estado actual, se reescribe la doc.**
`VERSION_RESPALDO` es el caso: AGENTS.md dice *"pasó a 3"* contando la
etapa de adjuntos, y hoy vale 4. Las dos frases son ciertas en su
contexto. El linter fuerza a que el valor de hoy esté escrito en algún
lugar chequeable, y ahí la historia se queda donde está.

### El arranque

Nace con las diez afirmaciones ya medidas de la tabla de arriba, **cuatro
de ellas en rojo**. Eso es el criterio de aceptación de esta etapa: que el
linter falle al nacer y que arreglar la doc lo ponga en verde.

---

## Etapa B — `npm test` en un hook

`.githooks/pre-commit` corre `npm test` y aborta el commit si falla.

```json
"prepare": "git config core.hooksPath .githooks"
```

`prepare` corre solo con `npm install`, así que engancharlo no es un paso
que alguien tenga que acordarse de hacer. Cero dependencias nuevas: no
entra husky para escribir cuatro líneas de shell.

### Por qué solo `npm test` y no el trío completo

`npm test` son **1,04 segundos** medidos. `typecheck`, `lint` y `build`
son minutos, y un pre-commit de minutos no se tolera: se termina usando
`--no-verify` siempre, y entonces la red no existe. El trío completo sigue
siendo lo de siempre —a mano antes de dar algo por terminado— y eso no
cambia.

### Por qué un hook de git y no un hook de Claude Code

El de Claude Code corre cuando **yo** edito; el de git protege igual los
commits de Beno y los míos, vive versionado en el repo y no depende de la
configuración de una herramienta. La salida de emergencia es la estándar
(`git commit --no-verify`) y queda documentada.

Con la etapa A adentro de `npm test`, este hook además se convierte en la
única cosa que impide commitear documentación que miente.

---

## Etapa C — El arnés para los otros doce prompts

### El problema

Son **13 prompts** de sistema y **uno solo tiene red**. La lista completa,
medida:

| Archivo | Prompt | Modelo | Qué produce |
|---|---|---|---|
| `agentes/recepcionista.ts` | `SISTEMA` | chico | ✅ ya tiene arnés |
| `retro.ts` | `SISTEMA` | razonador | El documento de cierre de un proyecto |
| `generacion.ts` | `SISTEMA` | razonador | Lecciones sobre un tema (6.3) |
| `sugerencias.ts` | `SISTEMA` | razonador | Qué estudiar (6.4) |
| `agentes/observaciones.ts` | `SISTEMA` | razonador | Observaciones sobre los números |
| `presupuestos/estimacion.ts` | `SISTEMA` | razonador | Las horas de un presupuesto |
| `extraccion.ts` | `SISTEMA` | chico | Lecciones desde la bitácora |
| `clasificacion.ts` | `SISTEMA` | chico | Tipo y categoría de un movimiento |
| `zombies.ts` | `SISTEMA` | chico | El aviso de una suscripción zombie |
| `agentes/movimientos.ts` | `SISTEMA` | chico | Monto, moneda, descripción y fecha |
| `adjuntos.ts` | `SISTEMA_TROZO` | chico | Resumen de un trozo de PDF |
| `adjuntos.ts` | `SISTEMA_SINTESIS` | razonador | Lecciones desde un PDF |
| `adjuntos.ts` | `SISTEMA_CAPTURA` | qwen (visión) | Transcripción de una captura |

El más peligroso es `retro.ts`, y no por opinión: está medido que **el
razonamiento confabula más**, la primera corrida inventó un plazo previsto
que no existía, y la salida es un documento que se relee dentro de un año.
Su prompt tiene una regla antiinvención que **enumera los errores uno por
uno** porque el modelo respeta la lista y no el principio. Nada verifica
hoy que la siga respetando.

### La forma: la misma que el recepcionista, generalizada

```
banco (datos) → juez (puro) → corredor (red, retomable) → línea base (commiteada)
```

Lo nuevo son tres cosas.

**1. El prompt se declara una vez y lo usan los dos.** Cada módulo pasa a
exportar su prompt como un descriptor —todo lo que hoy le pasa a
`completarJSON` menos el `usuario`— y su propio call site lo consume:

```ts
export const PROMPT: PromptDeclarado<typeof respuestaSchema> = {
  modelo: MODELO_RAZONADOR, sistema: SISTEMA, esquema: respuestaSchema,
  temperatura: 0.4, esfuerzo: "medium", maxTokens: 4500, ...
};
// y más abajo, el call site de producción:
const { datos, uso } = await completarJSON({ ...PROMPT, usuario });
```

⚠ **Esto no es cosmética: es la propiedad que hace que el arnés sirva.**
Si el arnés tuviera su propia copia del prompt, mediría un prompt que no es
el que corre en producción, y una medición así es peor que ninguna —da
tranquilidad sin dar información—. Con un solo descriptor, no se puede
tocar el prompt sin tocar lo que se mide.

**2. Los jueces mecanizan varas que hoy son prosa.** Es la parte que más
compra, porque corre gratis, en milisegundos y dentro de `npm test`:

| Juez | Qué cobra | De dónde sale la regla |
|---|---|---|
| `pareceRotulo(titulo)` | *"El título es una afirmación discutible, no un rótulo"* | Está escrita **tres veces** (6.3, retro, adjuntos) y nunca se verificó |
| `numerosSinRespaldo(salida, entrada)` | Todo número de la salida tiene que aparecer en la entrada | Ataca directo el *"confabula más"* de la retro |
| `descripcionContenida(desc, frase)` | La descripción extraída es una subcadena de la frase | Mecaniza el **COPIALA ENTERA** del extractor de movimientos |
| `sinTonoAsistente(texto)` | Sin emojis ni muletillas | Lo piden seis de los trece prompts |

**3. Las fixtures son sintéticas, y no por comodidad.** El repo es
público: `colmena-backup-*.json` está en `.gitignore` justamente porque las
entradas de bitácora reales son personales. Una fixture con la bitácora de
Beno adentro sería publicarla. Las fixtures imitan la **forma** del
contexto real —montos, categorías, fechas, largos— con contenido inventado.

### Lo que cuesta medirlo, y la decisión que hay que tomar

Medido: cada llamada del razonador reserva ~5000 tokens contra un techo de
7300 por minuto, o sea **una llamada por minuto**. Con 3 corridas por caso
—porque oscilar cuenta como fallar— una familia del razonador son ~3
minutos de reloj y ~15 000 tokens de un techo diario de 200 000.

Las seis familias del razonador con un caso cada una: **~18 llamadas,
~90 000 tokens, ~20 minutos**. Entra en el día, pero deja al razonador con
la mitad del cupo, así que **hoy conviene medir de a poco y con un caso por
familia**, no dos.

Las del modelo chico son mucho más baratas (200 a 900 `maxTokens`) y se
pueden medir enteras.

`SISTEMA_CAPTURA` es el único que necesita una imagen y el único que corre
en qwen. Su fixture es un PNG chico generado, y el juez que importa ahí es
que `legible: false` con ruido no invente una conversación —lo que ya se
midió a mano el 2026-08-10—.

### Lo que el arnés NO hace

- **No juzga si la respuesta es buena.** Juzga que cumpla las reglas que el
  prompt promete. "Esta retro es floja" no es mecanizable y no se intenta.
- **No corre en el hook ni en el build.** Ni una llamada a Groq en un
  pre-commit. Los jueces sí; el corredor, a mano.
- **No mide las trece de una.** `npm run medir <familia>`, una por vez,
  retomable. Un `--todo` que dispare 40 llamadas al razonador se come el
  techo diario y deja la app sin retro ni presupuestos por el resto del día.

---

## Etapa D — Dictar el subconjunto de proyectos

Hoy el subconjunto explícito (`movement_projects`, AGENTS.md §2.b) solo se
elige tildando casillas en el formulario. Beno lo pidió dictado: *"este
gasto es un compartido entre y, z y u proyecto"*.

### El hallazgo que cambia el costo de esta etapa

**No hay que tocar el prompt del recepcionista.** Estaba anotado como
"medio — toca el prompt, o sea medir antes y después", y medido no es así:

- `"compartido entre Proder y Gentius"` es **léxico y mecánico**: una
  preposición fija y dos nombres que se buscan en tres filas. Es
  exactamente el caso de la regla de §9 —*si algo se puede resolver sin
  modelo, se resuelve sin modelo*— y el mismo lugar donde ya viven
  `textoDelMovimiento()` y `pareceAnotacion()`.
- El destino **no cambia**: sigue siendo `movimientos`. Lo único que cambia
  es cómo se parte el argumento antes de leerlo.
- Y la frase telegráfica ni llega al modelo: la ataja `atajo.ts`.

Con el prompt intacto, esta etapa **no necesita medir contra Groq ni antes
ni después**, y el riesgo del prompt de vidrio no existe. Baja de medio a
bajo.

⚠ **Esto no es un tercer atajo de `atajo.ts`**, y la distinción importa
porque §9 dice que solo hay dos y no se agregan más. Un atajo decide **el
destino** sin el modelo. Esto no decide ningún destino: parte un argumento,
como ya lo hacen `partirArgumento()` y `textoDelMovimiento()`.

### Las tres piezas

**1. `agentes/subconjunto.ts` — puro.**

```ts
partirSubconjunto(texto, proyectos): { texto: string; ids: string[] }
```

Reconoce `compartido|repartido|dividido entre A, B y C` al final del texto,
y `entre A y B` cuando cierra la frase. Devuelve el texto sin esa cola y
los ids.

⚠ **La condición que hace segura la regla: si no resuelven TODOS los
nombres a proyectos que existen, no se toca nada.** Ni el texto ni los ids.
Un `"gasto entre semana"` o un `"entre lo que cobré y lo que pagué"` deja
todo exactamente como está hoy — el peor caso de un error de esta función
es que la feature no se active, nunca que la descripción quede rota o el
gasto imputado a otro. Y **mínimo dos**, igual que el formulario y el
schema: con uno solo "compartido entre X" es "es de X", y eso ya se
escribe con `project_id`.

**2. La caja (`despacho.ts`, caso `movimientos`).** Se parte **antes** de
`leerMovimiento()`. Ese orden es el punto: partir después deja la cola
adentro de la descripción, que es el defecto medido arriba. Con
subconjunto, el proyecto es compartido (`null`) y **la pregunta de proyecto
no se hace**: ya está contestada, y con más precisión que la pregunta.
La respuesta nombra los proyectos elegidos, porque mover el reparto mueve
balances.

**3. El conector (`registrar_movimiento`).** Gana `compartido_entre:
string[]` (slugs, mínimo 2), excluyente con `proyecto`. Va al payload como
ids y `aceptarMovimientoDictado()` inserta las filas de
`movement_projects` **después** de crear el movimiento, con el mismo
criterio de hoy: si eso falla, el movimiento ya existe y queda repartido
por ventana de fecha, que es el default correcto. La tarjeta de la bandeja
muestra los nombres: aceptar un reparto que no se ve no es aceptar.

### Lo que no se toca

`calcularParticipaciones()`, el prorrateo, el memo, el respaldo y las
cuatro lecturas de movimientos: la etapa D no agrega una forma nueva de
guardar el subconjunto, **usa la que ya existe**. Sin filas sigue mandando
la ventana de fecha, y lo explícito sigue sin filtrarse por `estaVivo()`.

---

## Criterio de aceptación

**A — Linter**
1. `npm run verificar:doc` reporta las cuatro derivas conocidas con
   archivo y línea, y `npm test` falla por ellas.
2. Arregladas las cuatro en la doc, las dos cosas quedan en verde.
3. Cambiar a mano un número de AGENTS.md lo vuelve a poner en rojo, y
   **borrar la frase entera también** (el chequeo sin match falla).

**B — Hook**
4. `git commit` con un test roto **no commitea** y dice qué falló.
5. Con los tests en verde, el commit pasa y el sobrecosto es ~1 s.

**C — Arnés**
6. Los trece prompts están declarados como descriptor y **los trece call
   sites de producción consumen el descriptor**: no queda ni una copia del
   prompt en el arnés (verificable con un test de completitud que cruce los
   `completarJSON` del repo contra el registro).
7. Los jueces pasan sus casos sin una sola llamada a Groq, dentro de
   `npm test`.
8. `npm run medir retro` corre de verdad contra Groq, escribe la tabla y
   deja la línea base commiteada. Al menos una familia del razonador y una
   del chico, medidas de verdad.
9. Se corta a la mitad y retoma donde estaba.

**D — Subconjunto**
10. `"-15000 hosting compartido entre Proder y Gentius"` deja la
    descripción en `"hosting"` —no en `"hosting compartido entre…"`— y el
    formulario abre con los dos proyectos tildados.
11. `"gasto entre semana"` y `"-15000 hosting"` se comportan **exactamente
    como hoy**.
12. `registrar_movimiento` con `compartido_entre` deja la propuesta, la
    tarjeta muestra los nombres y aceptarla crea las filas de
    `movement_projects`.
13. Con un solo proyecto, las dos superficies lo rechazan con un mensaje
    que dice por qué.
14. `npm test && npm run typecheck && npm run lint && npm run build` en
    verde, y **el invariante del prorrateo sigue cerrando** con y sin
    subconjunto.

## Lo que este spec NO hace

- **No toca el prompt del recepcionista.** Ninguna de las cuatro etapas
  agrega una línea ahí, así que no hay que medir el piso antes y después.
- **No agrega atajos a `atajo.ts`.** Siguen siendo dos.
- **No mide las trece familias frescas hoy.** El techo diario del razonador
  no da, y forzarlo dejaría la app sin retro ni presupuestos.
- **No toca `calcularParticipaciones()` ni el algoritmo de reparto**, ni la
  diferencia de centavos conocida entre las dos pantallas.
- **No habilita la etapa 6 de presupuestos** (bloqueada por diseño hasta
  ≥ 10 resueltos; hay 0) ni calibra las horas de estimación (Beno lo dejó
  afuera el 2026-08-11).
