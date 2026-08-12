import { test } from "node:test";
import assert from "node:assert/strict";

import { estaVivo } from "../src/lib/prorrateo.ts";

test("el runner ve los módulos de dominio", () => {
  const proyecto = {
    fecha_inicio: "2026-04-01",
    fecha_fin: "2026-07-20",
  } as Parameters<typeof estaVivo>[0];

  assert.equal(estaVivo(proyecto, "2026-04-01"), true, "punta de apertura");
  assert.equal(estaVivo(proyecto, "2026-07-20"), true, "punta de cierre");
  assert.equal(estaVivo(proyecto, "2026-07-21"), false, "un día después");
});
