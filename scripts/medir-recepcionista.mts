/**
 * Mide el recepcionista contra el banco de frases.
 *
 *   npm run medir:recepcionista            # el piso: 11 frases, ~11 min
 *   npm run medir:recepcionista -- --todo  # completo: 29 frases, ~50 min
 *   npm run medir:recepcionista -- --base  # además, reescribe la línea base
 *
 * ⚠ El `~50` es **medido con cronómetro, no calculado**, y por eso el
 * linter de deriva no lo chequea: 20 de las 29 frases llegan al modelo —a
 * las otras 9 las ataja `atajo.ts`— y a 2 llamadas por minuto la cuenta
 * daría 30. La diferencia es la corrección de la reserva con el `usage`
 * real. Si alguien recalcula y le da 30, el número bueno es el del reloj.
 *
 * ## Por qué tarda tanto, y por qué no se puede apurar
 *
 * Medido el 2026-08-12: el prompt reserva ~2613 tokens por llamada contra
 * un techo de 5500 por minuto del modelo chico, o sea **2 llamadas por
 * minuto**. Del piso de 11 frases, 4 las resuelve `atajo.ts` sin tocar el
 * modelo, así que quedan 7 × 3 = 21 llamadas: unos 11 minutos. No es un
 * bug del script, es el tier gratuito de Groq.
 *
 * Por eso es **retomable**: el estado se persiste frase por frase en
 * `.medidas/`, así que una corrida cortada a los 30 minutos no vuelve a
 * pagar lo que ya midió.
 *
 * Se corre con `--conditions=react-server` porque `recepcionista.ts` es
 * `server-only`. Verificado: sin esa flag el import tira.
 *
 * ⚠ **Es `.mts` y no `.ts`, y no es cosmética.** `package.json` no tiene
 * `"type": "module"`, así que un `.ts` lo transforma esbuild a CJS y los
 * cuatro `await` de arriba fallan con *"Top-level await is currently not
 * supported with the cjs output format"*. Y el `await` de arriba tampoco
 * es cosmético: `cargarEnvLocal()` tiene que correr **antes** de que se
 * importe nada que lea `GROQ_API_KEY`, y un `import` estático se hoistea
 * por encima de cualquier línea de este archivo. Es la misma extensión
 * que ya usa `mcp/servidor.mts` por el mismo motivo.
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
console.log(
  `${veredictos.length - fallados.length}/${veredictos.length} en verde`,
);

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
