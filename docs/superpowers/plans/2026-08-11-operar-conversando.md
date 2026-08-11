# Operar Pepe conversando — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las tres frases que Beno tipeó de verdad el 2026-08-10
terminen haciendo lo que pedían, y que **una frase no cubierta no escriba
nada en ninguna parte**.

**Architecture:** Dos olas independientes que se despliegan por separado.
La **ola 1** es la caja (`src/lib/agentes/`): la salvaguarda que corta el
sumidero de bitácora, los dos bugs del movimiento, el destino `proyecto` y
la recalibración medida del recepcionista. La **ola 2** es el conector
(`src/lib/mcp/`): tres tools nuevas que dejan propuestas en `inbox`, con
sus tres valores de `tipo_bandeja`, sus tres actions de aceptación y sus
tres tarjetas. La ola 1 arregla daño que **está pasando hoy** y no depende
de la ola 2; la ola 2 no toca ni una línea de la ola 1.

**Tech Stack:** TypeScript · Next 15.5 App Router · Supabase (Postgres) ·
Zod · `@modelcontextprotocol/server` + `mcp-handler` · Groq
(`llama-3.1-8b-instant`) · scripts de verificación con `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-10-operar-conversando-design.md`

---

## Correcciones de la ejecución (2026-08-11)

⚠ **Este plan se escribió midiendo —y aun así trajo defectos.** Están
corregidos en el código, pero **el código que figura abajo, en las tareas,
sigue siendo el original**. Si vas a re-ejecutar desde acá, leé esto
primero o los reintroducís.

Los cinco son de la misma familia: **afirmaciones plausibles que nadie
había ejecutado**, y los cinco fallan en silencio.

| Lo que el plan decía | Lo que es | Dónde |
|---|---|---|
| La segunda opción de la salvaguarda puede apuntar a `consultas` | Con un **track** eso muestra el balance general de toda la app titulado "Balance general". Hace falta un discriminador `tipo` | T1 |
| `normalizarNombre()` se duplica porque `resolver.ts` es `server-only` y no se puede importar desde un script | **Falso, medido**: con `--conditions=react-server` se importa perfecto. La razón verdadera es el contagio transitivo de `server-only` a `bitacora.ts`. Se extrajo a `agentes/nombres.ts` | T1 |
| El argumento de las opciones viaja sin problema | `route.ts` lo capa en **300** y el cliente no lo recorta: una frase de 298 produce un argumento de 317 → **HTTP 400** y el movimiento se pierde. Subido a 1100 | T2 |
| `\bcerr[áa]\b` matchea `"cerrá Proder"` | **No matchea ninguna forma acentuada**: `\b` de JS se define contra `\w`, que excluye "á". Los cuatro verbos caían al default `ventana`. Hace falta `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` con flag `u` | T3 |
| `leerLasDosFechas()` maneja una sola marca | Con solo apertura, la fecha se escribía en **`cierre`**: un proyecto que arranca el mes que viene nacía cerrado | T3 |

Y tres más que salieron barriendo el módulo terminado:

- **`RELLENO` se comía artículos que son parte de nombres reales**:
  `"cerrá El Prode"` daba `"Prode"` y `"Agente de RRHH"` daba
  `"Agente RRHH"`. Reemplazado por recortes estructurales (`ANDAMIAJE`).
- **El recorte de conectores sacaba uno solo de la punta**:
  `"creá el proyecto Agente de RRHH que arranca el 01/09/26"` daba el
  nombre `"Agente de RRHH que el"` — y eso es el nombre con el que se crea
  el proyecto. Después apareció **el mismo defecto en `nuevoNombre`**, que
  el arreglo no había alcanzado.
- **`EXPRESIONES_DE_FECHA` se había separado de `fechas.ts`**, que es
  exactamente lo que su propio comentario advertía: nació sin la regla de
  días de la semana y con `"5 de <cualquier palabra>"` abierta, así que un
  proyecto llamado `"5 de Mayo"` se leía como una fecha y se quedaba sin
  nombre. Ahora **se deriva** de las mismas listas que `REGLAS`.

**Lo que los agarró no fue escribir mejor el plan: fue que cada tarea
tenga una revisión que corre el código en vez de leerlo.** Dos de los ocho
los encontró un barrido de 540 combinaciones mirando **los cinco campos**
de la salida — los chequeos que verifican un subconjunto de los campos
dejan pasar los otros, y así se coló el del nombre con dos conectores.

**Deuda conocida que se decidió no pagar:** `agentes/proyectos.ts` hace
tres pasadas sobre el string crudo con regex que sirven para propósitos
opuestos (una marca sirve para *partir* y para *borrarse*; un verbo para
*decidir* y para *borrarse*). De ahí sale casi todo lo de arriba. La
salida buena es tokenizar una vez y que las tres respuestas salgan del
mismo mapa; no se hizo porque es un rediseño. Las limitaciones que quedan
están escritas al final de ese archivo.

---

## Antes de empezar

**Este proyecto no tiene suite de tests versionada** (`AGENTS.md`). La
verificación es: scripts temporales que se corren y **se borran**, más
`npm run typecheck && npm run lint` en cada tarea y `npm run build` al
cerrar cada ola. No agregues Jest ni Vitest.

Los scripts van en la **raíz del repo** —no en `scratch/`, que tiene su
propio `package.json` y cambia la resolución de módulos; no en `/tmp`,
desde donde no se resuelve `node_modules` ni el alias `@/`— y se corren
con:

```bash
npx tsx --conditions=react-server ./verificar-X.mts
```

El flag `--conditions=react-server` no es opcional: sin él,
`import "server-only"` resuelve al archivo que lanza a propósito.

Todo script que lea la base necesita este preámbulo, porque no corre
adentro de Next:

```ts
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]!] = m[2]!.trim();
}
```

**Para aplicar migraciones y regenerar tipos hace falta
`SUPABASE_ACCESS_TOKEN`, que lo tiene Beno.** Si no lo tenés, frená y
pedíselo; no inventes un camino alternativo.

**No corras `npm run build` con un `next dev` vivo**: comparten `.next` y
se pisan.

**No uses `process.exit()` en los scripts**: crashea en Windows. Imprimí
el resultado y salí normalmente.

---

## Lo medido antes de escribir este plan (2026-08-11)

Este plan **se ejecutó en seco antes de escribirse**. El anterior
(`2026-08-10-prorrateo-por-fecha.md`) se escribió leyendo código sin correr
nada y tenía siete afirmaciones falsas; abajo está todo lo que se comprobó,
con el comando que lo comprobó. Si vas a cambiar algo del plan, medí igual.

### Estado del repo

| Qué | Resultado | Cómo |
|---|---|---|
| `npm run typecheck` | limpio | corrido |
| `npm run lint` | limpio | corrido |
| `movements` de `despacho.ts` ya **no filtra por `activo`** | confirmado, `despacho.ts:502-509` | leído |
| `projects.activo` | **ya no existe**; solo queda `tracks.activo` | grep sobre `database.types.ts` |
| `tipo_bandeja` hoy | `categorizacion`, `zombie`, `leccion_sugerida`, `leccion_extraida`, `retro`, `nota_de_adjunto`, `movimiento_dictado`, `leccion_dictada` | `database.types.ts:1405` |
| Última migración aplicada | `20260811000001_historico_por_usuario.sql` | `ls supabase/migrations` |

⚠ **La próxima migración se numera `20260812000000` o más.** Las dos del
reparto quedaron con timestamps anteriores a las `20260811…` ya aplicadas y
hubo que empujarlas con `--include-all`.

### Estado de los datos

| Tabla | Contenido |
|---|---|
| `projects` | **Proder** (01/04/2026 → 20/07/2026), **El Prode de Beno** (01/04/2026 → 20/07/2026), **Gentius** (01/07/2026 → abierto). Los tres con peso 1 y sin archivar. |
| `tracks` | `pm` "Product Manager" y `dev` "Dev · Auditoría Gentius", los dos activos. |
| `inbox` | 6 filas, **todas resueltas**. La bandeja está vacía. |
| `quotes` | **vacía**: no hay ni un presupuesto creado. |
| `daily_log` | 6 entradas. |

⚠ **Gentius ya está abierto** (`fecha_fin` null). El criterio de aceptación
del fallo 2 dice "la ventana de Gentius queda abierta" y **hoy ya lo está**:
al probarlo, esa mitad no puede fallar. Lo que sí tiene que verse es que la
acción `proyecto` exista y conteste, no que cambie un dato.

### El recepcionista, medido contra la cuenta real

Corrida completa el 2026-08-11 con `llama-3.1-8b-instant`, temperatura 0,
14 frases. **Esta tabla es el piso de regresión de la Tarea 5.**

| Grupo | Frase | Hoy devuelve |
|---|---|---|
| ambigua | `"Claude Code"` | `movimientos` **0.3** |
| ambigua | `"Proder"` | `consultas` **0.3** |
| ambigua | `"pricing"` | `buscador` **0.3** |
| ambigua | `"Vercel Pro"` | `suscripciones` **0.3** |
| simple | `"pagué 20 usd de Claude Code"` | `movimientos` 1 · arg `"20 usd de Claude Code"` |
| simple | `"cómo viene Proder"` | `consultas` 0.9 · arg `"Proder"` |
| simple | `"qué me toca hoy"` | `roadmap` 1 · arg `null` |
| simple | `"qué estoy pagando que no uso"` | `suscripciones` 0.9 · arg `null` |
| simple | `"sacá lecciones de lo que aprendí con clientes"` | `lecciones_tema` 1 |
| simple | `"anotá que hoy peleé con el deploy toda la tarde"` | `bitacora` 1 |
| telegráfica | `"-20usd Claude Code 06/08"` | `movimientos` 1 · arg **idéntico, con la fecha** |
| choque | `"qué anotaciones tengo sobre gestión de presupuestos"` | `buscador` 1 |
| **fallo 1** | `"Anota las fechas de apertura y cierre de Proder y El Prode de Beno 01/04/26 apertura y 31/07/26 para las dos"` | **3 acciones**: `bitacora`(1) arg `"Proder"`, `bitacora`(1) arg `"El Prode"`, `retro`(1) arg `"Proder"` |
| **fallo 2** | `"Anotame -20usd en Claude Code en el proyecto Gentius. Activalo de paso"` | **1 acción**: `movimientos`(1) arg `"Claude Code en el proyecto Gentius"` |

Dos cosas que salieron de acá y cambian el plan:

1. **El fallo 1 se reproduce exacto**, y los dos argumentos de bitácora
   vuelven **sin las fechas**: `"Proder"` y `"El Prode"`.
2. **El fallo 2 devuelve UNA acción, no dos** — "Activalo de paso" se
   pierde entero. Pero el argumento **sí trae "Gentius" adentro**, así que
   la mitad del bug se arregla sin tocar el prompt.

### La colisión de "cerrá" no es hipotética: está escrita en el prompt

`recepcionista.ts:303-304` dice hoy, textual:

```
- "retro": cerrar un proyecto y hacer su retrospectiva. Ej: "cerrá Proder",
  "hacé la retro de Gentius".
```

O sea que el prompt manda `"cerrá Proder"` a `retro` **a propósito**. La
Tarea 5 no agrega una regla nueva contra una colisión previsible: **corrige
una línea que hoy dice lo contrario de lo que va a haber que decir.**

### Cuánto cuesta medir el recepcionista

Medido en la misma corrida: cada llamada gasta **~2100 tokens de prompt**
contra un techo de **5500 tokens/minuto** para `MODELO_CHICO`
(`llm.ts:144`). O sea **2 frases por minuto**, y el limitador espera ~59 s
entre pares. Las 14 frases tardaron **~7 minutos**. Con las 16 del piso
ampliado son ~8 minutos **por corrida**, y la Tarea 5 necesita dos.

⚠ **Y cada línea que le agregues al prompt sube ese costo.** No es solo el
riesgo de romper las ambiguas: medir se vuelve más lento a cada línea.

### `leerFecha` no sirve tal cual para la ventana de un proyecto

Corrido con `hoy = "2026-08-11"`:

| Entrada | `leerFecha` devuelve | Por qué |
|---|---|---|
| `"01/04/26"` | `2026-04-01` ✅ | |
| `"31/07/26"` | `2026-07-31` ✅ | |
| `"30/12"` | **`2025-12-30`** ❌ | sin año, una fecha adelante es del año pasado |
| `"2027-01-15"` | **`2026-08-11` ("hoy")** ❌ | nada cae en el futuro |
| `"apertura 01/04/26 y cierre 31/07/26"` | `2026-04-01` | devuelve **solo la primera** |

Las dos reglas están bien para lo que `leerFecha` cubre hoy —una entrada de
bitácora no es de mañana y un gasto dictado ya se pagó— y **están mal para
un proyecto**: un proyecto se puede abrir el mes que viene, y de hecho
`alternarProyectoActivo()` ya contempla ese caso. Por eso la Tarea 3 le
agrega una opción y no un módulo paralelo.

### `resolverProyecto` sobre la frase entera, medido

Reproducido `resolverNombrado` con los tres proyectos reales:

| Texto | Resuelve a |
|---|---|
| `"Claude Code"` | `null` |
| `"Claude Code en el proyecto Gentius"` | **Gentius** ✅ |
| `"Anotame -20usd en Claude Code en el proyecto Gentius. Activalo de paso"` | **Gentius** ✅ |
| `"Venta Proder Keerian"` | Proder ✅ (el comportamiento de hoy, que sirve) |
| `"Venta Proder Keerian en el proyecto Gentius"` | `"ambiguo"` |
| `"Claude Pro - Agosto"` | `null` |

O sea: **el fallo 2 se arregla cambiando el argumento de `resolverProyecto`,
sin ningún regex nuevo**, y el caso de conflicto contesta `"ambiguo"` — que
es exactamente cuando hay que preguntar.

### La salvaguarda de bitácora, medida contra las 6 entradas reales

| Entrada | Caracteres | Palabras | ¿Resuelve **exacto** contra un proyecto o track? |
|---|---|---|---|
| 1 | **186** | 33 | no |
| 2 | 256 | 49 | no |
| 3 | 1543 | 254 | no |
| 4 | 354 | 60 | no |
| 5 | 405 | 68 | no |
| 6 | **2015** | 338 | no |

⚠ **El spec dice "van de 200 a 1500 caracteres" y el rango real es
186-2015.** No cambia nada —el piso de la salvaguarda es 15— pero el número
del spec es inexacto.

Y los casos que **sí tienen que caer**:

| Texto | Caracteres | Palabras | Exacto |
|---|---|---|---|
| `"Proder"` | 6 | 1 | **sí** |
| `"El Prode"` | 8 | 2 | no |
| `"Gentius"` | 7 | 1 | **sí** |
| `"El Prode de Beno"` | **16** | **4** | **sí** |
| `"Product Manager"` | 15 | 2 | sí |

Dos conclusiones que hay que respetar al implementar:

1. **El chequeo de nombre tiene que ser EXACTO, no `resolverProyecto()`.**
   `resolverProyecto` hace match parcial con `aguja.includes(nombre)`, así
   que una anotación larga que **mencione** un proyecto resolvería y caería
   en la pregunta. Contra las 6 entradas de hoy da `null` por casualidad
   (ninguna nombra un proyecto vigente: la que habla del tema dice "HRKit",
   el nombre viejo). No te apoyes en esa casualidad.
2. **El chequeo exacto se gana el lugar con un caso concreto:
   `"El Prode de Beno"`** — 16 caracteres y 4 palabras, o sea que pasa los
   dos filtros de largo y **solo lo agarra el chequeo de nombre**. Es uno de
   los dos proyectos del fallo 1.

### ⚠ Un presupuesto en borrador NO puede colgar de un proyecto

Leído en `20260810002000_presupuestos.sql:189`, la tabla `quotes` tiene:

```sql
constraint quotes_proyecto_coherente
  check ((estado = 'aceptado') = (project_id is not null)),
```

Y `quoteSchema` (`lib/schemas.ts:175`) **no tiene un campo `project_id`**:
`armarFila()` no lo escribe, y `estado` tampoco —lo pone el default
`'borrador'` de la columna—. El único lugar donde `project_id` se llena es
`aceptarPresupuesto()`, que por eso obliga a elegir o crear un proyecto.

**Esto corrige el spec en un punto.** El spec dice que
`presupuesto_dictado` deja "el presupuesto en `borrador`, **sobre un
proyecto que ya existe**", y eso la base no lo permite. Consecuencias:

- `registrar_presupuesto` **no toma un `proyecto`**. Tomarlo sería aceptar
  un dato que no se puede guardar en ningún lado.
- El argumento del spec para meter el presupuesto adentro de
  `registrar_proyecto` —"apuntaría a un proyecto que todavía no existe"—
  resulta que es cierto por una razón distinta de la que dice: un borrador
  no apunta a ningún proyecto nunca. **La conclusión no cambia** y el motivo
  que queda es el bueno: una frase de Beno tiene que costar **una tarjeta y
  una tecla**, no dos viajes a la bandeja.
