# El reparto por fecha — plan de implementación

> ✅ **EJECUTADO Y EN PRODUCCIÓN el 2026-08-11.** Las nueve tareas están
> hechas, mergeadas a `main` y desplegadas. Este archivo se deja como
> registro de qué se decidió y **con qué información equivocada** — ver
> "Correcciones de la ejecución", abajo. Los desvíos respecto de lo que
> dice acá están explicados en cada tarea; el resultado final está en
> `AGENTS.md` §2 y en `docs/registro-correcciones.md`.
>
> Dos cosas que el plan no previó y se hicieron igual: el reparto se
> extrajo entero a `prorrateo.ts` porque había **tres** caminos de cálculo
> y no dos, y la migración que borra `activo` se aplicó **después** del
> deploy y no antes, para no dejar una ventana con producción rota.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un gasto compartido se reparta entre los proyectos que
estaban vivos **el día de ese gasto**, y no entre los que están activos
hoy.

**Architecture:** `projects.fecha_inicio`/`fecha_fin` pasan a ser la única
fuente de verdad y la columna `activo` se borra. `calcularParticipaciones`
recibe una fecha obligatoria y se calcula por movimiento, memoizada por
fecha. La migración se hace en dos pasos —primero cargar las ventanas, y
recién varios commits después borrar `activo`— para que el repo compile y
se comporte bien en cada commit intermedio.

**Tech Stack:** TypeScript · Next 15 App Router · Supabase (Postgres) ·
Zod · scripts de verificación con `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-10-prorrateo-por-fecha-design.md`

---

## Correcciones de la ejecución (2026-08-11)

Este plan se escribió **leyendo código y razonando sobre él, sin ejecutar
nada**, y por eso afirmaba siete cosas que no eran ciertas. Las Tareas 1 a
4 ya se ejecutaron y encontraron cinco de ellas de a una; las otras dos
salieron después, en una auditoría en seco de las tareas que faltaban.
Todas están corregidas más abajo, en su tarea.

| Lo que decía | Lo que es | Dónde |
|---|---|---|
| El typecheck de la Tarea 3 falla en 6 call sites | Pasa limpio; la función vieja todavía existe | T3 · Step 8 |
| `crearProyectoDesdePresupuesto` crea el proyecto | No existe; el insert está inline en `aceptarPresupuesto` | T4 · Step 2 |
| El centinela del reparto simulado es `"nuevo"` | El componente lo lee como `"__nuevo__"` | T4 · Step 2 |
| La simulación se hace en `hoy` | Se inserta la fecha del formulario, que es editable | T4 · Step 2 |
| El closure memoizado se escribe en cada call site | Estaba duplicado; ahora es `memoParticipaciones()` | T4 · Step 1 |
| Los archivos de tracks que no hay que tocar son 3 | Son **4**: falta `lib/sugerencias.ts` | T6 · Step 3 |
| El `projectSchema` nuevo alcanza | Falta el refine cruzado del check de la base | T6 · Step 4 |

Y dos que no eran errores del plan pero tampoco estaban escritas: el
`process.exit()` de los scripts crashea en Windows, y `alternarProyectoActivo`
puede violar el check de fechas con un proyecto de inicio futuro.

**Moraleja para el próximo plan de este repo:** antes de darlo por
aprobado, grepear cada símbolo que nombra y correr cada comando cuyo
resultado predice. Los siete se detectaban así.

---

## Antes de empezar

**Este proyecto no tiene suite de tests versionada** (`AGENTS.md`). La
verificación es: scripts temporales que se corren contra la base real, se
confirman y **se borran**, más `npm run typecheck && npm run lint` en cada
tarea y `npm run build` al final. No agregues Jest ni Vitest.

Los scripts van en la **raíz del repo** (no en `/tmp`: desde afuera no se
resuelve `node_modules` ni el alias `@/`) y se corren con:

```bash
npx tsx --conditions=react-server ./verificar-X.mts
```

El flag `--conditions=react-server` no es opcional: sin él,
`import "server-only"` resuelve al archivo que lanza a propósito.

Todo script que lea la base necesita este preámbulo, porque no corre
adentro de Next:

```ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]] = m[2].trim();
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
```

**Para aplicar migraciones y regenerar tipos hace falta
`SUPABASE_ACCESS_TOKEN`, que lo tiene Beno.** Si no lo tenés, frená y
pedíselo; no inventes un camino alternativo.

**No corras `npm run build` con un `next dev` vivo**: comparten `.next` y
se pisan.

**Al regenerar tipos hay que volver a pegar a mano el bloque de alias del
final de `database.types.ts`.** El procedimiento exacto está en la Tarea 2.

### Los números de referencia, medidos el 2026-08-10

Sirven para saber si algo se movió cuando no tenía que moverse:

| Qué | Valor |
|---|---|
| Movimientos | 22, del 02/04/2026 al 07/07/2026 |
| Compartidos (`project_id is null`) | 15, todos egresos |
| Balance general efectuado, ARS | `$302.411` (ingresos `$624.200`, egresos `$321.789`) |
| Proder | `$463.306` |
| El Prode de Beno | `-$160.894` |
| Gentius | `$0` |

**El único número que tiene que cambiar en todo este plan** es el reparto
de *Claude Pro - Julio* (07/07/2026, US$ 20), que pasa de partirse entre
dos proyectos a partirse entre tres. Gentius deja de ser exactamente `$0`.
Cualquier otro movimiento en las cifras es un bug.

---

## Estructura de archivos

| Archivo | Responsabilidad después de este plan |
|---|---|
| `src/lib/prorrateo.ts` | `estaVivo()` y `calcularParticipaciones(projects, fecha)`. La regla de quién participa, en un solo lugar. |
| `src/lib/balances.ts` | Reparte por fecha y expone qué gastos quedaron sin dueño. |
| `src/lib/schemas.ts` | `projectSchema` sin `activo`, con las dos fechas. |
| `src/lib/actions/projects.ts` | El alta/edición y el botón, que ahora edita la ventana. |
| `supabase/migrations/20260810100000_ventanas_de_proyecto.sql` | Carga las tres ventanas. |
| `supabase/migrations/20260810100001_borrar_activo.sql` | Borra la columna. |
| `src/components/ajustes/proyectos-panel.tsx` | Los dos campos de fecha y el botón de abrir/cerrar. |

---

## Task 1: `estaVivo()` y el reparto con fecha, conviviendo con el viejo

La función nueva nace **al lado** de la vieja y con otro nombre. Así el
repo compila y se comporta igual mientras se migran los call sites de a
uno; recién en la Tarea 5 se borra la vieja.

**Files:**
- Modify: `src/lib/prorrateo.ts`
- Verify: `verificar-participaciones.mts` (temporal, se borra en el paso 6)

- [ ] **Step 1: Escribir el script de verificación**

Crear `verificar-participaciones.mts` en la raíz:

```ts
import { estaVivo, participacionesEnFecha } from "./src/lib/prorrateo.ts";

const P = (id: string, ini: string | null, fin: string | null) => ({
  id,
  fecha_inicio: ini,
  fecha_fin: fin,
  peso_prorrateo: 1,
});

let fallos = 0;
function chequear(que: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${que} → ${JSON.stringify(real)}`);
}

