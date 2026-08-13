import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { BANCO, casosDelPiso } from "@/lib/agentes/banco";
import { DESTINOS } from "@/lib/agentes/tipos";

/**
 * Los números que viven en el código y que la documentación repite.
 *
 * ## Por qué existe
 *
 * Cuatro veces la documentación afirmó algo que el código ya no decía: el
 * techo de 30 pedidos/minuto de Groq negado durante **dos días**, los
 * adjuntos que supuestamente no se respaldaban durante uno, tres números
 * viejos en el plan de pruebas publicado, y el costo de medir el
 * recepcionista. Y escribiendo el spec del 2026-08-13 aparecieron cuatro
 * más: 15 módulos `server-only` donde decía 11, 13 prompts donde decía
 * 11, `VERSION_RESPALDO` en 4 donde lo último escrito era 3, y el `~32
 * min` del corredor.
 *
 * Nadie miente: **el código cambia y la prosa se queda.** El patrón es
 * siempre el mismo, un número que vive en dos lados.
 *
 * ## Los tres límites del alcance, que son lo que lo hace útil
 *
 * ⚠ **Solo entran números DERIVABLES del código.** Un tiempo de reloj
 * medido contra Groq no sale de ningún archivo, así que chequearlo sería
 * comparar una prosa contra otra prosa vieja. Por eso el `~50 min` del
 * corpus completo no está acá (y por eso el comentario que lo escribe
 * aclara que es un cronómetro y no una cuenta).
 *
 * ⚠ **Los techos de Groq de §6.b tampoco.** Los de la tabla son de la
 * documentación de Groq; los de `TOKENS_POR_MINUTO` son nuestro margen.
 * Son dos cosas distintas, no una deriva.
 *
 * ⚠ **Y no entra lo que solo crece sin que su obsolescencia cause una
 * acción equivocada.** La cantidad de tests es el ejemplo: que la doc diga
 * 30 cuando hay 34 no le hace tomar a nadie una decisión mala, y
 * lintearlo obligaría a editar prosa en cada commit que agregue un test.
 * El lugar natural de ese número es la salida de `npm test`.
 */
export interface Hechos {
  /** `DESTINOS.length`. */
  destinos: number;
  /** `BANCO.length` y `casosDelPiso().length`. */
  frasesBanco: number;
  frasesPiso: number;
  /** `server.registerTool(` en `lib/mcp/tools/`, y el reparto por anotación. */
  toolsConector: number;
  toolsQueLeen: number;
  toolsQueProponen: number;
  toolsQueEscribenDirecto: number;
  /**
   * Archivos de `src/lib/*.ts` con `import "server-only"`.
   *
   * Es el número que decide qué puede importar el MCP —que no corre dentro
   * de Next—, así que una doc vieja acá termina en un import que revienta
   * en runtime. Es el glob de AGENTS.md §8, sin `**`: el número que
   * documenta es el de la raíz de `lib/`.
   */
  modulosServerOnly: number;
  /** Constantes de prompt de sistema, y llamadas a `completarJSON`. */
  promptsDeSistema: number;
  callSitesLLM: number;
  /** Valores de los enums de la bandeja, leídos de los tipos generados. */
  tiposBandeja: number;
  estadosBandeja: number;
  versionRespaldo: number;
  umbralConfianza: number;
  techoAmbigua: number;
}

function leer(raiz: string, ruta: string): string {
  return readFileSync(resolve(raiz, ruta), "utf8");
}

/**
 * Los `.ts` de un directorio.
 *
 * A mano y no con `globSync`: existe en Node 24 pero **no está en los
 * tipos de `@types/node` que tiene el proyecto**, así que `npm run
 * typecheck` lo rechaza aunque corra. Bajar una API real a una recursión
 * de seis líneas cuesta menos que subir una dependencia de tipos.
 */