- "Nace en `borrador`, nunca en `enviado`" **sale gratis**: es el default de
  la columna y `crearPresupuesto()` no manda `estado`. No hay una línea que
  puedas olvidarte de escribir.

---

## Estructura de archivos

### Ola 1 · La caja

| Archivo | Responsabilidad después de esta ola |
|---|---|
| `src/lib/agentes/bitacora.ts` | Además de `leerAnotacion()`, **`pareceAnotacion()`**: el test sobre el string que decide si se escribe o se pregunta. |
| `src/lib/agentes/fechas.ts` | `leerFecha()` con una opción `futuro` que apaga las dos reglas de "nada adelante". |
| `src/lib/agentes/proyectos.ts` | **Nuevo.** `leerPedidoDeProyecto()`: qué operación se pide y con qué fechas, determinístico. |
| `src/lib/agentes/tipos.ts` | `proyecto` en `DESTINOS`; `confirmado` en la decisión y en las opciones de una pregunta. |
| `src/lib/agentes/despacho.ts` | La rama `proyecto`; la salvaguarda en la rama `bitacora`; el proyecto del movimiento resuelto sobre el texto de trabajo y preguntado cuando no se sabe. |
| `src/lib/agentes/recepcionista.ts` | El bullet de `proyecto`, la corrección del bullet de `retro` y la línea del argumento. |
| `src/app/api/agentes/interpretar/route.ts` | Acepta `confirmado` en el cuerpo. |
| `src/components/agentes/caja-agente.tsx` | `ETIQUETA_DESTINO.proyecto` y el `confirmado` de las opciones. |

### Ola 2 · El conector

| Archivo | Responsabilidad después de esta ola |
|---|---|
| `supabase/migrations/20260812000000_bandeja_dictados.sql` | **Nuevo.** Los tres valores de `tipo_bandeja`, solos. |
| `src/lib/mcp/tools/notas.ts` | **Nuevo.** `registrar_nota`. |
| `src/lib/mcp/tools/proyectos.ts` | Suma `registrar_proyecto` (con el presupuesto adentro del payload). |
| `src/lib/mcp/tools/presupuesto-schema.ts` | **Nuevo.** Qué puede decir un modelo de un presupuesto —alcance y esfuerzo, **nunca plata**—. Lo comparten las dos tools. |
| `src/lib/mcp/tools/presupuestos.ts` | **Nuevo.** `registrar_presupuesto`. |
| `src/lib/actions/inbox.ts` | `aceptarNotaDictada()` (generaliza la de adjunto), `aceptarProyectoDictado()`, `aceptarPresupuestoDictado()`. |
| `src/components/bandeja/bandeja-view.tsx` | Las tres tarjetas. |
| `src/app/api/mcp/route.ts` | Registra las familias nuevas. |

---

# OLA 1 · La caja

## Task 1: La salvaguarda de la bitácora

**Es lo primero de todo el plan y se despliega solo.** Es lo único acá que
frena daño que está pasando hoy: `bitacora` tiene el gancho léxico más ancho
y es el único destino que escribe directo, así que un pedido no cubierto
termina en una fila escrita. Ya pasó.

**Files:**
- Modify: `src/lib/agentes/bitacora.ts`
- Modify: `src/lib/agentes/tipos.ts`
- Modify: `src/lib/agentes/despacho.ts` (rama `case "bitacora"`)
- Modify: `src/app/api/agentes/interpretar/route.ts`
- Modify: `src/components/agentes/caja-agente.tsx`
- Verify: `verificar-salvaguarda.mts` (temporal, se borra en el paso 8)

- [ ] **Step 1: Escribir el script de verificación**

Crear `verificar-salvaguarda.mts` en la raíz:

```ts
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]!] = m[2]!.trim();
}

const { createClient } = await import("@supabase/supabase-js");
const { pareceAnotacion } = await import("./src/lib/agentes/bitacora.ts");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { data: proyectos } = await admin.from("projects").select("nombre, slug");
const { data: tracks } = await admin.from("tracks").select("nombre, slug");
const nombrados = [...(proyectos ?? []), ...(tracks ?? [])];

let fallos = 0;
function chequear(que: string, real: unknown, esperado: unknown) {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${que} → ${JSON.stringify(real)}`);
}

// Las seis entradas reales de Beno: NINGUNA puede caer en la pregunta.
const { data: entradas } = await admin.from("daily_log").select("contenido");
for (const [i, e] of (entradas ?? []).entries()) {
  chequear(
    `entrada real ${i + 1} (${e.contenido.length} chars)`,
    pareceAnotacion(e.contenido, nombrados),
    true,
  );
}

// Los cuatro que SÍ tienen que caer.
chequear('"Proder"', pareceAnotacion("Proder", nombrados), false);
chequear('"El Prode"', pareceAnotacion("El Prode", nombrados), false);
chequear('"Gentius"', pareceAnotacion("Gentius", nombrados), false);
chequear(
  '"El Prode de Beno" (16 chars, 4 palabras: solo lo agarra el nombre exacto)',
  pareceAnotacion("El Prode de Beno", nombrados),
  false,
);
chequear('"pm" (slug de track)', pareceAnotacion("pm", nombrados), false);

// Y los que NO tienen que caer aunque mencionen un proyecto.
chequear(
  "una anotación larga que menciona a Proder",
  pareceAnotacion(
    "Hoy hablé con el cliente de Proder y quedamos en que la segunda etapa arranca en septiembre.",
    nombrados,
  ),
  true,
);
chequear(
  "el límite justo: 15 caracteres y 3 palabras",
  pareceAnotacion("uno dos tresxxx", nombrados),
  true,
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
```

- [ ] **Step 2: Correrlo para verificar que falla**

Run: `npx tsx --conditions=react-server ./verificar-salvaguarda.mts`

Expected: falla al importar, con `pareceAnotacion is not a function` o
`does not provide an export named 'pareceAnotacion'`.

- [ ] **Step 3: Escribir `pareceAnotacion()`**

Al final de `src/lib/agentes/bitacora.ts`, después de `leerAnotacion()`:

```ts
/**
 * Lo mínimo que necesita una fila para poder compararse por nombre.
 * Proyectos y tracks lo cumplen los dos.
 */
interface Nombrado {
  nombre: string;
  slug: string;
}

/**
 * Menos que esto no es una anotación: es un nombre suelto o un pedido a
 * medias. Los dos números salieron de medir las seis entradas reales de
 * Beno el 2026-08-11: la más corta tiene **186 caracteres y 33 palabras**,
 * o sea que el piso está un orden de magnitud por debajo de lo que él
 * escribe de verdad.
 */
const MIN_CHARS = 15;
const MIN_PALABRAS = 3;

/**
 * ¿Esto que se va a escribir parece una anotación?
 *
 * ## Por qué existe
 *
 * `bitacora` es **el destino con el gancho léxico más ancho** ("anotá",
 * "apuntá", "registrá", "guardá") y **el único que escribe directo**. Esas
 * dos cosas juntas lo convierten en el sumidero de todo lo que la app no
 * sabe hacer: cuando un pedido no está cubierto, el recepcionista aterriza
 * en el vecino léxico más cercano y termina acá. En el resto del diseño el
 * peor caso es "una propuesta basura que se rechaza con una tecla"; acá el
 * peor caso es **una fila escrita**, y pasó — el 2026-08-10, pedir las
 * fechas de dos proyectos dejó dos entradas con el contenido `"Proder"` y
 * `"El Prode"`.
 *
 * ⚠ **Va en código y no en el prompt del recepcionista, a propósito.** Es
 * la misma regla que ya aplicó `textoDelMovimiento()`: si algo se puede
 * resolver con un test sobre un string, se hace ahí. Ese prompt tiene
 * cuatro incidentes medidos de romperse por agregarle texto.
 *
 * ## Por qué la comparación de nombre es EXACTA
 *
 * No usa `resolverProyecto()`, que hace match parcial
 * (`aguja.includes(nombre)`): con eso, cualquier anotación larga que
 * **mencione** un proyecto caería en la pregunta. Medido el 2026-08-11
 * contra las seis entradas reales, hoy da `null` de casualidad —ninguna
 * nombra un proyecto vigente, la que habla del tema dice "HRKit"— y no hay
 * que apoyarse en esa casualidad.
 *
 * El chequeo exacto se gana el lugar con un caso concreto y no hipotético:
 * **`"El Prode de Beno"` tiene 16 caracteres y 4 palabras**, así que pasa
 * los dos filtros de largo y lo único que lo agarra es esto. Es uno de los
 * dos proyectos del fallo que originó la salvaguarda.
 */
export function pareceAnotacion(
  contenido: string,
  nombrados: Nombrado[],
): boolean {
  const limpio = contenido.trim();

  if (limpio.length < MIN_CHARS) return false;
  if (limpio.split(/\s+/).filter(Boolean).length < MIN_PALABRAS) return false;

  return !esNombreDeEntidad(limpio, nombrados);
}

/** Coincide **exactamente** con el nombre o el slug de un proyecto o un track. */
export function esNombreDeEntidad(
  texto: string,
  nombrados: Nombrado[],
): Nombrado | null {
  const aguja = normalizarNombre(texto);
  if (!aguja) return null;

  return (
    nombrados.find(
      (n) =>
        normalizarNombre(n.nombre) === aguja ||
        normalizarNombre(n.slug) === aguja,
    ) ?? null
  );
}

/**
 * El mismo criterio que `agentes/resolver.ts`: minúsculas, sin tildes y
 * sin puntuación. Está duplicado a propósito y son cinco líneas: lo de
 * allá es un módulo `server-only` y esto tiene que poder correrse desde un
 * script de verificación sin arrastrar medio Next.
 */
function normalizarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Correr el script y verificar que pasa**

Run: `npx tsx --conditions=react-server ./verificar-salvaguarda.mts`

Expected: 13 líneas `ok` y `TODO OK`.

- [ ] **Step 5: Agregar `confirmado` a la decisión y a las opciones**

Sin esto la pregunta es un bucle: Beno elige "Sí, anotalo", vuelve a
`bitacora` con el mismo texto, la salvaguarda dispara de nuevo.

En `src/lib/agentes/tipos.ts`, dentro de `decisionBase`, después de
`analizar`:

```ts
  /**
   * Beno ya contestó que sí a una pregunta de confirmación.
   *
   * **No lo produce el modelo** —igual que `analizar` cuando el destino
   * viene elegido a mano—: lo pone el route handler cuando Beno aprieta
   * una opción que lo trae. Es lo único que le permite a una rama con
   * salvaguarda distinguir "el recepcionista derivó esto acá" de "Beno
   * dijo que sí". Sin él, la pregunta se vuelve a hacer para siempre.
   */
  confirmado: z.boolean().optional(),
```

Y en la variante `pregunta` de `RespuestaSimple`, en el mismo archivo:

```ts
      opciones: {
        etiqueta: string;
        destino: Destino;
        argumento: string | null;
        /** La opción que dice "sí, hacelo igual". Apaga la salvaguarda. */
        confirmado?: boolean;
      }[];
```

- [ ] **Step 6: Cablear `confirmado` de punta a punta**

En `src/app/api/agentes/interpretar/route.ts`, en `cuerpoSchema`:

```ts
    argumento: z.string().max(300).nullable().optional(),
    /** Solo lo manda la caja cuando Beno eligió una opción de confirmación. */
    confirmado: z.boolean().optional(),
```

En el mismo archivo, en el destructuring y en la construcción de la
decisión:

```ts
  const { frase, destino, argumento, adjuntos, confirmado } = parseado.data;
```

```ts
    const decisiones = destino
      ? [{ destino, argumento: argumento ?? null, confianza: 1, confirmado }]
      : await decidirDestinos(frase);
```

En `src/components/agentes/caja-agente.tsx`, la firma de `enviar` y el
cuerpo del fetch:

```ts
  async function enviar(
    destino?: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) {
```

```ts
        body: JSON.stringify({
          frase: texto,
          destino,
          argumento: dato,
          ...(confirmado ? { confirmado } : {}),
          ...(adjuntos ? { adjuntos } : {}),
        }),
```

Y las tres firmas de `onElegir` del archivo (líneas 389, 456, 739 antes de
este cambio) pasan a:

```ts
  onElegir: (
    destino: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) => void;
```

En el `case "pregunta"`, el `onClick` de cada opción:

```ts
                onClick={() => onElegir(o.destino, o.argumento, o.confirmado)}
```

- [ ] **Step 7: La salvaguarda en la rama `bitacora`**

En `src/lib/agentes/despacho.ts`, `case "bitacora"`, **después** de leer
los proyectos y **antes** de resolver el proyecto por nombre. El orden
importa: la pregunta necesita saber contra qué entidad resolvió.

Cambiar el import:

```ts
import { leerAnotacion, esNombreDeEntidad, pareceAnotacion } from "@/lib/agentes/bitacora";
```

Y agregar, justo después de `const todos = proyectos ?? [];`:

```ts
      /*
        ⚠ **Si lo que se va a anotar no parece una anotación, se pregunta
        en vez de escribir.**

        `bitacora` es el destino con el gancho léxico más ancho y el único
        que escribe directo: cuando un pedido no está cubierto por ningún
        especialista, el recepcionista aterriza acá y lo que era un "no sé
        hacer eso" se convierte en una fila escrita. Pasó el 2026-08-10 —
        pedir las fechas de dos proyectos dejó dos entradas con el
        contenido "Proder" y "El Prode"—. El desarrollo del test está en
        `agentes/bitacora.ts`.

        `confirmado` es la salida: cuando Beno aprieta "Sí, anotalo", la
        opción vuelve con esa marca y esto no se vuelve a preguntar.
      */
      const { data: tracksParaChequeo } = await supabase
        .from("tracks")
        .select("nombre, slug");

      const nombrados = [...todos, ...(tracksParaChequeo ?? [])];

      if (
        !decision.confirmado &&
        !pareceAnotacion(anotacion.contenido, nombrados)
      ) {
        const entidad = esNombreDeEntidad(anotacion.contenido, nombrados);

        return {
          clase: "pregunta",
          titulo: entidad
            ? `¿“${anotacion.contenido}” querías anotarlo en la bitácora, o querías hacer algo con ${entidad.nombre}?`
            : `¿“${anotacion.contenido}” querías anotarlo en la bitácora?`,
          opciones: [
            {
              etiqueta: "Sí, anotalo",
              destino: "bitacora" as const,
              argumento: anotacion.contenido,
              confirmado: true,
            },
            ...(entidad
              ? [
                  {
                    etiqueta: `Ver los números de ${entidad.nombre}`,
                    destino: "consultas" as const,
                    argumento: entidad.nombre,
                  },
                ]
              : []),
          ],
        };
      }
```

⚠ **La segunda opción apunta a `consultas` y no a `proyecto` porque ese
destino todavía no existe.** La Tarea 4 la reapunta; son tres líneas y está
anotado ahí como paso explícito.

- [ ] **Step 8: Verificar y borrar el script**

```bash
npx tsx --conditions=react-server ./verificar-salvaguarda.mts
npm run typecheck && npm run lint
rm verificar-salvaguarda.mts
```

Expected: `TODO OK`, typecheck limpio, lint limpio.

- [ ] **Step 9: Probarlo a mano en la app**

Levantar `npm run dev`, entrar a la caja y escribir `anotá Proder`.

Expected: **no se escribe nada**; vuelve la pregunta con dos botones.
Apretar "Sí, anotalo" escribe la entrada con el contenido `"Proder"`.

Después escribir una anotación real de dos renglones. Expected: se guarda
directo, sin pregunta, igual que antes.

- [ ] **Step 10: Commit**

```bash
git add src/lib/agentes/bitacora.ts src/lib/agentes/tipos.ts src/lib/agentes/despacho.ts src/app/api/agentes/interpretar/route.ts src/components/agentes/caja-agente.tsx
git commit -m "La bitacora pregunta en vez de escribir lo que no parece una anotacion"
```

---

## Task 2: El proyecto del movimiento, buscado en la frase y preguntado

**Files:**
- Modify: `src/lib/agentes/despacho.ts` (`case "movimientos"`)
- Verify: `verificar-proyecto-movimiento.mts` (temporal, se borra en el paso 6)

El bug de `activo` **ya no está**: `despacho.ts:502-509` resuelve sin
filtrar por estado desde el plan del reparto por fecha, con el comentario
que lo explica. Lo que queda es el segundo bug —buscar el proyecto solo
dentro de la descripción extraída— y la pregunta que falta.

- [ ] **Step 1: Escribir el script de verificación**

Crear `verificar-proyecto-movimiento.mts` en la raíz:

```ts
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]!] = m[2]!.trim();
}

const { createClient } = await import("@supabase/supabase-js");
const { resolverProyecto } = await import("./src/lib/agentes/resolver.ts");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { data: proyectos } = await admin.from("projects").select("*");

let fallos = 0;
function chequear(texto: string, esperado: string | null) {
  const r = resolverProyecto(texto, proyectos ?? []);
  const nombre = r === "ambiguo" ? "ambiguo" : (r?.nombre ?? null);
  const ok = nombre === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${JSON.stringify(texto)} → ${nombre}`);
}

