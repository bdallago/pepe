# El reparto por fecha — diseño

> ✅ **EJECUTADO Y EN PRODUCCIÓN el 2026-08-11.** El plan es
> `../plans/2026-08-10-prorrateo-por-fecha.md`.
>
> ⚠ **Una cosa que este spec afirma dejó de ser cierta**: la sección "Lo
> que este spec deja afuera" difiere el **gasto compartido entre un
> subconjunto explícito de proyectos** hasta saber "si aparece seguido o
> fue un caso de dos veces". Se implementó igual el mismo 2026-08-11, a
> pedido de Beno — `movement_projects`, migración
> `20260812000001_compartido_entre.sql`. El razonamiento del spec para
> diferirlo era correcto y no alcanzaba: **medir sirve para decidir cómo
> construir algo, no si construir lo que ya te pidieron.**
>
> Lo que sí sobrevivió de ese razonamiento, y es lo mejor del diseño
> final: **sin filas no cambia nada**, el reparto por ventana de fecha
> sigue siendo el default, y por eso la tabla entró sin mover un solo
> número de los que había cargados. El desarrollo está en AGENTS.md §2.b.

Spec A de dos. El otro es `2026-08-10-operar-conversando-design.md`, que
es donde viven los tres fallos que Beno reportó. Este es el modelo de
datos que aquel necesita abajo.

## El problema

`calcularParticipaciones(projects)` se queda con los proyectos que tienen
`activo = true` **en el momento en que se abre la pantalla**, y con esa
foto reparte **todo el histórico**. Un gasto compartido del 15/05 no se
reparte entre quienes estaban trabajando el 15/05: se reparte entre
quienes estén activos hoy.

Mientras la lista de proyectos no cambie, nadie lo nota. Se nota el día
que cambia, y entonces cambia el pasado: cerrar un proyecto reescribe
retroactivamente cuánto costó cada uno de los otros, sin que nada avise.

Salió en una conversación del 2026-08-10. Beno pidió cargar las fechas de
apertura y cierre de dos proyectos, y la respuesta fue advertirle que eso
lo iba a dejar sin proyectos activos y que los gastos compartidos
quedarían sin repartir. Su réplica fue la correcta: **sus 22 movimientos
están todos adentro de las ventanas que estaba proponiendo**, así que
conceptualmente ninguno queda flotando. Lo que estaba mal no era su
pedido, era el cálculo.

Verificado: los 22 movimientos van del 02/04/2026 al 07/07/2026.

## El modelo

Un proyecto tiene una **ventana de vida**: `fecha_inicio` y `fecha_fin`,
que ya existen en `projects` desde `20260810000001_proyectos_fechas.sql`
y que **hoy no las lee nadie** (verificado: las únicas menciones de esos
nombres en `src/` son de `tracks`, `recurrences` y `presupuestos`).

Un proyecto participa del reparto de un gasto compartido si **la fecha de
ese gasto cae dentro de su ventana**:

```
participa(proyecto, gasto) =
  (proyecto.fecha_inicio is null or gasto.fecha >= proyecto.fecha_inicio)
  and
  (proyecto.fecha_fin    is null or gasto.fecha <= proyecto.fecha_fin)
```

Las dos puntas abiertas tienen significado y no son un caso degenerado:
`fecha_inicio` nula es "desde siempre" y `fecha_fin` nula es "sigue
abierto". Un proyecto sin ninguna de las dos participa de todo, que es
exactamente el comportamiento de hoy — y por eso la migración de datos
puede ser incremental sin que nada se rompa en el medio.

El peso sigue siendo `peso_prorrateo`, normalizado **entre los que
participan de ese gasto**, no entre todos.

### `activo` deja de guardarse

Decisión de Beno, tomada el 2026-08-10: **la ventana es la única fuente
de verdad.**

Un proyecto está activo si hoy cae dentro de su ventana. El botón manual
de activar/desactivar no escribe una bandera: **edita la ventana**.
Desactivar pone `fecha_fin` en hoy; activar la vuelve a `null`.

La alternativa era guardar las dos cosas y que la fecha solo avisara. Se
descartó porque admite un estado contradictorio —un proyecto marcado
activo con el cierre vencido— y ese es justamente el estado que Beno
señaló como incorrecto cuando pidió esta feature. Con una sola fuente de
verdad no puede existir.

