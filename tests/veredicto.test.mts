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