// Rule 1: lo que la frase dice explícitamente.
chequear("Claude Code en el proyecto Gentius", "Gentius");
chequear("-20usd en Claude Code en el proyecto Gentius", "Gentius");
// Rule 2: lo que nombre la descripción, que es el comportamiento de hoy.
chequear("Venta Proder Keerian", "Proder");
// Rule 3: nada, o dos que se contradicen → hay que preguntar.
chequear("Claude Code", null);
chequear("Claude Pro - Agosto", null);
chequear("Venta Proder Keerian en el proyecto Gentius", "ambiguo");

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
```

- [ ] **Step 2: Correrlo — ya pasa, y ese es el punto**

Run: `npx tsx --conditions=react-server ./verificar-proyecto-movimiento.mts`

Expected: `TODO OK` **antes de tocar nada**. El script no prueba código
nuevo: prueba que `resolverProyecto` sobre el texto entero ya devuelve lo
que hace falta. Lo que está mal es **qué texto se le pasa**, no la función.
Guardalo: en el paso 5 se corre otra vez para confirmar que nada se movió.

- [ ] **Step 3: Resolver el proyecto sobre el texto de trabajo**

En `src/lib/agentes/despacho.ts`, `case "movimientos"`. Reemplazar la
primera línea del bloque:

```ts
      const hoy = todayISO();
      const texto = textoDelMovimiento(decision.argumento, frase);
```

por:

```ts
      const hoy = todayISO();

      /*
        Cuando esto viene de la pregunta de proyecto de abajo, el argumento
        vuelve como `"<texto del movimiento> — <slug>"`. Se parte acá,
        explícito, con el mismo helper y el mismo formato que usan
        `lecciones_tema` y `tema_estudio` para su pregunta de entidad.

        La gracia es la misma: lo que vuelve del lado izquierdo es la
        frase telegráfica original, así que `leerMovimiento()` la resuelve
        con el regex y la segunda vuelta **no gasta ninguna llamada al
        modelo** ni puede leer distinto lo que ya había leído bien.
      */
      const [argumentoCrudo, proyectoElegido] = partirArgumento(
        decision.argumento,
      );
      const texto = textoDelMovimiento(argumentoCrudo || null, frase);
```

Y reemplazar el bloque de resolución del proyecto (hoy en las líneas
494-509) por:

```ts
      /*
        ⚠ **El proyecto se busca en el texto de trabajo, no en la
        descripción extraída.**

        La descripción de "Anotame -20usd en Claude Code en el proyecto
        Gentius" es `"Claude Code"`, así que buscando ahí la palabra
        "Gentius" nunca entraba en la comparación y el movimiento se iba a
        "Compartido". Le pasó a Beno el 2026-08-10.

        Con el texto entero las dos reglas del spec salen de una sola
        llamada, y eso está medido (2026-08-11, contra los tres proyectos
        reales): lo explícito gana ("…en el proyecto Gentius" → Gentius) y
        lo de la descripción sigue funcionando ("Venta Proder Keerian" →
        Proder). Cuando las dos fuentes se contradicen —"Venta Proder
        Keerian en el proyecto Gentius"— devuelve `"ambiguo"`, que es
        exactamente cuando hay que preguntar en vez de elegir.

        Sin filtro por estado, y es deliberado: que un proyecto esté
        cerrado no impide imputarle un gasto. Al revés — un gasto de un
        proyecto cerrado va a ese proyecto, que para eso se cerró en esa
        fecha y no en otra.
      */
      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const todosLosProyectos = proyectos ?? [];

      const nombrado =
        proyectoElegido === COMPARTIDO_EN_PREGUNTA
          ? null
          : proyectoElegido
            ? resolverProyecto(proyectoElegido, todosLosProyectos)
            : resolverProyecto(texto, todosLosProyectos);

      const proyecto = nombrado !== "ambiguo" ? nombrado : null;

      /*
        **Si no se sabe de qué proyecto es, se pregunta.** Lo pidió Beno:
        hasta ahora se asumía "Compartido" en silencio, y eso es una
        imputación que toma la app sin decirlo. Va al final de las
        preguntas —después de monto, descripción y fecha— con el mismo
        criterio de siempre: primero lo más caro de equivocar.

        "Compartido" va **primero y con nombre**, porque es una elección
        legítima y frecuente (las suscripciones), no un default.
      */
      if (!proyecto && !proyectoElegido && todosLosProyectos.length > 0) {
        return {
          clase: "pregunta",
          titulo:
            nombrado === "ambiguo"
              ? `Nombraste más de un proyecto. ¿A cuál va “${descripcion}”?`
              : `¿De qué proyecto es “${descripcion}”?`,
          opciones: [
            {
              etiqueta: "Compartido (se reparte)",
              destino: "movimientos" as const,
              argumento: `${texto} — ${COMPARTIDO_EN_PREGUNTA}`,
            },
            ...todosLosProyectos.map((p) => ({
              etiqueta: p.nombre,
              destino: "movimientos" as const,
              argumento: `${texto} — ${p.slug}`,
            })),
          ],
        };
      }
```

Y arriba, junto a `PEDIDO_EN_URL_CHARS`:

```ts
/**
 * El slug que manda la opción "Compartido" de la pregunta de proyecto.
 *
 * No puede ser el string vacío —el `— ` desaparecería y `partirArgumento`
 * devolvería `null`, o sea "no eligió nada" y la pregunta volvería a
 * salir—. Con un centinela que ningún slug puede tener, elegir compartido
 * es una decisión que llega, no una ausencia.
 */
const COMPARTIDO_EN_PREGUNTA = "__compartido__";
```

⚠ **El centinela se chequea ANTES de buscarlo como slug** —está así en el
bloque de arriba— y el guardia de la pregunta pide `!proyectoElegido`, no
`!proyecto`. Las dos cosas son la misma precaución: sin ellas, elegir
"Compartido" vuelve a caer en `proyecto === null` y la pregunta se hace
para siempre. Es el mismo bucle que la salvaguarda de la Tarea 1 resuelve
con `confirmado`.

- [ ] **Step 4: Ajustar la procedencia**

En el mismo `case`, el campo `proyecto` de `procedencia`:

```ts
        proyecto: proyecto
          ? proyectoElegido
            ? "lo elegiste vos"
            : "lo nombraste en la frase"
          : "compartido, lo elegiste vos",
```

- [ ] **Step 5: Verificar**

```bash
npx tsx --conditions=react-server ./verificar-proyecto-movimiento.mts
npm run typecheck && npm run lint
rm verificar-proyecto-movimiento.mts
```

Expected: `TODO OK`, typecheck limpio, lint limpio.

- [ ] **Step 6: Probarlo a mano**

Con `npm run dev`, escribir en la caja:

| Frase | Esperado |
|---|---|
| `Anotame -20usd en Claude Code en el proyecto Gentius` | el formulario abre con **Gentius**, y la procedencia dice "lo nombraste en la frase" |
| `-20usd Claude Code 06/08` | **pregunta** de qué proyecto es, con "Compartido (se reparte)" primero |
| elegir "Compartido" en esa pregunta | el formulario abre con Compartido y **sin gastar otra llamada al modelo** (mirá la consola: no tiene que aparecer una línea `[llm] movimientos`) |

⚠ **El segundo caso es un click más en el camino más usado de la app.** Es
lo que pidió Beno con todas las letras ("compartido tiene que ser una
elección visible, no el default silencioso") y por eso se hace, pero es el
costo real de esta tarea y hay que verlo antes de darla por buena. Si al
usarlo molesta, la salida no es volver al default mudo: es que la pregunta
recuerde la última elección, y eso es otra tarea.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agentes/despacho.ts
git commit -m "El proyecto del movimiento sale de la frase entera, y si no se sabe se pregunta"
```

---

## Task 3: Fechas que pueden caer adelante, y el pedido de proyecto

**Files:**
- Modify: `src/lib/agentes/fechas.ts`
- Create: `src/lib/agentes/proyectos.ts`
- Verify: `verificar-fechas-proyecto.mts` (temporal, se borra en el paso 6)

`leerFecha()` tiene dos reglas que dicen "nada cae en el futuro", y las dos
están bien para lo que cubre hoy: una entrada de bitácora no es de mañana y
un gasto dictado ya se pagó. **Para la ventana de un proyecto están mal**, y
medido el 2026-08-11 el daño es silencioso: `"2027-01-15"` vuelve como
`2026-08-11` y `"30/12"` vuelve como **`2025-12-30`**.

- [ ] **Step 1: Escribir el script de verificación**

Crear `verificar-fechas-proyecto.mts` en la raíz:

```ts
const { leerFecha } = await import("./src/lib/agentes/fechas.ts");
const { leerPedidoDeProyecto } = await import("./src/lib/agentes/proyectos.ts");

const hoy = "2026-08-11";
let fallos = 0;

function chequear(que: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${que} → ${JSON.stringify(real)}`);
}

// --- leerFecha sigue igual sin la opción -------------------------
chequear("01/04/26 (sin futuro)", leerFecha("01/04/26", hoy).fecha, "2026-04-01");
chequear("30/12 (sin futuro)", leerFecha("30/12", hoy).fecha, "2025-12-30");
chequear("2027-01-15 (sin futuro)", leerFecha("2027-01-15", hoy).fecha, hoy);

// --- con futuro permitido ----------------------------------------
const F = { futuro: true };
chequear("30/12 (con futuro)", leerFecha("30/12", hoy, F).fecha, "2026-12-30");
chequear("2027-01-15 (con futuro)", leerFecha("2027-01-15", hoy, F).fecha, "2027-01-15");
chequear("01/04/26 (con futuro)", leerFecha("01/04/26", hoy, F).fecha, "2026-04-01");

// --- el pedido entero --------------------------------------------
const p1 = leerPedidoDeProyecto(
  "Proder apertura 01/04/26 y cierre 31/07/26",
  hoy,
);
chequear("fallo 1 · operación", p1.operacion, "ventana");
chequear("fallo 1 · apertura", p1.apertura, "2026-04-01");
chequear("fallo 1 · cierre", p1.cierre, "2026-07-31");
chequear("fallo 1 · nombre", p1.nombre, "Proder");

const p2 = leerPedidoDeProyecto("cerrá Proder", hoy);
chequear("cerrar sin fecha · operación", p2.operacion, "cerrar");
chequear("cerrar sin fecha · cierre", p2.cierre, null);

const p3 = leerPedidoDeProyecto("reabrí Proder", hoy);
chequear("reabrir", p3.operacion, "reabrir");

const p4 = leerPedidoDeProyecto("activalo", hoy);
chequear("activalo (sin nombre) → reabrir", p4.operacion, "reabrir");
chequear("activalo · nombre vacío", p4.nombre, "");

const p5 = leerPedidoDeProyecto("creá el proyecto Agente de RRHH", hoy);
chequear("crear · operación", p5.operacion, "crear");
chequear("crear · nombre", p5.nombre, "Agente de RRHH");

const p6 = leerPedidoDeProyecto("renombrá HRKit a Gentius", hoy);
chequear("renombrar · operación", p6.operacion, "renombrar");
chequear("renombrar · nombre", p6.nombre, "HRKit");
chequear("renombrar · nuevo", p6.nuevoNombre, "Gentius");

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
```

- [ ] **Step 2: Correrlo para verificar que falla**

Run: `npx tsx --conditions=react-server ./verificar-fechas-proyecto.mts`

Expected: falla al importar `./src/lib/agentes/proyectos.ts` (no existe).

- [ ] **Step 3: La opción `futuro` en `fechas.ts`**

En `src/lib/agentes/fechas.ts`, cambiar la interfaz de las reglas y las dos
que ajustan el año.

La interfaz:

```ts
/**
 * Opciones de lectura.
 *
 * `futuro` apaga las **dos** reglas de "nada cae adelante": la del año
 * implícito (sin año escrito, una fecha adelante es del año pasado) y el
 * recorte a hoy. Las dos existen porque lo que usa esto hoy —bitácora y
 * movimientos— registra lo que ya pasó.
 *
 * ⚠ **Un proyecto no.** Un proyecto se puede abrir el mes que viene, y
 * `alternarProyectoActivo()` ya contempla ese caso. Sin esta opción,
 * "cerrá X el 30/12" escribiría **2025**-12-30 y "abrí X el 2027-01-15"
 * escribiría hoy, las dos cosas en silencio y contra el check
 * `projects_fechas_coherentes`. Medido el 2026-08-11.
 */
export interface OpcionesFecha {
  futuro?: boolean;
}

interface ReglaFecha {
  patron: RegExp;
  armar: (
    m: RegExpMatchArray,
    hoy: string,
    futuro: boolean,
  ) => { fecha: string; etiqueta: string } | null;
}
```

La regla de `"5/8"` / `"05/08/2026"`:

```ts
    armar: (m, hoy, futuro) => {
      const anio = m[3]
        ? Number(m[3].length === 2 ? `20${m[3]}` : m[3])
        : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, Number(m[2]), Number(m[1]));
      if (!fecha) return null;
      // Sin año escrito, una fecha que cae adelante es del año pasado:
      // el 3 de enero, "el 28/12" es diciembre del año que se fue. Salvo
      // que quien llama diga que el futuro vale.
      const ajustada =
        !futuro && !m[3] && fecha > hoy
          ? armarISO(anio - 1, Number(m[2]), Number(m[1]))
          : fecha;
      return ajustada
        ? { fecha: ajustada, etiqueta: formatDate(ajustada) }
        : null;
    },
```

La regla de `"el 5 de agosto"`:

```ts
    armar: (m, hoy, futuro) => {
      const mes = MESES[m[2]!]!;
      const anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, mes, Number(m[1]));
      if (!fecha) return null;
      const ajustada =
        !futuro && !m[3] && fecha > hoy
          ? armarISO(anio - 1, mes, Number(m[1]))
          : fecha;
      return ajustada
        ? { fecha: ajustada, etiqueta: formatDate(ajustada) }
        : null;
    },
```

Y `leerFecha`:

```ts
export function leerFecha(
  texto: string,
  hoy: string,
  opciones: OpcionesFecha = {},
): FechaLeida {
  const futuro = opciones.futuro === true;
  const normalizado = normalizarConservandoFechas(texto);

  for (const regla of REGLAS) {
    const coincidencia = normalizado.match(regla.patron);
    if (!coincidencia) continue;

    const armado = regla.armar(coincidencia, hoy, futuro);
    if (!armado) continue;

    const adelante = armado.fecha > hoy;

    return {
      fecha: !futuro && adelante ? hoy : armado.fecha,
      etiqueta: !futuro && adelante ? "hoy" : armado.etiqueta,
      explicita: true,
    };
  }

  return { fecha: hoy, etiqueta: "hoy", explicita: false };
}
```

Las otras cinco reglas (`anteayer`, `ayer`, `hace N días`, `la semana
pasada`, el día de la semana, `hoy`) ignoran el tercer parámetro: todas
miran para atrás por construcción y no hay nada que apagar.

⚠ `partirFechaFinal()` llama a `leerFecha(cola, hoy)` **sin opciones** y
tiene que quedar así: la usa el extractor de movimientos, que sí registra lo
que ya pasó.

- [ ] **Step 4: Crear `src/lib/agentes/proyectos.ts`**

```ts
import { leerFecha } from "@/lib/agentes/fechas";

/**
 * Qué se le pide a un proyecto, leído de la frase **sin modelo**.
 *
 * Es el mismo criterio que `fechas.ts` y `rango.ts`: si algo se puede
 * resolver sin modelo, se resuelve sin modelo. El recepcionista devuelve
 * texto libre ("Proder apertura 01/04/26 y cierre 31/07/26") y pasar eso a
 * una operación con dos fechas es un puñado de expresiones regulares.
 *
 * ## Por qué esto habilita a la rama a escribir directo
 *
 * Igual que `agentes/bitacora.ts`: **no hay producción de un modelo**. Las
 * fechas las dice Beno, leerlas es aritmética de calendario y el nombre del
 * proyecto se resuelve contra tres filas. No hay nada que confirmar que no
 * haya escrito él.
 *
 * ⚠ **Si alguna vez el prompt de este destino pasa a pedirle al modelo que
 * interprete, complete o infiera fechas, ese razonamiento se cae y esto
 * pasa a necesitar la bandeja.** El recepcionista tiene prohibido tocar el
 * argumento; lo único que hace es recortar de la frase qué parte le toca a
 * este destino.
 */

