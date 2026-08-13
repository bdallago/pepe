import type { SuperficieUso } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * El log de uso: qué se le pidió a la app y qué contestó.
 *
 * Beno lo pidió así: *"log de lo que pido, log de lo que la app devuelve y
 * análisis y resolución en base a eso"*. Antes de esto lo único que había
 * eran unos `console.*` que van a los logs de Vercel: efímeros, y que
 * ningún agente puede consultar días después, que es justo cuando sirven.
 *
 * ## La regla que ordena todo este archivo
 *
 * ⚠ **Registrar no puede romper ni demorar lo que se estaba haciendo.**
 * Es la regla 7 aplicada al caso más obvio: si la fila no se puede
 * escribir, Beno tiene que ver su respuesta igual. Por eso
 * `registrarUso()` **nunca lanza** y por eso quien la llama no la espera.
 *
 * De ahí salen las tres decisiones de abajo, que no son estilo.
 *
 * ⚠ **Este módulo NO lleva `import "server-only"`**, y es deliberado: no
 * toca `next/headers` ni nada de Next —recibe el cliente por parámetro—,
 * igual que `lib/bitacora.ts`. Ponerlo lo volvería inimportable desde
 * `npm test`, que corre sin la condición `react-server` a propósito, y
 * `acotar()` es justo la parte que conviene probar sin base ni red.
 */

/** Lo que decidió el recepcionista, aplanado para poder leerlo de un vistazo. */
export interface DecisionRegistrada {
  destino: string;
  argumento: string | null;
  confianza: number;
}

export interface PedidoDeUso {
  superficie: SuperficieUso;
  /** Una línea legible: la frase, o el nombre de la tool. */
  pedido: string;
  /** La entrada entera. */
  entrada: unknown;
  salida?: unknown;
  /**
   * Solo la caja. Es la columna que más importa: sin ella el log dice qué
   * contestó la app pero no **por qué**, y una derivación equivocada se ve
   * igual que una correcta con el argumento mal leído.
   */
  decisiones?: DecisionRegistrada[];
  duracionMs?: number;
  error?: string;
}

/**
 * Cuánto texto se guarda de un campo.
 *
 * Hay dos cosas que pueden ser enormes y ninguna aporta al mirar la cola:
 * un data URI de una captura (megabytes de base64) y el texto extraído de
 * un PDF. Se recorta acá y no en la base porque la base no puede saber
 * cuál de sus jsonb vino de una imagen.
 */
const TOPE_TEXTO = 4000;

/**
 * Recorta strings largos adentro de cualquier estructura.
 *
 * Recursivo y no un `JSON.stringify().slice()` porque lo que interesa es
 * conservar **la forma** —qué campos vinieron y cuáles quedaron vacíos—,
 * que es lo que se mira para entender una respuesta. Un string cortado al
 * medio del JSON deja un documento que no se puede ni parsear.
 */
export function acotar(valor: unknown, profundidad = 0): unknown {
  if (typeof valor === "string") {
    return valor.length > TOPE_TEXTO
      ? `${valor.slice(0, TOPE_TEXTO)}… [recortado, ${valor.length} chars]`
      : valor;
  }

  // Un tope de profundidad barato contra una estructura ciclada o absurda:
  // esto corre en el camino de una respuesta y no puede colgarse.
  if (profundidad > 6) return "[…]";

  if (Array.isArray(valor)) {
    return valor.slice(0, 50).map((v) => acotar(v, profundidad + 1));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, acotar(v, profundidad + 1)]),
    );
  }

  return valor;
}

/**
 * Deja la fila. **Nunca lanza.**
 *
 * Esa garantía es la que hace el trabajo de la regla 7: si Postgres está
 * caído o la tabla todavía no existe, el error queda en la consola y la
 * respuesta de Beno sale igual.
 *
 * ⚠ **Y sí se espera, aunque sea tentador no hacerlo.** Un `void` sin
 * `await` ahorraría unos 50 ms, pero en Vercel la función puede terminar
 * antes de que la promesa corra y la fila se pierde **en silencio y a
 * veces sí y a veces no**. Un log con agujeros irregulares es peor que
 * ninguno: lleva a concluir "esto no pasó" cuando lo que no pasó fue el
 * registro. Contra los 600 ms que ya espera la caja por Groq, el
 * round-trip no se nota.
 */
export async function registrarUso(
  supabase: SupabaseClient,
  userId: string,
  pedido: PedidoDeUso,
): Promise<void> {
  try {
    const { error } = await supabase.from("agent_log").insert({
      user_id: userId,
      superficie: pedido.superficie,
      // La base lo pide `not null`, y un pedido vacío es un dato: se
      // guarda dicho en castellano en vez de dejar caer la fila entera.
      pedido: pedido.pedido.trim() || "(sin texto)",
      entrada: acotar(pedido.entrada) as never,
      salida: (pedido.salida === undefined
        ? null
        : acotar(pedido.salida)) as never,
      decisiones: (pedido.decisiones ?? null) as never,
      duracion_ms: pedido.duracionMs ?? null,
      error: pedido.error ?? null,
    });

    if (error) {
      console.warn("[uso] no pude registrar el pedido:", error.message);
    }
  } catch (error: unknown) {
    // Incluye el caso de que la tabla todavía no exista: la app tiene que
    // andar igual con la migración sin aplicar.
    console.warn(
      "[uso] no pude registrar el pedido:",
      error instanceof Error ? error.message : error,
    );
  }
}
