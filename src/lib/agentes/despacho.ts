import "server-only";

import { resolverProyecto } from "@/lib/agentes/resolver";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
import { generarLecciones } from "@/lib/generacion";
import { generarRetro } from "@/lib/retro";
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

    case "retro": {
      // La retro es la llamada más cara de la app (razonador, mucho
      // contexto). Por eso el proyecto se resuelve **antes**: sin saber de
      // cuál, se pregunta en vez de gastar la llamada.
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
      const b = resultado.borrador;

      // El texto vuelve como borrador y **no se guarda** (regla 6.e): esto
      // es para leer. Las lecciones candidatas, en cambio, ya quedaron
      // esperando en la bandeja, así que se avisa.
      const cuerpo = [
        b.titulo,
        "",
        `Qué funcionó\n${b.que_funciono}`,
        "",
        `Qué no funcionó\n${b.que_no_funciono}`,
        "",
        `Cuánto costó de verdad\n${b.costo_real}`,
        "",
        `Conclusión\n${b.conclusion}`,
        ...(resultado.leccionesPropuestas > 0
          ? [
              "",
              `Dejé ${resultado.leccionesPropuestas} lecciones esperando en la bandeja.`,
            ]
          : []),
      ].join("\n");

      return {
        clase: "texto",
        destino: "retro",
        titulo: `Retro de ${proyecto.nombre}`,
        cuerpo,
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
        // El argumento de la opción lleva tema y proyecto pegados: al
        // volver, `resolverProyecto` reconoce el nombre adentro de la
        // frase igual que reconoce "cómo viene Proder".
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

    default:
      return {
        clase: "aviso",
        titulo: "No entendí qué necesitás",
        cuerpo:
          "Probá con algo como “cómo viene Proder”, “qué me toca hoy” o “qué estoy pagando que no uso”.",
      };
  }
}