export type OperacionDeProyecto =
  /** Crear uno nuevo. */
  | "crear"
  /** Poner o mover `fecha_inicio` / `fecha_fin`. */
  | "ventana"
  /** Cerrar: `fecha_fin` en la fecha dicha, o en hoy. */
  | "cerrar"
  /** Reabrir: `fecha_fin` a null. */
  | "reabrir"
  /** Cambiarle el nombre. */
  | "renombrar";

export interface PedidoDeProyecto {
  operacion: OperacionDeProyecto;
  /**
   * El texto con el que hay que encontrar el proyecto, ya sin los verbos
   * ni las fechas. Puede quedar vacío ("activalo"), y ahí quien llama
   * pregunta cuál.
   */
  nombre: string;
  /** Solo en `renombrar`. */
  nuevoNombre: string | null;
  apertura: string | null;
  cierre: string | null;
}

/** Los verbos de cada operación. Léxicos, como todo lo determinístico acá. */
const CREAR = /\b(?:cre[áa]|cre[áa]me|arm[áa]|nuevo\s+proyecto|proyecto\s+nuevo)\b/i;
const CERRAR = /\b(?:cerr[áa]|cerr[áa]me|dar?\s+de\s+baja|termin[áa]|finaliz[áa])\b/i;
const REABRIR = /\b(?:reabr[íi]|volv[ée]\s+a\s+abrir|activ[áa](?:lo|la)?|reactiv[áa](?:lo|la)?|abr[íi]\s+de\s+nuevo)\b/i;
const RENOMBRAR = /\b(?:renombr[áa]|cambi[áa]le\s+el\s+nombre|pas[áa]\s+a\s+llamarse)\b/i;

/** Dónde parte el texto entre lo de apertura y lo de cierre. */
const MARCA_APERTURA = /\b(?:apertura|inicio|arranc[óa]|arranca|empez[óa]|desde|abri[óo])\b/i;
const MARCA_CIERRE = /\b(?:cierre|fin(?:aliz[óa])?|termin[óa]|hasta|cerr[óo])\b/i;

/**
 * Todo lo que `fechas.ts` sabe leer, para poder **sacarlo** del texto y
 * quedarme con el nombre. Se arma de la misma lista para que no se separe
 * de las reglas: si allá aparece un formato nuevo, acá deja de borrarse y
 * se ve enseguida en el nombre resuelto.
 */
const EXPRESIONES_DE_FECHA =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:el\s+)?\d{1,2}\s+de\s+[a-záéíóú]+(?:\s+de\s+\d{4})?|anteayer|antes\s+de\s+ayer|ayer|hoy|hace\s+\S+\s+(?:d[íi]as?|semanas?)|(?:la\s+)?semana\s+pasada)\b/gi;

/**
 * Palabras de relleno que quedan pegadas al nombre después de sacar los
 * verbos y las fechas ("el proyecto Proder", "las fechas de Proder").
 */
const RELLENO =
  /\b(?:el|la|los|las|un|una|de|del|para|las?\s+fechas?|proyecto|proyectos|y|con|que|su)\b/gi;

export function leerPedidoDeProyecto(
  argumento: string | null,
  hoy: string,
): PedidoDeProyecto {
  const texto = (argumento ?? "").trim();

  const operacion: OperacionDeProyecto = RENOMBRAR.test(texto)
    ? "renombrar"
    : REABRIR.test(texto)
      ? "reabrir"
      : CREAR.test(texto)
        ? "crear"
        : CERRAR.test(texto) && !MARCA_APERTURA.test(texto)
          ? "cerrar"
          : "ventana";

  const { apertura, cierre } = leerLasDosFechas(texto, hoy);

  // "renombrá X a Y": el nombre nuevo es lo que viene después del " a ".
  let nuevoNombre: string | null = null;
  let paraElNombre = texto;

  if (operacion === "renombrar") {
    const corte = texto.search(/\s+a\s+/i);
    if (corte !== -1) {
      nuevoNombre = limpiarNombre(texto.slice(corte + 3), { relleno: false });
      paraElNombre = texto.slice(0, corte);
    }
  }

  return {
    operacion,
    nombre: limpiarNombre(paraElNombre, { relleno: true }),
    nuevoNombre,
    apertura,
    cierre,
  };
}

/**
 * Las dos fechas de una ventana, leídas por separado.
 *
 * `leerFecha()` devuelve **solo la primera** que encuentra, así que el
 * texto se parte antes por las marcas de apertura y cierre. Sin partir,
 * "apertura 01/04/26 y cierre 31/07/26" devolvía 01/04 para las dos cosas.
 *
 * ⚠ **Las dos van con `{ futuro: true }`.** Es lo único que hace que "cerrá
 * X el 30/12" escriba diciembre de este año y no del pasado.
 */
function leerLasDosFechas(
  texto: string,
  hoy: string,
): { apertura: string | null; cierre: string | null } {
  const iCierre = texto.search(MARCA_CIERRE);
  const iApertura = texto.search(MARCA_APERTURA);

  // Sin ninguna marca, una sola fecha suelta: es de lo que diga el verbo.
  if (iCierre === -1 && iApertura === -1) {
    const sola = leerFecha(texto, hoy, { futuro: true });
    if (!sola.explicita) return { apertura: null, cierre: null };
    return CERRAR.test(texto)
      ? { apertura: null, cierre: sola.fecha }
      : { apertura: sola.fecha, cierre: null };
  }

  const corte =
    iCierre === -1 ? texto.length : iApertura > iCierre ? iApertura : iCierre;

  const primero = texto.slice(0, corte);
  const segundo = texto.slice(corte);

  const laDe = (trozo: string) => {
    const f = leerFecha(trozo, hoy, { futuro: true });
    return f.explicita ? f.fecha : null;
  };

  return iApertura > iCierre
    ? { apertura: laDe(segundo), cierre: laDe(primero) }
    : { apertura: laDe(primero), cierre: laDe(segundo) };
}

/** Saca verbos, fechas y relleno; lo que queda es el nombre. */
function limpiarNombre(
  texto: string,
  { relleno }: { relleno: boolean },
): string {
  let limpio = texto
    .replace(CREAR, " ")
    .replace(CERRAR, " ")
    .replace(REABRIR, " ")
    .replace(RENOMBRAR, " ")
    .replace(MARCA_APERTURA, " ")
    .replace(MARCA_CIERRE, " ")
    .replace(EXPRESIONES_DE_FECHA, " ");

  if (relleno) limpio = limpio.replace(RELLENO, " ");

  return limpio.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 5: Correr el script hasta que pase**

Run: `npx tsx --conditions=react-server ./verificar-fechas-proyecto.mts`

Expected: `TODO OK`.

⚠ **Esto es lo que más chance tiene de no salir al primer intento de todo
el plan**, porque son expresiones regulares sobre castellano libre.
Ajustá las listas léxicas hasta que los 18 chequeos pasen; **no aflojes los
chequeos**. Si algún caso te obliga a una regla que rompe otro, sacá ese
caso del alcance y anotá acá cuál y por qué — es mejor que un lector
determinístico que a veces adivina.

- [ ] **Step 6: Verificar y borrar el script**

```bash
npm run typecheck && npm run lint
rm verificar-fechas-proyecto.mts
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/agentes/fechas.ts src/lib/agentes/proyectos.ts
git commit -m "Las fechas de un proyecto pueden caer adelante, y el pedido se lee sin modelo"
```

---

## Task 4: El destino `proyecto`

**Files:**
- Modify: `src/lib/agentes/tipos.ts`
- Modify: `src/lib/agentes/despacho.ts`
- Modify: `src/components/agentes/caja-agente.tsx`
- Verify: a mano, en la app

**Esta tarea NO toca el prompt del recepcionista.** El destino nace
alcanzable solo desde el pie de "¿no era esto?" y desde la salvaguarda de la
Tarea 1; el prompt es la Tarea 5, medida y aparte. Separarlas es lo que
permite que si la Tarea 5 hay que revertirla, el destino siga existiendo y
funcionando.

- [ ] **Step 1: Agregar el destino**

En `src/lib/agentes/tipos.ts`, en `DESTINOS`, **después de `"retro"`**:

```ts
  "retro",
  "proyecto",
```

Y arriba, en el bloque de comentarios de `DESTINOS`, después del párrafo de
`presupuesto`:

```
 * `proyecto` es el catorceavo y salió de un fallo, no de una idea: hasta
 * que existió **no había ningún destino que escribiera en `projects`**, y
 * cuando un pedido no está cubierto el recepcionista aterriza en el vecino
 * léxico más cercano. "Anotá las fechas de apertura y cierre de Proder y
 * El Prode" (2026-08-10) terminó en dos entradas de bitácora con el
 * contenido "Proder" y "El Prode", más una retro que nadie pidió.
 *
 * Escribe directo, por lo mismo que `bitacora` y `tema_estudio`: **no hay
 * producción de un modelo**. Las fechas las dice Beno, leerlas es
 * aritmética de calendario (`agentes/proyectos.ts`) y el nombre se
 * resuelve contra tres filas.
 *
 * ⚠ Con una obligación que la bitácora no tiene: **mover una ventana mueve
 * balances**, así que la respuesta dice qué cambió Y qué efecto tuvo. Sin
 * eso, el efecto se descubre tres pantallas después.
```

- [ ] **Step 2: `ETIQUETA_DESTINO`**

En `src/components/agentes/caja-agente.tsx:662`, agregar:

```ts
  proyecto: "Proyecto",
```

⚠ `ETIQUETA_DESTINO` es un `Record<Destino, string>`: **sin este paso el
typecheck falla**, que es exactamente lo que tiene que pasar. No lo
resuelvas con un `as`.

- [ ] **Step 3: La rama `proyecto` en `despacho.ts`**

Agregar el `case`, **entre `case "retro"` y `case "lecciones_tema"`**:

```ts
    case "proyecto": {
      /*
        Esta rama ESCRIBE en `projects`, directo y sin pasar por la
        bandeja, y no contradice la regla 6 por lo mismo que `bitacora` y
        `tema_estudio`: **no hay producción de un modelo**. Las fechas las
        dice Beno, leerlas es aritmética de calendario y el nombre del
        proyecto se resuelve contra tres filas.

        ⚠ Y con una obligación que la bitácora no tiene: **mover una
        ventana mueve balances**. La respuesta tiene que decir qué cambió
        y qué efecto tuvo, no un "listo".
      */
      const hoy = todayISO();
      const pedido = leerPedidoDeProyecto(decision.argumento, hoy);

      const { data: proyectosData } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const proyectos = proyectosData ?? [];

      /*
        Los compartidos, para poder decir **qué efecto tuvo** el cambio.
        Se leen acá adentro y no arriba del `switch`: es la única rama que
        los necesita, y las trece de al lado no tienen por qué pagar la
        consulta.
      */
      const { data: compartidosData } = await supabase
        .from("movements")
        .select("id, fecha, descripcion")
        .is("project_id", null)
        .order("fecha");

      const movimientosCompartidos = compartidosData ?? [];

      if (pedido.operacion === "crear") {
        if (!pedido.nombre) {
          return {
            clase: "aviso",
            titulo: "¿Cómo se llama el proyecto?",
            cuerpo:
              "Decime el nombre y, si ya lo sabés, desde cuándo va. El color y el peso quedan en los valores por defecto y se editan en Ajustes.",
          };
        }

        /*
          Por `crearProyecto()` y no con un insert a mano: esa action
          resuelve el slug disponible y valida contra `projectSchema`, que
          tiene el refine del check `projects_fechas_coherentes`. Por ahí
          es por donde "cerralo antes de que abriera" vuelve en castellano
          y no como un error crudo de Postgres.

          Devuelve `ActionResult` y **nunca lanza** para errores
          esperables: se mira el `.ok`, no se envuelve en try/catch.
        */
        const creado = await crearProyecto({
          nombre: pedido.nombre,
          color: COLOR_POR_DEFECTO_DE_PROYECTO,
          fecha_inicio: pedido.apertura,
          fecha_fin: pedido.cierre,
          peso_prorrateo: 1,
        });

        if (!creado.ok) {
          return {
            clase: "aviso",
            titulo: "No pude crear el proyecto",
            cuerpo: creado.error,
          };
        }

        return {
          clase: "texto",
          destino: "proyecto",
          titulo: `Creé el proyecto ${creado.data.nombre}`,
          cuerpo: [
            describirVentana(creado.data),
            efectoDelCambio(
              proyectos,
              [...proyectos, creado.data],
              movimientosCompartidos,
            ),
            "El color y el peso de prorrateo quedaron en los valores por defecto: se cambian desde Ajustes.",
          ].join("\n"),
        };
      }

      // Para todo lo demás hace falta saber de qué proyecto se habla.
      const encontrado = resolverProyecto(pedido.nombre, proyectos);

      if (!encontrado || encontrado === "ambiguo") {
        if (proyectos.length === 0) {
          return {
            clase: "aviso",
            titulo: "Todavía no tenés ningún proyecto",
            cuerpo: "Pedime que cree uno, o creálo desde Ajustes.",
          };
        }

        return {
          clase: "pregunta",
          titulo: pedido.nombre
            ? `No sé de qué proyecto me hablás con “${pedido.nombre}”`
            : "¿De qué proyecto?",
          opciones: proyectos.map((p) => ({
            etiqueta: p.nombre,
            destino: "proyecto" as const,
            // El slug reemplaza al nombre y el resto del pedido queda
            // intacto: las fechas y el verbo tienen que sobrevivir a la
            // pregunta o la respuesta no puede hacer nada.
            argumento: reemplazarNombre(decision.argumento, pedido.nombre, p.slug),
          })),
        };
      }

      const antes = proyectos;
      const despues = proyectos.map((p) =>
        p.id === encontrado.id
          ? {
              ...p,
              nombre: pedido.nuevoNombre ?? p.nombre,
              fecha_inicio: pedido.apertura ?? p.fecha_inicio,
              fecha_fin:
                pedido.operacion === "reabrir"
                  ? null
                  : pedido.operacion === "cerrar"
                    ? (pedido.cierre ?? hoy)
                    : (pedido.cierre ?? p.fecha_fin),
            }
          : p,
      );

      const nuevo = despues.find((p) => p.id === encontrado.id)!;

      /*
        `actualizarProyecto()` solo regenera el slug **si cambió el
        nombre**, para que los links viejos a `/proyectos/<slug>` sigan
        andando. Por eso se le manda el proyecto entero y no un parche: no
        reimplementes el update.
      */
      const guardado = await actualizarProyecto(encontrado.id, {
        nombre: nuevo.nombre,
        color: nuevo.color,
        fecha_inicio: nuevo.fecha_inicio,
        fecha_fin: nuevo.fecha_fin,
        peso_prorrateo: Number(nuevo.peso_prorrateo),
      });

      if (!guardado.ok) {
        return {
          clase: "aviso",
          titulo: "No pude cambiar el proyecto",
          cuerpo: guardado.error,
        };
      }

      return {
        clase: "texto",
        destino: "proyecto",
        titulo:
          pedido.operacion === "renombrar"
            ? `${encontrado.nombre} ahora se llama ${nuevo.nombre}`
            : `Cambié la ventana de ${nuevo.nombre}`,
        cuerpo: [
          describirVentana(nuevo),
          efectoDelCambio(antes, despues, movimientosCompartidos),
          "Si no era esto, cambialo desde Ajustes.",
        ].join("\n"),
      };
    }
```

- [ ] **Step 4: Los tres helpers**

Al final de `src/lib/agentes/despacho.ts`, en una sección nueva:

```ts
// ─────────────────────────────────────────────────────────────
// Proyectos
// ─────────────────────────────────────────────────────────────

/** La ventana en una línea, con las dos puntas nulas dichas en criollo. */
function describirVentana(p: {
  nombre: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}): string {
  const desde = p.fecha_inicio ? formatDate(p.fecha_inicio) : "siempre";
  const hasta = p.fecha_fin ? formatDate(p.fecha_fin) : "sigue abierto";
  return `${p.nombre} va de ${desde} a ${hasta}.`;
}

/**
 * Qué gastos compartidos cambian de reparto por este cambio de ventana.
 *
 * ⚠ **Esto es la obligación del spec y no un adorno**: mover una ventana
 * mueve balances, y sin decirlo el efecto se descubre tres pantallas
 * después. Se calcula con `calcularParticipaciones()` —la misma función
 * que usan los balances y la pantalla de Proyectos— sobre los proyectos
 * de antes y los de después, así que no hay un segundo lugar donde viva
 * la regla del reparto.
 */
function efectoDelCambio(
  antes: ProyectoParaReparto[],
  despues: ProyectoParaReparto[],
  compartidos: { id: string; fecha: string; descripcion: string }[],
): string {
  const participacionesAntes = memoParticipaciones(antes);
  const participacionesDespues = memoParticipaciones(despues);

  const movidos = compartidos.filter((m) => {
    const a = [...participacionesAntes(m.fecha).keys()].sort().join(",");
    const d = [...participacionesDespues(m.fecha).keys()].sort().join(",");
    return a !== d;
  });

  if (movidos.length === 0) {
    return "No cambia el reparto de ningún gasto compartido.";
  }

  const ejemplos = movidos
    .slice(0, 3)
    .map((m) => `${m.descripcion} (${formatDate(m.fecha)})`)
    .join(", ");

  const resto = movidos.length > 3 ? ` y ${movidos.length - 3} más` : "";

  return `Cambia el reparto de ${movidos.length} ${
    movidos.length === 1 ? "gasto compartido" : "gastos compartidos"
  }: ${ejemplos}${resto}. Miralo en Proyectos.`;
}

/**
 * Cambia el pedazo del argumento que nombraba al proyecto por su slug,
 * **dejando el resto intacto**.
 *
 * Es lo que hace que una pregunta de "¿de qué proyecto?" no se lleve
 * puestas las fechas. Es el mismo problema que resolvió `"tema — slug"` en
 * `lecciones_tema`, pero acá el argumento tiene más de un dato adentro y
 * no alcanza con pegar el slug al final.
 */
function reemplazarNombre(
  argumento: string | null,
  nombreLeido: string,
  slug: string,
): string {
  const texto = argumento ?? "";
  if (!nombreLeido) return `${texto} ${slug}`.trim();
  return texto.replace(nombreLeido, slug);
}
```

Y el color por defecto, que **va en `src/lib/schemas.ts`** —al lado de
`projectSchema`, que es donde vive lo compartido entre formularios y
actions— y no acá: en la ola 2 lo va a necesitar una action de bandeja, y
`despacho.ts` es `server-only` de la capa de agentes.

```ts
/**
 * El color con el que nace un proyecto que no se creó desde el formulario
 * (por conversación, o aceptando una propuesta de la bandeja).
 *
 * Es `--chart-1`, el primero de los ocho tonos validados. **No es un color
 * libre**: el selector de Ajustes ofrece esos ocho justamente para que los
 * gráficos no se llenen de colores sin validar (`AGENTS.md`, "Gráficos"), y
 * un alta que no pasa por ese selector no puede ser la puerta por la que
 * entre uno que no está en la lista.
 */
export const COLOR_POR_DEFECTO_DE_PROYECTO = "#008F8F";
```

Y los imports que faltan arriba de `despacho.ts`:

```ts
import { leerPedidoDeProyecto } from "@/lib/agentes/proyectos";
import { crearProyecto, actualizarProyecto } from "@/lib/actions/projects";
import { memoParticipaciones } from "@/lib/prorrateo";
import { COLOR_POR_DEFECTO_DE_PROYECTO } from "@/lib/schemas";
import type { ProyectoParaReparto } from "@/lib/prorrateo";
```

⚠ **`crearProyecto` y `actualizarProyecto` son Server Actions
(`"use server"`) y se pueden llamar desde el servidor sin problema**, pero
devuelven `ActionResult<T>` y **nunca lanzan**. No las envuelvas en
try/catch esperando excepciones: mirá el `.ok`.

⚠ **Y no reimplementes el insert.** `crearProyecto` resuelve el slug
disponible (`slugDisponible`) y `actualizarProyecto` solo regenera el slug
si cambió el nombre, para que los links viejos a `/proyectos/<slug>` sigan
andando. Los dos ya validan contra `projectSchema`, que tiene el refine del
check `projects_fechas_coherentes`: **por ahí es por donde "cerrá X antes
de que abriera" vuelve como un mensaje en castellano y no como un error de
Postgres.**

- [ ] **Step 5: Reapuntar la opción de la salvaguarda**

Ahora que el destino existe, en la rama `bitacora` de la Tarea 1 cambiar la
segunda opción:

```ts
            ...(entidad
              ? [
                  {
                    etiqueta: `Hacer algo con ${entidad.nombre}`,
                    destino: "proyecto" as const,
                    argumento: entidad.nombre,
                  },
                ]
              : []),
```

- [ ] **Step 6: Verificar**

```bash
npm run typecheck && npm run lint
```

Expected: limpio. Si `ETIQUETA_DESTINO` quedó sin la clave, el typecheck lo
dice acá.

- [ ] **Step 7: Probarlo a mano, incluido el efecto en los balances**

Con `npm run dev`, en la caja. Como el prompt todavía no conoce el destino,
llegá por el pie de "¿no era esto?" → **Proyecto**.

| Argumento | Esperado |
|---|---|
| `Proder apertura 01/04/26 y cierre 31/07/26` | "Proder va de 01/04/2026 a 31/07/2026" **y** una línea que diga qué gastos compartidos cambian de reparto |
| `cerrá Proder` | cierre en hoy (11/08/2026), con su efecto |
| `reabrí Proder` | "sigue abierto", con su efecto |
| `creá el proyecto Agente de RRHH` | proyecto creado, sin fechas, y "No cambia el reparto de ningún gasto compartido" **es falso**: sin fechas está vivo siempre, así que entra en todos. Verificá que la línea diga la verdad |

⚠ **El último caso es el que hay que mirar con lupa.** Un proyecto sin
ninguna de las dos fechas participa de **todo** el histórico
(`estaVivo()` con las dos puntas nulas es "desde siempre" y "sigue
abierto"), así que crear uno desde la caja **reescribe cuánto costó cada
uno de los otros**. Si el efecto medido son los 15 compartidos, la línea
tiene que decirlo. Es exactamente el tipo de cosa que el spec pide que no
se descubra tres pantallas después.

**Al terminar de probar, dejá los datos como estaban**: Proder de
01/04/2026 a 20/07/2026, y borrá el proyecto de prueba desde Ajustes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agentes/tipos.ts src/lib/agentes/despacho.ts src/components/agentes/caja-agente.tsx
git commit -m "El destino proyecto existe, escribe la ventana y dice que balances movio"
```

---

## Task 5: Recalibrar el recepcionista, medido

**Files:**
- Modify: `src/lib/agentes/recepcionista.ts`
- Verify: `medir-recepcionista.mts` (temporal, se borra en el paso 7)

**Paso propio, no efecto colateral.** Este prompt es de vidrio: hay
**cuatro incidentes medidos** en los que agregarle texto rompió casos que
ni siquiera nombraba. La receta que funcionó las últimas dos veces:
**líneas léxicas y no prosa**, **arriba del bloque de confianza**, que
queda último.

- [ ] **Step 1: Escribir el medidor**

Crear `medir-recepcionista.mts` en la raíz:

```ts
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]!] = m[2]!.trim();
}

