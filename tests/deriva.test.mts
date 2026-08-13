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

test("un número cambiado en el código se detecta", () => {
  const hechos = { ...medirHechos(RAIZ), destinos: 99 };
  const desvios = verificar(AFIRMACIONES, hechos, docs());
  assert.equal(desvios.length, 1);
  assert.equal(desvios[0]!.clase, "numero-viejo");
  assert.equal(desvios[0]!.deberiaDecir, 99);
});

/**
 * El test que protege la propiedad más importante del diseño: un chequeo
 * que deja de encontrar su línea no se puede apagar en silencio.
 */
test("una frase borrada se detecta, que es el punto de todo esto", () => {
  const rotos = docs();
  rotos.set("AGENTS.md", "un AGENTS.md que no dice nada de eso");

  const desvios = verificar(AFIRMACIONES, medirHechos(RAIZ), rotos);
  const deAgents = desvios.filter((d) => d.doc === "AGENTS.md");

  assert.equal(
    deAgents.length,
    AFIRMACIONES.filter((a) => a.doc === "AGENTS.md").length,
  );
  assert.ok(deAgents.every((d) => d.clase === "sin-match"));
});

test("cada afirmación captura un número en el grupo 1", () => {
  for (const a of AFIRMACIONES) {
    assert.ok(
      a.patron.source.includes("("),
      `${a.doc}: el patrón no tiene grupo de captura`,
    );
    assert.ok(a.porque.length > 20, `${a.doc}: falta el porqué`);
  }
});
