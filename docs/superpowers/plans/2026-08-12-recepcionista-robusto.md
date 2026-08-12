# Un recepcionista que se pueda tocar — plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usá
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutarlo tarea por tarea. Los pasos
> usan checkbox (`- [ ]`) para poder tildarlos.

**Objetivo:** Que tocar el prompt del recepcionista deje de ser un acto de
fe: un comando que mide, la regla mecánica en código donde no se pueda
ignorar, y un atajo para lo que no necesita modelo.

**Arquitectura:** Tres etapas en orden estricto, cada una mergeable sola.
**A** agrega un banco de frases y un corredor que las dispara N veces
contra Groq y tabula oscilación (no toca el prompt). **B** saca del prompt
las 24 líneas del bloque de confianza y las pone en una función pura que
solo puede *bajar* la confianza. **C** hace que las frases mecánicamente
decidibles no lleguen al modelo.

**Stack:** TypeScript, `tsx` (ya es dependencia), `node:test` +
`node:assert` (built-in, cero dependencias nuevas), Groq vía
`src/lib/llm.ts`.

**Spec:** `../specs/2026-08-12-recepcionista-robusto-design.md`

---

## Lo que ya se verificó corriendo, antes de escribir este plan

No hace falta volver a probarlo. Si algo de esto no se cumple en tu
máquina, **parate y avisá** — cambia el plan.

| Hecho | Cómo se verificó |
|---|---|
| `node --test` **no sirve**: no resuelve el alias `@/` que usa `prorrateo.ts` por dentro | `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'` |
| **`tsx --test` sí sirve**, sin warnings y sin dependencias nuevas | test importando `estaVivo` de `prorrateo.ts`: pasó |
| Importar `recepcionista.ts` (que es `server-only`) desde un script **exige `--conditions=react-server`** | sin la flag tira; con la flag: `importado OK, tipo: function` |
| `tsconfig.json` ya incluye `**/*.mts` y excluye solo `node_modules` | los tests entran solos a `npm run typecheck` |
| El prompt son **6887 caracteres / 2613 tokens** reservados; el bloque de confianza **1035 caracteres / 345 tokens** (15 %) | medido sobre el archivo real |
| Sacar el bloque deja el prompt en **2268** tokens, y **sigue entrando 2 llamadas por minuto** (5500 ÷ 2268 = 2) | medido; no esperes que acelere la medición |
| La función `esAmbigua()` de la etapa B da **44/44** sobre el corpus real | prototipo corrido; el código está en la Tarea B1 |
| `ambiguedad.ts` y `atajo.ts`, **tal como están escritos en este plan**, pasan `npm run typecheck` y `npm run lint` | se crearon, se chequearon y se borraron |
| Los 6 tests de `ambiguedad.test.mts` y los 5 de `atajo.test.mts` **pasan** con ese código | `tsx --test`: 6/6 y 5/5 |
| La regex `TELEGRAFICO` resuelve `-15000 hosting` (el caso que depende del backtracking del grupo de moneda) | incluido en los 5 de arriba |
| `DESTINOS` y `Destino` se exportan de `tipos.ts`, y `analizar` es **opcional** | por eso el atajo puede armar una `Decision` con tres campos |

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `scripts/env-local.ts` | **Nuevo.** Leer `.env.local` fuera de Next. Hoy está duplicado en dos scripts; este sería el tercero |
| `src/lib/agentes/banco.ts` | **Nuevo.** El corpus de frases y lo que se espera de cada una. **Datos, sin lógica** |
| `src/lib/agentes/veredicto.ts` | **Nuevo.** Comparar corridas contra lo esperado. **Puro**, sin red |
| `scripts/medir-recepcionista.ts` | **Nuevo.** El corredor: dispara, persiste, tabula |
| `src/lib/agentes/ambiguedad.ts` | **Nuevo (etapa B).** `esAmbigua()` y `acotarConfianza()`. **Puro** |
| `src/lib/agentes/atajo.ts` | **Nuevo (etapa C).** `atajar()`. **Puro** |
| `src/lib/agentes/recepcionista.ts` | **Modificar.** Engancha B y C; pierde 24 líneas de prompt |
| `tests/*.test.mts` | **Nuevos.** Todo lo puro, sin tocar Groq |
| `package.json` | **Modificar.** `test` y `medir:recepcionista` |
| `.gitignore` | **Modificar.** `.medidas/` |

---

# ETAPA A — El banco y el comando

## Tarea A1: El runner de tests

**Archivos:**
- Modificar: `package.json`
- Crear: `tests/humo.test.mts`

- [ ] **Paso 1: Escribir un test que falle**

`tests/humo.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { estaVivo } from "../src/lib/prorrateo.ts";

test("el runner ve los módulos de dominio", () => {
  const proyecto = {
    fecha_inicio: "2026-04-01",
    fecha_fin: "2026-07-20",
  } as Parameters<typeof estaVivo>[0];

  assert.equal(estaVivo(proyecto, "2026-04-01"), true, "punta de apertura");
  assert.equal(estaVivo(proyecto, "2026-07-20"), true, "punta de cierre");
  assert.equal(estaVivo(proyecto, "2026-07-21"), false, "un día después");
  assert.equal(estaVivo(proyecto, "2026-99-99"), false, "esto debería fallar");
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/humo.test.mts
```

Esperado: `fail 1`, con el mensaje `esto debería fallar`.

- [ ] **Paso 3: Sacar la aserción falsa**

Borrá la última línea (`"2026-99-99"`). Quedan las tres reales.

- [ ] **Paso 4: Agregar el script**

En `package.json`, dentro de `"scripts"`, después de `"typecheck"`:

```json
    "test": "tsx --test \"tests/**/*.test.mts\"",
```

- [ ] **Paso 5: Correr y verificar que pasa**

```bash
npm test
```

Esperado: `pass 1`, `fail 0`.

- [ ] **Paso 6: Verificar que no rompe nada**

```bash
npm run typecheck && npm run lint
```

Esperado: las dos sin salida de error.

- [ ] **Paso 7: Commit**

```bash
git add package.json tests/humo.test.mts
git commit -m "Los tests corren con tsx, sin agregar una sola dependencia"
```

---

## Tarea A2: Extraer `leerEnvLocal`

`scripts/backfill-embeddings.ts` y `scripts/importar-colmena.ts` tienen la
misma función copiada. El corredor sería la tercera copia.

**Archivos:**
- Crear: `scripts/env-local.ts`
- Crear: `tests/env-local.test.mts`
- Modificar: `scripts/backfill-embeddings.ts`, `scripts/importar-colmena.ts`

- [ ] **Paso 1: Escribir el test**

`tests/env-local.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leerEnvLocal } from "../scripts/env-local.ts";

function conArchivo(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pepe-env-"));
  writeFileSync(join(dir, ".env.local"), contenido, "utf8");
  return dir;
}

test("lee pares y saltea comentarios y vacías", () => {
  const dir = conArchivo("# un comentario\nA=1\n\nB=dos\n");
  assert.deepEqual(leerEnvLocal(dir), { A: "1", B: "dos" });
});

test("saca las comillas de los dos tipos", () => {
  const dir = conArchivo(`A="con dobles"\nB='con simples'\n`);
  assert.deepEqual(leerEnvLocal(dir), { A: "con dobles", B: "con simples" });
});

test("respeta los = que vienen dentro del valor", () => {
  const dir = conArchivo("TOKEN=abc=def==\n");
  assert.deepEqual(leerEnvLocal(dir), { TOKEN: "abc=def==" });
});

test("recorta el \\r de un archivo CRLF", () => {
  const dir = conArchivo("A=1\r\nB=2\r\n");
  assert.deepEqual(leerEnvLocal(dir), { A: "1", B: "2" });
});
```

> El último caso no es decorativo: `.env.local` de Beno **es CRLF**, y un
> parseo que no lo contemple deja un `\r` pegado al valor. Es la misma
> familia del incidente del BOM en `GROQ_API_KEY` que dejó todas las
> llamadas caídas 16 horas en silencio (AGENTS.md, "la lección más cara").

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/env-local.test.mts
```

Esperado: falla al resolver `../scripts/env-local.ts` (no existe).

- [ ] **Paso 3: Escribir el módulo**

`scripts/env-local.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Lee `.env.local` a mano.
 *
 * Los scripts corren fuera de Next, así que no hay nadie que cargue el
 * archivo por nosotros. Estaba copiado en `backfill-embeddings.ts` y en
 * `importar-colmena.ts`; vive acá para que haya un solo parser.
 *
 * ⚠ **Recorta el valor.** No es prolijidad: dos veces se rompió
 * producción por un byte invisible pegado a una variable —un `\n` en
 * `MCP_USUARIO_PERMITIDO` y un BOM en `GROQ_API_KEY`, que dejó todas las
 * llamadas a Groq caídas 16 horas sin un solo error visible, porque la
 * regla 7 hace que la app siga andando—. El archivo además es CRLF.
 */
