# Agentes de Pepe — Ola 1 (recepcionista + seis de solo lectura)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una caja donde Beno escribe en castellano desde el inicio o desde un atajo global, y un recepcionista deriva a seis agentes que son cáscara sobre funciones que ya existen y están probadas.

**Architecture:** Un módulo `lib/agentes/` con el recepcionista (una llamada al modelo chico que devuelve destino + argumento) y un despachador que llama a la función de dominio que ya existe. Un route handler delgado, y un componente `<CajaAgente>` usado en dos superficies. **Ningún agente de esta ola escribe en tablas de dominio por un camino nuevo**: los dos que producen propuestas (lecciones sobre un tema, suscripciones) ya escriben en `inbox`, que es su comportamiento actual.

**Tech Stack:** Next 15.5 App Router, TypeScript, Zod 4, Supabase, Groq vía `lib/llm.ts` (`MODELO_CHICO`), Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-09-agentes-design.md`

---

## Cómo se verifica en este proyecto

⚠ **Leer antes de empezar.** `AGENTS.md` dice: *"No hay suite de tests versionada. Antes de dar algo por terminado, corré `npm run typecheck && npm run lint && npm run build`."* Este plan respeta esa convención en vez de introducir un framework de tests que el proyecto no usa.

Cada tarea se verifica así:

1. Un **script temporal** en `scripts/_verificar-*.mts` que ejerce lo construido contra la base real y **imprime lo que devolvió**.
2. Se corre con `npx tsx`, se lee la salida y se confirma que dice lo que tiene que decir.
3. **Se borra el script** antes de commitear. No queda en el repo.
4. `npm run typecheck && npm run lint`. El `build` se corre una vez al final de cada tarea que toque componentes.

**No corras `npm run build` con un `next dev` vivo**: comparten `.next` y se pisan.

⚠ Los scripts `.mts` y no `.ts`: el `package.json` no declara módulos ES, así que `tsx` trata los `.ts` como CommonJS y ahí no hay `await` de nivel superior. Ya pasó con el MCP.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/agentes/tipos.ts` | Los destinos, el resultado del recepcionista y la unión discriminada de respuestas. Sin lógica. |
| `src/lib/agentes/recepcionista.ts` | Una llamada al modelo: frase → `{destino, argumento, confianza, pregunta, opciones}`. |
| `src/lib/agentes/resolver.ts` | Resuelve un nombre de proyecto a `projectId`, **sin modelo**. |
| `src/lib/agentes/despacho.ts` | Recibe destino + argumento, llama a la función de dominio que ya existe, devuelve una respuesta tipada. |
| `src/app/api/agentes/interpretar/route.ts` | Cáscara: autentica, valida el cuerpo, traduce errores. |
| `src/components/agentes/caja-agente.tsx` | El input, el estado de carga, y el render de cada tipo de respuesta. |
| `src/components/agentes/atajo-global.tsx` | Escucha la tecla, monta la caja en un diálogo. |

**Lo que NO se toca:** `lib/balances.ts`, `lib/prorrateo.ts`, `lib/sugerencias.ts`, `lib/retro.ts`, `lib/generacion.ts`, `lib/zombies.ts`, `lib/clasificacion.ts`. La ola 1 los llama, no los modifica.

---

## Task 1: Tipos compartidos

**Files:**
- Create: `src/lib/agentes/tipos.ts`

- [ ] **Step 1: Escribir el archivo**

```ts
import { z } from "zod";

/**
 * Los destinos posibles del recepcionista.
 *
 * `movimientos` está desde ahora aunque su agente llegue en la ola 2: si
 * no estuviera, "pagué 20 usd de Claude" caería en `desconocido` y el
 * recepcionista quedaría mintiendo sobre lo que la app entiende. Con el
 * destino declarado, el despacho contesta "todavía no, usá el formulario",
 * que es la verdad.
 */
export const DESTINOS = [
  "consultas",
  "buscador",
  "estudio",
  "retro",
  "lecciones_tema",
  "suscripciones",
  "movimientos",
  "desconocido",
] as const;

export type Destino = (typeof DESTINOS)[number];

/** Lo que devuelve el recepcionista. Se valida contra la salida del modelo. */
export const decisionSchema = z.object({
  destino: z.enum(DESTINOS),
  /**
   * El dato concreto sobre el que trabaja el especialista: el nombre del
   * proyecto para una retro, el tema para generar lecciones, la consulta
   * para el buscador. Texto libre a propósito: resolverlo a un id es
   * trabajo determinístico, no del modelo.
   */
  argumento: z.string().trim().max(300).nullable(),
  /** 0 a 1. Por debajo de UMBRAL_CONFIANZA se pregunta en vez de derivar. */
  confianza: z.number().min(0).max(1),
});

export type Decision = z.infer<typeof decisionSchema>;

/** Debajo de esto el recepcionista pregunta en vez de adivinar. */
export const UMBRAL_CONFIANZA = 0.6;

/**
 * Lo que la caja termina mostrando. Unión discriminada para que el
 * componente no tenga que adivinar qué recibió.
 */
export type RespuestaAgente =
  | { clase: "texto"; destino: Destino; titulo: string; cuerpo: string }
  | {
      clase: "lista";
      destino: Destino;
      titulo: string;
      items: { titulo: string; detalle: string }[];
    }
  | {
      clase: "propuestas";
      destino: Destino;
      titulo: string;
      cuantas: number;
      /** Adónde ir a confirmarlas. */
      href: string;
    }
  | {
      clase: "pregunta";
      titulo: string;
      opciones: { etiqueta: string; destino: Destino; argumento: string | null }[];
    }
  | { clase: "aviso"; titulo: string; cuerpo: string };
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: sin salida de error.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agentes/tipos.ts
git commit -m "Tipos compartidos de los agentes"
```