**Implementación: la columna `activo` se borra.** No se deja como caché
ni como columna generada. Una columna generada obligaría a que la
expresión dependa de `current_date`, que no es inmutable y Postgres no lo
permite en una generated column; una caché mantenida por la app deriva en
silencio el día que alguien escriba por afuera. Donde el código de hoy
lee `p.activo`, pasa a llamar a un helper puro:

```ts
/** ¿Está vivo hoy? Es lo que antes decía la columna `activo`. */
export function estaVivo(
  proyecto: Pick<Project, "fecha_inicio" | "fecha_fin">,
  hoy: string = todayISO(),
): boolean;
```

Vive en `lib/prorrateo.ts`, al lado de `calcularParticipaciones`, porque
es la misma regla mirada desde otro lado.

### La firma nueva

```ts
export function calcularParticipaciones(
  projects: Pick<Project, "id" | "fecha_inicio" | "fecha_fin" | "peso_prorrateo">[],
  fecha: string,
): Map<string, ParticipacionProyecto>;
```

**La fecha es obligatoria y no tiene default.** Un default a hoy dejaría
compilar todos los call sites viejos con el bug adentro, que es la peor
forma posible de hacer esta migración: el compilador es lo único que
garantiza que ninguno quedó sin mirar. Son 8 llamadas y están enumeradas
más abajo.

`ParticipacionProyecto` gana un campo. Hoy tiene `indice` y `total` para
la etiqueta "Compartido (1/3)"; ahora ese `total` es por fecha, así que
la etiqueta pasa a poder decir cosas distintas en dos movimientos de la
misma pantalla. Es correcto y es el punto de la feature, pero hay que
mostrarlo bien (ver más abajo).

### El invariante se sostiene

`suma(balance de cada proyecto) === balance general` sigue valiendo, y por
la misma razón de siempre: cada gasto compartido se reparte al 100 % entre
**su propio** conjunto, con `repartirPorRestoMayor()` sobre centavos
enteros. Que el conjunto cambie de un gasto a otro no lo afecta — lo que
lo rompería es repartir un gasto por debajo o por encima del 100 %, y eso
no pasa.

La excepción documentada sigue siendo la misma y ahora es **por
movimiento** en vez de global: un gasto compartido cuya fecha no cae en la
ventana de ningún proyecto no tiene entre quiénes repartirse.
`compartidoSinRepartir` pasa de "no hay proyectos activos" a "estos N
gastos no encontraron dueño", y la pantalla tiene que poder decir
**cuáles**, no solo cuánto: con el modelo viejo era todo o nada, ahora es
una lista concreta y accionable.

Ese caso es real y va a aparecer: el `-20usd Claude Code 06/08` del fallo
2 es un gasto posterior al cierre de Proder y El Prode. Si en ese momento
Gentius está abierto, cae en Gentius solo. Si no hubiera ninguno abierto,
queda sin repartir **y hay que decirlo**, porque significa algo — estás
pagando suscripciones sin ningún proyecto abierto.

## La migración de datos

Con las fechas que dio Beno el 2026-08-10:

| Proyecto | `fecha_inicio` | `fecha_fin` |
|---|---|---|
| Proder | 2026-04-01 | 2026-07-20 |
| El Prode de Beno | 2026-04-01 | 2026-07-20 |
| Gentius | 2026-07-01 | `null` |

Del 20/07 dijo "el 20/07 o por ahí". Se carga así y queda corregible desde
la pantalla, que este spec construye.

**Ojo con el orden**: la migración tiene que escribir las tres ventanas
**antes** de borrar `activo`, y en la misma transacción. Con `activo`
borrado y las fechas en null, los tres proyectos serían "vivos siempre" y
Gentius entraría al reparto de los 15 gastos compartidos. Es una ventana
de inconsistencia de milisegundos en la base, pero el respaldo diario o un
deploy en el medio la pueden capturar.

### Qué números se mueven

Uno solo, y está verificado contra los datos reales:

**Claude Pro del 07/07, US$ 20** es el único gasto compartido posterior al
2026-07-01, o sea el único que cae dentro de la ventana de Gentius. Pasa
de partirse entre dos proyectos a partirse entre tres: **US$ 6,67 a cada
uno en vez de US$ 10**.