export function leerEnvLocal(raiz: string): Record<string, string> {
  const contenido = readFileSync(resolve(raiz, ".env.local"), "utf8");
  const vars: Record<string, string> = {};

  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const separador = limpia.indexOf("=");
    if (separador === -1) continue;

    const clave = limpia.slice(0, separador).trim();
    let valor = limpia.slice(separador + 1).trim();

    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    vars[clave] = valor;
  }

  return vars;
}

/** Mete `.env.local` en `process.env` sin pisar lo que ya venía seteado. */
export function cargarEnvLocal(raiz: string): void {
  for (const [clave, valor] of Object.entries(leerEnvLocal(raiz))) {
    process.env[clave] ??= valor;
  }
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx tsx --test tests/env-local.test.mts
```

Esperado: `pass 4`, `fail 0`.

- [ ] **Paso 5: Reemplazar las dos copias**

En `scripts/backfill-embeddings.ts` y `scripts/importar-colmena.ts`:
borrá la función `leerEnvLocal` local y su bloque de comentario, y
agregá arriba:

```ts
import { leerEnvLocal } from "./env-local.ts";
```

Dejá el resto igual: los dos ya la llaman por ese nombre.

- [ ] **Paso 6: Verificar que siguen compilando**

```bash
npm run typecheck && npm run lint
```

Esperado: sin errores. **No corras los scripts**: uno baja 266 MB de
pesos y el otro pisaría el renombre de HRKit → Gentius (AGENTS.md).

- [ ] **Paso 7: Commit**

```bash
git add scripts/env-local.ts scripts/backfill-embeddings.ts scripts/importar-colmena.ts tests/env-local.test.mts
git commit -m "Un solo parser de .env.local, y con test del CRLF"
```

---

## Tarea A3: El banco de frases

**Archivos:**
- Crear: `src/lib/agentes/banco.ts`
- Crear: `tests/banco.test.mts`

- [ ] **Paso 1: Escribir el test**

`tests/banco.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { BANCO, casosDelPiso } from "../src/lib/agentes/banco.ts";
import { DESTINOS } from "../src/lib/agentes/tipos.ts";

test("no hay frases repetidas", () => {
  const vistas = new Set<string>();
  for (const caso of BANCO) {
    assert.ok(!vistas.has(caso.frase), `repetida: "${caso.frase}"`);
    vistas.add(caso.frase);
  }
});

test("todos los destinos esperados existen", () => {
  for (const caso of BANCO) {
    for (const destino of caso.espera.destinos) {
      assert.ok(
        (DESTINOS as readonly string[]).includes(destino),
        `destino inventado: "${destino}" en "${caso.frase}"`,
      );
    }
  }
});

test("las bandas de confianza son válidas", () => {
  for (const caso of BANCO) {
    const [min, max] = caso.espera.confianza;
    assert.ok(min <= max, `banda dada vuelta en "${caso.frase}"`);
    assert.ok(min >= 0 && max <= 1, `banda fuera de 0..1 en "${caso.frase}"`);
  }
});

test("si espera 'contiene', dice qué", () => {
  for (const caso of BANCO) {
    if (caso.espera.argumento === "contiene") {
      assert.ok(
        caso.espera.contiene && caso.espera.contiene.length > 0,
        `"${caso.frase}" espera 'contiene' pero no dice qué`,
      );
    }
  }
});

test("el piso son las 10 frases del bloque de regresión", () => {
  assert.equal(casosDelPiso().length, 10);
});

test("las cuatro anclas ambiguas están en el piso y esperan confianza baja", () => {
  const anclas = ["Claude Code", "Proder", "pricing", "Vercel Pro"];
  for (const frase of anclas) {
    const caso = BANCO.find((c) => c.frase === frase);
    assert.ok(caso, `falta el ancla "${frase}"`);
    assert.equal(caso.piso, true, `"${frase}" tiene que estar en el piso`);
    assert.ok(
      caso.espera.confianza[1] < 0.6,
      `"${frase}" tiene que esperar menos del umbral`,
    );
  }
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/banco.test.mts
```

Esperado: falla al resolver `banco.ts`.

- [ ] **Paso 3: Escribir el banco**

`src/lib/agentes/banco.ts`:

```ts
import type { Destino } from "@/lib/agentes/tipos";

/**
 * El corpus con el que se mide el recepcionista.
 *
 * ## Por qué existe
 *
 * Hasta el 2026-08-12 el piso de regresión era **prosa dentro del bloque
 * de comentarios de `recepcionista.ts`**: seis tandas de mediciones a
 * mano, escritas en castellano y sin nada que se pudiera correr. Nadie
 * podía verificar un cambio sin volver a armar el arnés desde cero, y por
 * eso —medido— el prompt se rompió cuatro veces.
 *
 * ⚠ **Esto son DATOS, no lógica.** La comparación vive en
 * `veredicto.ts` y el disparo en `scripts/medir-recepcionista.ts`. Si
 * alguna vez aparece un `if` acá, está en el archivo equivocado.
 *
 * ⚠ **Ninguna frase se inventa.** Todas salen de los comentarios de
 * `recepcionista.ts` o de AGENTS.md §9. `origen: "real"` marca las que
 * Beno tipeó de verdad: esas son las que no se negocian.
 *
 * ⚠ **`espera` es lo que está DOCUMENTADO, no lo que da hoy.** Si la
 * primera corrida contradice a un comentario, eso es un hallazgo y se
 * anota; no se ajusta el banco para que dé verde. Es justo la deriva
 * silenciosa que este banco viene a hacer visible.
 */
export interface CasoDelBanco {
  frase: string;
  /** De dónde salió. `"real"` = Beno la tipeó. */
  origen: "real" | "sintetica";
  /**
   * Si entra en el piso de regresión: las 10 que se corren siempre,
   * porque son las que históricamente se rompieron.
   */
  piso: boolean;
  /** Por qué está en el banco. Se imprime cuando falla. */
  porque: string;
  espera: {
    /** Aceptables. Varios cuando el comentario documenta oscilación. */
    destinos: Destino[];
    /** Cuántas acciones tiene que devolver la frase. */
    acciones: number;
    /** Banda inclusiva de confianza. */
    confianza: [number, number];
    /**
     * `"literal"`: idéntico a la frase.
     * `"contiene"`: tiene que traer los fragmentos de `contiene`.
     * `"null"`: el especialista no necesita argumento.
     * Sin definir: no se chequea.
     */
    argumento?: "literal" | "contiene" | "null";
    contiene?: string[];
  };
}

const ALTA: [number, number] = [0.6, 1];
const AMBIGUA: [number, number] = [0, 0.4];

export const BANCO: readonly CasoDelBanco[] = [
  // ── Las cuatro anclas ambiguas ──────────────────────────────
  // Se rompieron las cuatro veces. Un nombre suelto sin verbo no dice si
  // Beno quiere anotarlo, consultarlo, buscarlo o cerrarlo.
  {
    frase: "Claude Code",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Con los ejemplos fuera del prompt vuelve a confianza 1.",
    espera: { destinos: ["movimientos"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Proder",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Subió de 0.3 a 0.8 con un párrafo que ni la nombraba.",
    espera: { destinos: ["consultas"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "pricing",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Subió a 0.8 al usarse como ejemplo de tema.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Vercel Pro",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. La tabla de valores fijos la empeoró de 0.8 a 0.9.",
    espera: { destinos: ["suscripciones"], acciones: 1, confianza: AMBIGUA },
  },

  // ── Las seis simples: una sola acción cada una ──────────────
  {
    frase: "cómo viene Proder",
    origen: "real",
    piso: true,
    porque: "Simple. Consulta de plata con verbo y palabra de pregunta.",
    espera: { destinos: ["consultas"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué me toca hoy",
    origen: "real",
    piso: true,
    porque: "Simple. Tiene que ser roadmap y no estudio: LEE el plan.",
    espera: { destinos: ["roadmap"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué estoy pagando que no uso",
    origen: "real",
    piso: true,
    porque: "Simple. El gancho de suscripciones.",
    espera: { destinos: ["suscripciones"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "hacé la retro de Gentius",
    origen: "real",
    piso: true,
    porque: "Simple. No tiene que irse a proyecto: escribe un documento.",
    espera: {
      destinos: ["retro"],
      acciones: 1,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["Gentius"],
    },
  },
  {
    frase: "qué anotaciones tengo sobre gestión de presupuestos",
    origen: "real",
    piso: true,
    porque:
      "Simple y el choque escrito adentro del prompt: el tema es de plata " +
      "pero pregunta por lo que ESCRIBIÓ. Se fue a consultas con 0.8 una vez.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "quiero aprender sobre eso",
    origen: "real",
    piso: true,
    porque: "Simple. Separa tema_estudio de estudio por VERBO.",
    espera: { destinos: ["tema_estudio"], acciones: 1, confianza: ALTA },
  },

  // ── Las cinco telegráficas: el argumento vuelve literal ─────
  // Medidas el 2026-08-10: las cinco a movimientos con confianza 1 y el
  // argumento idéntico a la frase. Sin el número no hay gasto que cargar.
  {
    frase: "-20usd Claude Code 06/08",
    origen: "real",
    piso: false,
    porque: "Telegráfica. Volvió reescrita y SIN LA FECHA con un prompt largo.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "+50000ARS Venta Proder",
    origen: "real",
    piso: false,
    porque: "Telegráfica, ingreso.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "-20 usd claude code 06/08",
    origen: "real",
    piso: false,
    porque: "Telegráfica en minúsculas y con espacios.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "-15000 hosting",
    origen: "real",
    piso: false,
    porque: "Telegráfica sin moneda ni fecha.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "+200000 ARS venta",
    origen: "real",
    piso: false,
    porque: "Telegráfica sin proyecto.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },

  // ── Fronteras que costaron una medición cada una ────────────
  {
    frase: "cerrá Proder",
    origen: "real",
    piso: false,
    porque:
      "El bullet de retro decía textual 'Ej: cerrá Proder'. Al agregarse " +
      "el destino proyecto hubo que reescribirlo. Es la colisión que " +
      "estaba ESCRITA.",
    espera: { destinos: ["proyecto"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "agreguemos lecciones sobre pricing",
    origen: "real",
    piso: false,
    porque:
      "OSCILABA entre tema_estudio y lecciones_tema entre corridas. Es la " +
      "frase que prueba que el modelo no es determinístico con temp 0.",
    espera: { destinos: ["tema_estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "sacá lecciones de lo que aprendí con clientes",
    origen: "real",
    piso: false,
    porque: "El contraste con la de arriba: SACAR es mirar lo ya vivido.",
    espera: { destinos: ["lecciones_tema"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué lecciones hicimos de scrum",
    origen: "real",
    piso: false,
    porque:
      "Cuarto error silencioso del 2026-08-10: se iba a lecciones_tema " +
      "con 0.8, o sea generaba lecciones nuevas en vez de traer las escritas.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué lecciones sugerís hoy",
    origen: "real",
    piso: false,
    porque: "Se iba a lecciones_tema con 0.8. Una sugerencia sin tema es estudio.",
    espera: { destinos: ["estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "según toda la actividad que vengo haciendo, qué sugerís hoy",
    origen: "real",
    piso: false,
    porque: "Se iba a buscador con 0.8.",
    espera: { destinos: ["estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "tengo algún gasto recurrente próximo a vencer",
    origen: "real",
    piso: false,
    porque: "El gancho de vencimientos, que comparte tema con suscripciones.",
    espera: { destinos: ["vencimientos"], acciones: 1, confianza: ALTA },
  },
  {
    frase:
      "me armás un presupuesto para un cliente que quiere una landing con " +
      "formulario de contacto",
    origen: "real",
    piso: false,
    porque: "ARMAR uno es el verbo opuesto a buscar lo que anotó sobre ellos.",
    espera: { destinos: ["presupuesto"], acciones: 1, confianza: ALTA },
  },

  // ── Material que el modelo no puede abrir ───────────────────
  {
    frase: "mirá, te paso capturas para que veas esto que me contestó un cliente",
    origen: "real",
    piso: false,
    porque:
      "Devolvía TRES acciones con confianza 1 y los argumentos eran los " +
      "ejemplos del propio prompt copiados. Sin nada real que enganchar, " +
      "el modelo repite lo que tiene a mano.",
    espera: { destinos: ["desconocido"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Me haces un presupuesto para x proyecto? aca esta el spec",
    origen: "real",
    piso: false,
    porque:
      "Le GANA a la regla de 'material que no podés abrir', y está bien: " +
      "no lee el spec, lleva a la pantalla de alta con el texto pegado.",
    espera: { destinos: ["presupuesto"], acciones: 1, confianza: ALTA },
  },

  // ── Multi-acción: el riesgo es que parta las simples ────────
  {
    frase:
      "Anota las fechas de apertura y cierre de Proder y El Prode de Beno " +
      "01/04/26 apertura y 31/07/26 para las dos",
    origen: "real",
    piso: false,
    porque:
      "Fallo 1 del 2026-08-10. Daba TRES acciones equivocadas: dos de " +
      "bitácora con argumentos 'Proder' y 'El Prode', más una retro que " +
      "nadie pidió. Las fechas desaparecían enteras.",
    espera: {
      destinos: ["proyecto"],
      acciones: 2,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["01/04", "31/07"],
    },
  },
  {
    frase:
      "hoy el cliente x me dijo y cosa sobre Gentius, quiero que lo anotes " +
      "en la bitácora y que me generes lecciones sobre eso",
    origen: "real",
    piso: false,
    porque:
      "El argumento de bitácora volvía recortado a 'cosa sobre Gentius': " +
      "la entrada de Beno con tres cuartas partes borradas, en silencio.",
    espera: {
      destinos: ["bitacora", "lecciones_tema"],
      acciones: 2,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["el cliente x me dijo"],
    },
  },
  {
    frase: "anotá que hoy peleé con el deploy toda la tarde",
    origen: "sintetica",
    piso: false,
    porque: "Bitácora simple: NO se parte en dos.",
    espera: {
      destinos: ["bitacora"],
      acciones: 1,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["peleé con el deploy toda la tarde"],
    },
  },
];

/** Las 10 que se corren siempre. ~15 minutos a 2 llamadas por minuto. */
export function casosDelPiso(): readonly CasoDelBanco[] {
  return BANCO.filter((c) => c.piso);
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx tsx --test tests/banco.test.mts
```

Esperado: `pass 6`, `fail 0`. Si `casosDelPiso().length` no da 10,
**no toques el test**: contá los `piso: true` y arreglá el banco.

- [ ] **Paso 5: Verificar tipos**

```bash
npm run typecheck && npm run lint
```

- [ ] **Paso 6: Commit**

```bash
git add src/lib/agentes/banco.ts tests/banco.test.mts
git commit -m "El piso de regresion deja de ser prosa y pasa a ser datos"
```

---

## Tarea A4: El veredicto (comparación pura)

**Archivos:**
- Crear: `src/lib/agentes/veredicto.ts`
- Crear: `tests/veredicto.test.mts`

- [ ] **Paso 1: Escribir el test**

`tests/veredicto.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { juzgar, type Corrida } from "../src/lib/agentes/veredicto.ts";
import type { CasoDelBanco } from "../src/lib/agentes/banco.ts";

const caso: CasoDelBanco = {
  frase: "cómo viene Proder",
  origen: "real",
  piso: true,
  porque: "de prueba",
  espera: { destinos: ["consultas"], acciones: 1, confianza: [0.6, 1] },
};

const buena: Corrida = {
  acciones: [{ destino: "consultas", argumento: "Proder", confianza: 0.9 }],
};

test("tres corridas iguales y correctas: pasa y no osciló", () => {
  const v = juzgar(caso, [buena, buena, buena]);
  assert.equal(v.ok, true);
  assert.equal(v.oscilo, false);
  assert.deepEqual(v.problemas, []);
});

test("dos de tres correctas NO pasa, aunque la moda sea correcta", () => {
  const otra: Corrida = {
    acciones: [{ destino: "buscador", argumento: "Proder", confianza: 0.9 }],
  };
  const v = juzgar(caso, [buena, buena, otra]);
  assert.equal(v.oscilo, true, "tiene que marcar oscilación");
  assert.equal(v.ok, false, "oscilar es fallar");
});

test("una confianza fuera de banda falla aunque el destino esté bien", () => {
  const floja: Corrida = {
    acciones: [{ destino: "consultas", argumento: "Proder", confianza: 0.3 }],
  };
  const v = juzgar(caso, [buena, buena, floja]);
  assert.equal(v.ok, false);
  assert.ok(v.problemas.some((p) => p.includes("confianza")));
});

test("la cantidad de acciones equivocada falla", () => {
  const dos: Corrida = {
    acciones: [
      { destino: "consultas", argumento: "a", confianza: 0.9 },
      { destino: "buscador", argumento: "b", confianza: 0.9 },
    ],
  };
  const v = juzgar(caso, [dos, dos, dos]);
  assert.equal(v.ok, false);
  assert.ok(v.problemas.some((p) => p.includes("acciones")));
});

test("argumento literal: exige la frase entera", () => {
  const literal: CasoDelBanco = {
    ...caso,
    frase: "-20usd Claude Code 06/08",
    espera: { ...caso.espera, destinos: ["movimientos"], argumento: "literal" },
  };
  const exacta: Corrida = {
    acciones: [
      {
        destino: "movimientos",
        argumento: "-20usd Claude Code 06/08",
        confianza: 1,
      },
    ],
  };
  const recortada: Corrida = {
    acciones: [
      { destino: "movimientos", argumento: "Claude Code", confianza: 1 },
    ],
  };
  assert.equal(juzgar(literal, [exacta, exacta, exacta]).ok, true);
  assert.equal(juzgar(literal, [recortada, recortada, recortada]).ok, false);
});

test("argumento contiene: falla si falta un fragmento", () => {
  const conFechas: CasoDelBanco = {
    ...caso,
    frase: "poné las fechas",
    espera: {
      ...caso.espera,
      destinos: ["proyecto"],
      argumento: "contiene",
      contiene: ["01/04", "31/07"],
    },
  };
  const completa: Corrida = {
    acciones: [
      { destino: "proyecto", argumento: "Proder 01/04 - 31/07", confianza: 1 },
    ],
  };
  const sinUna: Corrida = {
    acciones: [{ destino: "proyecto", argumento: "Proder 01/04", confianza: 1 }],
  };
  assert.equal(juzgar(conFechas, [completa, completa, completa]).ok, true);
  const v = juzgar(conFechas, [sinUna, sinUna, sinUna]);
  assert.equal(v.ok, false);
  assert.ok(v.problemas.some((p) => p.includes("31/07")));
});

test("un error del modelo cuenta como corrida fallada, no revienta", () => {
  const rota: Corrida = { error: "esquema: raíz: confianza requerida" };
  const v = juzgar(caso, [buena, buena, rota]);
  assert.equal(v.ok, false);
  assert.ok(v.problemas.some((p) => p.includes("esquema")));
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/veredicto.test.mts
```

Esperado: falla al resolver `veredicto.ts`.

- [ ] **Paso 3: Escribir el módulo**

`src/lib/agentes/veredicto.ts`:

```ts
import type { CasoDelBanco } from "@/lib/agentes/banco";
import type { Destino } from "@/lib/agentes/tipos";

/**
 * Compara N corridas de una frase contra lo que el banco espera.
 *
 * ## Por qué es puro y vive separado del corredor
 *
 * Para poder probar el criterio **sin gastar un solo token**. El corredor
 * (`scripts/medir-recepcionista.ts`) hace red y persistencia; esto decide
 * si algo pasó o falló, que es la parte con reglas.
 *
 * ## Por qué oscilar es fallar
 *
 * Es el agujero de las seis mediciones anteriores. El comentario de
 * `recepcionista.ts` dice que `"agreguemos lecciones"` *"oscilaba entre
 * los dos destinos entre corridas"*: **el modelo no es determinístico ni
 * con `temperatura: 0`**. Con una corrida por frase, una respuesta
 * correcta 2 de 3 veces se lee idéntica a una correcta siempre — y son
 * cosas distintas. Acá una frase que no da lo mismo las tres veces
 * **no pasa**, aunque la moda sea la correcta.
 */
export interface AccionCruda {
  destino: Destino;
  argumento: string | null;
  confianza: number;
}

/** Una corrida: o devolvió acciones, o falló. */
export type Corrida =
  | { acciones: AccionCruda[]; error?: undefined }
  | { acciones?: undefined; error: string };

export interface Veredicto {
  frase: string;
  ok: boolean;
  /** No devolvió lo mismo todas las veces. Por sí solo ya es fallar. */
  oscilo: boolean;
  /** Los destinos de la primera acción de cada corrida, en orden. */
  destinos: (Destino | "ERROR")[];
  confianzas: number[];
  problemas: string[];
}

function firma(corrida: Corrida): string {
  if (corrida.error) return `ERROR:${corrida.error}`;
  return corrida.acciones.map((a) => a.destino).join(",");
}

export function juzgar(
  caso: CasoDelBanco,
  corridas: Corrida[],
): Veredicto {
  const problemas: string[] = [];
  const { espera } = caso;

  const firmas = new Set(corridas.map(firma));
  const oscilo = firmas.size > 1;
  if (oscilo) {
    problemas.push(
      `osciló entre corridas: ${[...firmas].join(" | ")}`,
    );
  }

  const destinos: (Destino | "ERROR")[] = [];
  const confianzas: number[] = [];

  for (const [i, corrida] of corridas.entries()) {
    if (corrida.error) {
      destinos.push("ERROR");
      problemas.push(`corrida ${i + 1}: ${corrida.error}`);
      continue;
    }

    const { acciones } = corrida;
    destinos.push(acciones[0]?.destino ?? "ERROR");

    if (acciones.length !== espera.acciones) {
      problemas.push(
        `corrida ${i + 1}: ${acciones.length} acciones, se esperaban ${espera.acciones}`,
      );
    }

    for (const accion of acciones) {
      if (!espera.destinos.includes(accion.destino)) {
        problemas.push(
          `corrida ${i + 1}: destino "${accion.destino}", se esperaba ${espera.destinos.join(" o ")}`,
        );
      }

      confianzas.push(accion.confianza);
      const [min, max] = espera.confianza;
      if (accion.confianza < min || accion.confianza > max) {
        problemas.push(
          `corrida ${i + 1}: confianza ${accion.confianza} fuera de [${min}, ${max}]`,
        );
      }
    }

    problemas.push(...revisarArgumento(caso, acciones, i + 1));
  }

  return {
    frase: caso.frase,
    ok: problemas.length === 0,
    oscilo,
    destinos,
    confianzas,
    problemas,
  };
}

/**
 * El argumento importa distinto según el destino, y hay dos casos donde
 * un recorte silencioso es el peor daño posible: en `bitacora` sale el
 * texto que se guarda **literal**, y en `movimientos` sin el número no
 * hay gasto que cargar. Por eso se chequea por fragmentos y no "se
 * parece".
 */
function revisarArgumento(
  caso: CasoDelBanco,
  acciones: AccionCruda[],
  numero: number,
): string[] {
  const { espera } = caso;
  if (!espera.argumento) return [];

  const problemas: string[] = [];
  const normal = (s: string) => s.trim().toLowerCase();

  if (espera.argumento === "null") {
    for (const a of acciones) {
      if (a.argumento !== null) {
        problemas.push(
          `corrida ${numero}: se esperaba argumento null y vino "${a.argumento}"`,
        );
      }
    }
    return problemas;
  }

  if (espera.argumento === "literal") {
    const alguna = acciones.some(
      (a) => a.argumento !== null && normal(a.argumento) === normal(caso.frase),
    );
    if (!alguna) {
      problemas.push(
        `corrida ${numero}: el argumento no volvió literal (vino "${acciones[0]?.argumento}")`,
      );
    }
    return problemas;
  }

  // "contiene"
  const juntos = normal(acciones.map((a) => a.argumento ?? "").join(" "));
  for (const fragmento of espera.contiene ?? []) {
    if (!juntos.includes(normal(fragmento))) {
      problemas.push(
        `corrida ${numero}: al argumento le falta "${fragmento}"`,
      );
    }
  }
  return problemas;
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx tsx --test tests/veredicto.test.mts
```

Esperado: `pass 7`, `fail 0`.

- [ ] **Paso 5: Verificar tipos y commit**

```bash
npm run typecheck && npm run lint
git add src/lib/agentes/veredicto.ts tests/veredicto.test.mts
git commit -m "Oscilar entre corridas cuenta como fallar, y eso se puede probar sin Groq"
```

---

## Tarea A5: El corredor

**Archivos:**
- Crear: `scripts/medir-recepcionista.ts`
- Modificar: `package.json`, `.gitignore`

- [ ] **Paso 1: Ignorar el estado de las corridas**

En `.gitignore`, al lado de `.modelos/`:

```
# Estado de `npm run medir:recepcionista`. La línea base SÍ se commitea
# (docs/dev/recepcionista-linea-base.json); esto es el scratch de una
# corrida a medio hacer.
.medidas/
```

- [ ] **Paso 2: Escribir el corredor**

`scripts/medir-recepcionista.ts`:

```ts
/**
 * Mide el recepcionista contra el banco de frases.
 *
 *   npm run medir:recepcionista            # el piso: 10 frases, ~15 min
 *   npm run medir:recepcionista -- --todo  # completo: ~47 min
 *   npm run medir:recepcionista -- --base  # además, reescribe la línea base
 *
 * ## Por qué tarda tanto, y por qué no se puede apurar
 *
 * Medido el 2026-08-12: el prompt reserva ~2613 tokens por llamada contra
 * un techo de 5500 por minuto del modelo chico, o sea **2 llamadas por
 * minuto**. Tres corridas de las 10 frases del piso son 30 llamadas: unos
 * 15 minutos. No es un bug del script, es el tier gratuito de Groq.
 *
 * Por eso es **retomable**: el estado se persiste frase por frase en
 * `.medidas/`, así que una corrida cortada a los 30 minutos no vuelve a
 * pagar lo que ya midió.
 *
 * Se corre con `--conditions=react-server` porque `recepcionista.ts` es
 * `server-only`. Verificado: sin esa flag el import tira.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { cargarEnvLocal } from "./env-local.ts";

const RAIZ = resolve(import.meta.dirname, "..");
cargarEnvLocal(RAIZ);

const { BANCO, casosDelPiso } = await import("../src/lib/agentes/banco.ts");
const { juzgar } = await import("../src/lib/agentes/veredicto.ts");
const { decidirDestinos } = await import(
  "../src/lib/agentes/recepcionista.ts"
);
type Corrida = import("../src/lib/agentes/veredicto.ts").Corrida;

const CORRIDAS = 3;
const DIR_ESTADO = resolve(RAIZ, ".medidas");
const LINEA_BASE = resolve(RAIZ, "docs/dev/recepcionista-linea-base.json");

const todo = process.argv.includes("--todo");
const guardarBase = process.argv.includes("--base");
const casos = todo ? BANCO : casosDelPiso();

mkdirSync(DIR_ESTADO, { recursive: true });
const archivoEstado = resolve(
  DIR_ESTADO,
  todo ? "corrida-completa.json" : "corrida-piso.json",
);

type Estado = Record<string, Corrida[]>;
const estado: Estado = existsSync(archivoEstado)
  ? (JSON.parse(readFileSync(archivoEstado, "utf8")) as Estado)
  : {};

const yaHechas = casos.filter(
  (c) => (estado[c.frase]?.length ?? 0) >= CORRIDAS,
).length;

console.log(
  `Midiendo ${casos.length} frases x ${CORRIDAS} corridas ` +
    `= ${casos.length * CORRIDAS} llamadas.`,
);
if (yaHechas > 0) console.log(`Retomando: ${yaHechas} frases ya medidas.`);
console.log(
  `A 2 llamadas/minuto son ~${Math.ceil(
    ((casos.length - yaHechas) * CORRIDAS) / 2,
  )} minutos.\n`,
);

for (const [i, caso] of casos.entries()) {
  const hechas = estado[caso.frase] ?? [];
  if (hechas.length >= CORRIDAS) continue;

  for (let n = hechas.length; n < CORRIDAS; n++) {
    process.stdout.write(
      `[${i + 1}/${casos.length}] corrida ${n + 1}/${CORRIDAS}  "${caso.frase.slice(0, 45)}"… `,
    );
    try {
      const acciones = await decidirDestinos(caso.frase);
      hechas.push({ acciones });
      process.stdout.write(`${acciones.map((a) => a.destino).join(",")}\n`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      hechas.push({ error: mensaje });
      process.stdout.write(`ERROR: ${mensaje.slice(0, 60)}\n`);
    }
    // Se persiste llamada a llamada, o "retomable" sería mentira.
    estado[caso.frase] = hechas;
    writeFileSync(archivoEstado, JSON.stringify(estado, null, 2), "utf8");
  }
}

// ── La tabla ────────────────────────────────────────────────
const veredictos = casos.map((c) => juzgar(c, estado[c.frase] ?? []));
const fallados = veredictos.filter((v) => !v.ok);

console.log("\n" + "═".repeat(78));
console.log(
  "frase".padEnd(46) + "destinos".padEnd(16) + "conf.".padEnd(10) + "ok",
);
console.log("─".repeat(78));

for (const v of veredictos) {
  const conf = v.confianzas.length
    ? `${Math.min(...v.confianzas)}-${Math.max(...v.confianzas)}`
    : "—";
  const marca = v.ok ? "✓" : v.oscilo ? "≈ OSCILA" : "✗";
  console.log(
    `"${v.frase.slice(0, 42)}"`.padEnd(46) +
      [...new Set(v.destinos)].join("/").slice(0, 14).padEnd(16) +
      conf.padEnd(10) +
      marca,
  );
}

console.log("─".repeat(78));
console.log(`${veredictos.length - fallados.length}/${veredictos.length} en verde`);

if (fallados.length > 0) {
  console.log("\nLo que falló:\n");
  for (const v of fallados) {
    const caso = casos.find((c) => c.frase === v.frase);
    console.log(`  "${v.frase}"`);
    console.log(`    está en el banco porque: ${caso?.porque}`);
    for (const p of v.problemas) console.log(`    - ${p}`);
    console.log();
  }
}

if (guardarBase) {
  writeFileSync(
    LINEA_BASE,
    JSON.stringify({ fecha: new Date().toISOString(), veredictos }, null, 2),
    "utf8",
  );
  console.log(`Línea base escrita en ${LINEA_BASE}`);
}

process.exit(fallados.length > 0 ? 1 : 0);
```

- [ ] **Paso 3: Agregar el script**

En `package.json`, debajo de `"backfill:embeddings"`:

```json
    "medir:recepcionista": "tsx --conditions=react-server scripts/medir-recepcionista.ts",
```

- [ ] **Paso 4: Verificar que compila antes de gastar 15 minutos**

```bash
npm run typecheck && npm run lint
```

Esperado: sin errores. **No sigas si algo falla acá**: el paso que viene
tarda un cuarto de hora.

- [ ] **Paso 5: Correr el piso de verdad**

```bash
npm run medir:recepcionista
```

Esperado: unos 15 minutos, con progreso frase por frase, y al final la
tabla. **El resultado no está predeterminado**: el spec avisa que si una
frase documentada ya no da lo que decía el comentario, **eso es un
hallazgo**.

- [ ] **Paso 6: Anotar los hallazgos, no taparlos**

Si algo salió distinto de lo que espera el banco:

1. **No cambies `espera` para que dé verde.**
2. Anotá en el mensaje de commit qué frase, qué esperaba y qué dio.
3. Si osciló, corré esa frase de nuevo para ver si es estable en su
   inestabilidad.

- [ ] **Paso 7: Verificar que retoma**

```bash
npm run medir:recepcionista
```

Esperado: **termina en segundos** y da la misma tabla, porque encuentra
las tres corridas de cada frase en `.medidas/corrida-piso.json`.

- [ ] **Paso 8: Guardar la línea base**

```bash
rm -rf .medidas
npm run medir:recepcionista -- --base
```

- [ ] **Paso 9: Commit**

```bash
git add scripts/medir-recepcionista.ts package.json .gitignore docs/dev/recepcionista-linea-base.json
git commit -m "Medir el recepcionista pasa a ser un comando y no un ritual de 20 minutos"
```

---

## Tarea A6: Dejarlo escrito donde se busca

**Archivos:**
- Modificar: `AGENTS.md`, `docs/dev/manual-agentico.md`

- [ ] **Paso 1: AGENTS.md**

En §9, dentro del bloque "El prompt del recepcionista es de vidrio",
reemplazá la frase *"antes de tocar ese prompt, medí; después de tocarlo,
volvé a medir"* por:

```markdown
**Por eso: antes de tocar ese prompt, medí; después de tocarlo, volvé a
medir.** Y ahora eso es un comando y no un ritual:

```bash
npm run medir:recepcionista            # el piso: 10 frases, ~15 min
npm run medir:recepcionista -- --todo  # completo: ~47 min
```

El piso de regresión vive en `src/lib/agentes/banco.ts` y la línea base
commiteada en `docs/dev/recepcionista-linea-base.json`, así que el diff de
un PR muestra **qué confianzas se movieron**.

⚠ **Oscilar cuenta como fallar.** Cada frase se dispara tres veces: el
modelo **no es determinístico ni con `temperatura: 0`** —está medido con
`"agreguemos lecciones"`—, así que una corrida por frase no distingue "lo
arreglé" de "salió bien esta vez". Las seis mediciones históricas de este
prompt tienen ese sesgo.

⚠ **Medir cuesta 2 llamadas por minuto** y no se puede apurar: el prompt
reserva ~2613 tokens contra un techo de 5500 por minuto. Por eso el
corredor es retomable.
```

- [ ] **Paso 2: manual-agentico.md**

Agregá una fila a la tabla del área de agentes:

```markdown
| Medir el recepcionista | `npm run medir:recepcionista` · `src/lib/agentes/banco.ts` (datos) · `veredicto.ts` (puro) · `scripts/medir-recepcionista.ts` (red) | nada: solo lee | Tarda ~15 min el piso y ~47 el completo, a 2 llamadas/min. Es retomable: `.medidas/` guarda el progreso. Oscilar entre corridas cuenta como fallar |
```

- [ ] **Paso 3: Commit**

```bash
git add AGENTS.md docs/dev/manual-agentico.md
git commit -m "La documentacion dice como se mide el recepcionista ahora"
```

> **Fin de la etapa A.** Es mergeable sola: no tocó el prompt ni el
> comportamiento de la app. Verificá `npm run typecheck && npm run lint &&
> npm run build` antes de seguir.

---

# ETAPA B — La regla mecánica sale del prompt

## Tarea B1: `esAmbigua()` — la función pura

**Archivos:**
- Crear: `src/lib/agentes/ambiguedad.ts`
- Crear: `tests/ambiguedad.test.mts`

- [ ] **Paso 1: Escribir el test con los 44 casos**

`tests/ambiguedad.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { esAmbigua, acotarConfianza, TECHO_AMBIGUA } from "../src/lib/agentes/ambiguedad.ts";

/** [frase, esperaAmbigua] — el corpus con el que se construyó la función. */
const CASOS: [string, boolean][] = [
  // Las cuatro anclas del piso de regresión
  ["Claude Code", true],
  ["Proder", true],
  ["pricing", true],
  ["Vercel Pro", true],
  // Otros sustantivos sueltos
  ["el hosting", true],
  ["Gentius", true],
  ["presupuestos", true],
  ["backlog", true],
  ["hosting", true],
  ["Google Ads", true],
  // Sustantivos que terminan parecido a un verbo y NO lo son
  ["orden", true],
  ["imagen", true],
  ["margen", true],
  // Telegráficas: tienen dígitos
  ["-20usd Claude Code 06/08", false],
  ["+50000ARS Venta Proder", false],
  ["-20 usd claude code 06/08", false],
  ["-15000 hosting", false],
  ["+200000 ARS venta", false],
  // Con palabra de pregunta
  ["qué me toca hoy", false],
  ["cómo viene Proder", false],
  ["qué anotaciones tengo sobre gestión de presupuestos", false],
  ["qué estoy pagando que no uso", false],
  ["qué lecciones sugerís hoy", false],
  ["cuánto gasté en herramientas este año", false],
  ["cuál es mi balance", false],
  // Con verbo conjugado y sin palabra de pregunta: los difíciles
  ["cerrá Proder", false],
  ["activalo", false],
  ["reabrí Gentius", false],
  ["hacé la retro de Gentius", false],
  ["revisá mis suscripciones", false],
  ["sacá lecciones de lo que aprendí con clientes", false],
  ["anotá que hoy peleé con el deploy toda la tarde", false],
  ["creá el proyecto Voltio", false],
  ["cotizá este trabajo", false],
  ["quiero aprender sobre eso", false],
  ["sugerime qué estudiar", false],
  ["poné que arrancó el 01/04", false],
  // Conjugaciones que NO caen en vocal acentuada final
  ["agreguemos lecciones sobre pricing", false],
  ["tenía algo sobre backlogs", false],
  ["sugerís algo", false],
  ["tenés algo de contratos", false],
  ["estábamos viendo pricing", false],
  ["sumemos un track", false],
  ["estoy pagando Vercel Pro", false],
];

test("los 44 casos del corpus", () => {
  const fallos: string[] = [];
  for (const [frase, esperado] of CASOS) {
    const dio = esAmbigua(frase);
    if (dio !== esperado) {
      fallos.push(`"${frase}": esperaba ${esperado}, dio ${dio}`);
    }
  }
  assert.deepEqual(fallos, [], `${fallos.length} de ${CASOS.length} mal`);
});

test("el corpus tiene los 44 casos con los que se construyó", () => {
  assert.equal(CASOS.length, 44);
});

test("una frase vacía es ambigua", () => {
  assert.equal(esAmbigua(""), true);
  assert.equal(esAmbigua("   "), true);
});

test("acotarConfianza BAJA una confianza alta", () => {
  const a = { destino: "movimientos" as const, argumento: null, confianza: 0.95 };
  assert.equal(acotarConfianza(a).confianza, TECHO_AMBIGUA);
});

test("acotarConfianza NUNCA sube una confianza baja", () => {
  const a = { destino: "movimientos" as const, argumento: null, confianza: 0.1 };
  assert.equal(acotarConfianza(a).confianza, 0.1);
});

test("acotarConfianza no toca el destino ni el argumento", () => {
  const a = {
    destino: "consultas" as const,
    argumento: "Proder",
    confianza: 1,
  };
  const b = acotarConfianza(a);
  assert.equal(b.destino, "consultas");
  assert.equal(b.argumento, "Proder");
});

test("el techo está por debajo del umbral que dispara la pregunta", () => {
  assert.ok(TECHO_AMBIGUA < 0.6);
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/ambiguedad.test.mts
```

Esperado: falla al resolver `ambiguedad.ts`.

- [ ] **Paso 3: Escribir el módulo**

`src/lib/agentes/ambiguedad.ts`:

```ts
import { UMBRAL_CONFIANZA, type Decision } from "@/lib/agentes/tipos";

/**
 * ¿La frase es un sustantivo o un nombre suelto, sin verbo ni pregunta?
 *
 * ## Por qué está en código y no en el prompt
 *
 * Estas 24 líneas **vivían en el prompt del recepcionista**, y eran las
 * que más se rompieron: cuatro incidentes medidos, dos de ellos por
 * cambios que **ni siquiera nombraban** lo que rompieron. El propio
 * prompt las presentaba como *"una comprobación mecánica sobre la frase,
 * sin pensar en el tema"* — o sea, un test sobre un string viviendo en un
 * prompt.
 *
 * Es la misma regla que ya aplicaron `textoDelMovimiento()`,
 * `pareceAnotacion()` y `normalizarClavesDecision()`: si se puede
 * resolver con un test sobre un string, se hace ahí.
 *
 * ## Por qué en código funciona algo que en el prompt no funcionaba
 *
 * No es una intuición, está medido y escrito en `recepcionista.ts`:
 * pedirle al modelo esta comprobación como regla abstracta **dejó
 * `"Claude Code"` en confianza 1**. Lo único que la bajaba eran cuatro
 * ejemplos concretos, y el comentario avisaba: *"si sacás los ejemplos,
 * 'Claude Code' vuelve a 1"*. O sea que el modelo no aplicaba la regla:
 * la imitaba. Acá se aplica siempre, y por eso los ejemplos también
 * pudieron salir del prompt.
 *
 * ## La asimetría que la hace segura
 *
 * Un **falso positivo** (dice ambigua y no lo era) cuesta una pregunta de
 * más. Un **falso negativo** (no la detecta) no acota nada y deja el
 * comportamiento exactamente como estaba antes de que este archivo
 * existiera: no hay regresión posible, solo mejora que no llegó.
 *
 * Por eso, ante la duda, esta función **no** declara ambigüedad.
 */

/** `qué`, `cuánto`, `cómo`… con o sin tilde. */
const PALABRAS_PREGUNTA =
  /\b(qu[eé]|cu[aá]nto?s?|cu[aá]ntas?|c[oó]mo|cu[aá]l(es)?|d[oó]nde|cu[aá]ndo|qui[eé]n(es)?|por\s?qu[eé])\b/i;

/**
 * En rioplatense el imperativo y el pretérito caen en vocal acentuada
 * final: `cerrá`, `anotá`, `sacá`, `poné`, `hacé`, `reabrí`, `pagué`,
 * `cobré`, `salió`. Sola, esta señal resuelve casi todo.
 */
const VOCAL_ACENTUADA_FINAL = /[áéíóú]$/;

/** Voseo de segunda persona: `sugerís`, `tenés`, `querés`, `hacés`. */
const VOSEO = /[áéíóú]s$/;

/**
 * Conjugaciones que NO caen en vocal acentuada final: imperfecto
 * (`tenía`, `estábamos`), primera del plural (`agreguemos`, `sumemos`) y
 * gerundio (`pagando`, `viendo`).
 *
 * ⚠ **No incluye `-an` ni `-en`, a propósito.** Matchean demasiados
 * sustantivos —`orden`, `imagen`, `margen`, `joven`— y cada uno sería una
 * frase ambigua que deja de detectarse.
 */
const TERMINACIONES_VERBALES =
  /(aba|abas|ábamos|aban|ía|ías|íamos|ían|amos|emos|imos|ando|iendo)$/;

/**
 * Los conjugados que no caen en ningún patrón. Lista **cerrada y corta**
 * a propósito.
 *
 * ⚠ **No hay regla general de enclíticos.** El prototipo tenía una
 * (`^[a-zñ]{3,}(lo|la|le|…)$`, para `activalo`) y **rompió
 * `"Google Ads"`**: `"google"` termina en `le`. Fue el único fallo de la
 * corrida final y se resolvió borrándola, no ajustándola. Los enclíticos
 * que Beno usa de verdad están acá abajo.
 */
const VERBOS_SIN_PATRON = new Set([
  "estoy", "esta", "está", "viene", "toca", "tengo", "hay", "sigue", "voy",
  "quiero", "necesito", "pague", "cobre", "gaste", "salio", "vino", "fue",
  "es", "son", "dame", "mostrame", "decime", "busca", "busco", "anda",
  "puedo", "debo", "falta", "queda",
  "activalo", "activala", "cerralo", "cerrala", "abrilo", "borralo", "hacelo",
]);

function tieneVerboConjugado(frase: string): boolean {
  return frase
    .trim()
    .split(/\s+/)
    .some((palabra) => {
      const limpia = palabra.replace(/[.,;:!?¿¡"'()]/g, "").toLowerCase();
      if (!limpia) return false;
      if (VOCAL_ACENTUADA_FINAL.test(limpia)) return true;
      if (VOSEO.test(limpia)) return true;
      if (TERMINACIONES_VERBALES.test(limpia)) return true;
      return VERBOS_SIN_PATRON.has(limpia);
    });
}

export function esAmbigua(frase: string): boolean {
  const limpia = frase.trim();
  if (!limpia) return true;
  if (PALABRAS_PREGUNTA.test(limpia)) return false;
  if (/\d/.test(limpia)) return false;
  return !tieneVerboConjugado(limpia);
}

/**
 * El techo que se le pone a una frase ambigua.
 *
 * Tiene que quedar **por debajo de `UMBRAL_CONFIANZA`** o no dispara la
 * pregunta, que es todo el punto. El test lo verifica.
 */
export const TECHO_AMBIGUA = 0.4;

/**
 * Acota la confianza hacia abajo. **Nunca la sube.**
 *
 * Esa dirección es lo que hace que este cambio no pueda causar el daño
 * que la app teme: el código solo puede volver más prudente al sistema,
 * nunca más audaz. El peor caso de un error acá es una pregunta de más
 * —el error barato, según AGENTS.md §9: *"una pregunta de más molesta,
 * una derivación equivocada muda hace lo que nadie pidió"*—.
 *
 * El **destino no se toca**: lo sigue eligiendo el modelo.
 */
export function acotarConfianza<T extends Pick<Decision, "confianza">>(
  decision: T,
): T {
  return { ...decision, confianza: Math.min(decision.confianza, TECHO_AMBIGUA) };
}

// Si alguien sube el umbral por encima del techo, esto deja de servir.
if (TECHO_AMBIGUA >= UMBRAL_CONFIANZA) {
  throw new Error(
    `TECHO_AMBIGUA (${TECHO_AMBIGUA}) tiene que ser menor que UMBRAL_CONFIANZA (${UMBRAL_CONFIANZA}).`,
  );
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx tsx --test tests/ambiguedad.test.mts
```

Esperado: `pass 7`, `fail 0`. **Sin una sola llamada a Groq**, en
milisegundos.

- [ ] **Paso 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/agentes/ambiguedad.ts tests/ambiguedad.test.mts
git commit -m "La regla de ambiguedad pasa a codigo, donde no se puede ignorar"
```

---

## Tarea B2: Engancharla, con el prompt todavía intacto

Primero se engancha **sin tocar el prompt**. Así, si algo se mueve en la
medición, se sabe que fue el enganche y no el recorte.

**Archivos:**
- Modificar: `src/lib/agentes/recepcionista.ts:456-473`

- [ ] **Paso 1: Modificar `decidirDestinos`**

Agregá el import arriba:

```ts
import { acotarConfianza, esAmbigua } from "@/lib/agentes/ambiguedad";
```

Y reemplazá el `return` final de `decidirDestinos`:

```ts
  const acciones = datos.acciones.slice(0, MAX_ACCIONES);

  // La comprobación mecánica se aplica acá y no la pide el prompt: ver
  // `ambiguedad.ts`. Solo puede BAJAR la confianza, así que lo peor que
  // puede provocar un error suyo es una pregunta de más.
  return esAmbigua(frase) ? acciones.map(acotarConfianza) : acciones;
```

- [ ] **Paso 2: Verificar que compila**

```bash
npm run typecheck && npm run lint
```

- [ ] **Paso 3: Medir el piso**

```bash
rm -rf .medidas
npm run medir:recepcionista
```

Esperado (~15 min): las cuatro anclas ambiguas en verde y **con confianza
≤ 0.4 en las tres corridas**. Las seis simples tienen verbo o palabra de
pregunta, así que no las toca: si alguna se movió, `esAmbigua()` tiene un
falso positivo y hay que agregar el caso a `tests/ambiguedad.test.mts`
**antes** de tocar la función.

- [ ] **Paso 4: Commit**

```bash
git add src/lib/agentes/recepcionista.ts
git commit -m "El recepcionista acota la confianza de las frases ambiguas"
```

---

## Tarea B3: Sacar las 24 líneas del prompt

**Archivos:**
- Modificar: `src/lib/agentes/recepcionista.ts`

- [ ] **Paso 1: Medir el corpus completo ANTES**

```bash
rm -rf .medidas
npm run medir:recepcionista -- --todo
```

Esperado: ~47 minutos. Guardá la tabla; es el "antes".

- [ ] **Paso 2: Borrar el bloque del prompt**

Borrá de `SISTEMA` todo desde `Antes de elegir la comprobación mecánica`
—en el archivo empieza con `Antes de elegir la confianza, hacé esta
comprobación mecánica`— hasta la línea `Si la respuesta a alguna de las
dos es sí, no aplica esta regla y la confianza puede ser alta.`
inclusive, **incluidos los cuatro ejemplos**.

Dejá la línea que la precede:

```
En "confianza" poné qué tan seguro estás, de 0 a 1. Si la frase podría ir
a dos especialistas distintos, poné menos de 0.6 y elegí el más probable.
```

Y que siga directo:

```
Respondé SOLO un objeto JSON con la clave "acciones": una lista de objetos
con las claves destino, argumento, confianza, analizar.
```

- [ ] **Paso 3: Verificar el tamaño**

```bash
npx tsx -e "
import { readFileSync } from 'node:fs';
const s = readFileSync('src/lib/agentes/recepcionista.ts','utf8').match(/const SISTEMA = \`([\s\S]*?)\`;/)[1];
console.log('caracteres:', s.length, '| tokens reservados:', Math.ceil((s.length+50)/3)+300);
"
```

Esperado: **~5852 caracteres y ~2268 tokens** (venía de 6887 y 2613).

- [ ] **Paso 4: Medir el corpus completo DESPUÉS**

```bash
rm -rf .medidas
npm run medir:recepcionista -- --todo
```

Criterio de aceptación, comparando contra el "antes" del paso 1:

1. **Ningún destino cambia** en ninguna frase.
2. **Ninguna frase que no oscilaba empieza a oscilar.**
3. Las cuatro anclas siguen ≤ 0.4 (ahora lo garantiza el código).

Si algo de esto falla, **revertí el paso 2** y anotalo: significa que el
bloque hacía algo más que la comprobación mecánica, y eso es un hallazgo
que cambia el spec.

- [ ] **Paso 5: Actualizar el comentario del archivo**

Al final del bloque de comentarios de `recepcionista.ts`, agregá:

```
 * **El bloque de confianza salió del prompt el 2026-08-12.** Eran 24
 * líneas y 345 tokens —el 15 %— y era el que más se rompió: los cuatro
 * incidentes de arriba son suyos. Ahora vive en `ambiguedad.ts` como
 * función pura, con sus 44 casos corriendo sin tocar Groq.
 *
 * ⚠ **Los cuatro incidentes de arriba NO se borran.** Siguen siendo la
 * razón por la que este prompt se toca midiendo, y la regla de que lo
 * que se pueda resolver con un test sobre un string va en código sale de
 * ahí. Lo que cambió es que ahora medir es `npm run medir:recepcionista`.
 *
 * Lo que NO cambió: el prompt sigue pidiendo confianza baja cuando la
 * frase podría ir a dos especialistas, y esa línea se queda. Lo que se
 * fue es solo la comprobación mecánica y sus cuatro ejemplos.
```

- [ ] **Paso 6: Commit**

```bash
npm run typecheck && npm run lint && npm run build
git add src/lib/agentes/recepcionista.ts
git commit -m "El prompt pierde las 24 lineas que mas se rompieron"
```

> **Fin de la etapa B.** Mergeable sola.

---

# ETAPA C — El atajo determinístico

## Tarea C1: `atajar()`

**Archivos:**
- Crear: `src/lib/agentes/atajo.ts`
- Crear: `tests/atajo.test.mts`

- [ ] **Paso 1: Escribir el test**

`tests/atajo.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { atajar } from "../src/lib/agentes/atajo.ts";

test("las cinco telegráficas reales atajan a movimientos, con el argumento literal", () => {
  const frases = [
    "-20usd Claude Code 06/08",
    "+50000ARS Venta Proder",
    "-20 usd claude code 06/08",
    "-15000 hosting",
    "+200000 ARS venta",
  ];
  for (const frase of frases) {
    const atajo = atajar(frase);
    assert.ok(atajo, `no atajó: "${frase}"`);
    assert.equal(atajo.decisiones.length, 1);
    assert.equal(atajo.decisiones[0].destino, "movimientos");
    assert.equal(atajo.decisiones[0].argumento, frase);
    assert.equal(atajo.decisiones[0].confianza, 1);
  }
});

test("un nombre suelto ataja con confianza baja, para que pregunte", () => {
  for (const frase of ["Claude Code", "Proder", "pricing", "Vercel Pro"]) {
    const atajo = atajar(frase);
    assert.ok(atajo, `no atajó: "${frase}"`);
    assert.ok(atajo.decisiones[0].confianza < 0.6, `"${frase}" no pregunta`);
  }
});

test("NO ataja lo que necesita al modelo", () => {
  const frases = [
    "cómo viene Proder",
    "hacé la retro de Gentius",
    "anotá que hoy peleé con el deploy toda la tarde",
    "qué anotaciones tengo sobre gestión de presupuestos",
    "me armás un presupuesto para un cliente que quiere una landing",
    "quiero aprender sobre eso",
  ];
  for (const frase of frases) {
    assert.equal(atajar(frase), null, `atajó de más: "${frase}"`);
  }
});

test("NO ataja una frase con monto adentro de una oración", () => {
  assert.equal(atajar("hoy pagué 20 dólares de hosting y me dio bronca"), null);
});

test("NO ataja una frase ambigua de más de dos palabras", () => {
  assert.equal(atajar("el hosting de Vercel Pro"), null);
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx tsx --test tests/atajo.test.mts
```

- [ ] **Paso 3: Escribir el módulo**

`src/lib/agentes/atajo.ts`:

```ts
import { esAmbigua, TECHO_AMBIGUA } from "@/lib/agentes/ambiguedad";
import type { Decision } from "@/lib/agentes/tipos";

/**
 * Frases que no necesitan al modelo.
 *
 * AGENTS.md §9 lo pide con todas las letras: *"si algo se puede resolver
 * sin modelo, se resuelve sin modelo"*. Lo que hace este archivo es
 * cobrar esa regla en el único lugar donde todavía no se cobraba: hoy una
 * frase telegráfica **paga una llamada a Groq entera** solo para que el
 * modelo conteste `"movimientos"` — y después `agentes/movimientos.ts` la
 * parsea igual con una expresión regular, sin modelo.
 *
 * Lo que compra: estabilidad perfecta (una regexp no oscila entre
 * corridas), latencia cero donde más se nota —medido el 2026-08-11, tres
 * frases seguidas esperaron ~59 s cada una al limitador— y cupo liberado.
 *
 * ## Solo entran dos casos, y no se agregan más
 *
 * Cada atajo es una regla que puede equivocarse en silencio, y el modelo
 * es mejor que una regexp en todo lo que no sea estrictamente mecánico.
 *
 * ⚠ **Un atajo no puede tener la última palabra sobre algo que escriba
 * directo.** Los dos elegidos cumplen: `movimientos` termina en un
 * formulario que Beno confirma, y la frase ambigua termina en una
 * pregunta. Si alguna vez se quiere atajar `bitacora` —que escribe
 * directo—, la respuesta es que no.
 */
export interface Atajo {
  decisiones: Decision[];
  /** Para el log: por qué no se llamó al modelo. */
  motivo: "telegrafico" | "ambigua";
}

/**
 * Signo, monto, moneda opcional, descripción y fecha opcional. Es la
 * forma de las cinco frases telegráficas reales de Beno, medidas el
 * 2026-08-10: las cinco fueron a `movimientos` con confianza 1 y el
 * argumento volvió idéntico a la frase.
 */
const TELEGRAFICO =
  /^[+-]\s?\d[\d.,]*\s*(usd|ars|u\$s|\$|dolares|dólares|pesos)?\s+\S+/i;

/** Menos que esto no alcanza para adivinar qué quiere. */
const MAX_PALABRAS_AMBIGUA = 2;

export function atajar(frase: string): Atajo | null {
  const limpia = frase.trim();
  if (!limpia) return null;

  if (TELEGRAFICO.test(limpia)) {
    return {
      motivo: "telegrafico",
      decisiones: [
        {
          destino: "movimientos",
          // La frase ENTERA, no un recorte: sin el número no hay gasto
          // que cargar, y es el modo de fallar que ya mordió una vez.
          argumento: limpia,
          confianza: 1,
        },
      ],
    };
  }

  const palabras = limpia.split(/\s+/).filter(Boolean).length;
  if (esAmbigua(limpia) && palabras <= MAX_PALABRAS_AMBIGUA) {
    return {
      motivo: "ambigua",
      decisiones: [
        {
          // El destino da igual: con esta confianza la cadena pregunta
          // antes de despachar. La pantalla ofrece las cuatro opciones
          // con el argumento intacto.
          destino: "desconocido",
          argumento: limpia,
          confianza: TECHO_AMBIGUA,
        },
      ],
    };
  }

  return null;
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx tsx --test tests/atajo.test.mts
```

Esperado: `pass 5`, `fail 0`.

- [ ] **Paso 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/agentes/atajo.ts tests/atajo.test.mts
git commit -m "Las frases que no necesitan modelo se resuelven sin modelo"
```

---

## Tarea C2: Engancharlo y medir

**Archivos:**
- Modificar: `src/lib/agentes/recepcionista.ts`

- [ ] **Paso 1: Modificar `decidirDestinos`**

Agregá el import:

```ts
import { atajar } from "@/lib/agentes/atajo";
```

Y al principio del cuerpo de `decidirDestinos`, antes de `completarJSON`:

```ts
  const atajo = atajar(frase);
  if (atajo) {
    console.info(`[recepcionista] atajo ${atajo.motivo}, sin llamar al modelo.`);
    return atajo.decisiones;
  }
```

- [ ] **Paso 2: Verificar que compila**

```bash
npm run typecheck && npm run lint
```

- [ ] **Paso 3: Medir el corpus completo**

```bash
rm -rf .medidas
npm run medir:recepcionista -- --todo
```

Ahora tarda **menos** que las veces anteriores: las cinco telegráficas y
las cuatro anclas ya no llaman a Groq, o sea 27 llamadas menos.

Criterio:
1. Las nueve atajadas en verde y **al instante**.
2. Todo lo demás igual que en la medición de la Tarea B3.

- [ ] **Paso 4: Probarlo a mano en la app**

```bash
npm run dev
```

Con la app levantada, en la caja (`Ctrl+J`) escribí `-20usd Claude Code
06/08`. Tiene que contestar **sin la espera del limitador**. Mirá la
consola del server: aparece `[recepcionista] atajo telegrafico` y **no**
la línea `[llm] recepcionista · …`.

- [ ] **Paso 5: Commit**

```bash
npm run build
git add src/lib/agentes/recepcionista.ts
git commit -m "El modelo deja de ser la puerta de entrada de lo que es mecanico"
```

---

## Tarea C3: Cerrar la documentación

**Archivos:**
- Modificar: `AGENTS.md`, `docs/dev/manual-agentico.md`
- Modificar: `docs/superpowers/specs/2026-08-12-recepcionista-robusto-design.md`

- [ ] **Paso 1: AGENTS.md §9**

Debajo de *"Regla que ordena todo: si algo se puede resolver sin modelo,
se resuelve sin modelo"*, agregá:

```markdown
Esa regla se cobra en `agentes/atajo.ts`: una frase telegráfica y un
nombre suelto **no llegan al modelo**. Antes pagaban una llamada entera
para que contestara `"movimientos"` o para que el prompt les bajara la
confianza, dos cosas que resuelve una expresión regular. Entran **solo
esos dos casos**: cada atajo es una regla que puede equivocarse en
silencio, y ninguno puede tener la última palabra sobre algo que escriba
directo.

Y el bloque de confianza del prompt **ya no está en el prompt**: vive en
`agentes/ambiguedad.ts`, solo puede BAJAR la confianza y tiene 44 casos
que corren sin tocar Groq.
```

- [ ] **Paso 2: Marcar el spec como ejecutado**

Reemplazá el bloque `> ⏳ **NO EJECUTADO.**` del spec por un `> ✅
**EJECUTADO...**` con la fecha y **qué encontró la ejecución que el spec
no preveía** — sobre todo los hallazgos del paso 6 de la Tarea A5.

- [ ] **Paso 3: Commit**

```bash
git add AGENTS.md docs/dev/manual-agentico.md docs/superpowers/specs/2026-08-12-recepcionista-robusto-design.md
git commit -m "La documentacion al dia con el recepcionista robusto"
```

---

## Criterio de aceptación de todo el plan

- [ ] `npm test` pasa: humo, env-local, banco, veredicto, ambigüedad, atajo.
- [ ] `npm run typecheck && npm run lint && npm run build` en verde.
- [ ] `npm run medir:recepcionista` da verde en el piso, y **retoma** si se corta.
- [ ] Las cuatro anclas dan ≤ 0.4 **en las tres corridas**.
- [ ] El prompt bajó de 6887 a ~5852 caracteres.
- [ ] Las cinco telegráficas se resuelven con **cero llamadas** a Groq.
- [ ] Ningún destino del corpus cambió respecto de la línea base.
- [ ] Los hallazgos de la Tarea A5 están anotados, no tapados.