const { decidirDestinos } = await import("./src/lib/agentes/recepcionista.ts");

const FRASES: [string, string][] = [
  ["ambigua", "Claude Code"],
  ["ambigua", "Proder"],
  ["ambigua", "pricing"],
  ["ambigua", "Vercel Pro"],
  ["simple", "pagué 20 usd de Claude Code"],
  ["simple", "cómo viene Proder"],
  ["simple", "qué me toca hoy"],
  ["simple", "qué estoy pagando que no uso"],
  ["simple", "sacá lecciones de lo que aprendí con clientes"],
  ["simple", "anotá que hoy peleé con el deploy toda la tarde"],
  ["telegrafica", "-20usd Claude Code 06/08"],
  ["choque", "qué anotaciones tengo sobre gestión de presupuestos"],
  ["choque-retro", "hacé la retro de Gentius"],
  ["choque-cerrar", "cerrá Proder"],
  ["fallo1", "Anota las fechas de apertura y cierre de Proder y El Prode de Beno 01/04/26 apertura y 31/07/26 para las dos"],
  ["fallo2", "Anotame -20usd en Claude Code en el proyecto Gentius. Activalo de paso"],
];

for (const [grupo, frase] of FRASES) {
  try {
    const acciones = await decidirDestinos(frase);
    console.log(
      `${grupo.padEnd(13)} ${JSON.stringify(frase)}\n              → ${acciones
        .map((a) => `${a.destino}(${a.confianza}) arg=${JSON.stringify(a.argumento)}`)
        .join("\n                ")}`,
    );
  } catch (e: unknown) {
    console.log(`${grupo.padEnd(13)} ${JSON.stringify(frase)}\n              → ERROR ${(e as Error).message}`);
  }
}
```

- [ ] **Step 2: Medir ANTES de tocar una línea**

Run: `npx tsx --conditions=react-server ./medir-recepcionista.mts`

⚠ **Tarda ~8 minutos**: son 16 llamadas de ~2100 tokens contra un techo de
5500 por minuto, o sea **2 por minuto**, con el limitador esperando ~59 s
entre pares. Medido el 2026-08-11. No lo mates pensando que se colgó.

Guardá la salida en un archivo o pegala en el commit: es la mitad de la
evidencia.

Expected (medido el 2026-08-11 con el prompt de hoy): la tabla de "Lo
medido antes de escribir este plan", más las dos filas nuevas —
`"hacé la retro de Gentius"` → `retro` y `"cerrá Proder"` → **`retro`**,
que es el bug que esta tarea viene a corregir.

- [ ] **Step 3: Corregir el bullet de `retro`**

⚠ **Esto es una corrección, no un agregado, y va primero.** El prompt hoy
dice, textual en `recepcionista.ts:303-304`:

```
- "retro": cerrar un proyecto y hacer su retrospectiva. Ej: "cerrá Proder",
  "hacé la retro de Gentius".
```

O sea que manda "cerrá Proder" a `retro` a propósito. Reemplazarlo por:

```
- "retro": hacer la retrospectiva de un proyecto, el documento que se
  escribe al terminarlo. Ej: "hacé la retro de Gentius", "escribí la retro
  de Proder".
```

Sigue siendo **dos líneas**, así que no suma tokens.

- [ ] **Step 4: Agregar el bullet de `proyecto`**

Justo después del bullet de `retro`, **tres líneas léxicas**:

```
- "proyecto": crear, cerrar, reabrir o renombrar un proyecto, o poner sus
  fechas. Ej: "creá el proyecto X", "cerrá X el 31/07", "reabrí X",
  "activalo", "poné que X arrancó el 01/04".
```

Y **dos líneas** pegadas al párrafo que ya separa `roadmap` de `estudio` —
no un párrafo nuevo, el que ya habla de fronteras:

```
"cerrá X" y "poné las fechas de X" son "proyecto": cambian la ficha del
proyecto. "hacé la retro de X" es "retro": escribe un documento sobre él.
```

Y **una línea** pegada a la instrucción del argumento, que es de lo que
habla:

```
Para "proyecto" copiá el nombre del proyecto Y las fechas tal como las
escribió, sin sacarle ninguna.
```

**Total: 6 líneas nuevas, todas arriba del bloque de confianza, ninguna en
prosa.** El bloque de confianza y sus cuatro ejemplos quedan **últimos**,
sin tocar. Es exactamente la receta que salió limpia al primer intento con
`presupuesto`.

- [ ] **Step 5: Medir DESPUÉS**

Run: `npx tsx --conditions=react-server ./medir-recepcionista.mts`

**El piso de regresión, y qué se hace si se rompe:**

| Qué | Esperado | Si falla |
|---|---|---|
| `"Claude Code"`, `"Proder"`, `"pricing"`, `"Vercel Pro"` | los cuatro **< 0.6** | **revertí y acortá.** Es la trampa que mordió cuatro veces |
| Las seis simples | **una sola acción** cada una, mismo destino que antes | revertí |
| `"-20usd Claude Code 06/08"` | argumento **idéntico a la frase, con la fecha** | revertí: es la señal de que hay texto de más |
| `"qué anotaciones tengo sobre gestión de presupuestos"` | `buscador` | revertí |
| `"hacé la retro de Gentius"` | `retro` | ajustá el bullet de `retro` |
| **`"cerrá Proder"`** | **`proyecto`** (antes: `retro`) | el corte por verbo no prendió: reforzá **las dos líneas de frontera**, no el bullet |
| **fallo 1** | **dos acciones `proyecto`**, con las fechas en el argumento, y **cero `retro`** | ver abajo |
| **fallo 2** | dos acciones: `movimientos` con Gentius **y** `proyecto` | ver abajo |

Dos cosas que hay que saber antes de leer el resultado de las dos últimas
filas:

1. **El fallo 1 hoy devuelve los argumentos `"Proder"` y `"El Prode"`, sin
   las fechas.** Esa es la línea del argumento del paso 4, y es la que más
   chance tiene de no alcanzar. Si las fechas no vuelven, **no agregues un
   párrafo explicando**: probá una segunda línea léxica y volvé a medir. Si
   tampoco, dejalo y anotá el desvío — la salvaguarda de la Tarea 1 ya
   garantiza que **no se escribe nada** en ese caso, que es el punto 4 del
   criterio de aceptación y lo más importante de todo el spec.
2. **El fallo 2 hoy devuelve UNA acción, no dos** ("Activalo de paso" se
   pierde entero). La hipótesis es que el modelo no partía porque no tenía
   dónde poner la segunda mitad, y que con `proyecto` existiendo parte solo:
   la regla de partir ya cubre "de paso", que está en la frase. **Medilo, no
   lo asumas.** Si sigue devolviendo una, el movimiento igual va a Gentius
   (Tarea 2) y Gentius ya está abierto: se anota el desvío y no se toca el
   prompt para forzarlo.

- [ ] **Step 6: Anotar la medición en el archivo**

En el bloque de comentarios de `recepcionista.ts`, **antes** de `const
SISTEMA`, agregar un párrafo con el mismo formato que los otros seis:
qué se agregó, cuántas líneas, dónde, qué se midió antes y después, y qué
se movió. Es el registro que hace que el próximo no repita la trampa.

- [ ] **Step 7: Verificar y borrar el medidor**

```bash
npm run typecheck && npm run lint
rm medir-recepcionista.mts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/agentes/recepcionista.ts
git commit -m "El recepcionista conoce el destino proyecto, y cerrar deja de ser una retro"
```

---

## Task 6: Cierre de la ola 1

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/dev/manual-agentico.md`
- Modify: `docs/registro-correcciones.md`

- [ ] **Step 1: Build limpio**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: los tres limpios. **Bajá el `next dev` antes**: comparten `.next`.

- [ ] **Step 2: `AGENTS.md` §9**

En la sección "La capa de agentes", cambiar "Los trece destinos" por
"Los catorce destinos" y reemplazar el bloque ⚠ que hoy dice que `bitacora`
es el sumidero y que la salvaguarda "está en el spec" por lo que quedó
hecho: el test sobre el string, sus dos condiciones, los números medidos
(186-2015 caracteres en las seis entradas reales) y que el chequeo de
nombre es **exacto y no `resolverProyecto`**, con el caso de
`"El Prode de Beno"` como razón.

Agregar a la tabla de archivos:

```
| `agentes/proyectos.ts` | Qué se le pide a un proyecto y con qué fechas, determinístico |
```

Y una línea en la lista de destinos que escriben directo: son **tres**
(`bitacora`, `tema_estudio`, `proyecto`), con la misma condición de validez
—si el prompt de alguno pasa a pedir interpretar, se cae el razonamiento—.

- [ ] **Step 3: `docs/dev/manual-agentico.md`**

En la fila de la capa de agentes: los catorce destinos, `agentes/proyectos.ts`
como entrypoint nuevo, y como trampa las dos de esta ola:

- `leerFecha()` recorta al futuro salvo `{ futuro: true }`; el destino
  `proyecto` es el único que lo pasa.
- la pregunta de proyecto de `movimientos` viaja como `"<texto> — <slug>"`
  y el centinela de compartido es `__compartido__`.

- [ ] **Step 4: `docs/registro-correcciones.md`**

Al principio del historial, tres entradas de 1-2 líneas:

- La bitácora era el sumidero de todo lo que la app no sabe hacer, y eso
  dejó dos filas escritas el 2026-08-10.
- El movimiento buscaba el proyecto solo en la descripción extraída, así
  que "en el proyecto Gentius" nunca entraba en la comparación.
- `leerFecha` recortaba al pasado las fechas de un proyecto: `"30/12"`
  volvía como 2025 y `"2027-01-15"` como hoy, las dos en silencio.

