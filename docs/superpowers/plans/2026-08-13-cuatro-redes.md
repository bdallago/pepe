# Las cuatro redes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** poner las cuatro redes del spec
`../specs/2026-08-13-cuatro-redes-design.md`: un linter que impide que la
documentación afirme números falsos, un pre-commit que corre los tests, un
arnés para los otros doce prompts, y dictar el subconjunto de proyectos.

**Architecture:** las cuatro etapas van en orden y cada una protege a la
siguiente. A y C reusan el corte que ya funcionó en el recepcionista
—**datos** (una tabla), **juicio puro** (una función sin red), **corredor**
(el que gasta)—. D es la única que toca el dominio y entra última, con las
tres redes puestas.

**Tech Stack:** TypeScript, `node:test` corrido con `tsx` (cero
dependencias nuevas), Zod, Next 15.5, Supabase, Groq.

---

## Estructura de archivos

**Etapa A — linter de deriva**

| Archivo | Responsabilidad |
|---|---|
| Crear `src/lib/deriva/hechos.ts` | **Mide el código.** Importa módulos y cuenta archivos. Lo único que toca el filesystem |
| Crear `src/lib/deriva/afirmaciones.ts` | **Datos.** Qué documento afirma qué, con su regex y su porqué. Si aparece un `if` acá, está en el archivo equivocado |
| Crear `src/lib/deriva/verificar.ts` | **Puro.** Cruza afirmaciones contra hechos y devuelve los desvíos |
| Crear `tests/deriva.test.mts` | Lo corre en `npm test` |
| Crear `scripts/verificar-doc.mts` | El reporte a mano, con archivo:línea |
| Modificar `package.json` | `"verificar:doc"` |
| Modificar `AGENTS.md`, `docs/dev/manual-agentico.md` | Arreglar las cuatro derivas |

**Etapa B — hook**

| Archivo | Responsabilidad |
|---|---|
| Crear `.githooks/pre-commit` | Corre `npm test` y aborta si falla |
| Modificar `package.json` | `"prepare": "git config core.hooksPath .githooks"` |

**Etapa C — arnés**

| Archivo | Responsabilidad |
|---|---|
| Modificar `src/lib/llm.ts` | El tipo `PromptDeclarado<T>` |
| Modificar los 13 módulos con prompt | Exportar el descriptor y consumirlo en su propio call site |
| Crear `src/lib/arnes/jueces.ts` | **Puro.** Las varas mecanizadas |
| Crear `src/lib/arnes/registro.ts` | **Datos.** Las 13 familias: prompt, fixtures, juez |
| Crear `src/lib/arnes/fixtures/*.ts` | Entradas sintéticas (el repo es público) |
| Crear `scripts/medir.mts` | El corredor genérico, retomable |
| Crear `tests/jueces.test.mts`, `tests/arnes.test.mts` | Los jueces y la completitud del registro |
| Crear `docs/dev/lineas-base/*.json` | Las líneas base commiteadas |

**Etapa D — subconjunto dictado**

| Archivo | Responsabilidad |
|---|---|
| Crear `src/lib/agentes/subconjunto.ts` | **Puro.** Parte `"… compartido entre A y B"` |
| Crear `tests/subconjunto.test.mts` | Su barrido |
| Modificar `src/lib/agentes/tipos.ts` | `PrecargaMovimiento.proyectosExplicitos` |
| Modificar `src/lib/agentes/despacho.ts` | Partir antes de `leerMovimiento()` |
| Modificar `src/components/movimientos/movement-form.tsx` | Precargar los tildes |
| Modificar `src/lib/mcp/tools/movimientos.ts` | `compartido_entre` |
| Modificar `src/lib/actions/inbox.ts` | Insertar `movement_projects` al aceptar |
| Modificar `src/components/bandeja/*` | Mostrar los nombres en la tarjeta |

---

# Etapa A — El linter de deriva documental

### Task 1: Los hechos, medidos desde el código

**Files:**
- Create: `src/lib/deriva/hechos.ts`
- Test: `tests/deriva.test.mts` (se crea en la Task 2)

- [ ] **Step 1: Escribir `hechos.ts`**

```ts
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BANCO, casosDelPiso } from "@/lib/agentes/banco";
import { DESTINOS } from "@/lib/agentes/tipos";

/**
 * Los números que viven en el código y que la documentación repite.
 *
 * ## Por qué existe
 *
 * Cuatro veces la doc afirmó algo que el código ya no decía: el techo de
 * 30 pedidos/minuto de Groq negado durante dos días, los adjuntos que
 * supuestamente no se respaldaban, tres números viejos en el plan de
 * pruebas publicado, y el costo de medir el recepcionista. Nadie miente:
 * el código cambia y la prosa se queda.
 *
 * ⚠ **Acá solo entran números DERIVABLES del código.** Un tiempo de reloj
 * medido contra Groq no se puede derivar de ningún archivo, así que
 * chequearlo sería comparar una prosa contra otra prosa vieja. Los techos
 * de la tabla de §6.b tampoco: esos son de la documentación de Groq y los
 * de `TOKENS_POR_MINUTO` son nuestro margen, que es otra cosa.
 *
 * ⚠ **Y tampoco entra lo que solo crece sin que su obsolescencia cause
 * una acción equivocada.** La cantidad de tests es el ejemplo: que la doc
 * diga 30 cuando hay 34 no le hace tomar a nadie una decisión mala, y
 * lintearlo obligaría a editar prosa en cada commit que agregue un test.
 * El lugar natural de ese número es la salida de `npm test`.
 */
export interface Hechos {
  /** `DESTINOS.length`. */
  destinos: number;
  /** `BANCO.length` y `casosDelPiso().length`. */
  frasesBanco: number;
  frasesPiso: number;
  /** `server.registerTool(` en `lib/mcp/tools/`, y el reparto por anotación. */
  toolsConector: number;
  toolsQueLeen: number;
  toolsQueProponen: number;
  toolsQueEscribenDirecto: number;
  /**
   * Archivos de `src/lib/*.ts` con `import "server-only"`. Es el número
   * que decide qué puede importar el MCP, así que una doc vieja acá
   * termina en un import que revienta en runtime.
   */
  modulosServerOnly: number;
  /** Constantes de prompt de sistema, y llamadas a `completarJSON`. */
  promptsDeSistema: number;
  callSitesLLM: number;
  /** Valores de los enums de la bandeja, leídos de los tipos generados. */
  tiposBandeja: number;
  estadosBandeja: number;
  versionRespaldo: number;
  umbralConfianza: number;
  techoAmbigua: number;
}

function leer(raiz: string, ruta: string): string {
  return readFileSync(resolve(raiz, ruta), "utf8");
}

/** Cuántas veces matchea `patron` en todos los archivos de `glob`. */
function contar(raiz: string, glob: string, patron: RegExp): number {
  let total = 0;
  for (const ruta of globSync(glob, { cwd: raiz })) {
    total += (leer(raiz, ruta as string).match(patron) ?? []).length;
  }
  return total;
}

/** En cuántos ARCHIVOS matchea `patron`, que no es lo mismo que arriba. */
function contarArchivos(raiz: string, glob: string, patron: RegExp): number {
  let total = 0;
  for (const ruta of globSync(glob, { cwd: raiz })) {
    if (patron.test(leer(raiz, ruta as string))) total++;
  }
  return total;
}