// --- estaVivo -------------------------------------------------
chequear("sin fechas, vivo siempre", estaVivo(P("a", null, null), "2020-01-01"), true);
chequear("antes del inicio", estaVivo(P("a", "2026-04-01", null), "2026-03-31"), false);
chequear("el día del inicio", estaVivo(P("a", "2026-04-01", null), "2026-04-01"), true);
chequear("el día del cierre", estaVivo(P("a", null, "2026-07-20"), "2026-07-20"), true);
chequear("después del cierre", estaVivo(P("a", null, "2026-07-20"), "2026-07-21"), false);

// --- participacionesEnFecha ----------------------------------
const tres = [
  P("proder", "2026-04-01", "2026-07-20"),
  P("prode", "2026-04-01", "2026-07-20"),
  P("gentius", "2026-07-01", null),
];

const enMayo = participacionesEnFecha(tres, "2026-05-15");
chequear("15/05: dos participantes", enMayo.size, 2);
chequear("15/05: mitad cada uno", enMayo.get("proder")?.fraccion, 0.5);
chequear("15/05: gentius afuera", enMayo.has("gentius"), false);

const enJulio = participacionesEnFecha(tres, "2026-07-07");
chequear("07/07: tres participantes", enJulio.size, 3);
chequear("07/07: un tercio", enJulio.get("gentius")?.fraccion, 1 / 3);

const enAgosto = participacionesEnFecha(tres, "2026-08-06");
chequear("06/08: solo gentius", enAgosto.size, 1);
chequear("06/08: se lleva todo", enAgosto.get("gentius")?.fraccion, 1);

const vacio = participacionesEnFecha([], "2026-05-15");
chequear("sin proyectos, mapa vacío", vacio.size, 0);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
```

- [ ] **Step 2: Correrlo para verificar que falla**

Run: `npx tsx --conditions=react-server ./verificar-participaciones.mts`
Expected: FALLA al importar — `estaVivo` y `participacionesEnFecha` no
existen todavía en `src/lib/prorrateo.ts`.

- [ ] **Step 3: Implementar las dos funciones**

En `src/lib/prorrateo.ts`, agregar el import de `todayISO` arriba:

```ts
import { todayISO } from "@/lib/dates";
```

Y agregar, **debajo** de `calcularParticipaciones` (que no se toca en esta
tarea):

```ts
/** Lo mínimo que hace falta para saber si un proyecto entra a un reparto. */
export type ProyectoParaReparto = Pick<
  Project,
  "id" | "fecha_inicio" | "fecha_fin" | "peso_prorrateo"
>;

/**
 * ¿El proyecto estaba vivo en esta fecha?
 *
 * Es lo que antes decía la columna `activo`, pero preguntado contra una
 * fecha en vez de contra el presente. Las dos puntas abiertas tienen
 * significado y no son un caso degenerado: `fecha_inicio` nula es "desde
 * siempre" y `fecha_fin` nula es "sigue abierto". Un proyecto sin ninguna
 * de las dos participa de todo, que es exactamente el comportamiento
 * anterior a este cambio — y por eso la migración de datos puede ser
 * incremental sin romper nada en el medio.
 *
 * Las dos comparaciones son inclusivas: el día que abrís y el día que
 * cerrás el proyecto está vivo.
 */
export function estaVivo(
  proyecto: Pick<Project, "fecha_inicio" | "fecha_fin">,
  fecha: string = todayISO(),
): boolean {
  if (proyecto.fecha_inicio && fecha < proyecto.fecha_inicio) return false;
  if (proyecto.fecha_fin && fecha > proyecto.fecha_fin) return false;
  return true;
}

/**
 * Qué fracción del gasto compartido **de esa fecha** le toca a cada
 * proyecto.
 *
 * ⚠ **La fecha no tiene default, y es a propósito.** Un default a hoy
 * dejaría compilar cualquier call site que se olvide de pasarla,
 * exactamente con el bug que este cambio viene a arreglar. Sin default,
 * el compilador obliga a mirar los ocho.
 *
 * Si no hay ningún proyecto vivo esa fecha devuelve un mapa vacío: el
 * gasto sigue contando en el balance general, simplemente no se reparte.
 * Quien llama tiene que decirlo, no esconderlo.
 */
export function participacionesEnFecha(
  projects: ProyectoParaReparto[],
  fecha: string,
): Map<string, ParticipacionProyecto> {
  const vivos = projects.filter((p) => estaVivo(p, fecha));
  const pesoTotal = vivos.reduce((sum, p) => sum + Number(p.peso_prorrateo), 0);

  const map = new Map<string, ParticipacionProyecto>();
  if (vivos.length === 0 || pesoTotal <= 0) return map;

  vivos.forEach((project, indice) => {
    map.set(project.id, {
      projectId: project.id,
      fraccion: Number(project.peso_prorrateo) / pesoTotal,
      indice: indice + 1,
      total: vivos.length,
    });
  });

  return map;
}
```

- [ ] **Step 4: Correrlo para verificar que pasa**

Run: `npx tsx --conditions=react-server ./verificar-participaciones.mts`
Expected: `TODO OK`, con exit code 0.

- [ ] **Step 5: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: sin salida (los dos pasan en silencio).

- [ ] **Step 6: Borrar el script y commitear**

```bash
rm verificar-participaciones.mts
git add src/lib/prorrateo.ts
git commit -m "La regla de quien participa del reparto, contra una fecha"
```

---

## Task 2: Cargar las tres ventanas en la base

Todavía **sin** borrar `activo`. Después de esta tarea las dos cosas
conviven y **no coinciden**, y esa discrepancia es la feature: Gentius
tiene `activo = false` y una ventana abierta desde el 01/07.

**Files:**
- Create: `supabase/migrations/20260810100000_ventanas_de_proyecto.sql`
- Modify: `src/lib/supabase/database.types.ts` (regenerado)
- Verify: `verificar-ventanas.mts` (temporal)

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- Las ventanas de vida de los tres proyectos.
--
-- `fecha_inicio` y `fecha_fin` existen desde
-- `20260810000001_proyectos_fechas.sql` y hasta hoy no las leyó nadie.
-- Con este dato cargado, el reparto de gastos compartidos puede pasar a
-- calcularse contra la fecha de cada gasto en vez de contra la foto de
-- los proyectos activos de hoy.
--
-- Las fechas las dio Beno el 2026-08-10. Del 20/07 dijo "el 20/07 o por
-- ahí": queda corregible desde la pantalla de Ajustes.
--
-- ⚠ Esta migración **no** borra la columna `activo`, y eso es
-- deliberado. Si las dos cosas pasaran juntas habría un momento —entre
-- el `alter table` y el deploy del código que lee las fechas— en el que
-- los tres proyectos quedarían sin ventana y sin bandera, o sea "vivos
-- siempre", y Gentius se comería un tercio de los 15 gastos compartidos.
-- La columna se borra en `20260810100001`, varios commits después, con
-- el código ya leyendo fechas.
--
-- Se escribe por `slug` y no por `id`: los uuid son de la base de Beno y
-- no sobrevivirían a un `db reset` sobre otro proyecto.
-- ============================================================

update public.projects set fecha_inicio = '2026-04-01', fecha_fin = '2026-07-20'
  where slug in ('proder', 'el-prode-de-beno');

update public.projects set fecha_inicio = '2026-07-01', fecha_fin = null
  where slug = 'gentius';
```

