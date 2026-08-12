import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leerEnvLocal } from "../scripts/env-local.ts";

function conArchivo(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pepe-env-"));
  writeFileSync(join(dir, ".env.local"), contenido, "utf8");
  return dir;
}

test("lee pares y saltea comentarios y vacías", () => {
  const dir = conArchivo("# un comentario\nA=1\n\nB=dos\n");
  assert.deepEqual(leerEnvLocal(dir), { A: "1", B: "dos" });
});

test("saca las comillas de los dos tipos", () => {
  const dir = conArchivo(`A="con dobles"\nB='con simples'\n`);
  assert.deepEqual(leerEnvLocal(dir), { A: "con dobles", B: "con simples" });
});

test("respeta los = que vienen dentro del valor", () => {
  const dir = conArchivo("TOKEN=abc=def==\n");
  assert.deepEqual(leerEnvLocal(dir), { TOKEN: "abc=def==" });
});

test("recorta el \\r de un archivo CRLF", () => {
  const dir = conArchivo("A=1\r\nB=2\r\n");
  assert.deepEqual(leerEnvLocal(dir), { A: "1", B: "2" });
});