Y actualizar el "Estado actual" con la fecha de hoy.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/
git commit -m "La documentacion al dia con la ola 1 de operar conversando"
```

---

# OLA 2 · El conector

**Se puede desplegar la ola 1 y parar acá.** Nada de lo que sigue toca
`src/lib/agentes/`.

## Task 7: Los tres valores de `tipo_bandeja`

**Files:**
- Create: `supabase/migrations/20260812000000_bandeja_dictados.sql`
- Modify: `src/lib/supabase/database.types.ts` (regenerado)

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- Tres tipos de bandeja nuevos: lo que dicta Beno por el conector y
-- todavía no tenía dónde caer.
--
-- Los tres son **producción de un modelo sobre tablas de dominio**, así
-- que la regla 6 de AGENTS.md aplica entera y no hay ningún razonamiento
-- que los exima: van a `inbox` como `pendiente` y los acepta Beno.
--
-- | valor | lo deja | aceptar crea |
-- |---|---|---|
-- | proyecto_dictado    | registrar_proyecto    | el proyecto, y su presupuesto en borrador si el payload lo trae |
-- | presupuesto_dictado | registrar_presupuesto | el presupuesto en borrador |
-- | nota_dictada        | registrar_nota        | una entrada de daily_log |
--
-- ⚠ Un presupuesto en `borrador` **no cuelga de ningún proyecto**, y no
-- es un olvido: `quotes` tiene el check
-- `(estado = 'aceptado') = (project_id is not null)`. El vínculo con el
-- proyecto se hace recién al aceptar el presupuesto, que es cuando se
-- elige o se crea el proyecto. Ver el desarrollo en la Tarea 9.
--
-- ## Por qué `nota_dictada` no reusa `nota_de_adjunto`
--
-- El camino de aceptación es el mismo —de hecho la action se generaliza
-- en vez de duplicarse— pero **de dónde vino no es lo mismo**, y eso es
-- justo lo que la tarjeta de la bandeja muestra a la izquierda para poder
-- juzgar la propuesta: allá va la imagen de la que salió el texto, acá va
-- la frase de Beno que lo pidió. Con un solo valor, la tarjeta tendría que
-- adivinar mirando el payload.
--
-- ## Por qué `registrar_nota` importa más de lo que parece
--
-- Es lo que sostiene la excepción de `escribir_bitacora`. Hasta que
-- existió, un resumen escrito por un modelo no tenía a dónde ir, y esa es
-- exactamente la presión que termina aflojando la única regla que permite
-- escribir sin confirmación. Con esto la separación es nítida y
-- verificable: el texto de Beno va directo, el del modelo va a la bandeja.
--
-- ## Por qué esta migración está sola
--
-- Un valor de enum agregado con `alter type ... add value` **no se puede
-- usar en la misma transacción que lo agregó**. Mismo criterio que
-- `20260810001000_adjuntos_enums.sql` y `20260811000000_bandeja_conector.sql`.
--
-- Y el timestamp es `20260812…` y no `20260811…` a propósito: las dos
-- migraciones del reparto por fecha quedaron numeradas antes que las
-- `20260811…` ya aplicadas y hubo que empujarlas con `--include-all`.
-- ============================================================

alter type public.tipo_bandeja add value if not exists 'proyecto_dictado';
alter type public.tipo_bandeja add value if not exists 'presupuesto_dictado';
alter type public.tipo_bandeja add value if not exists 'nota_dictada';
```

- [ ] **Step 2: Aplicarla**

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase db push --linked
```

Expected: aplica una migración. Si dice que hay migraciones anteriores sin
aplicar, **frená y avisá**: no uses `--include-all` sin mirar cuáles son.

- [ ] **Step 3: Regenerar los tipos**

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase gen types typescript \
  --project-id thlocwmhxzqkmmnxmunf --schema public \
  > src/lib/supabase/database.types.ts
```

⚠ **Volvé a pegar a mano el bloque de alias del final del archivo.** El
generador lo borra. Sacalo del `git diff` antes de commitear:

```bash
git diff src/lib/supabase/database.types.ts | head -60
```

- [ ] **Step 4: Verificar que el enum llegó**

```bash
grep -n "proyecto_dictado" src/lib/supabase/database.types.ts
```

Expected: dos apariciones (la unión de tipos y el array `Constants`).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

⚠ **Va a fallar en `TIPO_LABEL` de `bandeja-view.tsx:70`**, que es un
`Record<TipoBandeja, string>`. **Eso es correcto y es el punto**: el
compilador te está diciendo dónde falta la etiqueta. Agregá las tres:

```ts
  proyecto_dictado: "Proyecto dictado",
  presupuesto_dictado: "Presupuesto dictado",
  nota_dictada: "Nota dictada",
```

Y volvé a correr: limpio.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations src/lib/supabase/database.types.ts src/components/bandeja/bandeja-view.tsx
git commit -m "Tres tipos de bandeja para lo que dicta Beno por el conector"
```

---

## Task 8: `registrar_nota`

La más chica de las tres y la que más importa: es la que sostiene la
excepción de `escribir_bitacora`. Reusa entero el camino de
`nota_de_adjunto`.

**Files:**
- Create: `src/lib/mcp/tools/notas.ts`
- Modify: `src/lib/actions/inbox.ts`
- Modify: `src/components/bandeja/bandeja-view.tsx`
- Modify: `src/app/api/mcp/route.ts`

- [ ] **Step 1: La tool**

Crear `src/lib/mcp/tools/notas.ts`:

```ts
import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { todayISO } from "@/lib/dates";
import { datosDelPedido } from "@/lib/mcp/contexto";
import { PROPONE, respuesta } from "@/lib/mcp/formato";
import { avisoProyectoDesconocido, resolverProyecto } from "@/lib/mcp/resolver";

/**
 * `registrar_nota`: una nota **escrita por el modelo** que termina siendo
 * una entrada de bitácora, previa confirmación.
 *
 * ## Por qué existe, y por qué no es `escribir_bitacora`
 *
 * Son las dos puntas de la misma distinción y por eso van separadas.
 * `escribir_bitacora` escribe directo porque **el texto es de Beno palabra
 * por palabra**; acá el texto lo produjo un modelo resumiendo una
 * conversación, así que pasa por la bandeja como cualquier otra producción
 * de un modelo. Es exactamente la forma de `nota_de_adjunto`, donde el
 * texto sale de mirar una captura.
 *
 * ⚠ **Y esto es lo que hace que `escribir_bitacora` pueda seguir
 * escribiendo directo.** Hasta que existió, un resumen del modelo no tenía
 * a dónde ir, y esa es la presión que termina aflojando la única regla que
 * permite escribir sin confirmación. Con las dos tools, la separación es
 * nítida y verificable: tu texto va directo, el suyo va a la bandeja.
 *
 * Salió del fallo 3 del 2026-08-10, donde el modelo **detectó solo** que
 * lo que iba a cargar era un resumen suyo y no la voz de Beno, y avisó. El
 * criterio estaba; faltaba la capacidad.
 */
export function registrarNotas(server: McpServer) {
  server.registerTool(
    "registrar_nota",
    {
      title: "Registrar una nota en la bitácora",
      // La descripción tiene que dejar clarísimo que esto NO escribe la
      // entrada, y también CUÁNDO usar esta y no `escribir_bitacora`: si
      // el modelo elige mal, un resumen suyo termina guardado como si lo
      // hubiera escrito Beno.
      description:
        "Propone una entrada de bitácora **escrita por vos** (un resumen " +
        "de lo que charlaron, un relevamiento, notas de una reunión). " +
        "**No la crea**: deja una propuesta en la bandeja de Pepe y Beno " +
        "la acepta, la edita o la descarta. Al contestar decí que quedó " +
        "propuesta, no que quedó cargada.\n\n" +
        "Usá `escribir_bitacora` en cambio cuando el texto sea de Beno " +
        "palabra por palabra y vos solo lo estés pasando tal cual: esa " +
        "escribe directo, y por eso no sirve para nada que hayas " +
        "redactado o resumido vos.",
      inputSchema: z.object({
        contenido: z
          .string()
          .trim()
          .min(1)
          .max(6000)
          .describe("El texto de la entrada, tal como quedaría en la bitácora."),
        proyecto: z
          .string()
          .optional()
          .describe(
            "Slug del proyecto del que cuelga. Si no sabés, no lo mandes: se elige en la bandeja.",
          ),
        fecha: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.")
          .optional()
          .describe("Por defecto, hoy."),
      }),
      annotations: PROPONE,
    },
    async ({ contenido, proyecto, fecha }, ctx) => {
      const datos = datosDelPedido(ctx);

      let projectId: string | undefined;
      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        // `compartido` no existe para una nota: `daily_log.project_id` es
        // NOT NULL. Se trata igual que un slug que no existe.
        if (resuelto.tipo !== "proyecto") {
          return respuesta(
            `${avisoProyectoDesconocido(proyecto, resuelto.tipo === "no-encontrado" ? resuelto.disponibles : [])}\n\nUna entrada de bitácora cuelga siempre de un proyecto concreto: no hay "compartido" acá.\n\nNo propuse nada todavía.`,
          );
        }
        projectId = resuelto.proyecto.id;
      }

      const fechaFinal = fecha ?? todayISO();

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "nota_dictada",
        estado: "pendiente",
        payload: {
          contenido,
          fecha: fechaFinal,
          ...(projectId ? { project_id: projectId } : {}),
        },
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      return respuesta(
        [
          "Quedó **propuesta**, todavía no escrita en la bitácora.",
          "",
          projectId
            ? "Tiene proyecto y fecha: le alcanza con apretar Aceptar."
            : "Le falta el proyecto: la bandeja se lo pide antes de dejarlo aceptar.",
          "",
          "La tarjeta le avisa que el texto lo escribiste vos y no él, así que puede editarlo antes de aceptar.",
        ].join("\n"),
      );
    },
  );
}
```

- [ ] **Step 2: Generalizar la action de aceptación**

En `src/lib/actions/inbox.ts`, la única línea que cambia de
`aceptarNotaDeAdjunto` es el chequeo de tipo:

```ts
  if (item.tipo !== "nota_de_adjunto" && item.tipo !== "nota_dictada") {
    return fail("Esa propuesta no es una nota de bitácora.");
  }
```

Y el comentario de la función suma un párrafo:

```
 * Sirve para los **dos** tipos que terminan en una entrada de bitácora: la
 * que un modelo sacó de una captura y la que un modelo dictó por el
 * conector. El payload tiene la misma forma en los dos y el criterio
 * también — en los dos el texto lo produjo un modelo, así que pasa por la
 * bandeja—. Lo único que cambia es de dónde vino, y eso lo muestra la
 * tarjeta, no la action.
```

⚠ **No la renombres.** `aceptarNotaDeAdjunto` la importa
`bandeja-view.tsx` y renombrarla es ruido en el diff sin ninguna ganancia;
el comentario ya dice que cubre los dos.

- [ ] **Step 3: La tarjeta**

En `src/components/bandeja/bandeja-view.tsx`:

```ts
  const esNota =
    actual?.tipo === "nota_de_adjunto" || actual?.tipo === "nota_dictada";
  const esNotaDictada = actual?.tipo === "nota_dictada";
```

Y en el bloque de la tarjeta de nota, la columna izquierda cambia según el
origen. Reemplazar el `<section>` "Lo que pegaste" por:

```tsx
              <section className="space-y-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {esNotaDictada ? "De dónde salió" : "Lo que pegaste"}
                </h2>
                {esNotaDictada ? (
                  <>
                    <p className="text-sm">La dictaste desde Claude.</p>
                    {/*
                      La fuente a la izquierda es la salvaguarda contra lo
                      inventado, igual que la miniatura de una captura.
                      Acá la fuente no es una imagen: es la conversación,
                      que la app no tiene. Lo único honesto que se puede
                      mostrar es que el texto NO es de Beno.
                    */}
                    <p className="text-muted-foreground text-xs">
                      El texto lo <strong>escribió Claude</strong>, no vos: es
                      un resumen de lo que charlaron. Por eso pasa por acá y
                      no se guarda solo. Si le falta algo o suena a otra
                      persona, editalo antes de aceptar.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">{nota.de_que_es}</p>
                    <MiniaturaAdjunto
                      path={nota.storage_path}
                      alt={`Captura ${nota.adjunto_nombre}`}
                    />
                    {nota.frase && (
                      <p className="text-muted-foreground text-xs">
                        Escribiste: “{nota.frase}”
                      </p>
                    )}
                  </>
                )}
              </section>
```

⚠ `leerNota()` pone `storage_path: ""` cuando no viene, y `MiniaturaAdjunto`
con `path` vacío se queda en "Cargando la imagen…" para siempre. Por eso la
rama dictada **no la renderiza**, en vez de confiar en que el path vacío se
vea bien.

- [ ] **Step 4: Registrar la familia**

En `src/app/api/mcp/route.ts`:

```ts
import { registrarNotas } from "@/lib/mcp/tools/notas";
```

```ts
    registrarBitacora(server);
    registrarNotas(server);
```

Y actualizar la tabla del comentario de arriba: ahora son **nueve** tools,
y la fila de "dejan una propuesta en `inbox`" suma `registrar_nota`.

- [ ] **Step 5: Verificar**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Probarlo de punta a punta**

Desde Claude.ai con el conector conectado: *"registrá en la bitácora de
Gentius un resumen de lo que venimos charlando"*.

Expected: contesta que quedó **propuesta**; en `/bandeja` aparece una
tarjeta "Nota dictada" con el aviso de que el texto lo escribió Claude;
aceptarla crea la entrada en Bitácora.

Si no tenés el conector a mano, la alternativa es insertar la fila de
`inbox` a mano con un script y probar solo la tarjeta y la aceptación:

```ts
await admin.from("inbox").insert({
  user_id: "<el de Beno>",
  tipo: "nota_dictada",
  estado: "pendiente",
  payload: { contenido: "Texto de prueba de una nota dictada.", fecha: "2026-08-12" },
});
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/notas.ts src/lib/actions/inbox.ts src/components/bandeja/bandeja-view.tsx src/app/api/mcp/route.ts
git commit -m "registrar_nota: lo que escribe el modelo va a la bandeja, no a la bitacora"
```

---

## Task 9: `registrar_proyecto`, con el presupuesto adentro

**Files:**
- Create: `src/lib/mcp/tools/presupuesto-schema.ts`
- Modify: `src/lib/mcp/tools/proyectos.ts`
- Modify: `src/lib/actions/inbox.ts`
- Modify: `src/components/bandeja/bandeja-view.tsx`

- [ ] **Step 1: La tool**

`src/lib/mcp/tools/proyectos.ts` hoy solo importa lo que necesita
`listar_proyectos`. Sumar arriba:

```ts
import { PROPONE } from "@/lib/mcp/formato";
import { presupuestoDictadoSchema } from "@/lib/mcp/tools/presupuesto-schema";

/**
 * El mismo validador de fecha que usa `tools/movimientos.ts`. Está escrito
 * dos veces —son tres líneas— y no en `formato.ts`: ese módulo es de
 * paginación y respuestas, y meterle un `z.string()` lo convierte en el
 * cajón de todo.
 */
const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.");
```

⚠ **El esquema del presupuesto (Step 2) tiene que existir antes**: este
archivo lo importa. Si vas por orden, escribí el Step 2 primero y volvé.

Y dentro de `registrarProyectos`, después de `listar_proyectos`:

```ts
  server.registerTool(
    "registrar_proyecto",
    {
      title: "Registrar un proyecto",
      description:
        "Propone un proyecto nuevo. **No lo crea**: deja una propuesta en " +
        "la bandeja de Pepe y Beno la acepta o la descarta. Al contestar " +
        "decí que quedó para aprobar, no que quedó cargado.\n\n" +
        "Podés mandarle un presupuesto adentro: si va, se crea junto con " +
        "el proyecto y en estado borrador, en una sola tarjeta. **Vos no " +
        "calculás precios**: mandá los entregables con sus horas y el " +
        "monto lo saca Pepe de la tarifa de Ajustes.",
      inputSchema: z.object({
        nombre: z.string().trim().min(1).max(80),
        de_que_se_trata: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("Para que Beno sepa de qué proyecto le estás hablando."),
        fecha_inicio: fechaISO
          .optional()
          .describe("Cuándo arranca. Si no la sabés, no la mandes."),
        fecha_fin: fechaISO
          .optional()
          .describe("Cuándo termina. Sin esto, el proyecto queda abierto."),
        presupuesto: presupuestoDictadoSchema
          .optional()
          .describe(
            "El presupuesto del proyecto, si lo charlaron. Se crea en borrador junto con el proyecto.",
          ),
      }),
      annotations: PROPONE,
    },
    async ({ nombre, de_que_se_trata, fecha_inicio, fecha_fin, presupuesto }, ctx) => {
      const datos = datosDelPedido(ctx);

      // El check `projects_fechas_coherentes` existe en la base desde
      // `20260810000001`. Frenar acá es decirlo en castellano en vez de
      // dejar que reviente al aceptar, cuando Beno ya no tiene contexto.
      if (fecha_inicio && fecha_fin && fecha_fin < fecha_inicio) {
        return respuesta(
          "El cierre no puede ser anterior al inicio. No propuse nada todavía.",
        );
      }

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "proyecto_dictado",
        estado: "pendiente",
        payload: {
          nombre,
          ...(de_que_se_trata ? { de_que_se_trata } : {}),
          ...(fecha_inicio ? { fecha_inicio } : {}),
          ...(fecha_fin ? { fecha_fin } : {}),
          ...(presupuesto ? { presupuesto } : {}),
        },
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      return respuesta(
        [
          `Quedó **para aprobar**: el proyecto ${nombre} todavía no existe.`,
          "",
          presupuesto
            ? `Va con su presupuesto adentro (${presupuesto.items.length} entregables), que se crea en **borrador** si acepta. El precio lo calcula Pepe con la tarifa de Ajustes, así que puede no coincidir con el número que hayan charlado — si no coincide, gana el de Pepe y la tarjeta muestra la diferencia.`
            : "Sin presupuesto. Si después quieren armar uno, está `registrar_presupuesto`.",
          "",
          "Es una sola tarjeta y una sola tecla en la bandeja.",
        ].join("\n"),
      );
    },
  );
