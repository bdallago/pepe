/**
 * El reporte de deriva documental, con archivo:línea.
 *
 *   npm run verificar:doc
 *
 * Lo mismo que chequea `tests/deriva.test.mts`, pero imprimiendo los
 * hechos medidos para poder mirarlos. **Cero tokens, ~1 segundo.**
 *
 * Es `.mts` y no `.ts` por lo mismo que `medir-recepcionista.mts`:
 * `package.json` no tiene `"type": "module"`, así que un `.ts` lo
 * transforma esbuild a CJS y el top-level await de los imports dinámicos
 * falla con *"Top-level await is currently not supported with the cjs
 * output format"*.
 *
 * Y se corre con `--conditions=react-server` porque `banco.ts` cuelga de
 * módulos que Next resuelve por condición.
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

console.log("Hechos medidos desde el código:\n");
for (const [clave, valor] of Object.entries(hechos)) {
  console.log(`  ${clave.padEnd(26)} ${valor}`);
}

console.log(
  `\n${AFIRMACIONES.length} afirmaciones chequeadas en ${docs.size} ` +
    `documento(s) vivo(s): ${[...docs.keys()].join(", ")}\n`,
);

if (desvios.length === 0) {
  console.log("Sin deriva.");
  process.exit(0);
}

console.log(`${desvios.length} desvío(s):\n`);
for (const d of desvios) console.log(`  - ${describir(d)}\n`);
process.exit(1);
