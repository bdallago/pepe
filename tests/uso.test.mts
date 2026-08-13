import { test } from "node:test";
import assert from "node:assert/strict";

import { acotar, registrarUso } from "../src/lib/uso.ts";

/**
 * `acotar()` es lo único de `lib/uso.ts` que se puede probar sin base: la
 * escritura de la fila es un `insert` y su garantía —que nunca lance— se
 * verifica corriendo la app, no acá.
 *
 * Lo que se protege es que **el log siga siendo legible**. Las dos cosas
 * que pueden ser enormes son un data URI de una captura (megabytes de
 * base64) y el texto de un PDF, y ninguna aporta al mirar la cola.
 */

test("un string largo se recorta y dice cuánto medía", () => {
  const largo = "a".repeat(9000);
  const salida = acotar(largo) as string;

  assert.ok(salida.length < 4200, `quedó en ${salida.length}`);
  assert.match(salida, /\[recortado, 9000 chars\]$/);
});

test("un string corto queda idéntico", () => {
  assert.equal(acotar("hosting compartido"), "hosting compartido");
});

/**
 * El recorte es recursivo y no un `JSON.stringify().slice()` justamente
 * por esto: lo que sirve para entender una respuesta es **la forma** —qué
 * campos vinieron y cuáles quedaron vacíos—, y un JSON cortado al medio no
 * se puede ni parsear.
 */
test("conserva la forma: recorta adentro y no el documento entero", () => {
  const entrada = {
    frase: "mirá esto",
    adjuntos: [{ nombre: "captura.png", dataUri: "data:image/png;base64," + "A".repeat(9000) }],
    decisiones: null,
  };

  const salida = acotar(entrada) as {
    frase: string;
    adjuntos: { nombre: string; dataUri: string }[];
    decisiones: null;
  };

  assert.equal(salida.frase, "mirá esto");
  assert.equal(salida.adjuntos[0]!.nombre, "captura.png");
  assert.ok(salida.adjuntos[0]!.dataUri.includes("[recortado"));
  assert.equal(salida.decisiones, null, "un null tiene que seguir siendo null");
});

test("una estructura muy profunda no cuelga el registro", () => {
  // Esto corre en el camino de una respuesta de Beno: preferimos perder
  // detalle antes que demorarla.
  let anidado: unknown = "fondo";
  for (let i = 0; i < 40; i++) anidado = { adentro: anidado };

  const salida = JSON.stringify(acotar(anidado));
  assert.ok(salida.includes('"[…]"'), salida.slice(0, 120));
});

test("una lista enorme se corta en 50", () => {
  const salida = acotar(Array.from({ length: 500 }, (_, i) => i)) as number[];
  assert.equal(salida.length, 50);
});

test("los números, booleanos y nulls pasan tal cual", () => {
  assert.deepEqual(acotar({ monto: 15000, ok: true, fecha: null }), {
    monto: 15000,
    ok: true,
    fecha: null,
  });
});

/* ── La garantía que hace todo lo demás seguro ──────────────── */

/**
 * ⚠ **Estos dos tests son el corazón del módulo.** Toda la app llama a
 * `registrarUso()` en el camino de una respuesta de Beno: si pudiera
 * lanzar, un log caído se llevaría puesta la respuesta, que es exactamente
 * lo que prohíbe la regla 7. Se prueban con un cliente falso porque el
 * caso que importa es el que no se puede provocar a mano contra una base
 * que anda.
 */
const clienteQueRevienta = {
  from() {
    throw new Error("la base está caída");
  },
} as unknown as Parameters<typeof registrarUso>[0];

const clienteQueDevuelveError = {
  from: () => ({
    insert: async () => ({ error: { message: 'relation "agent_log" does not exist' } }),
  }),
} as unknown as Parameters<typeof registrarUso>[0];

const pedido = {
  superficie: "caja" as const,
  pedido: "cómo viene Proder",
  entrada: { frase: "cómo viene Proder" },
};

test("si el cliente lanza, registrarUso NO lanza", async () => {
  await assert.doesNotReject(() =>
    registrarUso(clienteQueRevienta, "un-user-id", pedido),
  );
});

test("si la tabla no existe todavía, registrarUso NO lanza", async () => {
  // Es el caso real de una migración sin aplicar: la app tiene que andar
  // igual, con el error en la consola y nada más.
  await assert.doesNotReject(() =>
    registrarUso(clienteQueDevuelveError, "un-user-id", pedido),
  );
});

test("un pedido vacío no tira la fila: la base lo pide not null", async () => {
  let guardado: Record<string, unknown> | undefined;
  const cliente = {
    from: () => ({
      insert: async (fila: Record<string, unknown>) => {
        guardado = fila;
        return { error: null };
      },
    }),
  } as unknown as Parameters<typeof registrarUso>[0];

  await registrarUso(cliente, "un-user-id", { ...pedido, pedido: "   " });
  assert.equal(guardado?.pedido, "(sin texto)");
});