---

## Task 2: Resolver proyectos sin modelo

**Files:**
- Create: `src/lib/agentes/resolver.ts`

Dos de los seis agentes (`retro` y `lecciones_tema`) necesitan un `projectId`. Resolverlo es comparar texto contra una lista corta: no se gasta una llamada al modelo en eso.

- [ ] **Step 1: Escribir el archivo**

```ts
import "server-only";

import type { Project } from "@/lib/supabase/database.types";

/**
 * Encuentra el proyecto que menciona una frase.
 *
 * Determinístico a propósito. El recepcionista devuelve texto libre
 * ("Proder", "el prode"); pasarlo a un id es comparar contra tres filas,
 * y una llamada al modelo para eso sería gastar latencia en algo que un
 * `includes` resuelve mejor.
 *
 * Devuelve `null` si no encontró nada y `"ambiguo"` si más de uno
 * matchea: quien llama pregunta en vez de elegir por su cuenta.
 */
export function resolverProyecto(
  argumento: string | null,
  proyectos: Project[],
): Project | null | "ambiguo" {
  if (!argumento) return null;

  const aguja = normalizar(argumento);
  if (aguja.length === 0) return null;

  const exactos = proyectos.filter(
    (p) => normalizar(p.nombre) === aguja || normalizar(p.slug) === aguja,
  );
  if (exactos.length === 1) return exactos[0]!;
  if (exactos.length > 1) return "ambiguo";

  const parciales = proyectos.filter(
    (p) => normalizar(p.nombre).includes(aguja) || aguja.includes(normalizar(p.nombre)),
  );
  if (parciales.length === 1) return parciales[0]!;
  if (parciales.length > 1) return "ambiguo";

  return null;
}

/** Minúsculas, sin tildes y sin puntuación, para comparar nombres escritos a mano. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 2: Verificar con un script temporal**

Create: `scripts/_verificar-resolver.mts`

```ts
import { resolverProyecto } from "@/lib/agentes/resolver.ts";
import type { Project } from "@/lib/supabase/database.types";

const p = (nombre: string, slug: string) =>
  ({ id: slug, nombre, slug }) as unknown as Project;

const proyectos = [
  p("El Prode de Beno", "el-prode-de-beno"),
  p("Proder", "proder"),
  p("Gentius", "gentius"),
];

const casos: [string | null, string][] = [
  ["Proder", "proder"],
  ["proder", "proder"],
  ["PRODER", "proder"],
  ["Gentius", "gentius"],
  ["gentius", "gentius"],
  ["el prode de beno", "el-prode-de-beno"],
  ["no existe", "null"],
  [null, "null"],
  ["", "null"],
];

let fallos = 0;
for (const [entrada, esperado] of casos) {
  const r = resolverProyecto(entrada, proyectos);
  const obtenido = r === null ? "null" : r === "ambiguo" ? "ambiguo" : r.slug;
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok  " : "MAL "} ${JSON.stringify(entrada).padEnd(20)} -> ${obtenido} (esperaba ${esperado})`,
  );
}
console.log(`\nfallos: ${fallos}`);
```

Run: `npx tsx scripts/_verificar-resolver.mts`
Expected: nueve líneas que empiezan con `ok` y `fallos: 0`.

⚠ Ojo con `"Proder"`: matchea parcialmente contra `"El Prode de Beno"` por el prefijo "prode". El match exacto se prueba primero justamente por eso, y por eso el caso está en la lista. **Si esa línea da `ambiguo`, el orden exacto-antes-que-parcial se rompió.**

- [ ] **Step 3: Borrar el script y commitear**

```bash
rm scripts/_verificar-resolver.mts
npm run typecheck && npm run lint
git add src/lib/agentes/resolver.ts
git commit -m "Resolver proyectos por nombre, sin gastar una llamada al modelo"
```

---

## Task 3: El recepcionista

**Files:**
- Create: `src/lib/agentes/recepcionista.ts`

- [ ] **Step 1: Escribir el archivo**

```ts
import "server-only";

import { completarJSON, MODELO_CHICO } from "@/lib/llm";
import { decisionSchema, type Decision } from "@/lib/agentes/tipos";

/**
 * Decide a qué especialista va una frase.
 *
 * Usa `MODELO_CHICO`: es una clasificación entre ocho opciones con salida
 * de decenas de tokens. Pagar razonamiento acá sería tirar latencia.
 *
 * No decide nada más. El especialista hace su trabajo, y resolver el
 * argumento a un id es determinístico (`resolver.ts`).
 */

const SISTEMA = `Sos el recepcionista de Pepe, la app personal de Beno.
Tu único trabajo es decidir a qué especialista mandar cada frase.

Los especialistas:

- "movimientos": anotar plata que entró o salió. Ej: "pagué 20 usd de
  Claude Code", "cobré 200 mil de Proder", "me salió 15 lucas el hosting".
- "consultas": preguntas sobre plata ya cargada. Ej: "cómo viene Proder",
  "cuánto gasté en herramientas este año", "cuál es mi balance".
- "buscador": buscar algo que ya está escrito, lecciones o bitácora. Ej:
  "tenía algo sobre backlogs", "qué había anotado de clientes".
- "estudio": qué estudiar o cómo viene el temario. Ej: "qué me toca hoy",
  "cómo voy con el track de PM", "qué estudio ahora".
- "retro": cerrar un proyecto y hacer su retrospectiva. Ej: "cerrá Proder",
  "hacé la retro de Gentius".
- "lecciones_tema": sacar lecciones sobre un tema. Ej: "sacá lecciones de
  lo que aprendí con clientes", "qué aprendí sobre pricing".
- "suscripciones": gastos recurrentes que quizá no usa. Ej: "qué estoy
  pagando que no uso", "revisá mis suscripciones".
- "desconocido": no encaja en ninguno.

En "argumento" poné el dato concreto sobre el que trabaja el especialista:
el nombre del proyecto para "retro", el tema para "lecciones_tema", lo que
busca para "buscador". Si el especialista no necesita ninguno, poné null.
NO reformules ni traduzcas el argumento: copialo como lo escribió Beno.

En "confianza" poné qué tan seguro estás, de 0 a 1. Si la frase podría ir
a dos especialistas distintos, poné menos de 0.6 y elegí el más probable.
Una frase que es solo el nombre de algo, sin verbo ("Claude Code"), es
ambigua: puede ser anotar un gasto o buscarlo.

Respondé SOLO un objeto JSON con las claves: destino, argumento, confianza.`;