/** Cuántos valores tiene un enum de `database.types.ts`. */
function valoresDeEnum(tipos: string, nombre: string): number {
  const bloque = tipos.match(
    new RegExp(`${nombre}:\\s*((?:\\s*\\|\\s*"[^"]+")+)`),
  );
  if (!bloque) throw new Error(`No encontré el enum ${nombre}.`);
  return (bloque[1]!.match(/"/g)!.length) / 2;
}

/** Un número escrito en el código, por su nombre de constante. */
function constante(fuente: string, nombre: string): number {
  const m = fuente.match(
    new RegExp(`${nombre}\\s*(?::\\s*[\\w<>.\\[\\]]+)?\\s*=\\s*([\\d._]+)`),
  );
  if (!m) throw new Error(`No encontré la constante ${nombre}.`);
  return Number(m[1]!.replaceAll("_", ""));
}

export function medirHechos(raiz: string): Hechos {
  const tipos = leer(raiz, "src/lib/supabase/database.types.ts");
  const tools = "src/lib/mcp/tools/*.ts";

  return {
    destinos: DESTINOS.length,
    frasesBanco: BANCO.length,
    frasesPiso: casosDelPiso().length,

    toolsConector: contar(raiz, tools, /server\.registerTool\(/g),
    toolsQueLeen: contar(raiz, tools, /annotations: SOLO_LECTURA/g),
    toolsQueProponen: contar(raiz, tools, /annotations: PROPONE/g),
    toolsQueEscribenDirecto: contar(raiz, tools, /annotations: ESCRIBE/g),

    // Es el glob de AGENTS.md §8, sin `**`: el número que documenta es el
    // de la raíz de `lib/`, no el de los subdirectorios.
    modulosServerOnly: contarArchivos(
      raiz,
      "src/lib/*.ts",
      /^import "server-only"/m,
    ),

    promptsDeSistema: contar(
      raiz,
      "src/lib/**/*.ts",
      /^const (?:SISTEMA|PROMPT)\w*\s*=/gm,
    ),
    callSitesLLM: contar(raiz, "src/lib/**/*.ts", /await completarJSON[<(]/g),

    tiposBandeja: valoresDeEnum(tipos, "tipo_bandeja"),
    estadosBandeja: valoresDeEnum(tipos, "estado_bandeja"),

    versionRespaldo: constante(
      leer(raiz, "src/lib/respaldo.ts"),
      "VERSION_RESPALDO",
    ),
    umbralConfianza: constante(
      leer(raiz, "src/lib/agentes/cadena.ts"),
      "UMBRAL_CONFIANZA",
    ),
    techoAmbigua: constante(
      leer(raiz, "src/lib/agentes/ambiguedad.ts"),
      "TECHO_AMBIGUA",
    ),
  };
}
```

- [ ] **Step 2: Verificar a mano que mide lo mismo que se midió escribiendo el spec**

Run:
```bash
npx tsx --conditions=react-server -e "import('./src/lib/deriva/hechos.ts').then(m=>console.log(m.medirHechos('.')))"
```

Expected: `destinos: 14`, `frasesBanco: 29`, `frasesPiso: 11`,
`toolsConector: 11`, `toolsQueLeen: 5`, `toolsQueProponen: 5`,
`toolsQueEscribenDirecto: 1`, `modulosServerOnly: 15`,
`promptsDeSistema: 13`, `callSitesLLM: 13`, `tiposBandeja: 11`,
`estadosBandeja: 5`, `versionRespaldo: 4`, `umbralConfianza: 0.6`,
`techoAmbigua: 0.4`.

⚠ Si `umbralConfianza` o `techoAmbigua` no aparecen donde dice el código,
buscar la constante con `grep -rn "UMBRAL_CONFIANZA" src/` y corregir la
ruta. **No cambiar el número esperado para que dé verde.**

- [ ] **Step 3: Commit**

```bash
git add src/lib/deriva/hechos.ts
git commit -m "Los numeros que la documentacion repite, medidos desde el codigo"
```

---

### Task 2: Las afirmaciones y el juicio

**Files:**
- Create: `src/lib/deriva/afirmaciones.ts`
- Create: `src/lib/deriva/verificar.ts`
- Create: `tests/deriva.test.mts`
- Create: `scripts/verificar-doc.mts`
- Modify: `package.json`

- [ ] **Step 1: Escribir `afirmaciones.ts`**

```ts
import type { Hechos } from "@/lib/deriva/hechos";

/**
 * Qué documento afirma qué número, y de qué hecho tiene que salir.
 *
 * ⚠ **Esto son DATOS.** La comparación vive en `verificar.ts`.
 *
 * ## Solo los documentos vivos
 *
 * AGENTS.md y los manuales dicen lo que es cierto HOY. Los specs, los
 * planes y `docs/registro-correcciones.md` dicen lo que era cierto el día
 * que se escribieron: lintearlos obligaría a reescribir el pasado, que es
 * lo contrario de para qué existen.
 *
 * ## Que la regex no matchee es TAMBIÉN una falla
 *
 * Es la propiedad que sostiene todo lo demás. Un chequeo que deja de
 * encontrar su línea porque alguien reescribió el párrafo se apaga solo y
 * en silencio, o sea que se convierte en el problema que vino a resolver.
 * Sin match, esto grita.
 */
export interface Afirmacion {
  doc: string;
  /** Tiene que capturar el número en el grupo 1. */
  patron: RegExp;
  hecho: keyof Hechos;
  /** Qué se rompe si esto queda viejo. Se imprime cuando falla. */
  porque: string;
  /** Para los números escritos con palabras. */
  comoTexto?: Record<string, number>;
}

const NUMEROS_EN_LETRAS: Record<string, number> = {
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
};

export const AFIRMACIONES: readonly Afirmacion[] = [
  {
    doc: "AGENTS.md",
    patron: /`server-only`\*\* — son (\d+), entre ellos `queries\.ts`/,
    hecho: "modulosServerOnly",
    porque:
      "Es la lista de lo que el MCP NO puede importar. Con el número " +
      "viejo, alguien importa uno y lo descubre en runtime.",
  },
  {
    doc: "AGENTS.md",
    patron: /el conector remoto tiene (\w+) tools/,
    hecho: "toolsConector",
    porque: "La tabla de abajo reparte esas tools por quién escribe.",
    comoTexto: NUMEROS_EN_LETRAS,
  },
  {
    doc: "AGENTS.md",
    patron: /\*\*(\d+) prompts\*\* en la app/,
    hecho: "promptsDeSistema",
    porque:
      "Es el denominador de cuántos tienen arnés. Si crece y la doc no, " +
      "un prompt nuevo entra sin red y nadie lo nota.",
  },
  {
    doc: "AGENTS.md",
    patron: /`VERSION_RESPALDO` vale hoy \*\*(\d+)\*\*/,
    hecho: "versionRespaldo",
    porque:
      "El workflow de respaldos lo usa de puerta: con un número menor " +
      "avisa y saltea en vez de fallar.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`tipos\.ts` \((\d+) destinos\)/,
    hecho: "destinos",
    porque: "Es el roster del recepcionista.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`tipo_bandeja` tiene \*\*(\d+)\*\* valores/,
    hecho: "tiposBandeja",
    porque:
      "Cada valor nuevo necesita su camino de aceptación. Uno sin " +
      "camino queda en la bandeja sin botón.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`estado_bandeja`, (\d+)\./,
    hecho: "estadosBandeja",
    porque: "`pospuesto` y `error` son los dos que se olvidan.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /el piso son (\d+) frases de un banco de (?:\d+)/,
    hecho: "frasesPiso",
    porque: "Es lo que se corre antes y después de tocar el prompt.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /un banco de (\d+)/,
    hecho: "frasesBanco",
    porque: "El corpus completo del recepcionista.",
  },
];
```

- [ ] **Step 2: Escribir `verificar.ts`**

```ts
import type { Afirmacion } from "@/lib/deriva/afirmaciones";
import type { Hechos } from "@/lib/deriva/hechos";

/**
 * Cruza las afirmaciones contra los hechos. Puro: recibe el texto de cada
 * documento ya leído, así que se puede probar sin tocar el filesystem.
 */
export interface Desvio {
  doc: string;
  /** 1-indexada, para poder abrirla. `null` si no matcheó en ninguna. */
  linea: number | null;
  clase: "sin-match" | "numero-viejo";
  dice: string | null;
  deberiaDecir: number;
  porque: string;
}

export function verificar(
  afirmaciones: readonly Afirmacion[],
  hechos: Hechos,
  docs: Map<string, string>,
): Desvio[] {
  const desvios: Desvio[] = [];

  for (const a of afirmaciones) {
    const texto = docs.get(a.doc);
    if (texto === undefined) {
      throw new Error(`Falta el contenido de ${a.doc}.`);
    }

    const esperado = hechos[a.hecho];
    const m = texto.match(a.patron);

    if (!m) {
      desvios.push({
        doc: a.doc,
        linea: null,
        clase: "sin-match",
        dice: null,
        deberiaDecir: esperado,
        porque: a.porque,
      });
      continue;
    }

    const crudo = m[1]!;
    const valor = a.comoTexto?.[crudo.toLowerCase()] ?? Number(crudo);

    if (valor !== esperado) {
      desvios.push({
        doc: a.doc,
        linea: texto.slice(0, m.index!).split("\n").length,
        clase: "numero-viejo",
        dice: crudo,
        deberiaDecir: esperado,
        porque: a.porque,
      });
    }
  }

  return desvios;
}

/** El desvío, en una línea legible. */
export function describir(d: Desvio): string {
  const donde = d.linea ? `${d.doc}:${d.linea}` : d.doc;
  return d.clase === "sin-match"
    ? `${donde} — la frase que afirmaba esto ya no está. Volvé a escribirla ` +
        `(el valor de hoy es ${d.deberiaDecir}) o borrá el chequeo. ${d.porque}`
    : `${donde} — dice "${d.dice}" y son ${d.deberiaDecir}. ${d.porque}`;
}
```

- [ ] **Step 3: Escribir `tests/deriva.test.mts`**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { AFIRMACIONES } from "../src/lib/deriva/afirmaciones.ts";
import { medirHechos } from "../src/lib/deriva/hechos.ts";
import { describir, verificar } from "../src/lib/deriva/verificar.ts";

const RAIZ = resolve(import.meta.dirname, "..");

function docs(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const a of AFIRMACIONES) {
    if (!mapa.has(a.doc)) {
      mapa.set(a.doc, readFileSync(resolve(RAIZ, a.doc), "utf8"));
    }
  }
  return mapa;
}

test("la documentación viva no afirma ningún número que el código desmienta", () => {
  const desvios = verificar(AFIRMACIONES, medirHechos(RAIZ), docs());
  assert.deepEqual(
    desvios.map(describir),
    [],
    "hay deriva documental: corré `npm run verificar:doc`",
  );
});

test("un número cambiado se detecta", () => {
  const hechos = { ...medirHechos(RAIZ), destinos: 99 };
  const desvios = verificar(AFIRMACIONES, hechos, docs());
  assert.equal(desvios.length, 1);
  assert.equal(desvios[0]!.clase, "numero-viejo");
  assert.equal(desvios[0]!.deberiaDecir, 99);
});

test("una frase borrada se detecta, que es el punto de todo esto", () => {
  const sinLaFrase = docs();
  sinLaFrase.set("AGENTS.md", "un AGENTS.md que no dice nada de eso");
  const desvios = verificar(AFIRMACIONES, medirHechos(RAIZ), sinLaFrase);
  assert.ok(desvios.length >= 1);
  assert.ok(desvios.every((d) => d.doc !== "AGENTS.md" || d.clase === "sin-match"));
});
```

- [ ] **Step 4: Escribir `scripts/verificar-doc.mts`**

```ts
/**
 * El reporte de deriva documental, a mano y con archivo:línea.
 *
 *   npm run verificar:doc
 *
 * Lo mismo que corre `npm test`, pero imprimiendo. Cero tokens, ~1 s.
 *
 * Es `.mts` por lo mismo que `medir-recepcionista.mts`: `package.json` no
 * tiene `"type": "module"` y el top-level await no compila a CJS.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");

const { AFIRMACIONES } = await import("../src/lib/deriva/afirmaciones.ts");
const { medirHechos } = await import("../src/lib/deriva/hechos.ts");
const { describir, verificar } = await import("../src/lib/deriva/verificar.ts");

const hechos = medirHechos(RAIZ);
const docs = new Map<string, string>();
for (const a of AFIRMACIONES) {
  if (!docs.has(a.doc)) {
    docs.set(a.doc, readFileSync(resolve(RAIZ, a.doc), "utf8"));
  }
}

const desvios = verificar(AFIRMACIONES, hechos, docs);

console.log("Hechos medidos:\n");
for (const [clave, valor] of Object.entries(hechos)) {
  console.log(`  ${clave.padEnd(26)} ${valor}`);
}

console.log(
  `\n${AFIRMACIONES.length} afirmaciones chequeadas en ${docs.size} documentos vivos.\n`,
);

if (desvios.length === 0) {
  console.log("Sin deriva.");
  process.exit(0);
}

console.log(`${desvios.length} desvío(s):\n`);
for (const d of desvios) console.log(`  - ${describir(d)}\n`);
process.exit(1);
```

- [ ] **Step 5: Agregar el script a `package.json`**

En `"scripts"`, después de `"typecheck"`:

```json
"verificar:doc": "tsx --conditions=react-server scripts/verificar-doc.mts",
```

- [ ] **Step 6: Correrlo y ver los cuatro rojos**

Run: `npm run verificar:doc`

Expected: exit 1, con al menos estos desvíos —
`AGENTS.md` dice `11` server-only y son `15`; y tres `sin-match`, porque
las frases de `promptsDeSistema`, `versionRespaldo` y las del manual con
el piso/banco **todavía no están escritas** con esa forma. Eso es correcto:
la Task 3 las escribe.

- [ ] **Step 7: Commit**

```bash
git add src/lib/deriva tests/deriva.test.mts scripts/verificar-doc.mts package.json
git commit -m "Un linter que cruza los numeros de la documentacion contra el codigo"
```

---

### Task 3: Arreglar las cuatro derivas

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/dev/manual-agentico.md`
- Modify: `scripts/medir-recepcionista.mts` (el `~32 min` del docstring)

- [ ] **Step 1: AGENTS.md — el número de módulos `server-only`**

Cambiar `— son 11, entre ellos `queries.ts` —` por `— son 15, entre ellos
`queries.ts` —`, y agregar al lado la razón por la que el número se mueve
solo:

```markdown
⚠ **Ese número lo chequea `npm test`** (`src/lib/deriva/`). No lo
actualices a mano sin correr `npm run verificar:doc`: creció de 11 a 15
sin que nadie lo note, que es exactamente el modo de fallar que el linter
viene a tapar.
```

- [ ] **Step 2: AGENTS.md — la cantidad de prompts, con la forma que el linter busca**

En §7 (o al final de §6.d), agregar:

```markdown
Al 2026-08-13 hay **13 prompts** en la app, en 11 archivos: uno por
`completarJSON`. El único que tenía red era el del recepcionista; el resto
la tiene desde el arnés de `src/lib/arnes/`.
```

⚠ El patrón del linter es `/\*\*(\d+) prompts\*\* en la app/`, así que la
frase tiene que decir literal `**13 prompts** en la app`.

- [ ] **Step 3: AGENTS.md — el valor de hoy de `VERSION_RESPALDO`**

Las dos menciones existentes (`pasó a 2`, `pasó a 3`) son historia y se
quedan como están. Agregar debajo de la de `3`:

```markdown
**`VERSION_RESPALDO` vale hoy **4**.** Lo subió el subconjunto explícito
de proyectos (`movement_projects` entró a `TABLAS`). Las dos frases de
arriba cuentan cómo llegó hasta acá y no se corrigen: dicen lo que pasó.
```

- [ ] **Step 4: `docs/dev/manual-agentico.md` — el piso y el banco, en una frase chequeable**

Donde hoy dice `~11 minutos el piso y ~50 el corpus completo`, dejar los
tiempos (son mediciones, el linter no los toca) y agregar la frase con los
conteos:

```markdown
El piso son 11 frases de un banco de 29.
```

- [ ] **Step 5: Corregir el `~32 min` del corredor**

En `scripts/medir-recepcionista.mts`, línea 5, cambiar
`# completo: ~32 min` por `# completo: 29 frases, ~50 min`.

⚠ **El linter no puede atrapar esto** —es un tiempo de reloj, no un número
derivable— y por eso conviene decir en el mismo comentario de dónde salió:

```
 *   npm run medir:recepcionista -- --todo  # completo: 29 frases, ~50 min
 *
 * El ~50 es medido, no calculado: 20 de las 29 frases llegan al modelo
 * (a las otras 9 las ataja `atajo.ts`), y a 2 llamadas por minuto eso da
 * 30 en teoría. La diferencia es la corrección de la reserva con el
 * `usage` real. Si alguien lo recalcula y le da 30, el número bueno es el
 * del cronómetro.
```

- [ ] **Step 6: Verde**

Run: `npm run verificar:doc && npm test`
Expected: "Sin deriva." y 33 tests en verde (30 + los 3 nuevos).

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/dev/manual-agentico.md scripts/medir-recepcionista.mts
git commit -m "Las cuatro afirmaciones que la documentacion tenia viejas"
```

---

# Etapa B — `npm test` en un hook

### Task 4: El pre-commit

**Files:**
- Create: `.githooks/pre-commit`
- Modify: `package.json`

- [ ] **Step 1: Escribir el hook**

`.githooks/pre-commit`:

```sh
#!/bin/sh
#
# Corre los tests puros antes de cada commit.
#
# Son ~1 segundo y ninguno toca Groq ni la base, así que el costo es
# invisible. Adentro va también el linter de deriva documental
# (`tests/deriva.test.mts`), así que esto es lo único que impide
# commitear documentación que afirma números falsos.
#
# ⚠ **Solo `npm test`, a propósito.** `typecheck`, `lint` y `build` son
# minutos: un pre-commit de minutos se termina saltando siempre con
# --no-verify, y entonces la red no existe. El trío completo sigue
# corriéndose a mano antes de dar algo por terminado.
#
# Salida de emergencia: git commit --no-verify
echo "→ npm test (pre-commit)"
if ! npm test --silent; then
  echo ""
  echo "✗ Los tests no pasan, así que no commiteo."
  echo "  Si esto es a propósito: git commit --no-verify"
  exit 1
fi
```

- [ ] **Step 2: Hacerlo ejecutable y engancharlo**

```bash
git update-index --add --chmod=+x .githooks/pre-commit
git config core.hooksPath .githooks
```

- [ ] **Step 3: `prepare` en `package.json`**

```json
"prepare": "git config core.hooksPath .githooks",
```

Va en `"scripts"`. Corre solo con `npm install`, así que engancharlo no es
un paso que nadie tenga que recordar. **Sin husky**: son cuatro líneas de
shell y una dependencia menos.

- [ ] **Step 4: Verificar que ABORTA de verdad**

```bash
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("roto a proposito", () => assert.equal(1, 2));\n' > tests/zz-roto.test.mts
git add tests/zz-roto.test.mts
git commit -m "esto no tiene que entrar"
```

Expected: el commit **falla** con "✗ Los tests no pasan, así que no
commiteo." y `git log -1` sigue mostrando el commit de la Task 3.

- [ ] **Step 5: Verificar que deja pasar lo bueno**

```bash
git reset tests/zz-roto.test.mts && rm tests/zz-roto.test.mts
git add .githooks/pre-commit package.json
git commit -m "Los tests corren antes de cada commit"
```

Expected: imprime `→ npm test (pre-commit)` y commitea.

---

# Etapa C — El arnés para los otros doce prompts

### Task 5: El descriptor de prompt, y los dos primeros convertidos

**Files:**
- Modify: `src/lib/llm.ts`
- Modify: `src/lib/retro.ts:99-146,243-270`
- Modify: `src/lib/agentes/movimientos.ts:210-263`

- [ ] **Step 1: El tipo, en `llm.ts`, debajo de `OpcionesLLM`**

```ts
/**
 * Un prompt declarado: todo lo que `completarJSON` necesita **menos el
 * dato concreto**.
 *
 * ⚠ **Existe para que el arnés mida el prompt que corre en producción, y
 * no una copia.** Si `src/lib/arnes/` tuviera su propio texto del prompt,
 * mediría algo que nadie ejecuta: daría tranquilidad sin dar información,
 * que es peor que no medir. Con un solo descriptor no se puede tocar el
 * prompt sin tocar lo que se mide.
 *
 * El call site de producción queda `completarJSON({ ...PROMPT, usuario })`.
 */
export type PromptDeclarado<T> = Omit<OpcionesLLM<T>, "usuario" | "signal">;
```

- [ ] **Step 2: Convertir `retro.ts`**

Reemplazar el objeto literal del `completarJSON` (líneas 243-270) por un
descriptor exportado arriba, conservando **todos** los comentarios que hoy
están al lado de cada opción —son mediciones y explican por qué cada
número es el que es—:

```ts
export const PROMPT_RETRO: PromptDeclarado<Respuesta> = {
  modelo: MODELO_RAZONADOR,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "retro-proyecto",
  temperatura: 0.4,
  // …acá van, sin tocar, los comentarios de esfuerzo/maxTokens/timeoutMs
  esfuerzo: "medium",
  maxTokens: 4500,
  timeoutMs: 180_000,
};
```

Y el call site:

```ts
const { datos, uso } = await completarJSON({ ...PROMPT_RETRO, usuario });
```

⚠ `Respuesta` es `z.infer<typeof respuestaSchema>`. Si el tipo no existe
con ese nombre en el archivo, usar `z.infer<typeof respuestaSchema>`
directo en el genérico.

- [ ] **Step 3: Convertir `agentes/movimientos.ts` igual**

```ts
export const PROMPT_MOVIMIENTO: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_CHICO,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "extraccion-movimiento",
  temperatura: 0,
  maxTokens: 200,
  reintentos: 1,
  timeoutMs: 15_000,
};
```

- [ ] **Step 4: Verificar que no cambió nada**

Run: `npm run typecheck && npm test`
Expected: verde. **Este paso no cambia comportamiento**: el objeto que
llega a `completarJSON` es idéntico campo por campo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts src/lib/retro.ts src/lib/agentes/movimientos.ts
git commit -m "Un prompt se declara una vez, y el arnes mide el que corre"
```

---

### Task 6: Los once prompts que faltan

**Files (cada uno, su `completarJSON`):**
- Modify: `src/lib/agentes/recepcionista.ts:466`
- Modify: `src/lib/clasificacion.ts:203`
- Modify: `src/lib/extraccion.ts:191`
- Modify: `src/lib/generacion.ts:195`
- Modify: `src/lib/sugerencias.ts:108`
- Modify: `src/lib/zombies.ts:150`
- Modify: `src/lib/agentes/observaciones.ts:150`
- Modify: `src/lib/presupuestos/estimacion.ts:270`
- Modify: `src/lib/adjuntos.ts:542` (`SISTEMA_TROZO`), `:576` (`SISTEMA_SINTESIS`), y el de `SISTEMA_CAPTURA`

- [ ] **Step 1: La misma transformación mecánica, once veces**

Para cada archivo: sacar del objeto que recibe `completarJSON` todo menos
`usuario`, `imagenes` y `signal`; ponerlo en un `export const PROMPT_<X>:
PromptDeclarado<…>` arriba (junto al `SISTEMA` que usa); dejar el call site
como `completarJSON({ ...PROMPT_<X>, usuario })`.

Nombres, para que el registro de la Task 8 los importe sin adivinar:
`PROMPT_RECEPCIONISTA`, `PROMPT_CLASIFICACION`, `PROMPT_EXTRACCION`,
`PROMPT_GENERACION`, `PROMPT_SUGERENCIAS`, `PROMPT_ZOMBIES`,
`PROMPT_OBSERVACIONES`, `PROMPT_ESTIMACION`, `PROMPT_ADJUNTO_TROZO`,
`PROMPT_ADJUNTO_SINTESIS`, `PROMPT_ADJUNTO_CAPTURA`.

⚠ **`imagenes` NO va en el descriptor** de `PROMPT_ADJUNTO_CAPTURA`: es
dato de entrada, igual que `usuario`. Va en el call site.

⚠ **Ningún comentario se borra.** Los `maxTokens` de estos archivos tienen
mediciones al lado (3500 en generación porque con 1800 volvía truncada,
4500 en la retro, 200 en el extractor) y son la única memoria de por qué.

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm run lint && npm test`
Expected: verde, sin cambios de comportamiento.

- [ ] **Step 3: Commit**

```bash
git add src/lib
git commit -m "Los trece prompts declarados en un solo lugar cada uno"
```

---

### Task 7: Los jueces

**Files:**
- Create: `src/lib/arnes/jueces.ts`
- Create: `tests/jueces.test.mts`

- [ ] **Step 1: Escribir los jueces**

```ts
/**
 * Las varas de los prompts, mecanizadas.
 *
 * ## Por qué esto es la mitad que importa
 *
 * Correr un prompt contra Groq cuesta minutos de reloj y cupo diario.
 * Juzgar una salida es gratis y corre en `npm test`. Todo lo que se pueda
 * mover de allá para acá se mueve: es la misma regla de §9 —*si algo se
 * puede resolver sin modelo, se resuelve sin modelo*— aplicada a la
 * verificación en vez de al despacho.
 *
 * ⚠ **Ninguno juzga si la respuesta es BUENA.** Juzgan que cumpla lo que
 * el prompt promete. "Esta retro es floja" no es mecanizable y no se
 * intenta.
 */

/**
 * Palabras con las que arranca un rótulo de manual de negocios.
 *
 * La vara está escrita tres veces en AGENTS.md (6.3, la retro, los
 * adjuntos) y nunca se verificó ni una: *"el título tiene que ser una
 * afirmación discutible, no un rótulo. Si podría estar en la tapa de
 * cualquier libro de negocios, está mal"*.
 */
const ARRANQUES_DE_ROTULO = [
  /^(establecer|priorizar|revisar|mejorar|optimizar|implementar|definir|mantener|invertir|diversificar|gestionar|planificar|documentar|evaluar|fomentar|asegurar|garantizar)\b/i,
  /^(la importancia|es importante|hay que|conviene|siempre)\b/i,
];

/** Un título es rótulo si empieza como consejo y no dice nada concreto. */
export function pareceRotulo(titulo: string): boolean {
  const t = titulo.trim();
  if (!ARRANQUES_DE_ROTULO.some((r) => r.test(t))) return false;

  // Un número, un porcentaje o un nombre propio en el medio lo salvan:
  // "Invertir 3 meses en el importador costó más que el importador" es
  // discutible aunque arranque con un infinitivo.
  const tieneDato = /\d/.test(t) || /\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]{2,}/.test(t);
  return !tieneDato;
}

/**
 * Los números de la salida que no aparecen en la entrada.
 *
 * Es el juez que ataca lo único que está medido de la retro: **el
 * razonamiento confabula más**, y su primera corrida inventó un plazo
 * previsto que no existía. Un número que el modelo no recibió y escribe
 * igual es una invención, punto — y en un documento que se relee dentro
 * de un año, es la peor.
 *
 * Los años y los números de una o dos cifras se ignoran a propósito: "dos
 * clientes" o "tres veces" salen de contar, no de inventar, y exigirlos
 * en la entrada daría falsos positivos en cada oración.
 */
export function numerosSinRespaldo(salida: string, entrada: string): string[] {
  const enEntrada = new Set(
    (entrada.match(/\d[\d.,]*/g) ?? []).map(normalizarNumero),
  );

  const sospechosos: string[] = [];
  for (const crudo of salida.match(/\d[\d.,]*/g) ?? []) {
    const n = normalizarNumero(crudo);
    if (n.length <= 2) continue;
    if (/^(19|20)\d\d$/.test(n)) continue;
    if (enEntrada.has(n)) continue;
    sospechosos.push(crudo);
  }
  return sospechosos;
}

function normalizarNumero(s: string): string {
  return s.replaceAll(".", "").replaceAll(",", "");
}

/**
 * ¿La descripción extraída está contenida en la frase?
 *
 * Mecaniza el **COPIALA ENTERA** del extractor de movimientos, que hoy
 * solo vive como mayúsculas dentro del prompt. El modo de fallar es
 * conocido y silencioso: con un prompt más largo, `"Venta Proder a
 * cliente nuevo"` volvía como `"Venta"` y el histórico —de donde sale la
 * clasificación de todo lo que venga después— quedaba sucio.
 */
export function descripcionContenida(
  descripcion: string,
  frase: string,
): boolean {
  const normal = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return normal(frase).includes(normal(descripcion));
}

/** Emojis y muletillas de asistente. Seis de los trece prompts los prohíben. */
const MULETILLAS = [
  /\b(¡?claro!?|por supuesto|desde ya|espero que|no dudes en|recordá que es importante)\b/i,
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
];

export function tonoDeAsistente(texto: string): string[] {
  return MULETILLAS.filter((r) => r.test(texto)).map((r) => String(r));
}
```

- [ ] **Step 2: Escribir `tests/jueces.test.mts`**

Con los casos reales que están documentados en AGENTS.md, que es de donde
salen las varas. Los rótulos son los que devolvió llama-3.3-70b el
2026-08-08; las afirmaciones buenas, las del razonador.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  descripcionContenida,
  numerosSinRespaldo,
  pareceRotulo,
} from "../src/lib/arnes/jueces.ts";

// Los tres que devolvió llama-3.3-70b el 2026-08-08 y que el prompt
// prohíbe, más los dos que AGENTS.md nombra en la regla de la retro.
const ROTULOS = [
  "Establecer límites de soporte",
  "Priorizar la documentación",
  "Revisar contratos",
  "Invertir en herramientas de calidad",
  "Diversificar los ingresos",
  "Es importante evaluar el gasto en herramientas",
];

// Las que salieron del razonador y que la doc pone como ejemplo de vara
// cumplida.
const AFIRMACIONES = [
  "El 70 % de la facturación proviene de dos clientes",
  "El 80% de la facturación en dos clientes te deja sin margen para decir que no",
  "Contratar temprano te cuesta menos que llegar tarde a Gentius",
];

test("los rótulos medidos se detectan", () => {
  for (const t of ROTULOS) {
    assert.ok(pareceRotulo(t), `no detectó el rótulo: "${t}"`);
  }
});

test("las afirmaciones discutibles pasan", () => {
  for (const t of AFIRMACIONES) {
    assert.ok(!pareceRotulo(t), `marcó como rótulo: "${t}"`);
  }
});

test("un número que no estaba en la entrada es una invención", () => {
  const entrada = "Movimientos: -150000 ARS hosting; +469472 ARS venta.";
  assert.deepEqual(numerosSinRespaldo("Gastaste 150.000 en hosting.", entrada), []);
  assert.deepEqual(
    numerosSinRespaldo("El plazo previsto era de 90 días.", entrada),
    ["90"],
  );
});

test("los años y los números chicos no cuentan como invención", () => {
  assert.deepEqual(numerosSinRespaldo("En 2026 hubo 3 clientes.", "sin números"), []);
});

test("la descripción tiene que estar contenida en la frase", () => {
  assert.ok(
    descripcionContenida("Venta Proder a cliente nuevo", "cobré 50000 por la Venta Proder a cliente nuevo"),
  );
  assert.ok(!descripcionContenida("Venta", "cobré 50000 por la Venta Proder a cliente nuevo") === false);
  assert.ok(
    descripcionContenida("claude code", "-20 usd Claude Code 06/08"),
    "tiene que ignorar mayúsculas y tildes",
  );
});
```

⚠ **Cuidado con el tercer `assert` del último test**: lo que hay que
verificar es que `"Venta"` **sí** está contenida (es una subcadena) — o
sea que este juez detecta el recorte solo cuando se lo compara contra lo
que el banco espera, no por sí solo. Escribirlo derecho:

```ts
assert.ok(descripcionContenida("Venta", "cobré 50000 por la Venta Proder"));
```

y anotar en el banco de la familia `movimiento` que la descripción
esperada es `"Venta Proder a cliente nuevo"` completa.

- [ ] **Step 3: Correr**

Run: `npm test`
Expected: los 5 nuevos en verde. Si `pareceRotulo` falla con alguno de los
seis rótulos medidos, **el juez está mal, no el caso**: esos seis los
devolvió un modelo de verdad.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arnes/jueces.ts tests/jueces.test.mts
git commit -m "Las varas de los prompts dejan de ser prosa"
```

---

### Task 8: El registro y las fixtures

**Files:**
- Create: `src/lib/arnes/fixtures/retro.ts`, `generacion.ts`, `movimiento.ts`, `extraccion.ts`, `sugerencias.ts`, `observaciones.ts`, `estimacion.ts`, `clasificacion.ts`, `zombies.ts`, `adjuntos.ts`
- Create: `src/lib/arnes/registro.ts`
- Create: `tests/arnes.test.mts`

- [ ] **Step 1: El tipo del registro**

```ts
import type { PromptDeclarado } from "@/lib/llm";

/**
 * Las trece familias de prompt de la app, con qué se les manda y qué
 * tiene que cumplir la salida.
 *
 * ⚠ **DATOS.** El juicio está en `jueces.ts` y el disparo en
 * `scripts/medir.mts`.
 *
 * ⚠ **Las fixtures son sintéticas, y no por comodidad: el repo es
 * público.** `colmena-backup-*.json` está en `.gitignore` justamente
 * porque las entradas de bitácora reales son personales. Una fixture con
 * la bitácora de Beno adentro sería publicarla. Imitan la FORMA del
 * contexto real —montos, categorías, fechas, largos— con contenido
 * inventado.
 */
export interface CasoDeArnes {
  nombre: string;
  /** El `usuario` que se le manda al prompt. */
  usuario: string;
  /** Imágenes, solo para la familia de capturas. */
  imagenes?: string[];
  /** Qué tiene que cumplir la salida. Devuelve los problemas. */
  juzgar: (salida: unknown, usuario: string) => string[];
}

export interface Familia {
  /** El id que se pasa a `npm run medir <id>`. */
  id: string;
  /** Dónde vive el prompt, para el reporte. */
  archivo: string;
  /** El mismo objeto que usa producción. Nunca una copia. */
  prompt: PromptDeclarado<unknown>;
  /** Cuánto cuesta: sirve para avisar antes de gastar el cupo. */
  clase: "chico" | "razonador" | "vision";
  casos: readonly CasoDeArnes[];
}
```

- [ ] **Step 2: La familia más importante: `retro`**

`src/lib/arnes/fixtures/retro.ts` — el contexto sintético tiene que traer
todo lo que `armarContexto()` arma de verdad: nombre, balances, la tabla
de movimientos con categorías y fechas, lecciones y bitácora.

```ts
export const CONTEXTO_RETRO = `Proyecto: Importador de facturas
Balance ARS: -412500 (ingresos 1200000, egresos 1612500)
Balance USD: -180

Movimientos:
- 2026-03-04 · Servidor dedicado · -45000 ARS · infraestructura
- 2026-03-19 · Anticipo del cliente · +600000 ARS · ventas
- 2026-04-02 · Licencia del OCR · -120 USD · herramientas
- 2026-04-28 · Segundo anticipo · +600000 ARS · ventas
- 2026-05-11 · Horas de un tercero · -980000 ARS · subcontratacion
- 2026-06-02 · Licencia del OCR · -60 USD · herramientas

Lecciones ya anotadas:
- Subcontratar el parser salió más caro que escribirlo (proceso)

Bitácora:
- 2026-05-12: el tercero entregó el parser y hubo que reescribir la mitad, el formato de las facturas del cliente no era el que habíamos visto.
- 2026-06-03: cerramos con el cliente conforme pero el margen se lo comió la subcontratación.`;
```

Y su juez, en `registro.ts`:

```ts
{
  id: "retro",
  archivo: "src/lib/retro.ts",
  prompt: PROMPT_RETRO as PromptDeclarado<unknown>,
  clase: "razonador",
  casos: [
    {
      nombre: "proyecto que cerró en pérdida por subcontratar",
      usuario: CONTEXTO_RETRO,
      juzgar: (salida, usuario) => {
        const r = salida as {
          titulo: string;
          que_funciono: string;
          que_no_funciono: string;
          costo_real: string;
          conclusion: string;
          lecciones: { titulo: string; contenido: string }[];
        };
        const problemas: string[] = [];

        // La regla 1 del prompt, mecanizada: nada de lo que afirme puede
        // traer un número que no le dimos.
        const todo = [
          r.titulo, r.que_funciono, r.que_no_funciono, r.costo_real,
          r.conclusion, ...r.lecciones.flatMap((l) => [l.titulo, l.contenido]),
        ].join("\n");
        const inventados = numerosSinRespaldo(todo, usuario);
        if (inventados.length > 0) {
          problemas.push(`números que no le dimos: ${inventados.join(", ")}`);
        }

        // La lista de errores concretos del prompt, la parte chequeable.
        if (/\bplazo|fecha prevista|a tiempo|entrega prevista\b/i.test(todo)) {
          problemas.push("habla de plazos, y no le dimos ningún plan");
        }

        for (const l of r.lecciones) {
          if (pareceRotulo(l.titulo)) {
            problemas.push(`lección con título de rótulo: "${l.titulo}"`);
          }
        }

        const tono = tonoDeAsistente(todo);
        if (tono.length > 0) problemas.push("tono de asistente");

        return problemas;
      },
    },
  ],
}
```

- [ ] **Step 3: Las otras doce familias, con el mismo patrón**

Una fixture y un juez por familia. Lo mínimo que cada juez tiene que
cobrar, por familia:

| Familia | Lo que se juzga |
|---|---|
| `recepcionista` | Ya tiene su propio banco: la familia **delega** en `banco.ts` y `veredicto.ts`, no los duplica |
| `generacion` | Ningún título rótulo; cada lección con la categoría dentro del enum |
| `sugerencias` | No inventa tracks ni sesiones que no estén en la entrada; nada de rótulos |
| `observaciones` | Todo número de la observación está en los balances de la entrada |
| `estimacion` | Cada entregable tiene horas > 0; **ninguna cita textual que no esté en el pedido** (`ancla_verificada` existe por esto) |
| `extraccion` | La lección propuesta cita la entrada; vara BAJA a propósito (§6): un falso negativo cuesta más que un falso positivo, así que acá **no** se aplica `pareceRotulo` |
| `clasificacion` | La categoría devuelta está en la lista que se le dio |
| `zombies` | El aviso nombra el gasto de la entrada y no promete haberlo dado de baja |
| `movimiento` | `descripcionContenida()`; monto exacto; `fecha_texto` copiado literal de la frase |
| `adjunto_trozo` | El resumen no trae números que el trozo no tenga |
| `adjunto_sintesis` | Vara de 6.3: nada de rótulos (AGENTS.md §6.g lo dice explícito) |
| `adjunto_captura` | Con ruido, `legible: false` y **cero conversación inventada** |

⚠ **La vara de `extraccion` es la única que va al revés y está escrito por
qué**: ahí el modelo reescribe lo que Beno vivió, no produce afirmaciones
propias. Aplicarle la vara de 6.3 haría que el arnés empuje justo en la
dirección que AGENTS.md §6 prohíbe (*"no lo vuelvas a apretar"*).

- [ ] **Step 4: El test de completitud**

`tests/arnes.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { medirHechos } from "../src/lib/deriva/hechos.ts";
import { FAMILIAS } from "../src/lib/arnes/registro.ts";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");

test("hay una familia de arnés por cada prompt de la app", () => {
  const { promptsDeSistema } = medirHechos(RAIZ);
  assert.equal(
    FAMILIAS.length,
    promptsDeSistema,
    "un prompt sin familia es un prompt sin red: agregalo a registro.ts",
  );
});

test("ninguna familia tiene el prompt copiado", () => {
  for (const f of FAMILIAS) {
    assert.ok(
      typeof f.prompt.sistema === "string" && f.prompt.sistema.length > 100,
      `${f.id}: el prompt tiene que venir importado del módulo real`,
    );
  }
});

test("toda familia tiene al menos un caso", () => {
  for (const f of FAMILIAS) {
    assert.ok(f.casos.length > 0, `${f.id} no tiene ningún caso`);
  }
});
```

⚠ **El primer test es el que cierra el círculo**: agregar un prompt nuevo
sin agregarle familia rompe `npm test`, y el hook de la etapa B no deja
commitearlo.

- [ ] **Step 5: Correr y commitear**

Run: `npm run typecheck && npm test`

```bash
git add src/lib/arnes tests/arnes.test.mts
git commit -m "Las trece familias de prompt, con fixture y juez"
```

---

### Task 9: El corredor genérico

**Files:**
- Create: `scripts/medir.mts`
- Modify: `package.json`
- Modify: `scripts/medir-recepcionista.mts` (queda como alias)

- [ ] **Step 1: Escribir `scripts/medir.mts`**

Mismo esqueleto que `medir-recepcionista.mts` —del que se copian las tres
propiedades que ya se ganaron a golpes—:

1. **`.mts` y `cargarEnvLocal()` antes de cualquier import dinámico.**
2. **Retomable**: el estado se persiste **llamada a llamada** en
   `.medidas/<familia>.json`, o "retomable" sería mentira.
3. **Tres corridas por caso**, porque el modelo no es determinístico ni
   con `temperatura: 0` y **oscilar cuenta como fallar**.

```ts
/**
 * Mide una familia de prompt contra su banco.
 *
 *   npm run medir retro
 *   npm run medir movimiento -- --base    # además, reescribe la línea base
 *   npm run medir -- --lista              # qué familias hay y qué cuestan
 *
 * ⚠ **Una familia por vez, a propósito.** Un `--todo` que dispare las
 * trece se come el techo diario del razonador (200 000 tokens) y deja la
 * app sin retro ni presupuestos por el resto del día. El costo por
 * familia se imprime antes de empezar.
 */
```

El cuerpo: elegir familia por `argv`, correr `CORRIDAS = 3` por caso
llamando `completarJSON({ ...familia.prompt, usuario: caso.usuario })`,
guardar `{ salida }` o `{ error }`, juzgar con `caso.juzgar`, imprimir la
tabla (caso · problemas · ok), escribir
`docs/dev/lineas-base/<familia>.json` con `--base`, y `process.exit(1)` si
algo falló.

**Oscilación**: la firma de una corrida es `JSON.stringify(salida)`
ordenado; si las tres no coinciden **no se falla automáticamente** —a
diferencia del recepcionista— porque acá la salida es texto redactado y
nunca va a ser idéntica. Lo que se compara entre corridas es **el conjunto
de problemas**: si una corrida trae un problema que otra no, eso sí es
oscilación y se marca.

- [ ] **Step 2: Los scripts de `package.json`**

```json
"medir": "tsx --conditions=react-server scripts/medir.mts",
"medir:recepcionista": "tsx --conditions=react-server scripts/medir-recepcionista.mts",
```

`medir:recepcionista` **se queda** y no se absorbe: su banco tiene
`espera` con destinos y bandas de confianza, que es una forma distinta de
juzgar, y su línea base commiteada es la referencia de cuatro incidentes.
Unificarlos sería reescribir la única red que ya funciona para que se
parezca a la nueva.

- [ ] **Step 3: Verificar el ciclo sin gastar cupo**

Run: `npm run medir -- --lista`
Expected: las 13 familias con su clase y el costo estimado en llamadas y
tokens. **Cero llamadas a Groq.**

- [ ] **Step 4: Commit**

```bash
git add scripts/medir.mts package.json
git commit -m "Un corredor para medir cualquier familia de prompt"
```

---

### Task 10: Medir de verdad

- [ ] **Step 1: Las seis del razonador**

```bash
npm run medir retro -- --base
npm run medir generacion -- --base
npm run medir sugerencias -- --base
npm run medir observaciones -- --base
npm run medir estimacion -- --base
npm run medir adjunto_sintesis -- --base
```

Expected: ~18 llamadas, ~20 minutos de reloj, ~90 000 tokens del techo
diario de 200 000 del razonador. **Decisión de Beno del 2026-08-13**: mide
las seis.

⚠ Si aparece un 429, **no es un bug**: el corredor es retomable, se
vuelve a lanzar y sigue donde estaba.

- [ ] **Step 2: Las del modelo chico**

```bash
npm run medir movimiento -- --base
npm run medir extraccion -- --base
npm run medir clasificacion -- --base
npm run medir zombies -- --base
npm run medir adjunto_trozo -- --base
```

- [ ] **Step 3: Anotar los hallazgos, no ajustar los jueces para que den verde**

Si un prompt falla su propia vara, **eso es el hallazgo** y va anotado en
el plan y en AGENTS.md. Es la misma regla que el banco del recepcionista
tiene escrita: *"`espera` es lo que está DOCUMENTADO, no lo que da hoy. Si
la primera corrida contradice a un comentario, eso es un hallazgo y se
anota; no se ajusta el banco para que dé verde"*.

- [ ] **Step 4: Commit de las líneas base**

```bash
git add docs/dev/lineas-base
git commit -m "La linea base de las once familias medidas contra Groq"
```

---

# Etapa D — Dictar el subconjunto de proyectos

### Task 11: El parser, puro

**Files:**
- Create: `src/lib/agentes/subconjunto.ts`
- Create: `tests/subconjunto.test.mts`

- [ ] **Step 1: Escribir el test primero, con los casos que importan**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { partirSubconjunto } from "../src/lib/agentes/subconjunto.ts";

// Los tres proyectos reales, porque los nombres con artículo y con "de"
// adentro son justo los que rompieron cosas antes ("El Prode de Beno").
const PROYECTOS = [
  { id: "p1", nombre: "El Prode de Beno", slug: "el-prode-de-beno" },
  { id: "p2", nombre: "Gentius", slug: "gentius" },
  { id: "p3", nombre: "Proder", slug: "proder" },
];

test("parte la cola y devuelve los ids", () => {
  const r = partirSubconjunto(
    "hosting compartido entre Proder y Gentius",
    PROYECTOS,
  );
  assert.equal(r.texto, "hosting");
  assert.deepEqual(r.ids, ["p3", "p2"]);
});

test("tres proyectos, con coma y con y", () => {
  const r = partirSubconjunto(
    "hosting compartido entre Proder, Gentius y El Prode de Beno",
    PROYECTOS,
  );
  assert.equal(r.texto, "hosting");
  assert.deepEqual(r.ids, ["p3", "p2", "p1"]);
});

test("un nombre con 'de' adentro no se parte por el 'y' del medio", () => {
  const r = partirSubconjunto(
    "hosting repartido entre El Prode de Beno y Proder",
    PROYECTOS,
  );
  assert.deepEqual(r.ids, ["p1", "p3"]);
});

test("si un nombre no existe, NO SE TOCA NADA", () => {
  const frase = "hosting compartido entre Proder y Voltio";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("con un solo proyecto no se activa: eso ya es project_id", () => {
  const frase = "hosting compartido entre Proder";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("los falsos positivos de 'entre' quedan intactos", () => {
  for (const frase of [
    "gasto entre semana",
    "la diferencia entre lo que cobré y lo que pagué",
    "hosting",
    "reunión entre las dos oficinas",
  ]) {
    const r = partirSubconjunto(frase, PROYECTOS);
    assert.equal(r.texto, frase, `tocó "${frase}"`);
    assert.deepEqual(r.ids, []);
  }
});
```

- [ ] **Step 2: Correr y ver el rojo**

Run: `npx tsx --test tests/subconjunto.test.mts`
Expected: FAIL, "Cannot find module .../subconjunto.ts".

- [ ] **Step 3: Implementar**

```ts
/**
 * Parte la cola `"… compartido entre A y B"` de un movimiento dictado.
 *
 * ## Por qué esto es código y no una línea en el prompt
 *
 * §9: *si algo se puede resolver sin modelo, se resuelve sin modelo*. Una
 * preposición fija y dos nombres que se buscan en tres filas es el caso
 * más claro que hay. Y el prompt del recepcionista es de vidrio —cuatro
 * incidentes medidos— así que la alternativa costaba medir el piso antes
 * y después, once minutos cada vez, para algo que resuelve una regex.
 *
 * ⚠ **Esto NO es un tercer atajo de `atajo.ts`**, aunque se parezca. Un
 * atajo decide **el destino** sin llamar al modelo, y §9 dice que hay dos
 * y no se agregan más. Esto no decide ningún destino: parte un argumento,
 * como `partirArgumento()` y `textoDelMovimiento()`.
 *
 * ## La condición que hace segura la regla
 *
 * **Si no resuelven TODOS los nombres, no se toca nada**: ni el texto ni
 * los ids. Un `"gasto entre semana"` sale igual que entró. El peor caso
 * de un error acá es que la feature no se active — nunca una descripción
 * rota ni un gasto repartido entre proyectos que Beno no nombró. Es la
 * misma asimetría con la que se eligió `esAmbigua()`.
 *
 * Y **mínimo dos**, igual que el formulario y el schema: "compartido
 * entre X" con uno solo es "es de X", y eso ya se escribe con
 * `project_id`. Dos formas de guardar lo mismo es la que después contesta
 * distinto según por dónde la leas.
 */
interface ProyectoNombrado {
  id: string;
  nombre: string;
}

export interface Subconjunto {
  /** El texto sin la cola. Igual al de entrada si no se activó. */
  texto: string;
  /** Los ids en el orden en que los nombró. Vacío si no se activó. */
  ids: string[];
}

/**
 * `compartido|repartido|dividido entre …` al final del texto.
 *
 * El participio es obligatorio: sin él, `"entre"` matchea demasiadas
 * frases normales ("la diferencia entre lo que cobré y lo que pagué") y
 * cada falso positivo sería una descripción recortada.
 */
const COLA = /\s*[,;]?\s*\b(?:compartido|repartido|dividido)s?\s+entre\s+(.+)$/i;

export function partirSubconjunto(
  texto: string,
  proyectos: readonly ProyectoNombrado[],
): Subconjunto {
  const sinCambios: Subconjunto = { texto, ids: [] };

  const m = texto.match(COLA);
  if (!m) return sinCambios;

  const ids = resolverLista(m[1]!, proyectos);
  if (ids === null || ids.length < 2) return sinCambios;

  return { texto: texto.slice(0, m.index!).trim(), ids };
}

/**
 * Parte la lista y resuelve cada nombre. `null` si alguno no existe.
 *
 * ⚠ El corte por `" y "` se hace **después** de intentar el nombre
 * completo, porque hay nombres con `y` o con `de` adentro. Con el corte
 * primero, `"El Prode de Beno y Proder"` funcionaba pero un proyecto
 * llamado `"Ventas y Marketing"` se habría partido al medio.
 */
function resolverLista(
  lista: string,
  proyectos: readonly ProyectoNombrado[],
): string[] | null {
  const nombres = partirNombres(lista, proyectos);
  if (nombres === null) return null;

  const ids: string[] = [];
  for (const nombre of nombres) {
    const p = proyectos.find(
      (p) => normalizar(p.nombre) === normalizar(nombre),
    );
    if (!p) return null;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

/**
 * Devuelve los tramos de la lista. Prueba primero el string entero contra
 * los nombres conocidos, y solo si no es uno de ellos corta por `,` y por
 * `" y "`.
 */
function partirNombres(
  lista: string,
  proyectos: readonly ProyectoNombrado[],
): string[] | null {
  const conocido = (s: string) =>
    proyectos.some((p) => normalizar(p.nombre) === normalizar(s));

  const tramos: string[] = [];
  for (const porComa of lista.split(/\s*[,;]\s*/)) {
    if (conocido(porComa)) {
      tramos.push(porComa);
      continue;
    }
    // Cortar por " y " probando de derecha a izquierda: el último tramo
    // es el que suele traer el conector.
    const partido = partirPorY(porComa, conocido);
    if (partido === null) return null;
    tramos.push(...partido);
  }
  return tramos.length > 0 ? tramos : null;
}

function partirPorY(
  texto: string,
  conocido: (s: string) => boolean,
): string[] | null {
  const separadores = [...texto.matchAll(/\s+y\s+/gi)];
  for (const sep of separadores) {
    const izquierda = texto.slice(0, sep.index!).trim();
    const derecha = texto.slice(sep.index! + sep[0].length).trim();
    if (conocido(izquierda) && conocido(derecha)) return [izquierda, derecha];
    if (conocido(izquierda)) {
      const resto = partirPorY(derecha, conocido);
      if (resto) return [izquierda, ...resto];
    }
  }
  return null;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Verde**

Run: `npx tsx --test tests/subconjunto.test.mts`
Expected: 6 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentes/subconjunto.ts tests/subconjunto.test.mts
git commit -m "Un parser para el compartido entre dos o mas proyectos"
```

---

### Task 12: La caja lo dicta

**Files:**
- Modify: `src/lib/agentes/tipos.ts:434-461`
- Modify: `src/lib/agentes/despacho.ts:465-647`
- Modify: `src/components/movimientos/movement-form.tsx:180-213`

- [ ] **Step 1: `PrecargaMovimiento` gana el campo**

```ts
  /** `null` es compartido, igual que en `movements`. */
  projectId: string | null;
  /**
   * Los proyectos que Beno nombró explícitamente para repartir este
   * compartido. Vacío es el default de siempre: los que estaban vivos en
   * la fecha del gasto.
   *
   * Solo puede venir con `projectId: null`: un movimiento imputado a un
   * proyecto no tiene subconjunto, y la base lo garantiza con un trigger.
   */
  proyectosExplicitos?: string[];
```

- [ ] **Step 2: `despacho.ts` — partir ANTES de leer**

En el `case "movimientos"`, después de `textoDelMovimiento(...)` y **antes
de** `leerMovimiento(texto, hoy)`. Los proyectos ya se leen más abajo en
esa misma rama; hay que **subir esa lectura** por encima del parseo:

```ts
      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");
      const todosLosProyectos = proyectos ?? [];

      /*
        ⚠ **Se parte antes de `leerMovimiento()`, y el orden es el punto.**
        Medido el 2026-08-13: con la cola adentro, `leerTelegrafico()`
        devuelve `descripcion: "hosting compartido entre Proder y
        Gentius"`. Esa descripción es la que alimenta
        `descripcion_normalizada` y con ella toda la sugerencia por
        histórico (regla 6.c), así que dictar el reparto ensuciaría para
        siempre la clasificación de ese gasto.
      */
      const conSubconjunto = partirSubconjunto(texto, todosLosProyectos);
      const leido = await leerMovimiento(conSubconjunto.texto, hoy);
```

De ahí para abajo, en la misma rama:

- La resolución de proyecto por nombre usa `conSubconjunto.texto`, no
  `texto`: si no, `"Proder"` de la cola haría que el gasto se impute a
  Proder en vez de repartirse.
- **La pregunta de proyecto no se hace** si `conSubconjunto.ids.length > 0`:
  ya está contestada, y con más precisión que la pregunta.
- `procedencia.proyecto` pasa a decir
  `` `compartido entre ${nombres.join(", ")} — lo dijiste en la frase` ``.
- La `precarga` lleva `projectId: null` y
  `proyectosExplicitos: conSubconjunto.ids`.
- El `cuerpo` de la respuesta nombra los proyectos: **mover el reparto
  mueve balances**, así que la respuesta dice qué va a pasar y no "listo".

- [ ] **Step 3: El formulario precarga los tildes**

`movement-form.tsx`, en `defaultValues`:

```ts
      proyectos_explicitos: [
        ...(movimiento?.proyectos_explicitos ?? precarga?.proyectosExplicitos ?? []),
      ],
```

⚠ El orden importa: `movimiento` primero. Editar algo guardado nunca puede
tomar el subconjunto de una precarga.

- [ ] **Step 4: Verificar corriendo el camino real**

```bash
npm run build && npm run start
```

Con la sesión de admin armada (ver `balance-proyectos-testing`), pegarle a
`/api/agentes/interpretar` con:

1. `-15000 hosting compartido entre Proder y Gentius`
   Expected: `clase: "movimiento"`, `precarga.descripcion === "hosting"`,
   `precarga.projectId === null`, `precarga.proyectosExplicitos` con los
   dos ids, y el cuerpo nombrando los dos proyectos.
2. `-15000 hosting`
   Expected: **igual que hoy** — pregunta de qué proyecto es.
3. `pagué 15 lucas de hosting, compartido entre Proder y Gentius`
   Expected: lo mismo que 1, pasando por el modelo para la descripción.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentes src/components/movimientos/movement-form.tsx
git commit -m "La caja entiende compartido entre dos o mas proyectos"
```

---

### Task 13: El conector lo dicta

**Files:**
- Modify: `src/lib/mcp/tools/movimientos.ts:219-257,339-358,366-386`
- Modify: `src/lib/actions/inbox.ts:385-396,466-475,507-524`
- Modify: `src/components/bandeja/bandeja-view.tsx` (la tarjeta del movimiento)

- [ ] **Step 1: El parámetro de la tool**

```ts
        compartido_entre: z
          .array(z.string())
          .min(2, "Con un solo proyecto usá `proyecto`, no esto.")
          .max(20)
          .optional()
          .describe(
            "Slugs de los proyectos entre los que se reparte este gasto, " +
              'cuando Beno los nombra ("compartido entre Proder y Gentius"). ' +
              "Mínimo dos, y excluyente con `proyecto`. Si no los nombró, " +
              "no lo mandes: el gasto se reparte solo entre los proyectos " +
              "que estaban abiertos en su fecha, que es el default.",
          ),
```

- [ ] **Step 2: Resolverlos, y rechazar sin proponer nada si alguno no existe**

Mismo criterio que ya tiene `proyecto`: *"un movimiento imputado al
proyecto equivocado es más difícil de detectar que uno que no se cargó"*.
Si `compartido_entre` viene junto con `proyecto`, se rechaza con el porqué
—la base lo prohíbe con un trigger, así que aceptarlo sería proponer algo
que va a fallar al aceptarse—.

- [ ] **Step 3: El payload y el schema de la bandeja**

En `payloadMovimientoSchema`:

```ts
  compartido_entre: z.array(uuid).min(2).optional(),
```

- [ ] **Step 4: Insertar al aceptar**

En `aceptarMovimientoDictado()`, después del `insert` de `movements` y con
el mismo criterio que `guardarSubconjunto()`: si falla, el movimiento ya
existe y queda repartido por ventana de fecha, que es el default correcto,
y el error se devuelve igual para que no pase inadvertido.

⚠ Solo si `projectId === null`. Con proyecto imputado, el trigger de la
base rechaza la fila.

- [ ] **Step 5: La tarjeta lo muestra**

Los nombres de los proyectos, no los ids. **Aceptar un reparto que no se
ve no es aceptar**, y es la mitad del sentido de la regla 6.

- [ ] **Step 6: Verificar corriendo**

Montar el handler del conector sin OAuth (como en el plan de pruebas del
2026-08-11) y:

1. `registrar_movimiento` con `compartido_entre: ["proder", "gentius"]`
   Expected: propuesta en la bandeja, respuesta nombrando los dos.
2. Con `compartido_entre: ["proder"]` → rechazo con el porqué.
3. Con `compartido_entre` **y** `proyecto` → rechazo con el porqué.
4. Aceptar la del punto 1 y verificar en la base: 1 fila en `movements`
   con `project_id null` y **2 filas** en `movement_projects`.
5. Borrar lo sembrado.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp src/lib/actions/inbox.ts src/components/bandeja
git commit -m "El conector propone un compartido entre proyectos elegidos"
```

---

### Task 14: Verificación combinada

- [ ] **Step 1: El trío, entero**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: todo verde. ⚠ **Bajar el `next dev` antes del build**: comparten
`.next` y se pisan.

- [ ] **Step 2: El invariante del prorrateo, con subconjunto puesto**

Correr el chequeo que ya se usó el 2026-08-12: `suma(balance de cada
proyecto) === balance general`, en ARS y en USD, con el movimiento nuevo
que tiene subconjunto y sin él.

Expected: cierra exacto. Balance general de referencia: **$302.411** (más
lo que sume el movimiento de prueba, que después se borra).

- [ ] **Step 3: Dejar la base como estaba**

Borrar el movimiento de prueba y sus filas de `movement_projects`;
verificar que `quotes` sigue en 0 y que no quedan pendientes en `inbox`.

---

### Task 15: La documentación al día

**Files:**
- Modify: `AGENTS.md` (§2.b, §9, §6.d, y la sección nueva del arnés)
- Modify: `docs/dev/manual-agentico.md` (las filas de las cuatro etapas)
- Modify: `docs/README.md` (los dos comandos nuevos)
- Modify: `docs/registro-correcciones.md` (las cuatro derivas encontradas)
- Modify: las memorias de `pepe-donde-quedamos` y `pepe-agentes`

- [ ] **Step 1: AGENTS.md**

- §2.b: dictar el subconjunto ya se puede, por la caja y por el conector, y
  **el prompt no se tocó**; el porqué (es léxico) y la condición de
  seguridad (si no resuelven todos, no se toca nada).
- §9: `subconjunto.ts` en la tabla de archivos, y la aclaración de que **no
  es un tercer atajo**.
- Una sección nueva para el arnés: las 13 familias, los jueces, qué cuesta
  medir cada clase, y la regla de que un prompt nuevo sin familia rompe
  `npm test`.
- El linter de deriva y el hook, con la regla de qué se lintea y qué no.

- [ ] **Step 2: Correr el linter sobre lo que se acaba de escribir**

Run: `npm run verificar:doc`
Expected: "Sin deriva." Si algo quedó en rojo, **arreglar la doc**, que es
justo para lo que se construyó.

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit -m "Toda la documentacion al dia con las cuatro redes"
```

---

## Lo que este plan NO hace

- No toca el prompt del recepcionista, así que **no hay que correr
  `medir:recepcionista` antes y después**. Se corre una vez al final como
  control, no como criterio.
- No agrega atajos a `atajo.ts`: siguen siendo dos.
- No unifica `medir` con `medir:recepcionista`.
- No cambia `calcularParticipaciones()` ni el algoritmo de reparto, ni la
  diferencia de centavos conocida entre las dos pantallas.
- No habilita la etapa 6 de presupuestos ni calibra las horas de
  estimación.
