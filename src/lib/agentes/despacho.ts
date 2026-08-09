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