export async function decidirDestino(frase: string): Promise<Decision> {
  const { datos } = await completarJSON({
    modelo: MODELO_CHICO,
    sistema: SISTEMA,
    usuario: frase,
    esquema: decisionSchema,
    // Consistencia, no creatividad: la misma frase tiene que ir siempre
    // al mismo lado.
    temperatura: 0,
    maxTokens: 120,
    etiqueta: "recepcionista",
  });

  return datos;
}
```

- [ ] **Step 2: Verificar contra el modelo real**

Create: `scripts/_verificar-recepcionista.mts`

```ts
process.loadEnvFile(".env.local");

const { decidirDestino } = await import("@/lib/agentes/recepcionista.ts");

const casos: [string, string][] = [
  ["pagué 20 usd de Claude Code", "movimientos"],
  ["cobré 200 mil de Proder", "movimientos"],
  ["cómo viene Proder", "consultas"],
  ["cuánto gasté en herramientas este año", "consultas"],
  ["tenía algo sobre backlogs", "buscador"],
  ["qué me toca hoy", "estudio"],
  ["cerrá Proder", "retro"],
  ["sacá lecciones de lo que aprendí con clientes", "lecciones_tema"],
  ["qué estoy pagando que no uso", "suscripciones"],
  ["hola qué tal", "desconocido"],
];

let fallos = 0;
for (const [frase, esperado] of casos) {
  const d = await decidirDestino(frase);
  const ok = d.destino === esperado;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok  " : "MAL "} ${frase.padEnd(45)} -> ${d.destino.padEnd(15)} conf=${d.confianza} arg=${JSON.stringify(d.argumento)}`,
  );
}

console.log(`\nfallos: ${fallos} de ${casos.length}`);

console.log("\n--- ambiguas (esperamos confianza < 0.6):");
for (const frase of ["Claude Code", "Proder"]) {
  const d = await decidirDestino(frase);
  console.log(`  ${frase.padEnd(15)} -> ${d.destino} conf=${d.confianza}`);
}
```

Run: `npx tsx scripts/_verificar-recepcionista.mts`

Expected: `fallos: 0 de 10`, y las dos frases ambiguas con `conf` menor a 0.6.

**Si falla alguna, no toques el código: ajustá el prompt** agregando el caso que falló a los ejemplos del especialista correcto, y volvé a correr. Es la calibración de la que habla `AGENTS.md`; ninguna función de modelo del proyecto salió bien de primera.

**Si "Claude Code" vuelve con confianza alta**, el recepcionista no está detectando ambigüedad y va a derivar mal en silencio. Reforzá el último párrafo del prompt antes de seguir.

- [ ] **Step 3: Borrar el script y commitear**

```bash
rm scripts/_verificar-recepcionista.mts
npm run typecheck && npm run lint
git add src/lib/agentes/recepcionista.ts
git commit -m "Recepcionista: decide a que especialista va cada frase"
```

---

## Task 4: Despacho — los tres que no necesitan argumento

**Files:**
- Create: `src/lib/agentes/despacho.ts`

Empieza por `estudio`, `suscripciones` y `movimientos` (este último devuelve el aviso de "todavía no"). Son los que no requieren resolver nada.

- [ ] **Step 1: Escribir el archivo**

```ts
import "server-only";

import { sugerirQueEstudiar } from "@/lib/sugerencias";
import { escanearZombies } from "@/lib/zombies";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Decision, RespuestaAgente } from "@/lib/agentes/tipos";

/**
 * Llama al especialista que corresponde y arma la respuesta para pantalla.
 *
 * Cada rama es una cáscara sobre una función de dominio que ya existe y
 * ya está probada. **No metas reglas de negocio acá**: si necesitás una,
 * va en el módulo de `lib/` que ya la tiene.
 */
export async function despachar(
  supabase: SupabaseClient,
  userId: string,
  decision: Decision,
): Promise<RespuestaAgente> {
  switch (decision.destino) {
    case "estudio": {
      const sugerencias = await sugerirQueEstudiar(supabase);

      if (sugerencias.length === 0) {
        return {
          clase: "aviso",
          titulo: "Todavía no puedo sugerirte nada",
          cuerpo:
            "Hace falta algo de temario cargado para tener contra qué anclar una sugerencia.",
        };
      }

      return {
        clase: "lista",
        destino: "estudio",
        titulo: "Esto es lo que te sugiero",
        items: sugerencias.map((s) => ({
          titulo: s.titulo,
          detalle: s.motivo,
        })),
      };
    }

    case "suscripciones": {
      const reporte = await escanearZombies(supabase, userId);

      if (reporte.propuestos === 0) {
        return {
          clase: "aviso",
          titulo: "No encontré suscripciones sin uso",
          cuerpo:
            reporte.detectados > 0
              ? "Las que detecté ya las habías resuelto antes."
              : "Todo lo que pagás seguido tiene actividad reciente.",
        };
      }

      return {
        clase: "propuestas",
        destino: "suscripciones",
        titulo: "Encontré suscripciones que quizá no estés usando",
        cuantas: reporte.propuestos,
        href: "/bandeja",
      };
    }

    case "movimientos":
      return {
        clase: "aviso",
        titulo: "Todavía no puedo cargar gastos desde acá",
        cuerpo:
          "Entendí que querés anotar plata, pero ese agente todavía no está. Cargalo desde Movimientos.",
      };

    default:
      return {
        clase: "aviso",
        titulo: "No entendí qué necesitás",
        cuerpo:
          "Probá con algo como “cómo viene Proder”, “qué me toca hoy” o “qué estoy pagando que no uso”.",
      };
  }
}
```

⚠ `sugerirQueEstudiar` devuelve `Sugerencia[]`. Antes de escribir el `.map`, abrí `src/lib/sugerencias.ts` y confirmá los nombres de los campos (`titulo`, `motivo`): si no coinciden, usá los reales, no inventes un adaptador.

- [ ] **Step 2: Verificar**

Create: `scripts/_verificar-despacho.mts`

```ts
process.loadEnvFile(".env.local");