- [ ] **Step 2: Aplicarla**

```bash
SUPABASE_ACCESS_TOKEN=<el de Beno> npx supabase db push --linked
```

Expected: `Applying migration 20260810100000_ventanas_de_proyecto.sql...`
y `Finished supabase db push.`

- [ ] **Step 3: Regenerar los tipos**

El esquema no cambió de forma, así que este paso es una verificación de
que el archivo sigue en sincronía. Guardá el bloque de alias antes:

```bash
grep -n "} as const" src/lib/supabase/database.types.ts
# tomá el número de línea N y guardá desde N+1 hasta el final:
sed -n "$((N+1)),\$p" src/lib/supabase/database.types.ts > /tmp/alias.txt

SUPABASE_ACCESS_TOKEN=<el de Beno> npx supabase gen types typescript \
  --project-id thlocwmhxzqkmmnxmunf --schema public \
  > src/lib/supabase/database.types.ts

cat /tmp/alias.txt >> src/lib/supabase/database.types.ts
```

Run: `git diff --stat src/lib/supabase/database.types.ts`
Expected: sin cambios, o cambios cosméticos de orden. Si aparece algo de
fondo, pará y mirá qué es antes de seguir.

- [ ] **Step 4: Escribir el script de verificación**

Crear `verificar-ventanas.mts` con el preámbulo de "Antes de empezar", más:

```ts
import { estaVivo } from "./src/lib/prorrateo.ts";

const { data: proyectos } = await admin
  .from("projects")
  .select("slug, activo, fecha_inicio, fecha_fin")
  .order("slug");

let fallos = 0;
const esperado: Record<string, { ini: string | null; fin: string | null; vivoHoy: boolean }> = {
  "el-prode-de-beno": { ini: "2026-04-01", fin: "2026-07-20", vivoHoy: false },
  gentius: { ini: "2026-07-01", fin: null, vivoHoy: true },
  proder: { ini: "2026-04-01", fin: "2026-07-20", vivoHoy: false },
};

for (const p of proyectos ?? []) {
  const e = esperado[p.slug];
  const vivo = estaVivo(p);
  const ok = p.fecha_inicio === e.ini && p.fecha_fin === e.fin && vivo === e.vivoHoy;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok  " : "FALLA"} ${p.slug}: ${p.fecha_inicio} → ${p.fecha_fin ?? "abierto"} | vivo hoy: ${vivo} | activo (columna vieja): ${p.activo}`,
  );
}

// La discrepancia esperada, que es el punto de todo esto.
const gentius = proyectos?.find((p) => p.slug === "gentius");
console.log(
  gentius?.activo === false && estaVivo(gentius)
    ? "\nok   Gentius: la columna dice inactivo y la ventana dice vivo. Esa es la diferencia que introduce este plan."
    : "\nFALLA la discrepancia esperada de Gentius no está",
);

process.exit(fallos === 0 ? 0 : 1);
```

- [ ] **Step 5: Correrlo**

Run: `npx tsx --conditions=react-server ./verificar-ventanas.mts`
Expected: tres `ok`, más la línea de la discrepancia de Gentius. Exit 0.

- [ ] **Step 6: Borrar el script y commitear**

```bash
rm verificar-ventanas.mts
git add supabase/migrations/20260810100000_ventanas_de_proyecto.sql src/lib/supabase/database.types.ts
git commit -m "Las ventanas de vida de los tres proyectos"
```

---

## Task 3: `balances.ts` reparte por fecha

Acá aterriza el cambio de comportamiento. Es la tarea donde el reparto de
Claude Pro del 07/07 pasa de dos a tres partes.

**Files:**
- Modify: `src/lib/balances.ts`
- Verify: `verificar-balances.mts` (temporal)

- [ ] **Step 1: Escribir el script de verificación contra los datos reales**

Crear `verificar-balances.mts` con el preámbulo, más:

```ts
import { calcularBalances } from "./src/lib/balances.ts";

const [{ data: movs }, { data: projs }, { data: cats }] = await Promise.all([
  admin.from("movements").select("*"),
  admin.from("projects").select("*"),
  admin.from("categories").select("*"),
]);

const filtros = { estado: "ambos" as const };
const b = calcularBalances(movs!, projs!, cats!, "ARS", filtros);

