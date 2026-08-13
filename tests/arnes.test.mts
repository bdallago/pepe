import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { FAMILIAS, familiaPorId } from "../src/lib/arnes/registro.ts";
import { medirHechos } from "../src/lib/deriva/hechos.ts";

const RAIZ = resolve(import.meta.dirname, "..");

/**
 * ⚠ **Ninguno de estos tests importa un descriptor**, y por eso pueden
 * correr en `npm test` sin `--conditions=react-server`: los trece módulos
 * son `server-only` y el registro los trae con un import dinámico que acá
 * nunca se ejecuta. Que el runner de tests siga sin esa condición es lo
 * que garantiza que los módulos de dominio —los que el MCP tiene que poder
 * importar— no arrastren nada de Next.
 */

/**
 * El test que cierra el círculo: agregar un prompt sin darle familia rompe
 * `npm test`, y el pre-commit no lo deja commitear.
 */
test("hay una familia de arnés por cada prompt de la app", () => {
  const { promptsDeSistema } = medirHechos(RAIZ);
  assert.equal(
    FAMILIAS.length,
    promptsDeSistema,
    "un prompt sin familia es un prompt sin red: agregalo a src/lib/arnes/registro.ts",
  );
});

test("cada familia apunta a un archivo que existe y tiene un SISTEMA", () => {
  for (const f of FAMILIAS) {
    const fuente = readFileSync(resolve(RAIZ, f.archivo), "utf8");
    assert.match(
      fuente,
      /^const SISTEMA\w*\s*=/m,
      `${f.id}: ${f.archivo} no tiene ningún prompt de sistema`,
    );
    assert.ok(
      fuente.includes(`export const ${f.descriptor}`),
      `${f.id}: ${f.archivo} no exporta ${f.descriptor}`,
    );
  }
});

/**
 * La otra mitad de la completitud: que no haya un archivo con prompt que el
 * registro no nombre. El test de arriba cuenta; este dice **cuál** falta,
 * que es la diferencia entre un rojo accionable y un rojo que hay que
 * investigar.
 */
test("no queda ningún archivo con prompt afuera del registro", () => {
  const conPrompt = new Set<string>();

  const recorrer = (subdir: string) => {
    for (const entrada of readdirSync(resolve(RAIZ, subdir), {
      withFileTypes: true,
    })) {
      const ruta = join(subdir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
      } else if (entrada.name.endsWith(".ts")) {
        const fuente = readFileSync(resolve(RAIZ, ruta), "utf8");
        if (/^const SISTEMA\w*\s*=/m.test(fuente)) {
          conPrompt.add(ruta.replaceAll("\\", "/"));
        }
      }
    }
  };
  recorrer("src/lib");

  const enRegistro = new Set(FAMILIAS.map((f) => f.archivo));
  const afuera = [...conPrompt].filter((a) => !enRegistro.has(a));

  assert.deepEqual(afuera, [], `archivos con prompt sin familia: ${afuera.join(", ")}`);
});

test("los ids son únicos y se pueden buscar", () => {
  const ids = FAMILIAS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids repetidos");
  for (const id of ids) {
    assert.ok(familiaPorId(id), `familiaPorId no encuentra "${id}"`);
  }
  assert.equal(familiaPorId("no-existe"), undefined);
});

test("toda familia tiene al menos un caso, y todo caso su juez", () => {
  for (const f of FAMILIAS) {
    assert.ok(f.casos.length > 0, `${f.id} no tiene ningún caso`);
    for (const c of f.casos) {
      assert.ok(c.usuario.length > 0, `${f.id}/${c.nombre}: entrada vacía`);
      assert.equal(typeof c.juzgar, "function", `${f.id}/${c.nombre}: sin juez`);
    }
  }
});

/**
 * Los jueces se prueban con salidas fabricadas a mano: una buena y una con
 * el defecto que ese juez existe para atrapar. Sin esto, un juez que
 * devuelve siempre `[]` pasaría por red toda la vida.
 */