const { createAdminClient } = await import("@/lib/supabase/server.ts");
const { despachar } = await import("@/lib/agentes/despacho.ts");

const supabase = createAdminClient();
const { data } = await supabase.from("projects").select("user_id").limit(1);
const userId = data![0]!.user_id;

for (const destino of ["estudio", "suscripciones", "movimientos", "desconocido"] as const) {
  const r = await despachar(supabase, userId, {
    destino,
    argumento: null,
    confianza: 1,
  });
  console.log(`\n===== ${destino}`);
  console.log(JSON.stringify(r, null, 2).slice(0, 600));
}
```

Run: `npx tsx scripts/_verificar-despacho.mts`

Expected: cuatro bloques. `estudio` con `clase: "lista"` y sugerencias reales; `suscripciones` con un aviso (hoy no hay candidatos con el umbral por defecto, así que **el aviso es el resultado correcto**, no un fallo); `movimientos` y `desconocido` con sus avisos.

- [ ] **Step 3: Borrar el script y commitear**

```bash
rm scripts/_verificar-despacho.mts
npm run typecheck && npm run lint
git add src/lib/agentes/despacho.ts
git commit -m "Despacho de los agentes que no necesitan argumento"
```

---

## Task 5: Despacho — consultas de plata

**Files:**
- Modify: `src/lib/agentes/despacho.ts`

- [ ] **Step 1: Agregar los imports**

```ts
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
import { resolverProyecto } from "@/lib/agentes/resolver";
```

- [ ] **Step 2: Agregar la rama antes de `default`**

```ts
    case "consultas": {
      const [movimientosRes, proyectosRes, categoriasRes] = await Promise.all([
        supabase.from("movements").select("*").limit(20000),
        supabase.from("projects").select("*").order("nombre"),
        supabase.from("categories").select("*").order("tipo").order("nombre"),
      ]);

      const movimientos = movimientosRes.data ?? [];
      const proyectos = proyectosRes.data ?? [];
      const categorias = categoriasRes.data ?? [];

      // La moneda no la decide el modelo: es la que Beno tiene elegida en
      // la app. Acá se usa ARS y la caja ofrece el link a la pantalla, que
      // sí tiene el conmutador.
      const moneda = "ARS" as const;
      const filtros = { estado: "efectuado" as const };

      const proyecto = resolverProyecto(decision.argumento, proyectos);

      if (proyecto === "ambiguo") {
        return {
          clase: "aviso",
          titulo: "No sé de qué proyecto me hablás",
          cuerpo: `Hay más de uno que coincide con “${decision.argumento}”.`,
        };
      }

      if (proyecto) {
        const b = calcularBalancesProyecto(
          movimientos,
          proyectos,
          categorias,
          proyecto.id,
          moneda,
          filtros,
        );

        return {
          clase: "texto",
          destino: "consultas",
          titulo: proyecto.nombre,
          cuerpo: [
            `Ingresos: ${formatMoney(b.efectuado.ingresos, moneda)}`,
            `Egresos: ${formatMoney(b.efectuado.egresos, moneda)}`,
            `Balance: ${formatMoney(b.efectuado.balance, moneda)}`,
            `Sobre ${b.cantidadMovimientos} movimientos.`,
          ].join("\n"),
        };
      }

      const b = calcularBalances(movimientos, proyectos, categorias, moneda, filtros);

      return {
        clase: "texto",
        destino: "consultas",
        titulo: "Balance general",
        cuerpo: [
          `Ingresos: ${formatMoney(b.efectuado.ingresos, moneda)}`,
          `Egresos: ${formatMoney(b.efectuado.egresos, moneda)}`,
          `Balance: ${formatMoney(b.efectuado.balance, moneda)}`,
          `Sobre ${b.cantidadMovimientos} movimientos.`,
        ].join("\n"),
      };
    }
```

- [ ] **Step 3: Verificar**

Create: `scripts/_verificar-consultas.mts`

```ts
process.loadEnvFile(".env.local");

const { createAdminClient } = await import("@/lib/supabase/server.ts");
const { despachar } = await import("@/lib/agentes/despacho.ts");

const supabase = createAdminClient();
const { data } = await supabase.from("projects").select("user_id").limit(1);
const userId = data![0]!.user_id;