Los otros catorce gastos compartidos son anteriores al 01/07 y quedan
exactamente como están, porque Proder y El Prode los siguen cubriendo a
los dos. Vercel Pro "de julio" es del 30/06 y **no** entra: la fecha del
movimiento es la que manda, no lo que diga su descripción.

Efecto en los balances por proyecto: Gentius deja de ser exactamente $0.

## Dónde toca el código

Ocho llamadas a `calcularParticipaciones`, todas enumeradas para que
ninguna quede sin mirar:

| Archivo | Qué fecha le corresponde |
|---|---|
| `lib/balances.ts:276` (`calcularBalances`) | la de cada movimiento — deja de ser una llamada y pasa a ser una por gasto compartido |
| `lib/balances.ts:371` (`calcularBalancesProyecto`) | ídem |
| `components/proyectos/proyectos-grid.tsx:39` | hoy, para la etiqueta de estado |
| `components/proyectos/proyecto-view.tsx:74` | hoy |
| `components/ajustes/proyectos-panel.tsx:75` | hoy |
| `components/presupuestos/acciones-presupuesto.tsx:142` | hoy — el "antes" |
| `components/presupuestos/acciones-presupuesto.tsx:143` | hoy — el "después", que simula el proyecto nuevo |
| `lib/prorrateo.ts:76` (`pesosSonUniformes`) | hoy |

Las dos de `balances.ts` son las que cambian de forma: hoy calculan el
mapa **una vez** y lo usan para todos los compartidos; ahora hay que
calcularlo **por fecha distinta**. Con 15 compartidos y 3 proyectos el
costo es irrelevante, pero conviene memoizar por fecha adentro de la
función y no recalcular 15 veces lo mismo.

`acciones-presupuesto.tsx` merece atención: hoy simula el reparto
agregando un proyecto ficticio con `activo: true` para mostrar cómo
cambia. Con ventanas, el proyecto que va a nacer del presupuesto tiene
`fecha_inicio` (la del presupuesto) y no tiene fin, así que la simulación
tiene que usar **su** ventana, no `activo: true`.

Y hay 12 lugares que leen `p.activo` y pasan a `estaVivo(p)`, incluidos
`lib/mcp/tools/balance.ts`, `lib/mcp/tools/proyectos.ts` y
`agentes/despacho.ts` — este último dentro del bug que arregla el spec B.

### Lo que NO se toca

- **`retros.balance_ars` / `balance_usd` quedan como están.** Se congelan
  al guardar, con el mismo criterio que el tipo de cambio: la retro dice
  lo que el proyecto costó cuando se cerró. Recalcularlas con el modelo
  nuevo sería reescribir un documento cerrado.
- **`tracks.activo` es otra cosa** y no se toca: un track en pausa es una
  decisión de estudio, no una ventana de vida.
- **Los movimientos con `project_id` puesto** no pasan por el reparto en
  ningún caso. Esto es solo para `project_id is null`.

## Lo que este spec deja afuera

**El gasto compartido entre un subconjunto explícito de proyectos.** Beno
lo nombró: *"este gasto es un compartido entre y, z y u proyecto"*. Hoy no
se puede guardar — `movements.project_id` es una sola columna, así que un
gasto es de un proyecto o es de todos los que correspondan, y no existe
forma de decir "de estos tres y no del cuarto". Necesita una tabla que
vincule un movimiento con varios proyectos, y toca el esquema, el
formulario, el motor de balances, el agente y las tools del conector.

Va después, y a propósito: recién con este spec andando y usado se va a
saber si el subconjunto explícito aparece seguido o fue un caso de dos
veces. Decidido con Beno el 2026-08-10.

## Criterio de aceptación

1. Cargar las tres ventanas de la tabla de arriba y verificar que **el
   único número que cambia** es el reparto de Claude Pro del 07/07, que
   pasa de dos a tres partes.
2. El invariante `suma(balance por proyecto) === balance general` cierra
   exacto en ARS y en USD, con las tres ventanas puestas. La pantalla de
   Proyectos ya lo verifica sola.
3. Un gasto compartido con fecha posterior a todas las ventanas aparece
   en `compartidoSinRepartir` **con su descripción**, no solo como un
   monto agregado.
4. Desactivar un proyecto desde la pantalla le pone `fecha_fin` en hoy, y
   volver a activarlo la deja en `null`. No queda ninguna bandera aparte
   que pueda contradecir la ventana.