```

⚠ **El presupuesto va ADENTRO del payload y no como una tool aparte, y es
la respuesta a un problema de orden**: si fueran dos ítems, el presupuesto
apuntaría a un proyecto que todavía no existe, y aceptar una sola frase de
Beno costaría dos viajes a la bandeja. La vara explícita de la bandeja es
una tarjeta, una tecla.

- [ ] **Step 2: El esquema compartido del presupuesto**

Va en un archivo propio, `src/lib/mcp/tools/presupuesto-schema.ts`, porque
**lo usan las dos tools**: esta y la de la Tarea 10. Metido adentro de
cualquiera de las dos, la otra tendría que importar de un archivo que
registra tools, y el orden de creación pasaría a importar.

Ojo: este archivo **no lleva `import "server-only"`**. Es un esquema de Zod
y nada más; el `server-only` está en los dos que lo importan, que son los
que tocan la base.

```ts
import { z } from "zod";

/**
 * Lo que un modelo puede decir de un presupuesto: **el alcance y el
 * esfuerzo, nunca la plata**.
 *
 * ⚠ **No hay ningún campo de precio, y es la decisión.** Lo que produce el
 * modelo termina en un PDF que se le manda a un cliente con el nombre de
 * Beno, así que el monto lo calcula la app con la tarifa de Ajustes y los
 * multiplicadores por tipo de cliente (`lib/presupuestos.ts`), igual que
 * hoy. El modelo estima esfuerzo; el precio sale de multiplicar horas por
 * su tarifa.
 *
 * Es el caso concreto del fallo 3: Beno mencionó "los 2.400.000 ARS y las
 * 110/120h". Las horas son estimación y entran; el monto sale de la
 * cuenta, y si no coincide, **gana la app y se avisa la diferencia**.
 */
export const presupuestoDictadoSchema = z.object({
  cliente_nombre: z.string().trim().min(1).max(120),
  cliente_tipo: z
    .enum(["particular", "pyme", "empresa"])
    .describe("Define el multiplicador que aplica Pepe sobre la tarifa base."),
  titulo: z.string().trim().min(1).max(160),
  resumen_alcance: z.string().trim().max(2000).default(""),
  pedido_texto: z
    .string()
    .trim()
    .max(60000)
    .describe(
      "Lo que dijo el cliente, tal cual. Es contra esto que se verifica cada entregable.",
    ),
  items: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(160),
        detalle: z.string().trim().max(600).default(""),
        horas: z.number().nonnegative().max(400),
        ancla: z
          .string()
          .trim()
          .max(400)
          .nullable()
          .default(null)
          .describe(
            "La cita literal del pedido que justifica este entregable, o null si no hay ninguna.",
          ),
      }),
    )
    .min(1)
    .max(50),
  supuestos: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  preguntas: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export type PresupuestoDictado = z.infer<typeof presupuestoDictadoSchema>;
```

⚠ **`ancla` va con techo 400 y no 200**, igual que `quoteItemSchema.ancla`
de `lib/schemas.ts`: una cita literal y correcta de 246 caracteres es un
caso real medido, y si acá entrara con 200 moriría recién al guardar.

- [ ] **Step 3: El armador del presupuesto, compartido**

En `src/lib/actions/inbox.ts`. **Lo llaman las dos actions** (la de esta
tarea y la de la Tarea 10): escribilo una sola vez.

```ts
/* ────────────────────────────────────────────────────────────
 * Presupuestos y proyectos dictados por el conector MCP
 * ──────────────────────────────────────────────────────────── */

/**
 * Lo que un modelo puede decir de un presupuesto. **Es el mismo esquema
 * que declara la tool**, revalidado acá porque el payload es `jsonb` y la
 * base no garantiza su forma.
 */
const presupuestoDictadoPayloadSchema = z.object({
  cliente_nombre: z.string().trim().min(1).max(120),
  cliente_tipo: z.enum(["particular", "pyme", "empresa"]),
  titulo: z.string().trim().min(1).max(160),
  resumen_alcance: z.string().trim().max(2000).default(""),
  pedido_texto: z.string().trim().max(60000).default(""),
  items: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(160),
        detalle: z.string().trim().max(600).default(""),
        horas: z.number().nonnegative().max(400),
        ancla: z.string().trim().max(400).nullable().default(null),
      }),
    )
    .min(1)
    .max(50),
  supuestos: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  preguntas: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

type PresupuestoDictadoPayload = z.infer<typeof presupuestoDictadoPayloadSchema>;

/**
 * Crea el presupuesto de un dictado, en `borrador`.
 *
 * ## Lo que el modelo NO decide
 *
 * ⚠ **El precio.** El modelo manda entregables con horas; el monto sale de
 * multiplicar horas por la tarifa de Ajustes y el multiplicador del tipo de
 * cliente, que es lo que ya hace `crearPresupuesto()` → `armarFila()` →
 * `calcularPresupuesto()`. Por eso `total_origen` va en `0` y
 * `total_editado` en `false`: con `false`, `armarFila()` **ignora** el
 * número que le pasan y usa el calculado. Es el caso concreto del fallo 3
 * —Beno mencionó "los 2.400.000 ARS y las 110/120h"—: las horas entran, el
 * monto sale de la cuenta, y si no coincide **gana la app**.
 *
 * ⚠ **`ancla_verificada` va en `false` sin excepción.** Es la marca de que
 * la cita se comprobó contra el pedido, y del lado del conector nadie la
 * comprobó. Ponerla en `true` porque "el modelo dijo que la sacó de ahí"
 * es justo la clase de mentira que el campo existe para impedir.
 *
 * ## Lo que no hace falta escribir
 *
 * **El estado.** `quoteSchema` no tiene `estado` y `armarFila()` no lo
 * manda: lo pone el default `'borrador'` de la columna
 * (`20260810002000_presupuestos.sql:155`). No hay una línea que se pueda
 * olvidar.
 *
 * **El proyecto.** Un borrador **no cuelga de ninguno** y no puede: el
 * check `(estado = 'aceptado') = (project_id is not null)` lo prohíbe. El
 * vínculo se hace al aceptar el presupuesto, desde su pantalla, que es
 * donde se elige o se crea el proyecto.
 *
 * La moneda del presupuesto se pone igual a la de la tarifa, a propósito:
 * así no hay conversión, y por lo tanto no hay forma de que salga con
 * `sin_cotizacion` y un total en una moneda que nadie pidió.
 */
async function crearPresupuestoDesdeDictado(
  dictado: PresupuestoDictadoPayload,
): Promise<ActionResult<PresupuestoCreado>> {
  const ajustes = await getAjustesPresupuesto();

  return await crearPresupuesto({
    cliente_nombre: dictado.cliente_nombre,
    cliente_tipo: dictado.cliente_tipo,
    titulo: dictado.titulo,
    resumen_alcance: dictado.resumen_alcance,
    pedido_texto: dictado.pedido_texto,
    moneda: ajustes.tarifa_moneda,
    fecha: todayISO(),
    // Los dos defaults de la columna, escritos: `quoteSchema` los pide.
    validez_dias: 15,
    mostrar_horas: false,
    condiciones: ajustes.condiciones_default ?? "",
    total_origen: 0,
    total_editado: false,
    items: dictado.items.map((i) => ({
      titulo: i.titulo,
      detalle: i.detalle,
      horas: i.horas,
      // Igual que los que salen de `estimarEsfuerzo()`: se apaga a
      // "manual" apenas Beno toca un campo del ítem.
      origen: "modelo" as const,
      ancla: i.ancla,
      ancla_verificada: false,
      confianza: null,
    })),
    supuestos: dictado.supuestos,
    preguntas: dictado.preguntas,
    modelo: "conector",
    reemplaza_a: null,
  });
}
```

Los imports que suma `inbox.ts`:

```ts
import { todayISO } from "@/lib/dates";
import { getAjustesPresupuesto } from "@/lib/presupuestos-server";
import { COLOR_POR_DEFECTO_DE_PROYECTO } from "@/lib/schemas";
import { crearProyecto } from "./projects";
import { crearPresupuesto, type PresupuestoCreado } from "./presupuestos";
```

⚠ **`crearPresupuesto()` falla con un mensaje accionable si no hay tarifa
cargada** ("Todavía no cargaste tu tarifa hora. Está en Ajustes → Tarifa, y
sin ella un presupuesto no tiene precio."). Ese mensaje tiene que llegar a
la bandeja **tal cual**: no lo envuelvas en un "no se pudo guardar".

- [ ] **Step 4: `aceptarProyectoDictado()`**

En el mismo archivo, después del armador:

```ts
const payloadProyectoSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  de_que_se_trata: z.string().optional(),
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  presupuesto: presupuestoDictadoPayloadSchema.optional(),
});

/**
 * Acepta un proyecto dictado: lo crea de verdad, y si trae presupuesto
 * adentro lo crea también, en `borrador`.
 *
 * ⚠ **Si el proyecto se crea y el presupuesto falla, el ítem queda
 * aceptado igual y se avisa.** Deshacer la creación sería peor: el
 * proyecto es lo que Beno acaba de aprobar, y el presupuesto se rehace
 * desde su pantalla. Es el mismo criterio que ya aplica
 * `aceptarPresupuesto()` cuando crea el proyecto y después falla el
 * update.
 */
export async function aceptarProyectoDictado(
  itemId: string,
): Promise<
  ActionResult<{
    projectId: string;
    quoteNumero: number | null;
    avisoPresupuesto: string | null;
  }>
> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { data: item, error: errorLectura } = await supabase
    .from("inbox")
    .select("id, tipo, estado, payload")
    .eq("id", idParseado.data)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!item) return fail("No encontré esa propuesta.");
  if (item.tipo !== "proyecto_dictado") {
    return fail("Esa propuesta no es un proyecto.");
  }
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Esa propuesta ya estaba resuelta.");
  }

  const payload = payloadProyectoSchema.safeParse(item.payload);
  if (!payload.success) {
    return fail("La propuesta guardada está incompleta. Rechazala.");
  }

  // El proyecto por `crearProyecto()` y no con un insert a mano: esa
  // action resuelve el slug disponible y valida contra `projectSchema`,
  // que tiene el refine del check `projects_fechas_coherentes`. Por ahí es
  // por donde un cierre anterior al inicio vuelve en castellano.
  const creado = await crearProyecto({
    nombre: payload.data.nombre,
    color: COLOR_POR_DEFECTO_DE_PROYECTO,
    fecha_inicio: payload.data.fecha_inicio ?? null,
    fecha_fin: payload.data.fecha_fin ?? null,
    peso_prorrateo: 1,
  });

  if (!creado.ok) return fail(creado.error);

  let quoteNumero: number | null = null;
  let avisoPresupuesto: string | null = null;

  if (payload.data.presupuesto) {
    const presupuesto = await crearPresupuestoDesdeDictado(
      payload.data.presupuesto,
    );
    if (presupuesto.ok) quoteNumero = presupuesto.data.numero;
    else avisoPresupuesto = presupuesto.error;
  }

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // El vínculo hacia adelante va en el payload, igual que el
      // `lesson_id` de `aceptarLeccion()`. `entidad_tabla`/`entidad_id`
      // vienen en null —la propuesta no salió de ninguna fila— así que no
      // hay nada que preservar.
      payload: {
        ...(item.payload as Record<string, unknown>),
        project_id: creado.data.id,
        ...(quoteNumero !== null ? { quote_numero: quoteNumero } : {}),
      },
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ projectId: creado.data.id, quoteNumero, avisoPresupuesto });
}
```

- [ ] **Step 5: Los lectores y la tarjeta**

En `src/components/bandeja/bandeja-view.tsx`, con el mismo patrón
desconfiado que `leerNota()` y `leerMovimiento()` —el payload es `jsonb` y
la base no garantiza su forma—:

```tsx
/** Lo que propone `registrar_proyecto`. */
interface ProyectoDictado {
  nombre: string;
  de_que_se_trata?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  presupuesto?: PresupuestoDictado;
}

/** Lo que propone `registrar_presupuesto`, y lo que viaja adentro del otro. */
interface PresupuestoDictado {
  cliente_nombre: string;
  cliente_tipo: "particular" | "pyme" | "empresa";
  titulo: string;
  resumen_alcance?: string;
  items: { titulo: string; detalle?: string; horas: number; ancla?: string | null }[];
  supuestos?: string[];
  preguntas?: string[];
}

function leerPresupuestoDictado(valor: unknown): PresupuestoDictado | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return null;
  }
  const p = valor as Record<string, unknown>;
  if (typeof p.cliente_nombre !== "string" || typeof p.titulo !== "string") {
    return null;
  }
  if (!Array.isArray(p.items) || p.items.length === 0) return null;

  return {
    cliente_nombre: p.cliente_nombre,
    cliente_tipo:
      p.cliente_tipo === "empresa" || p.cliente_tipo === "pyme"
        ? p.cliente_tipo
        : "particular",
    titulo: p.titulo,
    resumen_alcance:
      typeof p.resumen_alcance === "string" ? p.resumen_alcance : undefined,
    items: (p.items as Record<string, unknown>[]).map((i) => ({
      titulo: typeof i.titulo === "string" ? i.titulo : "Sin título",
      detalle: typeof i.detalle === "string" ? i.detalle : undefined,
      horas: Number(i.horas ?? 0),
      ancla: typeof i.ancla === "string" ? i.ancla : null,
    })),
    supuestos: Array.isArray(p.supuestos) ? (p.supuestos as string[]) : undefined,
    preguntas: Array.isArray(p.preguntas) ? (p.preguntas as string[]) : undefined,
  };
}

function leerProyectoDictado(payload: Json): ProyectoDictado | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.nombre !== "string") return null;

  return {
    nombre: p.nombre,
    de_que_se_trata:
      typeof p.de_que_se_trata === "string" ? p.de_que_se_trata : undefined,
    fecha_inicio: typeof p.fecha_inicio === "string" ? p.fecha_inicio : undefined,
    fecha_fin: typeof p.fecha_fin === "string" ? p.fecha_fin : undefined,
    presupuesto: leerPresupuestoDictado(p.presupuesto) ?? undefined,
  };
}
```

Y los dos componentes de tarjeta, al lado de `MiniaturaAdjunto`. **Van
como componentes y no dentro del ternario grande**: esa cadena ya tiene
cinco ramas y meterle dos más la vuelve ilegible.

```tsx
/**
 * El presupuesto propuesto, con **las horas y ningún precio**.
 *
 * ⚠ El precio no está y no es un olvido: lo calcula la app al aceptar, con
 * la tarifa de Ajustes y el multiplicador del tipo de cliente. Mostrar acá
 * un número que dijo el modelo sería mostrar un precio que no es el que se
 * va a guardar.
 */