let fallos = 0;
const chequear = (que: string, real: number, esperado: number) => {
  const ok = Math.abs(real - esperado) < 1;
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${que}: ${real} (esperado ${esperado})`);
};

// El balance general NO cambia: el reparto mueve plata entre proyectos,
// nunca cambia el total.
chequear("balance general efectuado", b.efectuado.balance, 302411);
chequear("ingresos", b.efectuado.ingresos, 624200);
chequear("egresos", b.efectuado.egresos, 321789);

// El invariante, que es lo que sostiene toda la app.
const suma = b.porProyecto.reduce((s, p) => s + p.balance, 0);
const cierra = Math.abs(suma - b.proyectado.balance - b.compartidoSinRepartir) < 1;
if (!cierra) fallos++;
console.log(
  `${cierra ? "ok  " : "FALLA"} invariante: suma por proyecto ${suma.toFixed(2)} + sin repartir ${b.compartidoSinRepartir} = general ${b.proyectado.balance}`,
);

// Gentius deja de ser exactamente cero: se lleva un tercio de Claude Pro
// de julio, el único compartido posterior al 01/07.
const gentius = b.porProyecto.find((p) => p.nombre === "Gentius")!;
const cambio = gentius.balance !== 0;
if (!cambio) fallos++;
console.log(
  `${cambio ? "ok  " : "FALLA"} Gentius ya no es 0: ${gentius.balance}`,
);

console.log("\nPor proyecto:");
b.porProyecto.forEach((p) => console.log(`  ${p.nombre}: ${p.balance}`));
console.log("Sin repartir:", b.compartidoSinRepartir, `(${b.movimientosSinRepartir.length} movimientos)`);

process.exit(fallos === 0 ? 0 : 1);
```

- [ ] **Step 2: Correrlo para verificar que falla**

Run: `npx tsx --conditions=react-server ./verificar-balances.mts`
Expected: FALLA a compilar — `b.movimientosSinRepartir` no existe. Y si
lo comentaras, fallaría el chequeo de Gentius: hoy da exactamente 0.

- [ ] **Step 3: Cambiar el reparto de compartidos**

En `src/lib/balances.ts`, cambiar el import de arriba:

```ts
import {
  estaVivo,
  participacionesEnFecha,
  type ParticipacionProyecto,
  type ProyectoParaReparto,
} from "@/lib/prorrateo";
```

Reemplazar la función `repartirCompartidos` entera por:

```ts
/**
 * Reparte los movimientos compartidos y devuelve, por proyecto, lo que le
 * tocó — más los que no encontraron a nadie.
 *
 * El conjunto de participantes se calcula **por fecha**, no una vez para
 * todos: es el punto entero de este módulo. Se memoiza porque los 15
 * compartidos de hoy caen en muchas menos fechas distintas, y recalcular
 * el mapa por movimiento sería trabajo repetido sin ninguna ganancia.
 *
 * Un movimiento cuya fecha no cae en la ventana de ningún proyecto sale
 * por `sinRepartir` en vez de desaparecer. Antes ese caso era global —o
 * había proyectos activos o no los había—; ahora es por movimiento, así
 * que la UI puede decir **cuáles** y no solo cuánto.
 */
function repartirCompartidos(
  compartidos: Movement[],
  projects: ProyectoParaReparto[],
  moneda: Moneda,
): {
  porProyecto: Map<string, { ingresos: number; egresos: number }>;
  sinRepartir: Movement[];
} {
  const porProyecto = new Map<string, { ingresos: number; egresos: number }>();
  const sinRepartir: Movement[] = [];

  const cache = new Map<string, Map<string, ParticipacionProyecto>>();
  const participacionesDe = (fecha: string) => {
    let p = cache.get(fecha);
    if (!p) {
      p = participacionesEnFecha(projects, fecha);
      cache.set(fecha, p);
    }
    return p;
  };

  for (const movement of compartidos) {
    const participaciones = participacionesDe(movement.fecha);
    const ids = [...participaciones.keys()];

    if (ids.length === 0) {
      sinRepartir.push(movement);
      continue;
    }

    const fracciones = ids.map((id) => participaciones.get(id)!.fraccion);
    const partes = repartirPorRestoMayor(
      montoEnMoneda(movement, moneda),
      fracciones,
    );

    ids.forEach((id, i) => {
      const acc = porProyecto.get(id) ?? { ingresos: 0, egresos: 0 };
      if (movement.tipo === "ingreso") acc.ingresos += partes[i];
      else acc.egresos += partes[i];
      porProyecto.set(id, acc);
    });
  }

  for (const acc of porProyecto.values()) {
    acc.ingresos = round2(acc.ingresos);
    acc.egresos = round2(acc.egresos);
  }

  return { porProyecto, sinRepartir };
}
```

- [ ] **Step 4: Agregar `movimientosSinRepartir` a la interfaz**

En `src/lib/balances.ts`, dentro de `interface Balances`, reemplazar el
comentario y el campo de `compartidoSinRepartir` por:

```ts
  /**
   * Neto de los egresos compartidos que no se pudieron repartir porque su
   * fecha no cae en la ventana de ningún proyecto. Si es distinto de 0,
   * la suma por proyecto no llega al general.
   */
  compartidoSinRepartir: number;
  /**
   * Cuáles fueron. Antes este caso era todo o nada y alcanzaba con el
   * monto; ahora es por movimiento, y un aviso que dice "hay $27.000 sin
   * repartir" sin decir de qué no se puede accionar.
   */
  movimientosSinRepartir: Movement[];
```

- [ ] **Step 5: Cambiar `calcularBalances`**

Reemplazar el bloque que va desde `const participaciones = calcularParticipaciones(projects);`
hasta el cálculo de `compartidoSinRepartir` por:

```ts
  const efectuados = filtrados.filter((m) => m.estado === "efectuado");

  const compartidos = filtrados.filter((m) => m.project_id === null);
  const reparto = repartirCompartidos(compartidos, projects, moneda);
```

Y donde dice `repartoCompartidos.get(project.id)`, usar
`reparto.porProyecto.get(project.id)`.

Reemplazar el cálculo de `compartidoSinRepartir` por:

```ts
  // Los que no encontraron dueño, netos: los egresos suman y los ingresos
  // restan, igual que en un balance.
  const compartidoSinRepartir = round2(
    reparto.sinRepartir.reduce((sum, m) => {
      const monto = montoEnMoneda(m, moneda);
      return sum + (m.tipo === "ingreso" ? -monto : monto);
    }, 0),
  );
```

Y en el objeto que devuelve, donde dice `activo: project.activo`, poner
`activo: estaVivo(project)`, y agregar al final:

```ts
    compartidoSinRepartir,
    movimientosSinRepartir: reparto.sinRepartir,
```

- [ ] **Step 6: Cambiar `calcularBalancesProyecto`**

Reemplazar el bloque de `const participaciones = ...` y el `for` de
`imputados` por:

```ts
  const filtrados = filtrarMovimientos(movements, filtros);

  const cache = new Map<string, Map<string, ParticipacionProyecto>>();
  const participacionesDe = (fecha: string) => {
    let p = cache.get(fecha);
    if (!p) {
      p = participacionesEnFecha(projects, fecha);
      cache.set(fecha, p);
    }
    return p;
  };

  // La participación de HOY, para la etiqueta "Compartido (1/3)" del
  // encabezado. Ojo: con reparto por fecha, dos movimientos de la misma
  // pantalla pueden haberse repartido entre conjuntos distintos, así que
  // esta etiqueta describe el presente y no cada fila.
  const participacion = participacionesDe(todayISO()).get(projectId);

  const imputados: Movement[] = [];

  for (const m of filtrados) {
    if (m.project_id === projectId) {
      imputados.push(m);
      continue;
    }
    if (m.project_id !== null) continue;

    const parte = participacionesDe(m.fecha).get(projectId);
    if (!parte) continue;

    imputados.push({
      ...m,
      monto_ars: round2(Number(m.monto_ars) * parte.fraccion),
      monto_usd: round2(Number(m.monto_usd) * parte.fraccion),
    });
  }
```

Agregar el import de `todayISO`:

```ts
import { monthKey, monthRange, todayISO } from "@/lib/dates";
```

Y en el objeto que devuelve, agregar `movimientosSinRepartir: []` al lado
del `compartidoSinRepartir: 0` que ya está.

- [ ] **Step 7: Correr el script y verificar que pasa**

Run: `npx tsx --conditions=react-server ./verificar-balances.mts`
Expected: todos `ok`. El general sigue en `302411`, el invariante cierra,
y Gentius ya no es `0`.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: **pasa limpio.**

⚠ **Este paso decía que iba a fallar en 6 call sites de UI. Era falso, y
se comprobó corriéndolo el 2026-08-11.** El razonamiento estaba mal: los
componentes importan `calcularParticipaciones` **directo de
`prorrateo.ts`**, no vía `balances.ts`, y esa función sigue existiendo
con su firma vieja hasta la Tarea 5. El compilador no tiene de qué
quejarse.

Consecuencia práctica, y por eso importa: **el compilador NO te va a
enumerar el trabajo de la Tarea 4.** Hay que ir a buscarlo con el `grep`
del Step 3 de esa tarea, que es la única red que queda. La promesa de la
Tarea 1 —"sin default, el compilador obliga a mirar los ocho"— recién se
cumple después del borrado de la Tarea 5.

- [ ] **Step 9: Commitear**

```bash
rm verificar-balances.mts
git add src/lib/balances.ts
git commit -m "El reparto de compartidos se calcula por fecha"
```

---

## Task 4: Migrar los call sites de la UI

**Files:**
- Modify: `src/components/proyectos/proyectos-grid.tsx:39`
- Modify: `src/components/proyectos/proyecto-view.tsx:74`
- Modify: `src/components/ajustes/proyectos-panel.tsx:75`
- Modify: `src/components/presupuestos/acciones-presupuesto.tsx:142-147`
- Modify: `src/lib/prorrateo.ts` (`pesosSonUniformes` e `imputarAProyecto`)

- [ ] **Step 1: Cambiar `pesosSonUniformes` e `imputarAProyecto`**

En `src/lib/prorrateo.ts`:

```ts
export function pesosSonUniformes(
  projects: ProyectoParaReparto[],
  fecha: string,
): boolean {
  const vivos = projects.filter((p) => estaVivo(p, fecha));
  if (vivos.length === 0) return true;
  const primero = Number(vivos[0].peso_prorrateo);
  return vivos.every((p) => Number(p.peso_prorrateo) === primero);
}
```

Y `imputarAProyecto` pasa a recibir los proyectos en vez de un mapa ya
calculado, porque el mapa ahora depende de la fecha de cada movimiento:

```ts
export function imputarAProyecto(
  movements: Movement[],
  projectId: string,
  projects: ProyectoParaReparto[],
  moneda: Moneda,
): MovimientoImputado[] {
  const cache = new Map<string, Map<string, ParticipacionProyecto>>();
  const participacionesDe = (fecha: string) => {
    let p = cache.get(fecha);
    if (!p) {
      p = participacionesEnFecha(projects, fecha);
      cache.set(fecha, p);
    }
    return p;
  };

  const resultado: MovimientoImputado[] = [];

  for (const movement of movements) {
    if (movement.project_id === projectId) {
      resultado.push({
        movement,
        monto: montoEnMoneda(movement, moneda),
        compartido: false,
      });
      continue;
    }

    if (movement.project_id !== null) continue;

    const participacion = participacionesDe(movement.fecha).get(projectId);
    if (!participacion) continue;

    resultado.push({
      movement,
      monto: round2(montoEnMoneda(movement, moneda) * participacion.fraccion),
      compartido: true,
      participacion,
    });
  }

  return resultado;
}
```

- [ ] **Step 2: Arreglar los cuatro componentes**

En los tres primeros, la llamada pasa a llevar la fecha de hoy, porque lo
que muestran es el estado presente:

- `proyectos-grid.tsx:39` → `participacionesEnFecha(projects, todayISO())`
- `proyecto-view.tsx:74` → ídem, y `pesosSonUniformes(projects, todayISO())`
- `proyectos-panel.tsx:75` → ídem

En los tres hay que agregar `import { todayISO } from "@/lib/dates";` y
cambiar el nombre importado de `calcularParticipaciones` a
`participacionesEnFecha`.

En `acciones-presupuesto.tsx:141-147`, la simulación de "cómo queda el
reparto si este presupuesto se convierte en proyecto" pasa a usar la
ventana del proyecto que va a nacer en vez de `activo: true`:

```ts
  const hoy = todayISO();
  const antes = participacionesEnFecha(projects, hoy);
  const despues = participacionesEnFecha(
    [
      ...projects,
      {
        id: "nuevo",
        // El proyecto nace hoy y sin fecha de cierre: es lo que hace
        // `crearProyectoDesdePresupuesto`.
        fecha_inicio: hoy,
        fecha_fin: null,
        peso_prorrateo: 1,
      },
    ],
    hoy,
  );
```

Y donde el componente usa `projects.filter((p) => p.activo)` (línea 141),
cambiar por `projects.filter((p) => estaVivo(p))`.

- [ ] **Step 3: Buscar los que falten**

Run: `grep -rn "calcularParticipaciones" src/ mcp/`
Expected: sin resultados fuera de `prorrateo.ts`. Si aparece alguno, es un
call site que se pasó por alto: arreglalo igual que los de arriba.

- [ ] **Step 4: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: los dos pasan.

- [ ] **Step 5: Commitear**

```bash
git add src/lib/prorrateo.ts src/components/
git commit -m "Los call sites de la UI pasan la fecha al reparto"
```

---

## Task 5: Borrar la función vieja

**Files:**
- Modify: `src/lib/prorrateo.ts`

- [ ] **Step 1: Verificar que nadie la usa**

Run: `grep -rn "calcularParticipaciones" src/ mcp/`
Expected: solo la definición en `src/lib/prorrateo.ts`.

- [ ] **Step 2: Borrarla y renombrar la nueva**

⚠ **El orden no es negociable: borrar PRIMERO, renombrar DESPUÉS.** Si
corrés el `sed` con la vieja todavía en el archivo, quedan dos funciones
exportadas con el mismo nombre y el error que tira el compilador no dice
lo que pasó.

⚠ **`prorrateo.ts` tiene dos exports que la Tarea 4 agregó y este plan no
conocía: `memoParticipaciones` y `cortesDelReparto`.** Las dos tienen
consumidores reales (`balances.ts` y `acciones-presupuesto.tsx`
respectivamente) y **no se borran**. Aparecen cerca de la vieja en
cualquier grep; no te confundas.

Borrar la función `calcularParticipaciones` entera (la que filtra por
`p.activo`) y renombrar `participacionesEnFecha` → `calcularParticipaciones`.

Run: `grep -rln "participacionesEnFecha" src/ | xargs sed -i 's/participacionesEnFecha/calcularParticipaciones/g'`

Verificado el 2026-08-11: el nombre **no aparece en `mcp/`**, así que el
`sed` sobre `src/` alcanza. Los seis archivos que toca son
`prorrateo.ts`, `balances.ts` (vía `memoParticipaciones`), los tres
componentes migrados en la Tarea 4, y un comentario de
`actions/presupuestos.ts` — ese último también corresponde renombrarlo.

⚠ Correr ese `sed` **solo sobre `src/`**, nunca sobre `docs/`: los specs
y los planes mencionan el nombre viejo a propósito, como registro de cómo
se hizo la migración.

- [ ] **Step 3: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: los dos pasan.

- [ ] **Step 4: Commitear**

```bash
git add src/
git commit -m "Se va la version del reparto que no miraba fechas"
```

---

## Task 6: Borrar la columna `activo`

**Files:**
- Create: `supabase/migrations/20260810100001_borrar_activo.sql`
- Modify: `src/lib/supabase/database.types.ts` (regenerado)
- Modify: los 12 lugares que leen `p.activo`

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- Se va `projects.activo`. La ventana es la única fuente de verdad.
--
-- Decidido con Beno el 2026-08-10, y el motivo es concreto: con las dos
-- cosas guardadas existe el estado contradictorio de un proyecto marcado
-- activo con el cierre vencido, que es exactamente el estado que él
-- señaló como incorrecto al pedir esta feature.
--
-- No se deja como columna generada: la expresión tendría que depender de
-- `current_date`, que no es inmutable y Postgres no lo acepta ahí. Y
-- tampoco como caché mantenida por la app, que deriva en silencio el día
-- que alguien escriba por afuera.
--
-- Lo que antes decía esta columna ahora lo dice `estaVivo()` en
-- `src/lib/prorrateo.ts`, contra una fecha.
--
-- Las ventanas se cargaron en `20260810100000`. Esta migración va después
-- a propósito: entre las dos hay commits de código que ya leen fechas.
-- ============================================================

alter table public.projects drop column activo;
```

- [ ] **Step 2: Aplicarla y regenerar tipos**

```bash
SUPABASE_ACCESS_TOKEN=<el de Beno> npx supabase db push --linked
```

Después regenerar los tipos con el mismo procedimiento de la Tarea 2,
paso 3 (guardar el bloque de alias, regenerar, volver a pegarlo).

- [ ] **Step 3: Typecheck para que el compilador enumere el trabajo**

Run: `npm run typecheck`
Expected: **falla**, con un error por cada lectura de `.activo` sobre un
proyecto. Esa lista es la tarea. Tienen que ser estos archivos:

```
src/components/ajustes/proyectos-panel.tsx
src/components/aprendizaje/session-card.tsx
src/components/charts/balance-proyecto-chart.tsx
src/components/presupuestos/acciones-presupuesto.tsx
src/components/providers/app-data-provider.tsx
src/components/proyectos/proyecto-view.tsx
src/components/proyectos/proyectos-grid.tsx
src/lib/actions/presupuestos.ts
src/lib/actions/projects.ts
src/lib/agentes/despacho.ts
src/lib/agentes/observaciones.ts
src/lib/mcp/tools/balance.ts
src/lib/mcp/tools/proyectos.ts
src/lib/schemas.ts
mcp/servidor.mts
```

⚠ `src/components/ajustes/tracks-panel.tsx`, `hoy-view.tsx`,
`lib/aprendizaje.ts` y **`lib/sugerencias.ts:241`** también dicen
`activo`, pero **sobre `tracks`**, que es otra tabla y no se toca. Un
track en pausa es una decisión de estudio, no una ventana de vida.

⚠ **`sugerencias.ts` faltaba en esta lista y es el más fácil de romper**,
porque su `t.activo` se lee igual que los de proyectos. Son **cuatro**
archivos de tracks, no tres. Medido el 2026-08-11: `grep -rn "\.activo"
src/ mcp/` da 18 archivos; 4 son de tracks, 13 son de proyectos y el
restante es la vieja `calcularParticipaciones` de `prorrateo.ts`, que la
Tarea 5 ya borró.

`src/lib/schemas.ts` **no aparece en ese grep**: dice `activo:` y no
`.activo`. Está en la lista de arriba igual, y hay que tocarlo.

✓ Verificado el 2026-08-11: `tsconfig.json` incluye `**/*.mts` y no
excluye `mcp/`, así que acá el compilador **sí** enumera el trabajo. (No
es como el Step 8 de la Tarea 3, donde la predicción era falsa porque la
función vieja seguía existiendo.)

- [ ] **Step 4: Reemplazar cada lectura**

En todos los componentes y módulos, `p.activo` pasa a `estaVivo(p)`, con
`import { estaVivo } from "@/lib/prorrateo";`. Casos que no son un
reemplazo mecánico:

`src/lib/schemas.ts` — `projectSchema` pierde `activo` y gana las fechas:

```ts
export const projectSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, "Poné un nombre.")
      .max(80, "Máximo 80 caracteres."),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
    fecha_inicio: isoDate.nullable(),
    fecha_fin: isoDate.nullable(),
    peso_prorrateo: z
      .number()
      .positive("El peso tiene que ser mayor a cero.")
      .max(9999, "Peso demasiado grande."),
  })
  // La base tiene `projects_fechas_coherentes` desde
  // `20260810000001_proyectos_fechas.sql:46`. Sin este refine, cerrar un
  // proyecto antes de su inicio no lo frena el formulario: lo frena
  // Postgres, y lo que ve Beno es el texto crudo de una violación de
  // check constraint. Validar acá es decirle lo mismo en castellano.
  .refine(
    (p) => !p.fecha_inicio || !p.fecha_fin || p.fecha_fin >= p.fecha_inicio,
    { message: "El cierre no puede ser anterior al inicio.", path: ["fecha_fin"] },
  );
```

⚠ **Ojo con el `.refine()`**: `z.object().refine()` devuelve un
`ZodEffects`, no un `ZodObject`. Si algún call site hace `.partial()`,
`.extend()`, `.omit()` o `.pick()` sobre `projectSchema`, deja de
compilar. Comprobalo con `grep -rn "projectSchema" src/` antes de dar la
tarea por terminada; si aparece alguno, exportá el objeto sin refinar
aparte y aplicá el refine solo donde se valida el formulario.

`src/lib/actions/projects.ts` — `crearProyecto` y `actualizarProyecto`
escriben `fecha_inicio`/`fecha_fin` en vez de `activo`, y
`alternarProyectoActivo` pasa a editar la ventana:

```ts
/**
 * El botón de abrir/cerrar un proyecto.
 *
 * No escribe una bandera porque ya no hay ninguna: **edita la ventana**.
 * Cerrar pone `fecha_fin` en hoy; reabrir la vuelve a `null`. Así no
 * puede existir un proyecto marcado abierto con el cierre vencido.
 *
 * Reabrir no toca `fecha_inicio`: si el proyecto arrancó el 01/04 y se
 * cerró por error, tiene que volver a arrancar el 01/04 y no hoy.
 *
 * El cierre se corre al inicio cuando el proyecto todavía no arrancó.
 * Cerrar hoy un proyecto que empieza el mes que viene violaría
 * `projects_fechas_coherentes` y devolvería un error de Postgres para
 * algo que tiene una respuesta obvia: un proyecto que se cierra antes de
 * arrancar duró cero días, y su ventana es su día de inicio.
 */
export async function alternarProyectoActivo(
  id: string,
  abierto: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireSession();

  let fecha_fin: string | null = null;

  if (!abierto) {
    const { data: proyecto } = await supabase
      .from("projects")
      .select("fecha_inicio")
      .eq("id", id)
      .single();

    const hoy = todayISO();
    fecha_fin =
      proyecto?.fecha_inicio && proyecto.fecha_inicio > hoy
        ? proyecto.fecha_inicio
        : hoy;
  }

  const { error } = await supabase
    .from("projects")
    .update({ fecha_fin })
    .eq("id", id);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
```

`src/lib/actions/presupuestos.ts:508` — el proyecto que nace de un
presupuesto se creaba con `activo: true`; ahora nace con
`fecha_inicio: parsedDestino.data.fecha_inicio` y `fecha_fin: null`.

`src/lib/agentes/despacho.ts:504` — **este es el bug del fallo 2 de Beno**
y se arregla acá de rebote:

```ts
      // Sin filtro por estado, y es deliberado: que un proyecto esté
      // cerrado no impide imputarle un gasto. Al revés — un gasto de un
      // proyecto cerrado va a ese proyecto, que para eso se cerró en esa
      // fecha y no en otra. Filtrar acá mandaba el movimiento a
      // "Compartido" en silencio, que es lo que le pasó a Beno el
      // 2026-08-10 al cargar un gasto en Gentius.
      const proyecto = nombrado !== "ambiguo" ? nombrado : null;
```

`mcp/servidor.mts:92` — el listado del MCP local dice activo/inactivo;
pasa a `estaVivo(p) ? "activo" : "cerrado"`. El módulo importa de
`@/lib/prorrateo`, que es puro y no tiene `server-only`, así que se puede.

- [ ] **Step 5: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: los dos pasan.

- [ ] **Step 6: Commitear**

```bash
git add supabase/migrations/20260810100001_borrar_activo.sql src/ mcp/
git commit -m "Se va la columna activo: la ventana es la unica verdad"
```

---

## Task 7: Las fechas y el botón en la pantalla de Proyectos

**Files:**
- Modify: `src/components/ajustes/proyectos-panel.tsx`

- [ ] **Step 1: Agregar los dos campos al formulario**

En el formulario de alta/edición (alrededor de la línea 220, donde hoy
está `activo: proyecto?.activo ?? true`), reemplazar ese default por:

```ts
      fecha_inicio: proyecto?.fecha_inicio ?? todayISO(),
      fecha_fin: proyecto?.fecha_fin ?? null,
```

Y agregar los dos inputs, siguiendo el patrón de
`components/recurrentes/recurrencia-dialog.tsx:218-228`, que ya hace
exactamente esto para las recurrencias:

```tsx
<div className="grid gap-3 sm:grid-cols-2">
  <div className="space-y-1.5">
    <Label htmlFor="p-inicio">Arrancó</Label>
    <Input id="p-inicio" type="date" {...register("fecha_inicio")} />
  </div>
  <div className="space-y-1.5">
    <Label htmlFor="p-fin">Cerró</Label>
    <Input
      id="p-fin"
      type="date"
      value={watch("fecha_fin") ?? ""}
      onChange={(e) => setValue("fecha_fin", e.target.value || null)}
    />
    <p className="text-muted-foreground text-xs">
      Vacío = sigue abierto.
    </p>
  </div>
</div>
```

- [ ] **Step 2: Enganchar el botón de abrir/cerrar**

`alternarProyectoActivo` existe en las actions desde siempre y **no está
enganchada a ninguna pantalla** (verificado el 2026-08-10). En la fila de
cada proyecto, donde hoy se muestra el cartel de inactivo (línea 135):

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() =>
    void alternarProyectoActivo(proyecto.id, !estaVivo(proyecto))
  }
>
  {estaVivo(proyecto) ? "Cerrar" : "Reabrir"}
</Button>
```

- [ ] **Step 3: Avisar cuándo cerrar mueve el reparto**

Debajo del botón, cuando el proyecto está vivo y es el único:

```tsx
{estaVivo(proyecto) &&
  projects.filter((p) => estaVivo(p)).length === 1 && (
    <p className="text-muted-foreground text-xs">
      Es el único abierto: al cerrarlo, los gastos compartidos posteriores
      a hoy no van a tener entre quiénes repartirse.
    </p>
  )}
```

- [ ] **Step 4: Probarlo a mano**

Run: `npm run dev` y abrir `/ajustes`.
Expected: los dos campos de fecha muestran `2026-04-01` y `2026-07-20`
para Proder; el botón dice "Reabrir" (porque cerró el 20/07) y apretarlo
deja `fecha_fin` en `null`. Volver a apretarlo lo cierra hoy.

⚠ Bajá el `next dev` antes de correr `npm run build`.

- [ ] **Step 5: Commitear**

```bash
git add src/components/ajustes/proyectos-panel.tsx
git commit -m "Las ventanas se editan, y el boton de cerrar existe de verdad"
```

---

## Task 8: Decir cuáles quedaron sin repartir

**Files:**
- Modify: `src/components/dashboard/dashboard-view.tsx:61-66`
- Modify: `src/components/proyectos/proyectos-grid.tsx:142`
- Modify: `src/lib/agentes/observaciones.ts:264-266`
- Modify: `src/lib/mcp/tools/balance.ts:199-202`
- Modify: `mcp/servidor.mts:189-190`

- [ ] **Step 1: Cambiar los cinco textos**

Los cinco dicen hoy alguna variante de *"no hay ningún proyecto activo"*,
que con reparto por fecha ya no es la razón. La razón nueva es que la
fecha de esos gastos no cae en la ventana de nadie.

En `dashboard-view.tsx`:

```tsx
{balances.compartidoSinRepartir !== 0 ? (
  <div className="...">
    <p>
      {formatMoney(Math.abs(balances.compartidoSinRepartir), moneda)} en
      gastos compartidos no se repartieron: ningún proyecto estaba abierto
      en esas fechas. Cuentan en el balance general pero en ninguno de los
      balances por proyecto.
    </p>
    <ul className="mt-2 space-y-0.5 text-xs">
      {balances.movimientosSinRepartir.slice(0, 5).map((m) => (
        <li key={m.id}>
          <span className="cifra">{formatDate(m.fecha)}</span> · {m.descripcion}
        </li>
      ))}
    </ul>
  </div>
) : null}
```

En `lib/mcp/tools/balance.ts`, reemplazar el texto del aviso por:

```ts
        lineas.push(
          "",
          `⚠ Hay ${formatMoney(Math.abs(b.compartidoSinRepartir), moneda)} de gastos compartidos sin repartir: ningún proyecto estaba abierto en sus fechas. Están contados en el balance general pero en ninguno de los balances por proyecto.`,
          ...b.movimientosSinRepartir
            .slice(0, 5)
            .map((m) => `  - ${formatDate(m.fecha)} · ${m.descripcion}`),
        );
```

En `observaciones.ts:266`, mismo criterio:

```ts
      `Hay ${miles(balances.compartidoSinRepartir)} de gastos compartidos que no se repartieron: ningún proyecto estaba abierto en sus fechas.`,
```

En `mcp/servidor.mts:189` y `proyectos-grid.tsx`, ajustar el texto con
la misma razón. `proyectos-grid` ya recibe el monto por prop; pasale
también `movimientosSinRepartir` si querés listarlos, o dejá solo el texto
corregido.

⚠ **La referencia `proyectos-grid.tsx:142` está vieja.** Al 2026-08-11 la
línea 146 es la que pasa `sinRepartir={balances.compartidoSinRepartir}`, y
**el texto vive en el subcomponente de más abajo** (alrededor de las
líneas 156-165, donde está `const esperada = sinRepartir !== 0`). Buscá
por el nombre de la prop, no por el número de línea.

⚠ **`mcp/servidor.mts:189` compara `> 0` mientras los otros cuatro
comparan `!== 0`.** Con un ingreso compartido sin repartir el neto da
negativo y ese aviso —solo ese— no aparecería. Es una inconsistencia
pre-existente, no la introduce este plan, pero se arregla gratis mientras
tenés el archivo abierto. Unificalo en `!== 0`.

- [ ] **Step 1.b: El otro texto de `balance.ts`, que el plan no había visto**

`lib/mcp/tools/balance.ts:157-166` es un bloque **distinto** del de arriba
y también quedó mintiendo. Usa `b.participacion`, que
`calcularBalancesProyecto` define como la participación **de hoy**,
mientras cada fila se repartió con el conjunto de **su** fecha.

Reproducible hoy con Proder: cerró el 20/07, así que `b.participacion` es
`undefined` y el conector contesta *"No participa del reparto de los
gastos compartidos"*. Es falso — sus movimientos de abril a julio sí
incluyen su porción de los compartidos de esa ventana, y de hecho están
sumados en el balance que el mismo mensaje muestra dos líneas más arriba.

La pregunta que ese texto quiere contestar no es "¿participa hoy?" sino
"¿algo de lo que estoy mostrando lleva parte de un gasto compartido?".
Resolvelo con un flag que se calcule durante el `for` de `imputados` en
`calcularBalancesProyecto`, y que la etiqueta de hoy quede solo para
cuando el proyecto está vivo.

- [ ] **Step 2: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: los dos pasan.

- [ ] **Step 3: Commitear**

```bash
git add src/ mcp/
git commit -m "El aviso de lo que quedo sin repartir dice cuales son"
```

---

## Task 9: Verificación final

**Files:**
- Verify: `verificar-final.mts` (temporal)

- [ ] **Step 1: Escribir la verificación completa**

Crear `verificar-final.mts` con el preámbulo, más:

```ts
import { calcularBalances, calcularBalancesProyecto } from "./src/lib/balances.ts";

const [{ data: movs }, { data: projs }, { data: cats }] = await Promise.all([
  admin.from("movements").select("*"),
  admin.from("projects").select("*"),
  admin.from("categories").select("*"),
]);

let fallos = 0;
const chequear = (que: string, ok: boolean, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${que} ${detalle}`);
};

