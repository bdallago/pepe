/**
 * La cola de uso: qué le pediste a la app, qué contestó y qué falta revisar.
 *
 *   npm run revisar:uso                       # lo no revisado, lo más nuevo arriba
 *   npm run revisar:uso -- --todo             # también lo ya revisado
 *   npm run revisar:uso -- --ver <id>         # una fila entera: entrada y salida
 *   npm run revisar:uso -- --id <id> --veredicto defecto --nota "…"
 *
 * ## Por qué un comando y no una pantalla
 *
 * Esto no lo mira Beno: lo miro yo. Una pantalla sería una sección más de
 * la app para mantener, con RLS, con estados vacíos y con lugar en el menú,
 * y su único usuario sería un agente que ya tiene una terminal.
 *
 * ## Por qué marcar es parte del mismo comando
 *
 * El veredicto vive **al lado del hecho**, en la misma fila, y no en un
 * documento aparte que se desincroniza. Es el mismo patrón que `inbox`. Si
 * el análisis viviera en otro lado, en dos semanas nadie sabría cuáles de
 * las 300 interacciones ya se miraron.
 *
 * Es `.mts` por lo mismo que los otros corredores: sin `"type": "module"`
 * esbuild pasa el archivo a CJS y mueren los `await` de nivel superior.
 */
import { resolve } from "node:path";

import { cargarEnvLocal } from "./env-local.ts";

const RAIZ = resolve(import.meta.dirname, "..");
cargarEnvLocal(RAIZ);

const { createClient } = await import("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const argv = process.argv.slice(2);
const bandera = (nombre: string): string | undefined => {
  const i = argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : argv[i + 1];
};

const VEREDICTOS = ["ok", "defecto", "mejora", "ruido"] as const;
type Veredicto = (typeof VEREDICTOS)[number];

interface Fila {
  id: string;
  creado_en: string;
  superficie: "caja" | "conector";
  pedido: string;
  entrada: unknown;
  salida: unknown;
  decisiones: { destino: string; argumento: string | null; confianza: number }[] | null;
  duracion_ms: number | null;
  error: string | null;
  revisado_en: string | null;
  veredicto: Veredicto | null;
  nota: string | null;
}

/* ── Marcar ─────────────────────────────────────────────────── */

const idAMarcar = bandera("id");
if (idAMarcar) {
  const veredicto = bandera("veredicto");
  if (!veredicto || !VEREDICTOS.includes(veredicto as Veredicto)) {
    console.error(`--veredicto tiene que ser uno de: ${VEREDICTOS.join(", ")}`);
    process.exit(1);
  }

  const { error } = await supabase
    .from("agent_log")
    .update({
      veredicto,
      nota: bandera("nota") ?? null,
      // La fecha y el veredicto van juntos: la base tiene un check que
      // prohíbe medias revisiones, por el mismo motivo que
      // `sessions.teoria_hecha`/`teoria_fecha`.
      revisado_en: new Date().toISOString(),
    })
    .eq("id", idAMarcar);

  if (error) {
    console.error("No pude marcarla:", error.message);
    process.exit(1);
  }

  console.log(`Marcada como ${veredicto}.`);
  process.exit(0);
}

/* ── Ver una entera ─────────────────────────────────────────── */

const idAVer = bandera("ver");
if (idAVer) {
  const { data, error } = await supabase
    .from("agent_log")
    .select("*")
    .eq("id", idAVer)
    .maybeSingle();

  if (error || !data) {
    console.error("No la encontré:", error?.message ?? "sin resultados");
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

/* ── La cola ────────────────────────────────────────────────── */

const todo = argv.includes("--todo");
const limite = Number(bandera("limite") ?? 40);

let consulta = supabase
  .from("agent_log")
  .select("*")
  .order("creado_en", { ascending: false })
  .limit(limite);

if (!todo) consulta = consulta.is("revisado_en", null);

const { data, error } = await consulta;

if (error) {
  console.error("No pude leer el log:", error.message);
  if (error.message.includes("agent_log")) {
    console.error("\n¿Está aplicada la migración 20260813000000_agent_log.sql?");
  }
  process.exit(1);
}

const filas = (data ?? []) as unknown as Fila[];

if (filas.length === 0) {
  console.log(todo ? "El log está vacío." : "No hay nada sin revisar.");
  process.exit(0);
}

console.log(
  `\n${filas.length} ${todo ? "interacciones" : "sin revisar"}, de la más nueva a la más vieja.\n`,
);

for (const f of filas) {
  const cuando = f.creado_en.slice(0, 16).replace("T", " ");
  const ms = f.duracion_ms === null ? "" : ` · ${f.duracion_ms} ms`;
  const marca = f.veredicto ? ` · [${f.veredicto}]` : "";

  console.log("─".repeat(78));
  console.log(`${cuando} · ${f.superficie}${ms}${marca}`);
  console.log(`  ${f.pedido.slice(0, 100)}`);

  // Las decisiones son lo que más importa de la cola: dicen POR QUÉ
  // contestó lo que contestó, que es lo que no se puede reconstruir
  // después mirando solo la respuesta.
  if (f.decisiones?.length) {
    for (const d of f.decisiones) {
      console.log(
        `  → ${d.destino} (${d.confianza})${d.argumento ? ` · "${d.argumento.slice(0, 60)}"` : ""}`,
      );
    }
  }

  const salida = f.salida as { clase?: string; titulo?: string } | null;
  if (salida?.clase) {
    console.log(`  ← ${salida.clase}${salida.titulo ? `: ${salida.titulo}` : ""}`);
  }
  if (f.error) console.log(`  ! ${f.error.slice(0, 120)}`);
  if (f.nota) console.log(`  nota: ${f.nota}`);

  console.log(`  id: ${f.id}`);
}

console.log("─".repeat(78));
console.log(
  "\nPara ver una entera:  npm run revisar:uso -- --ver <id>\n" +
    `Para marcarla:        npm run revisar:uso -- --id <id> --veredicto ${VEREDICTOS.join("|")} --nota "…"\n`,
);
