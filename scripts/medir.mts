/**
 * Mide una familia de prompt contra su banco.
 *
 *   npm run medir -- --lista            # qué familias hay y qué cuestan
 *   npm run medir retro                 # las 3 corridas de cada caso
 *   npm run medir retro -- --base       # además, reescribe la línea base
 *
 * ⚠ **Una familia por vez, a propósito.** Un `--todo` que dispare las trece
 * se come el techo diario del razonador (200 000 tokens) y deja la app sin
 * retro, sin sugerencias y sin presupuestos por el resto del día. El costo
 * estimado se imprime antes de empezar.
 *
 * ## Las tres propiedades que se copian de `medir-recepcionista.mts`
 *
 * 1. **`.mts` y `cargarEnvLocal()` antes de cualquier import.** Un `.ts` lo
 *    transforma esbuild a CJS y el top-level await falla; y un `import`
 *    estático se hoistea por encima de la carga del `.env.local`, así que
 *    `GROQ_API_KEY` no estaría cuando se lee.
 * 2. **Retomable, persistiendo llamada a llamada.** Si no, "retomable"
 *    sería mentira: una corrida cortada volvería a pagar lo que ya midió.
 * 3. **Tres corridas por caso.** El modelo no es determinístico ni con
 *    `temperatura: 0` —está medido con `"agreguemos lecciones"`— así que una
 *    corrida no distingue "lo arreglé" de "salió bien esta vez".
 *
 * ## Y la que NO se copia
 *
 * Acá **oscilar no es fallar por sí solo**, al revés que en el
 * recepcionista. Allá la salida es un destino de una lista cerrada y dos
 * corridas distintas son una contradicción; acá es texto redactado, que no
 * va a ser idéntico nunca. Lo que se compara entre corridas es **el
 * conjunto de problemas**: si una corrida trae un problema que otra no, eso
 * sí es inestabilidad y se marca.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { cargarEnvLocal } from "./env-local.ts";

const RAIZ = resolve(import.meta.dirname, "..");
cargarEnvLocal(RAIZ);

const { FAMILIAS, familiaPorId } = await import("../src/lib/arnes/registro.ts");
const { completarJSON, ErrorLLM } = await import("../src/lib/llm.ts");

type Familia = (typeof FAMILIAS)[number];
// El mismo patrón que usa `medir-recepcionista.mts`: el import dinámico no
// deja escribir el tipo, así que se lo trae con `import(...)` en posición de
// tipo.
type CasoDeArnes = import("../src/lib/arnes/registro.ts").CasoDeArnes;

const CORRIDAS = 3;
const DIR_ESTADO = resolve(RAIZ, ".medidas");
const DIR_BASE = resolve(RAIZ, "docs/dev/lineas-base");

const argumentos = process.argv.slice(2);
const guardarBase = argumentos.includes("--base");
const soloLista = argumentos.includes("--lista");
const id = argumentos.find((a) => !a.startsWith("--"));

/**
 * Lo que se guarda de cada corrida: **la salida cruda, no el veredicto.**
 *
 * ⚠ Y eso es lo que hace que refinar un juez no cueste una sola llamada.
 * El juicio se calcula al reportar, así que volver a correr `npm run medir`
 * después de tocar `jueces.ts` **no dispara nada**: las tres corridas ya
 * están guardadas y se vuelven a juzgar gratis. Salió del primer hallazgo
 * real del arnés (2026-08-13), donde lo que había que arreglar era el juez
 * y no el prompt.
 */
interface Corrida {
  salida?: unknown;
  error?: string;
}

type Estado = Record<string, Corrida[]>;

/* ── El listado, que no gasta nada ──────────────────────────── */

function costoEstimado(f: Familia): string {
  const llamadas = f.casos.length * CORRIDAS;
  return `${String(llamadas).padStart(2)} llamadas · ${f.clase}`;
}

if (soloLista || !id) {
  console.log(
    `\n${FAMILIAS.length} familias. Cada una son ${CORRIDAS} corridas por caso.\n`,
  );
  console.log(
    "id".padEnd(20) + "casos".padEnd(8) + "costo".padEnd(26) + "archivo",
  );
  console.log("─".repeat(92));

  for (const f of FAMILIAS) {
    console.log(
      f.id.padEnd(20) +
        String(f.casos.length).padEnd(8) +
        costoEstimado(f).padEnd(26) +
        f.archivo,
    );
  }

  console.log("─".repeat(92));
  console.log(
    "\nEl razonador entra ~1 llamada por minuto (reserva ~5000 tokens contra\n" +
      "un techo de 7300) y tiene techo DIARIO de 200 000. El chico entra de a\n" +
      "dos o tres. Medí de a una familia: las seis del razonador juntas son\n" +
      "~20 minutos de reloj y la mitad del cupo del día.\n",
  );
  if (!id) {
    console.log("Uso: npm run medir <id> [-- --base]\n");
    process.exit(soloLista ? 0 : 1);
  }
  process.exit(0);
}

/* ── La corrida ─────────────────────────────────────────────── */

const familia = familiaPorId(id);
if (!familia) {
  console.error(
    `No existe la familia "${id}". Corré \`npm run medir -- --lista\`.`,
  );
  process.exit(1);
}

const prompt = await familia.cargar();

mkdirSync(DIR_ESTADO, { recursive: true });
const archivoEstado = resolve(DIR_ESTADO, `arnes-${familia.id}.json`);