test("el juez de la retro atrapa un plazo inventado", () => {
  const familia = familiaPorId("retro")!;
  const caso = familia.casos[0]!;

  const buena = {
    titulo: "El margen se lo comió la subcontratación",
    que_funciono: "El cliente pagó los dos anticipos sin demora.",
    que_no_funciono: "El parser vino sin soportar el formato real del cliente.",
    costo_real:
      "De 1.615.900 de egresos, 981.400 se fueron en subcontratación: más de la mitad en una sola decisión.",
    conclusion: "Pedir archivos reales antes de encargar el parser.",
    lecciones: [
      {
        titulo: "Dos archivos de muestra no alcanzan para presupuestar un parser",
        contenido: "Pedí los peores archivos que tengan, no los que eligieron mostrar.",
        categoria: "proceso",
      },
    ],
  };

  assert.deepEqual(caso.juzgar(buena, caso.usuario), []);

  const conPlazo = {
    ...buena,
    que_no_funciono: "El plazo previsto era de 90 días y se entregó tarde.",
  };
  const problemas = caso.juzgar(conPlazo, caso.usuario);
  assert.ok(
    problemas.some((p) => p.includes("plazos")),
    `tendría que quejarse del plazo: ${problemas.join(" | ")}`,
  );
  assert.ok(problemas.some((p) => p.includes("90")));
});

test("el juez del extractor se queja si DESCARTA una entrada con idea", () => {
  const familia = familiaPorId("extraccion")!;
  const caso = familia.casos[0]!;

  const problemas = caso.juzgar({ tiene_leccion: false }, caso.usuario);
  assert.ok(
    problemas.some((p) => p.includes("vara es BAJA")),
    "el extractor es el único que falla por descartar de más",
  );

  assert.deepEqual(
    caso.juzgar(
      {
        tiene_leccion: true,
        titulo: "Pedir los peores archivos, no los que eligieron mostrar",
        contenido:
          "El parser andaba con los archivos de prueba y se caía con los del cliente.",
        categoria: "proceso",
      },
      caso.usuario,
    ),
    [],
  );
});

test("el juez del extractor NO aplica la vara de los rótulos", () => {
  // Es la asimetría de §6: acá el modelo transcribe lo que Beno vivió, así
  // que un título "de manual" es válido si eso fue lo que entendió.
  const caso = familiaPorId("extraccion")!.casos[0]!;
  assert.deepEqual(
    caso.juzgar(
      {
        tiene_leccion: true,
        titulo: "Revisar los formatos de entrada antes de encargar",
        contenido: "Lo aprendí peleando con el importador toda la tarde.",
        categoria: "proceso",
      },
      caso.usuario,
    ),
    [],
    "un rótulo NO puede fallar en el extractor",
  );
});

test("el juez de la captura celebra un legible: false", () => {
  const caso = familiaPorId("adjunto_captura")!.casos[0]!;

  assert.deepEqual(
    caso.juzgar(
      { legible: false, de_que_es: "una imagen de un solo píxel", transcripcion: null },
      caso.usuario,
    ),
    [],
  );

  const inventado = caso.juzgar(
    {
      legible: true,
      de_que_es: "una conversación de WhatsApp",
      transcripcion: "Cliente: hola, cómo va",
    },
    caso.usuario,
  );
  assert.equal(inventado.length, 2, inventado.join(" | "));
});

test("el juez del movimiento atrapa la descripción recortada", () => {
  const familia = familiaPorId("movimiento")!;
  const caso = familia.casos.find((c) => c.nombre.includes("Venta Proder"))!;

  assert.deepEqual(
    caso.juzgar(
      {
        monto: 601700,
        moneda: null,
        descripcion: "Venta Proder a cliente nuevo",
        fecha_texto: null,
      },
      caso.usuario,
    ),
    [],
  );

  // El fallo medido: la descripción vuelve recortada. Está CONTENIDA en la
  // frase, así que solo lo atrapa la comparación contra lo esperado.
  const recortada = caso.juzgar(
    { monto: 601700, moneda: null, descripcion: "Venta", fecha_texto: null },
    caso.usuario,
  );
  assert.ok(
    recortada.some((p) => p.includes("en vez de")),
    recortada.join(" | "),
  );
});
