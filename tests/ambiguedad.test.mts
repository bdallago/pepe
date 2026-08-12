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
