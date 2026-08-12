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