for (const argumento of [null, "Proder", "Gentius", "no existe"]) {
  const r = await despachar(supabase, userId, {
    destino: "consultas",
    argumento,
    confianza: 1,
  });
  console.log(`\n===== argumento: ${JSON.stringify(argumento)}`);
  console.log(r.clase === "texto" ? `${r.titulo}\n${r.cuerpo}` : JSON.stringify(r));
}
```

Run: `npx tsx scripts/_verificar-consultas.mts`

Expected: `null` y `"no existe"` devuelven el balance general (los mismos números); `"Proder"` y `"Gentius"` devuelven el de cada proyecto. **Los números tienen que coincidir con los de la pantalla de Proyectos.** Si no coinciden, revisá que las consultas de proyectos no filtren `archivado_en` y estén ordenadas por nombre, igual que `app/(app)/layout.tsx`.

- [ ] **Step 4: Borrar el script y commitear**

```bash
rm scripts/_verificar-consultas.mts
npm run typecheck && npm run lint
git add src/lib/agentes/despacho.ts
git commit -m "Agente de consultas de plata"
```

---

## Task 6: Despacho — buscador

**Files:**
- Modify: `src/lib/agentes/despacho.ts`

- [ ] **Step 1: Agregar la rama**

```ts
    case "buscador": {
      const consulta = decision.argumento?.trim();

      if (!consulta) {
        return {
          clase: "aviso",
          titulo: "¿Qué querés buscar?",
          cuerpo: "Decime un tema y te busco en las lecciones.",
        };
      }

      // Sin embedding: es el modo que la app declara válido cuando el
      // embedding falla o tarda (regla 7), y con el corpus actual es el
      // que mejor midió. `?? undefined` y no null: omitir el parámetro
      // deja que Postgres aplique su default.
      const { data, error } = await supabase.rpc("buscar_lecciones_hibrido", {
        p_consulta: consulta,
        p_embedding: undefined,
        p_limite: 5,
      });

      if (error) {
        return {
          clase: "aviso",
          titulo: "No pude buscar",
          cuerpo: error.message,
        };
      }

      const resultados = data ?? [];

      if (resultados.length === 0) {
        return {
          clase: "aviso",
          titulo: `No encontré nada sobre “${consulta}”`,
          cuerpo:
            "La búsqueda es por texto, así que si no te acordás de las palabras exactas puede no aparecer.",
        };
      }

      return {
        clase: "lista",
        destino: "buscador",
        titulo: `Encontré ${resultados.length} sobre “${consulta}”`,
        items: resultados.map((r) => ({
          titulo: r.titulo,
          detalle: r.contenido,
        })),
      };
    }
```

- [ ] **Step 2: Verificar**

Create: `scripts/_verificar-buscador.mts`

```ts
process.loadEnvFile(".env.local");

const { createAdminClient } = await import("@/lib/supabase/server.ts");
const { despachar } = await import("@/lib/agentes/despacho.ts");

const supabase = createAdminClient();
const { data } = await supabase.from("projects").select("user_id").limit(1);
const userId = data![0]!.user_id;

for (const argumento of ["sprint", "backlog", "zzzz-no-existe", null]) {
  const r = await despachar(supabase, userId, {
    destino: "buscador",
    argumento,
    confianza: 1,
  });
  console.log(`\n===== ${JSON.stringify(argumento)}  -> ${r.clase}`);
  if (r.clase === "lista") for (const i of r.items) console.log(`  - ${i.titulo}`);
  else console.log(`  ${r.titulo}`);
}
```

Run: `npx tsx scripts/_verificar-buscador.mts`

Expected: `"sprint"` y `"backlog"` devuelven lecciones reales; `"zzzz-no-existe"` y `null` devuelven avisos.

- [ ] **Step 3: Borrar el script y commitear**

```bash
rm scripts/_verificar-buscador.mts
npm run typecheck && npm run lint
git add src/lib/agentes/despacho.ts
git commit -m "Agente buscador de lecciones"
```

---

## Task 7: Despacho — retro y lecciones sobre un tema

**Files:**
- Modify: `src/lib/agentes/despacho.ts`

Los dos necesitan un `projectId` y los dos son caros (usan el razonador). Por eso ninguno corre sin proyecto resuelto.

- [ ] **Step 1: Agregar los imports**

```ts
import { generarLecciones } from "@/lib/generacion";
import { generarRetro } from "@/lib/retro";
```

- [ ] **Step 2: Agregar las dos ramas**

```ts
    case "retro": {
      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const proyecto = resolverProyecto(decision.argumento, proyectos ?? []);

      if (proyecto === "ambiguo" || !proyecto) {
        return {
          clase: "pregunta",
          titulo: "¿De qué proyecto querés la retro?",
          opciones: (proyectos ?? []).map((p) => ({
            etiqueta: p.nombre,
            destino: "retro" as const,
            argumento: p.slug,
          })),
        };
      }

      const resultado = await generarRetro(supabase, userId, proyecto.id);

      return {
        clase: "texto",
        destino: "retro",
        titulo: `Retro de ${proyecto.nombre}`,
        cuerpo: resultado.texto,
      };
    }

    case "lecciones_tema": {
      const tema = decision.argumento?.trim();

      if (!tema) {
        return {
          clase: "aviso",
          titulo: "¿Sobre qué tema?",
          cuerpo: "Decime de qué querés que saque lecciones.",
        };
      }

      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const proyecto = resolverProyecto(decision.argumento, proyectos ?? []);

      if (!proyecto || proyecto === "ambiguo") {
        return {
          clase: "pregunta",
          titulo: `¿De qué proyecto saco lecciones sobre “${tema}”?`,
          opciones: (proyectos ?? []).map((p) => ({
            etiqueta: p.nombre,
            destino: "lecciones_tema" as const,
            argumento: `${tema} — ${p.slug}`,
          })),
        };
      }

      const reporte = await generarLecciones(supabase, userId, {
        tema,
        projectId: proyecto.id,
      });

      if (reporte.propuestas === 0) {
        return {
          clase: "aviso",
          titulo: "No saqué ninguna lección",
          cuerpo: `No encontré material suficiente sobre “${tema}” en ${proyecto.nombre}.`,
        };
      }

      return {
        clase: "propuestas",
        destino: "lecciones_tema",
        titulo: `Dejé ${reporte.propuestas} lecciones esperando`,
        cuantas: reporte.propuestas,
        href: "/bandeja",
      };
    }