for (const moneda of ["ARS", "USD"] as const) {
  const b = calcularBalances(movs!, projs!, cats!, moneda, { estado: "ambos" });
  const suma = b.porProyecto.reduce((s, p) => s + p.balance, 0);
  const diferencia = Math.abs(suma - b.proyectado.balance - b.compartidoSinRepartir);

  chequear(
    `invariante en ${moneda}`,
    diferencia < 0.05,
    `(diferencia ${diferencia.toFixed(4)})`,
  );

  // Cada proyecto contra su propia vista, que usa otro camino de cálculo.
  for (const p of projs!) {
    const solo = calcularBalancesProyecto(
      movs!, projs!, cats!, p.id, moneda, { estado: "ambos" },
    );
    const enGeneral = b.porProyecto.find((x) => x.projectId === p.id)!;
    chequear(
      `${p.nombre} coincide entre las dos vistas (${moneda})`,
      Math.abs(solo.proyectado.balance - enGeneral.balance) < 0.05,
      `${solo.proyectado.balance} vs ${enGeneral.balance}`,
    );
  }
}

const ars = calcularBalances(movs!, projs!, cats!, "ARS", { estado: "ambos" });
chequear("el general no se movió", Math.abs(ars.efectuado.balance - 302411) < 1, `${ars.efectuado.balance}`);
chequear("Gentius ya no es cero", ars.porProyecto.find((p) => p.nombre === "Gentius")!.balance !== 0);