function archivosTs(
  raiz: string,
  subdir: string,
  recursivo: boolean,
): string[] {
  const encontrados: string[] = [];

  for (const entrada of readdirSync(resolve(raiz, subdir), {
    withFileTypes: true,
  })) {
    const ruta = join(subdir, entrada.name);
    if (entrada.isDirectory()) {
      if (recursivo) encontrados.push(...archivosTs(raiz, ruta, true));
    } else if (entrada.name.endsWith(".ts")) {
      encontrados.push(ruta);
    }
  }

  return encontrados;
}

/** Cuántas veces matchea `patron` en todos esos archivos. */
function contar(archivos: string[], raiz: string, patron: RegExp): number {
  let total = 0;
  for (const ruta of archivos) {
    total += (leer(raiz, ruta).match(patron) ?? []).length;
  }
  return total;
}

/** En cuántos ARCHIVOS matchea `patron`, que no es lo mismo que arriba. */
function contarArchivos(
  archivos: string[],
  raiz: string,
  patron: RegExp,
): number {
  return archivos.filter((ruta) => patron.test(leer(raiz, ruta))).length;
}

/**
 * Cuántos valores tiene un enum de `database.types.ts`.
 *
 * Se cuentan las comillas y se divide por dos en vez de contar los `|`:
 * el primer valor puede venir en la misma línea que el nombre del enum o
 * en la siguiente según cómo lo formatee el generador, y las comillas no
 * dependen de eso.
 */
function valoresDeEnum(tipos: string, nombre: string): number {
  const bloque = tipos.match(
    new RegExp(`${nombre}:\\s*((?:\\s*\\|\\s*"[^"]+")+)`),
  );
  if (!bloque) throw new Error(`No encontré el enum ${nombre}.`);
  return (bloque[1]!.match(/"/g) ?? []).length / 2;
}

/** Un número escrito en el código, por su nombre de constante. */
function constante(fuente: string, nombre: string): number {
  const m = fuente.match(
    new RegExp(`${nombre}\\s*(?::\\s*[\\w<>.[\\]]+)?\\s*=\\s*([\\d._]+)`),
  );
  if (!m) throw new Error(`No encontré la constante ${nombre}.`);
  return Number(m[1]!.replaceAll("_", ""));
}

export function medirHechos(raiz: string): Hechos {
  const tipos = leer(raiz, "src/lib/supabase/database.types.ts");
  const tools = archivosTs(raiz, "src/lib/mcp/tools", false);
  const raizDeLib = archivosTs(raiz, "src/lib", false);
  const todoLib = archivosTs(raiz, "src/lib", true);

  return {
    destinos: DESTINOS.length,
    frasesBanco: BANCO.length,
    frasesPiso: casosDelPiso().length,

    toolsConector: contar(tools, raiz, /server\.registerTool\(/g),
    toolsQueLeen: contar(tools, raiz, /annotations: SOLO_LECTURA/g),
    toolsQueProponen: contar(tools, raiz, /annotations: PROPONE/g),
    toolsQueEscribenDirecto: contar(tools, raiz, /annotations: ESCRIBE/g),

    modulosServerOnly: contarArchivos(
      raizDeLib,
      raiz,
      /^import "server-only"/m,
    ),

    promptsDeSistema: contar(
      todoLib,
      raiz,
      /^const (?:SISTEMA|PROMPT)\w*\s*=/gm,
    ),
    callSitesLLM: contar(todoLib, raiz, /await completarJSON[<(]/g),

    tiposBandeja: valoresDeEnum(tipos, "tipo_bandeja"),
    estadosBandeja: valoresDeEnum(tipos, "estado_bandeja"),

    versionRespaldo: constante(
      leer(raiz, "src/lib/respaldo.ts"),
      "VERSION_RESPALDO",
    ),
    umbralConfianza: constante(
      leer(raiz, "src/lib/agentes/tipos.ts"),
      "UMBRAL_CONFIANZA",
    ),
    techoAmbigua: constante(
      leer(raiz, "src/lib/agentes/ambiguedad.ts"),
      "TECHO_AMBIGUA",
    ),
  };
}