```

⚠ Antes de escribir esto, abrí `src/lib/retro.ts` y `src/lib/generacion.ts` y confirmá los nombres de campo de `ResultadoRetro` (`texto`) y `ReporteGeneracion` (`propuestas`). Si difieren, usá los reales.

⚠ La rama de `lecciones_tema` reusa `decision.argumento` para buscar el proyecto **y** como tema. Cuando la pregunta devuelve `"tema — slug"`, el `resolverProyecto` va a matchear por el slug del final. Verificalo en el paso siguiente: es el caso más frágil de esta tarea.

- [ ] **Step 3: Verificar solo los caminos que NO llaman al razonador**

Create: `scripts/_verificar-retro.mts`

```ts
process.loadEnvFile(".env.local");

const { createAdminClient } = await import("@/lib/supabase/server.ts");
const { despachar } = await import("@/lib/agentes/despacho.ts");

const supabase = createAdminClient();
const { data } = await supabase.from("projects").select("user_id").limit(1);
const userId = data![0]!.user_id;

// Sin proyecto resuelto: tiene que preguntar, NO llamar al modelo.
for (const [destino, argumento] of [
  ["retro", null],
  ["retro", "no existe"],
  ["lecciones_tema", null],
  ["lecciones_tema", "clientes"],
] as const) {
  const r = await despachar(supabase, userId, { destino, argumento, confianza: 1 });
  console.log(`\n===== ${destino} ${JSON.stringify(argumento)} -> ${r.clase}`);
  console.log(`  ${r.titulo}`);
  if (r.clase === "pregunta") for (const o of r.opciones) console.log(`    [${o.etiqueta}] arg=${o.argumento}`);
}
```

Run: `npx tsx scripts/_verificar-retro.mts`

Expected: los cuatro devuelven `pregunta` o `aviso` **sin tardar** (si tarda diez segundos, llamó al razonador y no tenía que hacerlo). Las opciones tienen que listar los tres proyectos.

⚠ **No pruebes el camino feliz de la retro en este script.** `generarRetro` escribe en `inbox` las lecciones candidatas, y correrlo por prueba te ensucia la bandeja. Probalo desde la interfaz al final, una vez, y rechazá lo que deje.

- [ ] **Step 4: Borrar el script y commitear**

```bash
rm scripts/_verificar-retro.mts
npm run typecheck && npm run lint
git add src/lib/agentes/despacho.ts
git commit -m "Agentes de retro y de lecciones sobre un tema"
```

---

## Task 8: Route handler

**Files:**
- Create: `src/app/api/agentes/interpretar/route.ts`

- [ ] **Step 1: Escribir el archivo**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { decidirDestino } from "@/lib/agentes/recepcionista";
import { despachar } from "@/lib/agentes/despacho";
import { DESTINOS, UMBRAL_CONFIANZA, type RespuestaAgente } from "@/lib/agentes/tipos";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * La puerta de entrada de los agentes.
 *
 * Cáscara delgada, como el resto de los route handlers: autentica, valida
 * el cuerpo y traduce errores. Toda la decisión vive en `lib/agentes/`.
 */

export const dynamic = "force-dynamic";
// El razonador de la retro es lo más lento que puede pasar por acá.
export const maxDuration = 300;

const cuerpoSchema = z.object({
  frase: z.string().trim().min(1).max(1000),
  /** Cuando Beno elige una opción de una pregunta, ya sabemos el destino. */
  destino: z.enum(DESTINOS).optional(),
  argumento: z.string().max(300).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
  }

  const parseado = cuerpoSchema.safeParse(await request.json().catch(() => null));
  if (!parseado.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const { frase, destino, argumento } = parseado.data;
  const supabase = await createClient();

  // Sin modelo la app sigue entera en modo manual (regla 7). Acá eso
  // significa decirlo y no romper.
  if (!destino && !hayModeloConfigurado()) {
    return NextResponse.json({
      clase: "aviso",
      titulo: "El modelo no está disponible",
      cuerpo: "Podés seguir usando la app normalmente desde el menú.",
    } satisfies RespuestaAgente);
  }

  try {
    // Si viene destino, es porque Beno eligió una opción: no se vuelve a
    // preguntar ni se gasta otra llamada.
    const decision = destino
      ? { destino, argumento: argumento ?? null, confianza: 1 }
      : await decidirDestino(frase);

    if (decision.confianza < UMBRAL_CONFIANZA) {
      return NextResponse.json({
        clase: "pregunta",
        titulo: `No estoy seguro de qué querés hacer con “${frase}”`,
        opciones: [
          { etiqueta: "Anotar un gasto", destino: "movimientos", argumento: frase },
          { etiqueta: "Buscar algo que anoté", destino: "buscador", argumento: frase },
          { etiqueta: "Ver números", destino: "consultas", argumento: frase },
        ],
      } satisfies RespuestaAgente);
    }

    const respuesta = await despachar(supabase, user.id, decision);
    return NextResponse.json(respuesta);
  } catch (error: unknown) {
    console.error("[agentes] falló:", error);
    return NextResponse.json({
      clase: "aviso",
      titulo: "No pude procesar eso",
      cuerpo: mensajeDeErrorLLM(error),
    } satisfies RespuestaAgente);
  }
}
```

⚠ El `catch` devuelve 200 con un aviso, no un 5xx. Es a propósito: un fallo del modelo no puede interrumpir el flujo (regla 7), y la caja tiene que mostrar algo entendible en vez de un error de red.

- [ ] **Step 2: Verificar por HTTP con sesión**

Levantá el dev (`npm run dev`) y armá una sesión siguiendo la receta de `AGENTS.md` (magic link de admin + cookie de `@supabase/ssr` en chunks). Con esa cookie:

```bash
curl -s -X POST http://localhost:3000/api/agentes/interpretar \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"frase":"cómo viene Proder"}' | head -c 600
```

Expected: un JSON con `"clase":"texto"` y el balance de Proder.

Y sin cookie:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/agentes/interpretar \
  -H 'content-type: application/json' -d '{"frase":"hola"}'
```

Expected: `401`.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npm run lint
git add src/app/api/agentes/interpretar/route.ts
git commit -m "Route handler de los agentes"
```

---

## Task 9: El componente `<CajaAgente>`

**Files:**
- Create: `src/components/agentes/caja-agente.tsx`

- [ ] **Step 1: Escribir el componente**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Destino, RespuestaAgente } from "@/lib/agentes/tipos";

/**
 * La caja donde Beno escribe en castellano.
 *
 * Un componente, dos superficies: la pantalla de inicio y el atajo global.
 * El estado vive acá y no en un store: es una interacción de ida y vuelta,
 * no hay nada que compartir entre pantallas.
 */
export function CajaAgente({ onCerrar }: { onCerrar?: () => void }) {
  const [frase, setFrase] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState<RespuestaAgente | null>(null);

  async function enviar(destino?: Destino, argumento?: string | null) {
    const texto = frase.trim();
    if (!texto || cargando) return;

    setCargando(true);
    setRespuesta(null);

    try {
      const r = await fetch("/api/agentes/interpretar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frase: texto, destino, argumento }),
      });
      setRespuesta((await r.json()) as RespuestaAgente);
    } catch {
      setRespuesta({
        clase: "aviso",
        titulo: "No pude conectarme",
        cuerpo: "Probá de nuevo, o usá el menú de arriba.",
      });
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="flex gap-2"
      >
        <Input
          value={frase}
          onChange={(e) => setFrase(e.target.value)}
          placeholder="¿Qué querés hacer?"
          disabled={cargando}
          autoFocus
          aria-label="Pedile algo a Pepe"
        />
        <Button type="submit" disabled={cargando || frase.trim().length === 0}>
          {cargando ? "Pensando…" : "Dale"}
        </Button>
      </form>

      {respuesta && <Respuesta respuesta={respuesta} onElegir={enviar} onCerrar={onCerrar} />}
    </div>
  );
}

/** Cómo se llama cada especialista en pantalla. */
const ETIQUETA_DESTINO: Record<Destino, string> = {
  consultas: "Números",
  buscador: "Buscador",
  estudio: "Estudio",
  retro: "Retro",
  lecciones_tema: "Lecciones",
  suscripciones: "Suscripciones",
  movimientos: "Movimientos",
  desconocido: "—",
};

/**
 * Muestra a qué especialista fue y deja corregirlo.
 *
 * El spec lo pide explícitamente: el recepcionista puede derivar mal, y si
 * la pantalla no dice a dónde te llevó, no hay forma de darse cuenta ni de
 * arreglarlo. Sin esto, una derivación equivocada se ve igual que una
 * respuesta pobre.
 */
