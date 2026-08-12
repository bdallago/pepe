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

test("el piso son las 11 frases del bloque de regresión", () => {
  assert.equal(casosDelPiso().length, 11);
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