const estado: Estado = existsSync(archivoEstado)
  ? (JSON.parse(readFileSync(archivoEstado, "utf8")) as Estado)
  : {};

const yaHechos = familia.casos.filter(
  (c) => (estado[c.nombre]?.length ?? 0) >= CORRIDAS,
).length;

console.log(
  `\n${familia.id} — ${familia.casos.length} caso(s) x ${CORRIDAS} corridas ` +
    `= ${familia.casos.length * CORRIDAS} llamadas a ${prompt.modelo}.`,
);
if (yaHechos > 0) console.log(`Retomando: ${yaHechos} caso(s) ya medido(s).`);
console.log(`Prompt: ${prompt.sistema.length} caracteres.\n`);

for (const [i, caso] of familia.casos.entries()) {
  const hechas = estado[caso.nombre] ?? [];
  if (hechas.length >= CORRIDAS) continue;

  for (let n = hechas.length; n < CORRIDAS; n++) {
    process.stdout.write(
      `[${i + 1}/${familia.casos.length}] corrida ${n + 1}/${CORRIDAS}  ${caso.nombre.slice(0, 44)}… `,
    );

    try {
      const { datos, uso } = await completarJSON({
        ...prompt,
        usuario: caso.usuario,
        ...(caso.imagenes ? { imagenes: caso.imagenes } : {}),
      });

      const problemas = caso.juzgar(datos, caso.usuario);
      hechas.push({ salida: datos });

      process.stdout.write(
        problemas.length === 0
          ? `ok (${uso.tokensEntrada}+${uso.tokensSalida} tok, ${uso.latenciaMs} ms)\n`
          : `${problemas.length} problema(s)\n`,
      );
    } catch (error) {
      const mensaje =
        error instanceof ErrorLLM
          ? `${error.tipo}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      hechas.push({ error: mensaje });
      process.stdout.write(`ERROR ${mensaje.slice(0, 60)}\n`);
    }

    // Llamada a llamada, o "retomable" sería mentira.
    estado[caso.nombre] = hechas;
    writeFileSync(archivoEstado, JSON.stringify(estado, null, 2), "utf8");
  }
}

/* ── El veredicto ───────────────────────────────────────────── */

interface Veredicto {
  caso: string;
  ok: boolean;
  /** Un problema que apareció en algunas corridas y no en todas. */
  inestable: string[];
  /** Los que aparecieron en TODAS. */
  siempre: string[];
  errores: string[];
}

function juzgarCaso(caso: CasoDeArnes, corridas: Corrida[]): Veredicto {
  const nombre = caso.nombre;
  const errores = corridas
    .map((c) => c.error)
    .filter((e): e is string => e !== undefined);

  // El juicio se calcula ACÁ y no al guardar: ver el comentario de
  // `Corrida`. Refinar un juez no cuesta una llamada.
  const conjuntos = corridas
    .filter((c) => c.error === undefined)
    .map((c) => new Set(caso.juzgar(c.salida, caso.usuario)));

  const todos = new Set(conjuntos.flatMap((s) => [...s]));
  const siempre = [...todos].filter((p) => conjuntos.every((s) => s.has(p)));
  const inestable = [...todos].filter((p) => !conjuntos.every((s) => s.has(p)));

  return {
    caso: nombre,
    ok: todos.size === 0 && errores.length === 0,
    inestable,
    siempre,
    errores,
  };
}

const veredictos = familia.casos.map((c) => juzgarCaso(c, estado[c.nombre] ?? []));
const fallados = veredictos.filter((v) => !v.ok);

console.log("\n" + "═".repeat(78));
console.log("caso".padEnd(52) + "problemas".padEnd(14) + "ok");
console.log("─".repeat(78));

for (const v of veredictos) {
  const cuenta = `${v.siempre.length} fijo(s)${v.inestable.length > 0 ? ` +${v.inestable.length}?` : ""}`;
  console.log(
    v.caso.slice(0, 50).padEnd(52) +
      cuenta.padEnd(14) +
      (v.ok ? "✓" : v.errores.length > 0 ? "✗ ERROR" : "✗"),
  );
}

console.log("─".repeat(78));
console.log(`${veredictos.length - fallados.length}/${veredictos.length} en verde`);

if (fallados.length > 0) {
  console.log("\nLo que falló:\n");
  for (const v of fallados) {
    console.log(`  ${v.caso}`);
    for (const p of v.siempre) console.log(`    - ${p}`);
    for (const p of v.inestable) console.log(`    ~ (no en todas) ${p}`);
    for (const e of v.errores) console.log(`    ! ${e}`);
    console.log();
  }
  console.log(
    "⚠ Si un prompt falla su propia vara, eso es el hallazgo: se anota, no\n" +
      "  se afloja el juez para que dé verde.\n",
  );
}

if (guardarBase) {
  mkdirSync(DIR_BASE, { recursive: true });
  const archivo = resolve(DIR_BASE, `${familia.id}.json`);
  writeFileSync(
    archivo,
    JSON.stringify(
      {
        familia: familia.id,
        archivo: familia.archivo,
        modelo: prompt.modelo,
        promptChars: prompt.sistema.length,
        fecha: new Date().toISOString(),
        corridas: CORRIDAS,
        veredictos,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Línea base escrita en docs/dev/lineas-base/${familia.id}.json`);
}

process.exit(fallados.length > 0 ? 1 : 0);
