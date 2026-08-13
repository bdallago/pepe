import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estaContenido,
  numerosSinRespaldo,
  pareceRotulo,
  tonoDeAsistente,
} from "../src/lib/arnes/jueces.ts";

/**
 * ⚠ **Ninguno de estos casos se inventó.** Los rótulos son los que
 * devolvieron modelos de verdad y los que AGENTS.md nombra como
 * contraejemplos; las afirmaciones son las que la doc pone como vara
 * cumplida. Si un juez falla contra uno de estos, **el juez está mal**.
 */

// Los tres que devolvió llama-3.3-70b el 2026-08-08 con el prompt de 6.3,
// más los dos que la regla de la retro nombra como no-lecciones, más el
// que devolvió el razonador con temperatura alta.
const ROTULOS = [
  "Establecer límites de soporte",
  "Priorizar la documentación",
  "Revisar contratos",
  "Invertir en herramientas de calidad",
  "Diversificar los ingresos",
  "Es importante evaluar el gasto en herramientas",
  "Optimizar la infraestructura",
];

// Las que la doc pone como ejemplo de vara cumplida.
const AFIRMACIONES = [
  "El 70 % de la facturación proviene de dos clientes",
  "El 80% de la facturación en dos clientes te deja sin margen para decir que no",
  "Subcontratar el parser salió más caro que escribirlo",
  "Cobrar por cada versión mayor evita que el cliente exija cambios sin fin",
  "Invertir 3 meses en el importador costó más que el importador",
  "Diversificar te habría costado el cliente de Proder",
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

test("un infinitivo con un dato adentro NO es rótulo", () => {
  // La condición doble es lo que evita el falso positivo obvio.
  assert.ok(pareceRotulo("Documentar los procesos"));
  assert.ok(!pareceRotulo("Documentar el importador ahorró 12 horas"));
});

test("un número que no estaba en la entrada es una invención", () => {
  const entrada = "Movimientos: -150000 ARS hosting; +469472 ARS venta.";

  assert.deepEqual(
    numerosSinRespaldo("Gastaste 150.000 en hosting.", entrada),
    [],
    "el separador de miles no puede contar como número distinto",
  );
  assert.deepEqual(
    numerosSinRespaldo("El plazo previsto era de 90 días.", entrada),
    ["90"],
  );
  assert.deepEqual(
    numerosSinRespaldo("Cerró con 469.472 de ingresos y 1250 de comisión.", entrada),
    ["1250"],
  );
});

test("los años y los números chicos no cuentan como invención", () => {
  assert.deepEqual(
    numerosSinRespaldo("En 2026 hubo 3 clientes y 40 facturas.", "sin números"),
    [],
    "contar lo que se le dio no es inventar",
  );
});

/**
 * La excepción del piso de dos cifras, que sale del fallo medido: la
 * primera corrida de la retro inventó un "plazo previsto" y `"90 días"` se
 * colaba por debajo.
 */
test("una duración inventada se detecta aunque tenga dos cifras", () => {
  const entrada = "Movimientos: -150000 ARS hosting el 2026-03-04.";

  assert.deepEqual(numerosSinRespaldo("Se atrasó 90 días.", entrada), ["90"]);
  assert.deepEqual(numerosSinRespaldo("Llevó 6 semanas de más.", entrada), ["6"]);
  assert.deepEqual(
    numerosSinRespaldo("El hosting costó 150.000.", entrada),
    [],
    "un monto que sí está en la entrada no se toca",
  );
});

test("estaContenido ignora tildes, mayúsculas y espacios de más", () => {
  const frase = "cobré 50000 por la Venta Proder a cliente nuevo";

  assert.ok(estaContenido("Venta Proder a cliente nuevo", frase));
  // Un recorte SÍ está contenido: este juez detecta lo inventado, no lo
  // recortado. Lo recortado lo detecta el banco, comparando contra lo que
  // espera. La distinción importa para no pedirle a este juez lo que no
  // puede dar.
  assert.ok(estaContenido("Venta", frase));
  assert.ok(estaContenido("claude code", "-20 usd Claude Code 06/08"));
  assert.ok(!estaContenido("Venta Gentius", frase));
});

test("las muletillas de asistente se nombran", () => {
  assert.deepEqual(tonoDeAsistente("El margen se lo comió la subcontratación."), []);
  assert.deepEqual(tonoDeAsistente("¡Claro! Acá va la retro."), [
    "cortesía de chatbot",
  ]);
  assert.ok(tonoDeAsistente("Espero que te sirva 🙂").length === 2);
});
