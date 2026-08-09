import "server-only";

import { resolverProyecto } from "@/lib/agentes/resolver";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
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

    case "consultas": {
      // Las tres consultas son idénticas a las del layout de las pantallas
      // privadas: proyectos sin filtrar `archivado_en` y ordenados por
      // nombre, categorías por tipo y nombre. Si acá se filtrara distinto,
      // el agente contestaría números que no coinciden con la pantalla.
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

      const b = calcularBalances(
        movimientos,
        proyectos,
        categorias,
        moneda,
        filtros,
      );

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

    default:
      return {
        clase: "aviso",
        titulo: "No entendí qué necesitás",
        cuerpo:
          "Probá con algo como “cómo viene Proder”, “qué me toca hoy” o “qué estoy pagando que no uso”.",
      };
  }
}