console.log("\nBalances finales, ARS:");
ars.porProyecto.forEach((p) => console.log(`  ${p.nombre}: ${p.balance}`));

process.exitCode = fallos === 0 ? 0 : 1;
```

⚠ **`process.exitCode`, nunca `process.exit()`.** En Windows,
`process.exit()` justo después de que se cierra el socket de Supabase
crashea con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, un
bug de libuv. La salida ya se imprimió entera, así que parece un fallo del
cálculo y no lo es. Nos pasó en las Tareas 2, 3 y 4.

### El margen del chequeo de los dos caminos, medido

**Medido el 2026-08-11, antes de escribir esta verificación**, para que
nadie descubra el número cuando ya falló:

| Proyecto y moneda | Diferencia entre los dos caminos |
|---|---|
| Proder (USD) | **0.0400** ← la peor |
| El Prode de Beno (ARS) | 0.0200 |
| Gentius (USD) | 0.0100 |
| el resto | 0.0000 |

**Con `< 0.05` pasa, pero por un centavo.** La causa es real y
pre-existente: `calcularBalances` reparte con `repartirPorRestoMayor()`
—centavos enteros— y `calcularBalancesProyecto` hace
`round2(monto * fraccion)` por movimiento, que es justo el redondeo por
fracción que el docstring del módulo dice que rompe el invariante. Al
pasar de mitades a tercios el desvío creció (era 0.0100 y 0.0400 antes de
este plan).

No lo aflojes a `< 0.10` para que pase: eso esconde el problema. Si algún
día se pasa de 0.05, la salida correcta es unificar el algoritmo —que
`calcularBalancesProyecto` también use `repartirPorRestoMayor()`— y no
mover la vara.

- [ ] **Step 2: Correrlo**

Run: `npx tsx --conditions=react-server ./verificar-final.mts`
Expected: todos `ok`. El invariante cierra en ARS y en USD, cada proyecto
da lo mismo por los dos caminos de cálculo, el general sigue en `302411` y
Gentius dejó de ser `0`.

- [ ] **Step 3: La batería completa**

Bajá cualquier `next dev` que esté corriendo antes de buildear.

Run: `npm run typecheck && npm run lint && npm run build`
Expected: los tres pasan.

- [ ] **Step 4: Borrar el script y commitear**

```bash
rm verificar-final.mts
git add -A
git commit -m "Verificacion del invariante con reparto por fecha"
```

- [ ] **Step 5: Actualizar la documentación**

En `AGENTS.md`, la sección **2. El prorrateo se calcula al vuelo** dice
que se reparte entre los proyectos **activos**. Reescribirla: se reparte
entre los que estaban **vivos en la fecha del gasto**, `activo` ya no
existe, y la excepción de `compartidoSinRepartir` pasó de global a por
movimiento.

En el `README.md`, la sección **2. Los gastos compartidos se prorratean al
vuelo** dice lo mismo y necesita el mismo arreglo.

```bash
git add AGENTS.md README.md
git commit -m "La documentacion del prorrateo, al dia con el reparto por fecha"
```

---

## Self-review de este plan

**Cobertura del spec:**

| Requisito del spec | Tarea |
|---|---|
| `estaVivo()` en `prorrateo.ts` | 1 |
| `calcularParticipaciones(projects, fecha)` sin default | 1, 5 |
| Ventanas cargadas para los tres proyectos | 2 |
| Reparto por fecha, memoizado | 3 |
| `compartidoSinRepartir` por movimiento, con descripciones | 3, 8 |
| Los 8 call sites de `calcularParticipaciones` | 3, 4 |
| Los 12 lugares que leen `p.activo` | 6 |
| Columna `activo` borrada | 6 |
| Botón que edita la ventana | 6 (action), 7 (UI) |
| Invariante en ARS y USD | 9 |
| Criterio 1 del spec (solo cambia Claude Pro 07/07) | 3, 9 |
| Criterio 3 (gasto fuera de toda ventana, con descripción) | 8 |

**Lo que este plan NO hace, y está bien:** no toca `retros.balance_ars`
(congelado a propósito), no toca `tracks.activo` (otra tabla) y no
implementa el gasto compartido entre un subconjunto explícito de
proyectos, que el spec deja afuera con motivo.