function PresupuestoPropuesto({ p }: { p: PresupuestoDictado }) {
  const horas = p.items.reduce((total, i) => total + i.horas, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{p.titulo}</p>
        <span className="text-muted-foreground text-xs">
          {p.cliente_nombre} · {p.cliente_tipo}
        </span>
      </div>

      {p.resumen_alcance && <p className="text-sm">{p.resumen_alcance}</p>}

      <ul className="space-y-2">
        {p.items.map((i, indice) => (
          <li key={indice} className="text-sm">
            <span className="font-medium">{i.titulo}</span>{" "}
            <span className="cifra text-muted-foreground">{i.horas} h</span>
            {i.detalle && (
              <p className="text-muted-foreground text-xs">{i.detalle}</p>
            )}
            {/*
              La cita del pedido al lado del entregable es la salvaguarda
              contra el ítem inventado, igual que el `ancla` de las
              sugerencias de estudio. Se guarda SIN verificar —del lado del
              conector nadie la comprobó contra el pedido— y por eso se
              muestra como cita y no como respaldo.
            */}
            {i.ancla && (
              <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">
                “{i.ancla}”
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-xs">
        <span className="cifra">{horas}</span> horas en total.{" "}
        <strong>El precio no lo puso Claude</strong>: lo calcula Pepe con tu
        tarifa de Ajustes y el multiplicador de “{p.cliente_tipo}” cuando
        aceptes. Nace en borrador y no queda colgado de ningún proyecto
        hasta que lo aceptes desde Presupuestos.
      </p>

      {p.supuestos && p.supuestos.length > 0 && (
        <div className="text-muted-foreground text-xs">
          <p className="font-medium">Supuestos</p>
          <ul className="list-disc pl-4">
            {p.supuestos.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {p.preguntas && p.preguntas.length > 0 && (
        <div className="text-muted-foreground text-xs">
          <p className="font-medium">Preguntas para el cliente</p>
          <ul className="list-disc pl-4">
            {p.preguntas.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProyectoPropuesto({ p }: { p: ProyectoDictado }) {
  const desde = p.fecha_inicio ? formatDate(p.fecha_inicio) : "siempre";
  const hasta = p.fecha_fin ? formatDate(p.fecha_fin) : "sigue abierto";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">{p.nombre}</p>
        <p className="text-muted-foreground cifra text-xs">
          De {desde} a {hasta}
        </p>
      </div>

      {p.de_que_se_trata && <p className="text-sm">{p.de_que_se_trata}</p>}

      {/*
        ⚠ El aviso más importante de esta tarjeta. Un proyecto sin
        `fecha_inicio` está vivo DESDE SIEMPRE (`estaVivo()` con la punta
        nula es "desde siempre"), así que entra en el reparto de TODOS los
        gastos compartidos del histórico y reescribe cuánto costó cada uno
        de los otros. Sin decirlo acá, se descubre tres pantallas después.
      */}
      {!p.fecha_inicio && (
        <p className="text-muted-foreground border-l-2 pl-3 text-xs">
          Sin fecha de inicio, este proyecto cuenta como abierto{" "}
          <strong>desde siempre</strong>: entra en el reparto de todos los
          gastos compartidos que ya tenés cargados y cambia cuánto costó cada
          uno de los otros. Si arrancó en una fecha, ponésela en Ajustes
          después de aceptar.
        </p>
      )}

      {p.presupuesto && (
        <div className="border-t border-dashed pt-3">
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            Con este presupuesto adentro
          </h3>
          <PresupuestoPropuesto p={p.presupuesto} />
        </div>
      )}

      <p className="text-muted-foreground border-t border-dashed pt-3 text-xs">
        Aceptar <strong>crea el proyecto</strong>
        {p.presupuesto ? " y su presupuesto en borrador" : ""}. El color y el
        peso de prorrateo quedan en los valores por defecto: se cambian desde
        Ajustes.
      </p>
    </div>
  );
}
```

Y el cableado, junto a los otros `es…`:

```tsx
  const esProyecto = actual?.tipo === "proyecto_dictado";
  const proyectoDictado =
    actual && esProyecto ? leerProyectoDictado(actual.payload) : null;
```

En `aceptar()`, antes de la rama de lección:

```tsx
    if (esProyecto) {
      if (!proyectoDictado) return;
      resolver(
        actual,
        async () => {
          const r = await aceptarProyectoDictado(actual.id);
          if (r.ok && r.data.avisoPresupuesto) {
            // El proyecto se creó igual: no es un fallo del ítem, es una
            // mitad que no salió, y se dice en vez de tragársela.
            toast.warning(
              `El proyecto quedó creado, pero el presupuesto no: ${r.data.avisoPresupuesto}`,
            );
          }
          return r;
        },
        "Proyecto creado.",
      );
      return;
    }
```

Y en la cadena de renderizado, una rama más antes de `esNota`:

```tsx
        ) : esProyecto ? (
          proyectoDictado ? (
            <ProyectoPropuesto p={proyectoDictado} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Esta propuesta quedó incompleta y no se puede aceptar. Rechazala.
            </p>
          )
```

⚠ **Acordate de sumar `esProyecto` y `proyectoDictado` al array de
dependencias de `aceptar()`**, y de excluir el tipo nuevo de la condición de
`propuesta` (la que hoy dice `!esZombie && !esNota && !esMovimiento`) y de
`faltaProyecto`. Si no, un proyecto dictado se intenta leer como lección y
la tarjeta muestra "quedó incompleta".

- [ ] **Step 6: Verificar y probar**

```bash
npm run typecheck && npm run lint
```

Insertar una propuesta a mano para probar la tarjeta sin depender del
conector, con un script temporal en la raíz (acordate del preámbulo de
`.env.local` y de borrarlo después):

```ts
await admin.from("inbox").insert({
  user_id: "<el de Beno>",
  tipo: "proyecto_dictado",
  estado: "pendiente",
  payload: {
    nombre: "Agente de RRHH",
    de_que_se_trata: "Relevamiento con el equipo de RRHH que lo pidió.",
    presupuesto: {
      cliente_nombre: "RRHH interno",
      cliente_tipo: "empresa",
      titulo: "Agente de RRHH — primera etapa",
      resumen_alcance: "Relevamiento, prototipo y puesta en marcha.",
      pedido_texto: "Necesitamos un agente que responda las consultas de legajos.",
      items: [
        { titulo: "Relevamiento", detalle: "", horas: 20, ancla: "las consultas de legajos" },
        { titulo: "Prototipo", detalle: "", horas: 60, ancla: null },
        { titulo: "Puesta en marcha", detalle: "", horas: 35, ancla: null },
      ],
      supuestos: ["Los legajos ya están digitalizados."],
      preguntas: ["¿Cuántos legajos son?"],
    },
  },
});
```

Expected en `/bandeja`: la tarjeta "Proyecto dictado", **con el aviso de
"desde siempre"** (el payload no trae `fecha_inicio`), los tres entregables
con sus horas, "115 horas en total" y **ningún precio**. Aceptar crea el
proyecto y un presupuesto en `borrador`.

**Al terminar, borrá el proyecto y el presupuesto de prueba.**

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/ src/lib/actions/inbox.ts src/components/bandeja/bandeja-view.tsx
git commit -m "registrar_proyecto: el proyecto y su presupuesto en una sola tarjeta"
```

---

## Task 10: `registrar_presupuesto`

Para cuando el proyecto **ya existe** o cuando todavía no hay ninguno: un
borrador no cuelga de un proyecto en ningún caso. Comparte el esquema con la
tool de la Tarea 9 y **el armador entero**.

**Files:**
- Create: `src/lib/mcp/tools/presupuestos.ts`
- Modify: `src/lib/actions/inbox.ts`
- Modify: `src/components/bandeja/bandeja-view.tsx`
- Modify: `src/app/api/mcp/route.ts`

- [ ] **Step 1: La tool**

Crear `src/lib/mcp/tools/presupuestos.ts`:

```ts
import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { datosDelPedido } from "@/lib/mcp/contexto";
import { PROPONE, respuesta } from "@/lib/mcp/formato";
import { presupuestoDictadoSchema } from "@/lib/mcp/tools/presupuesto-schema";

/**
 * `registrar_presupuesto`: un presupuesto propuesto, a la bandeja.
 *
 * ⚠ **No toma un proyecto, y no es un olvido.** Un presupuesto en
 * `borrador` no cuelga de ninguno: `quotes` tiene el check
 * `(estado = 'aceptado') = (project_id is not null)`, así que el vínculo
 * se hace recién al aceptar el presupuesto desde su pantalla, que es donde
 * se elige o se crea el proyecto. Aceptar un pedido de proyecto acá sería
 * aceptar un dato que no se puede guardar en ningún lado.
 *
 * Para el caso "proyecto nuevo + su presupuesto" está `registrar_proyecto`,
 * que lo lleva adentro del payload: una tarjeta, una tecla.
 */
export function registrarPresupuestos(server: McpServer) {
  server.registerTool(
    "registrar_presupuesto",
    {
      title: "Registrar un presupuesto",
      description:
        "Propone un presupuesto para un cliente. **No lo crea**: deja una " +
        "propuesta en la bandeja de Pepe y Beno la acepta o la descarta. " +
        "Al contestar decí que quedó para aprobar, no que quedó cargado.\n\n" +
        "**Vos no calculás precios.** Mandá los entregables con sus horas " +
        "estimadas y el monto lo saca Pepe multiplicando por la tarifa de " +
        "Ajustes y el multiplicador del tipo de cliente. Si el cliente " +
        "mencionó un número, no lo mandes: mandá las horas.\n\n" +
        "Si el proyecto todavía no existe en Pepe, usá " +
        "`registrar_proyecto` con el presupuesto adentro: queda todo en " +
        "una sola tarjeta.",
      inputSchema: presupuestoDictadoSchema,
      annotations: PROPONE,
    },
    async (dictado, ctx) => {
      const datos = datosDelPedido(ctx);

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "presupuesto_dictado",
        estado: "pendiente",
        payload: dictado,
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      const horas = dictado.items.reduce((total, i) => total + i.horas, 0);

      return respuesta(
        [
          `Quedó **para aprobar**: ${dictado.items.length} entregables, ${horas} horas en total.`,
          "",
          "El precio lo calcula Pepe con la tarifa de Ajustes cuando Beno lo acepte, así que puede no coincidir con el número que hayan charlado. Si no coincide, gana el de Pepe.",
          "",
          "Nace en **borrador** y sin proyecto: el proyecto se elige al aceptar el presupuesto desde su pantalla.",
        ].join("\n"),
      );
    },
  );
}
```

- [ ] **Step 2: `aceptarPresupuestoDictado()`**

En `src/lib/actions/inbox.ts`, después de `aceptarProyectoDictado()`. **Usa
el mismo armador**, así que son veinte líneas:

```ts
/**
 * Acepta un presupuesto dictado: lo crea de verdad, en `borrador`.
 *
 * Toda la lógica está en `crearPresupuestoDesdeDictado()`, compartida con
 * `aceptarProyectoDictado()`: acá solo se valida el ítem y se lo cierra.
 */
export async function aceptarPresupuestoDictado(
  itemId: string,
): Promise<ActionResult<{ numero: number }>> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { data: item, error: errorLectura } = await supabase
    .from("inbox")
    .select("id, tipo, estado, payload")
    .eq("id", idParseado.data)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!item) return fail("No encontré esa propuesta.");
  if (item.tipo !== "presupuesto_dictado") {
    return fail("Esa propuesta no es un presupuesto.");
  }
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Esa propuesta ya estaba resuelta.");
  }

  const payload = presupuestoDictadoPayloadSchema.safeParse(item.payload);
  if (!payload.success) {
    return fail("La propuesta guardada está incompleta. Rechazala.");
  }

  const creado = await crearPresupuestoDesdeDictado(payload.data);
  // El mensaje de "no cargaste tu tarifa hora" llega tal cual: es
  // accionable y Beno está a un click de Ajustes.
  if (!creado.ok) return fail(creado.error);

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      payload: {
        ...(item.payload as Record<string, unknown>),
        quote_id: creado.data.id,
        quote_numero: creado.data.numero,
      },
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ numero: creado.data.numero });
}
```

- [ ] **Step 3: La tarjeta**

Reusa `PresupuestoPropuesto` de la Tarea 9 entero. El cableado, junto a los
otros:

```tsx
  const esPresupuesto = actual?.tipo === "presupuesto_dictado";
  const presupuestoDictado =
    actual && esPresupuesto ? leerPresupuestoDictado(actual.payload) : null;
```

En `aceptar()`:

```tsx
    if (esPresupuesto) {
      if (!presupuestoDictado) return;
      resolver(
        actual,
        () => aceptarPresupuestoDictado(actual.id),
        "Presupuesto creado en borrador.",
      );
      return;
    }
```

Y una rama más en el renderizado, al lado de la de proyecto:

```tsx
        ) : esPresupuesto ? (
          presupuestoDictado ? (
            <PresupuestoPropuesto p={presupuestoDictado} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Esta propuesta quedó incompleta y no se puede aceptar. Rechazala.
            </p>
          )
```

⚠ Mismas dos cosas que en la tarea anterior: sumar `esPresupuesto` y
`presupuestoDictado` a las dependencias de `aceptar()`, y excluir el tipo
de la condición de `propuesta` y de `faltaProyecto`.

- [ ] **Step 4: Registrar la familia**

En `src/app/api/mcp/route.ts`:

```ts
import { registrarPresupuestos } from "@/lib/mcp/tools/presupuestos";
```

```ts
    registrarNotas(server);
    registrarPresupuestos(server);
```

Y la tabla del comentario de arriba pasa a **once** tools.

- [ ] **Step 5: Verificar, probar y commitear**

```bash
npm run typecheck && npm run lint
```

Probalo insertando un ítem `presupuesto_dictado` a mano con el mismo
`payload.presupuesto` del script de la Tarea 9 (sin el envoltorio de
proyecto). Expected: la tarjeta muestra los entregables y las horas, y
**ningún precio**; aceptar crea el presupuesto en `borrador`, sin proyecto.

**Si no tenés tarifa cargada en Ajustes**, aceptar tiene que fallar con
"Todavía no cargaste tu tarifa hora…" y el ítem **queda en la bandeja**. Es
el caso que hay que ver antes de dar la tarea por buena.

```bash
git add src/lib/mcp/tools src/lib/actions/inbox.ts src/components/bandeja/bandeja-view.tsx src/app/api/mcp/route.ts
git commit -m "registrar_presupuesto: el modelo estima esfuerzo, el precio lo pone Pepe"
```

---

## Task 11: Cierre de la ola 2

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/conector-mcp.md`
- Modify: `docs/dev/manual-agentico.md`
- Modify: `docs/registro-correcciones.md`

- [ ] **Step 1: Build limpio**

```bash
npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 2: `AGENTS.md` §8**

La tabla de tools pasa de ocho a **once**:

| Escribe | Tools |
|---|---|
| nada | `listar_proyectos`, `listar_movimientos`, `balance`, `buscar_lecciones`, `leer_bitacora` |
| `inbox` | `registrar_movimiento`, `registrar_leccion`, `registrar_nota`, `registrar_proyecto`, `registrar_presupuesto` |
| directo | `escribir_bitacora` |

Y el párrafo que hoy explica por qué `escribir_bitacora` es la excepción
suma la mitad que faltaba: **`registrar_nota` es lo que la sostiene.**
Hasta que existió, un resumen del modelo no tenía a dónde ir, y esa era la
presión que termina aflojando la única regla que permite escribir sin
confirmación.

Sumar también: el precio de un presupuesto **nunca lo calcula el modelo**;
`ancla_verificada` entra siempre en `false` desde el conector; un
presupuesto dictado nace en `borrador`.

- [ ] **Step 3: `docs/conector-mcp.md` y el manual agéntico**

Las tres tools nuevas con su forma de payload, y en el manual la fila de la
bandeja con los tres `tipo_bandeja` nuevos y qué crea aceptar cada uno.

- [ ] **Step 4: `docs/registro-correcciones.md`**

Una entrada: el fallo 3 del 2026-08-10 no fue un error del modelo — se frenó
solo, explicó que el proyecto no existía y avisó que lo que iba a cargar era
un resumen suyo. **Faltaba capacidad, no criterio.**

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/
git commit -m "La documentacion al dia con las tres tools nuevas del conector"
```

---

## Criterio de aceptación

Las cuatro frases reales, tal cual las escribió Beno. **Corrolas en la app,
no razones sobre ellas.**

1. **Fallo 1** — `"Anota las fechas de apertura y cierre de Proder y El
   Prode de Beno 01/04/26 apertura y 31/07/26 para las dos"`

   Las dos ventanas quedan escritas en los dos proyectos, la respuesta dice
   qué cambió en los balances, y **no se escribe nada en la bitácora ni se
   dispara ninguna retro**.

   ⚠ Ojo con las fechas al probarlo: la frase dice **31/07** y los datos de
   hoy tienen **20/07** (Beno corrigió el dato después). Correr la frase
   pisa el 20/07 con el 31/07 y **está bien** — la acción tiene que escribir
   lo que dice la frase. No cambia ningún número: *Claude Pro* del 07/07 cae
   adentro de las dos. **Dejá los datos como estaban al terminar.**

   Y si la recalibración de la Tarea 5 no logró que las fechas vuelvan en el
   argumento, este punto queda a medias **pero el daño no ocurre**: la
   salvaguarda de la Tarea 1 hace que la frase pregunte en vez de escribir.
   Eso es el punto 4, que es lo más importante.

2. **Fallo 2** — `"Anotame -20usd en Claude Code en el proyecto Gentius.
   Activalo de paso"`

   El movimiento llega al formulario con **Gentius**. La segunda mitad
   ("activalo") depende de que el recepcionista parta la frase en dos; si no
   parte, se anota el desvío. **Gentius ya está abierto**, así que esa mitad
   no puede fallar por datos: lo que se verifica es que la acción exista.

3. **Fallo 3** — el proyecto del Agente de RRHH desde Claude.ai

   Claude crea el proyecto con su presupuesto **en una sola tarjeta** de
   bandeja, y el relevamiento entra como nota, también a la bandeja. La
   respuesta dice que quedó **para aprobar**, no que quedó cargado.

4. **Una frase no cubierta por ningún destino no escribe nada en ninguna
   parte.**

   Probá `anotá Proder`, `apuntá Gentius` y `guardá pm`. Los tres tienen que
   preguntar. Después probá una anotación real de dos renglones: tiene que
   guardarse directo, sin pregunta.

   **Este es el que cierra el hallazgo transversal**, y es el único que no
   sale de una frase que Beno haya escrito: sale de lo que pasó con la que
   sí escribió.
