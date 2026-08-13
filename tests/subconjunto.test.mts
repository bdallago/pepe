import { test } from "node:test";
import assert from "node:assert/strict";

import { partirSubconjunto } from "../src/lib/agentes/subconjunto.ts";

/**
 * Los tres proyectos reales de la base, porque los nombres con artículo y
 * con "de" adentro son justo los que rompieron cosas antes: `"El Prode de
 * Beno"` es uno de los dos proyectos del fallo que originó la salvaguarda
 * de bitácora, y `"Prode"` es subcadena de `"Proder"`.
 */
const PROYECTOS = [
  { id: "p1", nombre: "El Prode de Beno", slug: "el-prode-de-beno" },
  { id: "p2", nombre: "Gentius", slug: "gentius" },
  { id: "p3", nombre: "Proder", slug: "proder" },
];

test("parte la cola y devuelve los ids en el orden en que se nombraron", () => {
  const r = partirSubconjunto(
    "hosting compartido entre Proder y Gentius",
    PROYECTOS,
  );
  assert.equal(r.texto, "hosting");
  assert.deepEqual(r.ids, ["p3", "p2"]);
});

test("tres proyectos, con coma y con y", () => {
  const r = partirSubconjunto(
    "hosting compartido entre Proder, Gentius y El Prode de Beno",
    PROYECTOS,
  );
  assert.equal(r.texto, "hosting");
  assert.deepEqual(r.ids, ["p3", "p2", "p1"]);
});

test("un nombre con 'de' adentro no se parte por el 'y' del final", () => {
  const r = partirSubconjunto(
    "hosting repartido entre El Prode de Beno y Proder",
    PROYECTOS,
  );
  assert.equal(r.texto, "hosting");
  assert.deepEqual(r.ids, ["p1", "p3"]);
});

test("los tres participios andan, y el texto queda limpio", () => {
  for (const participio of ["compartido", "repartido", "dividido"]) {
    const r = partirSubconjunto(
      `Vercel Pro - Agosto ${participio} entre Proder y Gentius`,
      PROYECTOS,
    );
    assert.equal(r.texto, "Vercel Pro - Agosto", participio);
    assert.deepEqual(r.ids, ["p3", "p2"], participio);
  }
});

test("la coma antes del participio también se come", () => {
  const r = partirSubconjunto(
    "el hosting, compartido entre Proder y Gentius",
    PROYECTOS,
  );
  assert.equal(r.texto, "el hosting");
  assert.deepEqual(r.ids, ["p3", "p2"]);
});

/* ── Lo que NO tiene que activarse ──────────────────────────── */

test("si un nombre no existe, NO SE TOCA NADA", () => {
  const frase = "hosting compartido entre Proder y Voltio";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase, "el texto tiene que volver intacto");
  assert.deepEqual(r.ids, []);
});

test("con un solo proyecto no se activa: eso ya es project_id", () => {
  const frase = "hosting compartido entre Proder";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("un nombre ambiguo no activa nada", () => {
  // "Prode" es subcadena de "El Prode de Beno" **y** de "Proder": con dos
  // candidatos no se elige, se deja todo como estaba.
  const frase = "hosting compartido entre Prode y Gentius";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("los falsos positivos de 'entre' quedan intactos", () => {
  for (const frase of [
    "gasto entre semana",
    "la diferencia entre lo que cobré y lo que pagué",
    "hosting",
    "reunión entre las dos oficinas",
    "traslado entre Proder y Gentius",
    "-15000 hosting",
    "",
  ]) {
    const r = partirSubconjunto(frase, PROYECTOS);
    assert.equal(r.texto, frase, `tocó "${frase}"`);
    assert.deepEqual(r.ids, [], `resolvió algo en "${frase}"`);
  }
});

test("sin proyectos cargados no se activa nunca", () => {
  const frase = "hosting compartido entre Proder y Gentius";
  const r = partirSubconjunto(frase, []);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("el mismo proyecto nombrado dos veces no cuenta doble", () => {
  // Con "Proder y Proder" quedaría un solo id, y con uno solo no se activa.
  const frase = "hosting compartido entre Proder y proder";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

/* ── Cómo se escribe de verdad ──────────────────────────────── */

test("resuelve por slug y por nombre corto, sin tildes ni mayúsculas", () => {
  assert.deepEqual(
    partirSubconjunto("hosting compartido entre proder y GENTIUS", PROYECTOS).ids,
    ["p3", "p2"],
  );
  assert.deepEqual(
    partirSubconjunto(
      "hosting compartido entre el-prode-de-beno y gentius",
      PROYECTOS,
    ).ids,
    ["p1", "p2"],
  );
  assert.deepEqual(
    partirSubconjunto("hosting compartido entre El Prode y Gentius", PROYECTOS)
      .ids,
    ["p1", "p2"],
    "el nombre corto tiene que andar: es como se lo nombra hablando",
  );
});

/**
 * Las cinco frases telegráficas reales de Beno tienen la fecha al final, así
 * que la cola bien puede quedar después. Sin el rescate, el último tramo
 * sería `"Gentius 13/08"`, no resolvería y —por la condición de todo o
 * nada— no se activaría nada: el reparto se perdería **y** la fecha se
 * quedaría adentro de la descripción.
 */
test("la fecha colgada del último proyecto se rescata", () => {
  const r = partirSubconjunto(
    "-15000 hosting compartido entre Proder y Gentius 13/08",
    PROYECTOS,
  );
  assert.equal(r.texto, "-15000 hosting 13/08");
  assert.deepEqual(r.ids, ["p3", "p2"]);
});

test("la fecha rescatada anda con las tres formas de escribirla", () => {
  for (const fecha of ["6/8", "06/08", "06/08/26", "06/08/2026"]) {
    const r = partirSubconjunto(
      `-20usd Claude Code compartido entre Proder y Gentius ${fecha}`,
      PROYECTOS,
    );
    assert.equal(r.texto, `-20usd Claude Code ${fecha}`, fecha);
    assert.deepEqual(r.ids, ["p3", "p2"], fecha);
  }
});

test("sin fecha rescatable, un nombre que no resuelve sigue sin activar nada", () => {
  const frase = "-15000 hosting compartido entre Proder y Gentius ayer";
  const r = partirSubconjunto(frase, PROYECTOS);
  assert.equal(r.texto, frase);
  assert.deepEqual(r.ids, []);
});

test("una frase telegráfica entera, que es el caso real", () => {
  const r = partirSubconjunto(
    "-15000 hosting compartido entre Proder y Gentius",
    PROYECTOS,
  );
  assert.equal(
    r.texto,
    "-15000 hosting",
    "tiene que seguir siendo telegráfica para que la lea el regex",
  );
  assert.deepEqual(r.ids, ["p3", "p2"]);
});