function PieDeDestino({
  destino,
  onElegir,
}: {
  destino: Destino;
  onElegir: (destino: Destino, argumento: string | null) => void;
}) {
  const [mostrando, setMostrando] = useState(false);

  const alternativas = (Object.keys(ETIQUETA_DESTINO) as Destino[]).filter(
    (d) => d !== destino && d !== "desconocido",
  );

  return (
    <div className="mt-3 border-t pt-2">
      <p className="text-xs text-muted-foreground">
        → {ETIQUETA_DESTINO[destino]}{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setMostrando((v) => !v)}
        >
          ¿no era esto?
        </button>
      </p>

      {mostrando && (
        <div className="mt-2 flex flex-wrap gap-2">
          {alternativas.map((d) => (
            <Button key={d} size="sm" variant="secondary" onClick={() => onElegir(d, null)}>
              {ETIQUETA_DESTINO[d]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Respuesta({
  respuesta,
  onElegir,
  onCerrar,
}: {
  respuesta: RespuestaAgente;
  onElegir: (destino: Destino, argumento: string | null) => void;
  onCerrar?: () => void;
}) {
  switch (respuesta.clase) {
    case "texto":
      return (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{respuesta.titulo}</h3>
          <pre className="cifra mt-2 whitespace-pre-wrap text-sm">{respuesta.cuerpo}</pre>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "lista":
      return (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{respuesta.titulo}</h3>
          <ul className="mt-2 space-y-3">
            {respuesta.items.map((i, n) => (
              <li key={n}>
                <p className="text-sm font-medium">{i.titulo}</p>
                <p className="text-sm text-muted-foreground">{i.detalle}</p>
              </li>
            ))}
          </ul>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "propuestas":
      return (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{respuesta.titulo}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Nada se guardó todavía: te esperan en la bandeja para que confirmes.
          </p>
          <Button asChild className="mt-3" onClick={onCerrar}>
            <Link href={respuesta.href}>Ver las {respuesta.cuantas} propuestas</Link>
          </Button>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "pregunta":
      return (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{respuesta.titulo}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {respuesta.opciones.map((o, n) => (
              <Button
                key={n}
                variant="secondary"
                onClick={() => onElegir(o.destino, o.argumento)}
              >
                {o.etiqueta}
              </Button>
            ))}
          </div>
        </div>
      );

    case "aviso":
      return (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{respuesta.titulo}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{respuesta.cuerpo}</p>
        </div>
      );
  }
}
```

`@/components/ui/input` y `@/components/ui/dialog` ya existen en el repo; no hace falta instalar nada de shadcn.

- [ ] **Step 2: Verificar en pantalla**

Se verifica montándolo en la Task 10. No commitees este componente suelto sin montarlo: un componente que no renderiza en ningún lado no está verificado.

---

## Task 10: Montar en la pantalla de inicio

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Montar el componente arriba de todo**

```tsx
import { CajaAgente } from "@/components/agentes/caja-agente";

// …dentro del JSX, como primer bloque de la página:
<section className="mb-6">
  <CajaAgente />
</section>
```

- [ ] **Step 2: Verificar en el browser**

Run: `npm run dev` y entrá a la app.

Probá estas cinco y confirmá lo que devuelve cada una:

| Escribís | Tiene que |
|---|---|
| `cómo viene Proder` | mostrar el balance de Proder |
| `qué me toca hoy` | listar sugerencias de estudio |
| `tenía algo sobre backlogs` | listar lecciones |
| `qué estoy pagando que no uso` | avisar que no hay suscripciones sin uso |
| `Claude Code` | **preguntar** con tres botones, no adivinar |

Y probá que los botones de la pregunta funcionen: al tocar uno, tiene que resolver sin volver a preguntar.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npm run lint && npm run build
git add src/components/agentes/caja-agente.tsx "src/app/(app)"
git commit -m "Caja de agentes en la pantalla de inicio"
```

---

## Task 11: Atajo global

**Files:**
- Create: `src/components/agentes/atajo-global.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Escribir el componente**

```tsx
"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CajaAgente } from "@/components/agentes/caja-agente";

/**
 * Abre la caja desde cualquier pantalla con Ctrl/Cmd + K.
 *
 * No invasivo a propósito: no ocupa lugar hasta que lo pedís, `esc` lo
 * cierra y la pantalla de atrás queda visible.
 */
export function AtajoGlobal() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    }

    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>¿Qué querés hacer?</DialogTitle>
        </DialogHeader>
        <CajaAgente onCerrar={() => setAbierto(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Montarlo en el layout**

En `src/app/(app)/layout.tsx`, dentro del JSX que envuelve a `children`:

```tsx
import { AtajoGlobal } from "@/components/agentes/atajo-global";

// …junto al resto del chrome de la app:
<AtajoGlobal />
```

- [ ] **Step 3: Verificar en el browser**

Con el dev corriendo:

1. Andá a **Aprendizaje → Roadmap**. Apretá `Ctrl+K`: se abre la caja sin perder la pantalla de atrás.
2. Escribí `cómo viene Proder` y confirmá que responde.
3. Apretá `esc`: se cierra.
4. Andá a **Bitácora** y repetí. Tiene que funcionar igual.
5. **Con el foco en un campo de texto** (por ejemplo el de cargar una entrada de bitácora), apretá `Ctrl+K`: tiene que abrir igual y no escribir una "k" en el campo.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npm run lint && npm run build
git add src/components/agentes/atajo-global.tsx "src/app/(app)/layout.tsx"
git commit -m "Atajo global para abrir la caja desde cualquier pantalla"
```

---

## Task 12: Calibración con frases reales

**Files:** solo `src/lib/agentes/recepcionista.ts` (el prompt)

Ninguna función de modelo de este proyecto salió bien de primera. Esta tarea es la que convierte "anda" en "sirve".

- [ ] **Step 1: Juntar veinte frases propias**

Pedile a Beno que escriba veinte frases **como las escribiría él**, no como cree que hay que escribirlas. Anotá a qué destino tendría que ir cada una **antes** de probarlas.

- [ ] **Step 2: Correrlas**

Create: `scripts/_calibrar.mts`

```ts
process.loadEnvFile(".env.local");

const { decidirDestino } = await import("@/lib/agentes/recepcionista.ts");
const { UMBRAL_CONFIANZA } = await import("@/lib/agentes/tipos.ts");

/** Reemplazá esto por las veinte frases de Beno y su destino esperado. */
const casos: [string, string][] = [
  ["...", "movimientos"],
];

let aciertos = 0;
let erroresSilenciosos = 0;

for (const [frase, esperado] of casos) {
  const d = await decidirDestino(frase);
  const acerto = d.destino === esperado;
  const pregunta = d.confianza < UMBRAL_CONFIANZA;

  if (acerto) aciertos++;
  else if (!pregunta) erroresSilenciosos++;

  const marca = acerto ? "ok  " : pregunta ? "preg" : "MAL ";
  console.log(
    `${marca} ${frase.padEnd(50)} -> ${d.destino.padEnd(15)} conf=${d.confianza} (esperaba ${esperado})`,
  );
}

console.log(`\naciertos: ${aciertos}/${casos.length}`);
console.log(`errores silenciosos (derivó mal con confianza alta): ${erroresSilenciosos}`);
```

Run: `npx tsx scripts/_calibrar.mts`

- [ ] **Step 3: Corregir el prompt, no el código**

Por cada fallo, agregá la frase como ejemplo al especialista correcto en `SISTEMA`. Volvé a correr. Repetí hasta que no haya fallos o hasta que un fallo sea genuinamente ambiguo — en ese caso lo correcto es que baje la confianza y pregunte, no que acierte.

**Meta: 18 de 20, y que los 2 restantes pregunten en vez de errar en silencio.** Un falso destino con confianza alta es peor que una pregunta.

- [ ] **Step 4: Borrar el script y commitear**

```bash
rm scripts/_calibrar.mts
npm run typecheck && npm run lint
git add src/lib/agentes/recepcionista.ts
git commit -m "Calibrar el recepcionista con frases reales de Beno"
```

---

## Cierre

Con esto Beno tiene una caja en el inicio y un atajo global que resuelven seis cosas sin saber dónde está el botón. El séptimo agente —movimientos, el único con lógica nueva— va en su propio plan, y conviene escribirlo **después** de que esta ola esté en uso: cómo se comporta el recepcionista con seis destinos reales es la información que hoy no tenemos.
