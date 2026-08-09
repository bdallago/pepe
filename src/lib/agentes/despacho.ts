import "server-only";

import { resolverProyecto } from "@/lib/agentes/resolver";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { addDays, compareISO, formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { generarLecciones } from "@/lib/generacion";
import { proximoVencimiento } from "@/lib/recurrences";
import { generarRetro } from "@/lib/retro";
import { sugerirQueEstudiar } from "@/lib/sugerencias";
import { escanearZombies } from "@/lib/zombies";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Recurrence } from "@/lib/supabase/database.types";
import type { Decision, RespuestaAgente } from "@/lib/agentes/tipos";

/**
 * Qué tan lejos mira el agente de vencimientos.
 *
 * Treinta días es un ciclo mensual entero: alcanza para que toda
 * recurrencia mensual aparezca al menos una vez, y no tanto como para que
 * la lista deje de ser "lo que se viene".
 */
const DIAS_DE_VENCIMIENTO_PROXIMO = 30;

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

    case "vencimientos": {
      // Es la otra pregunta sobre lo recurrente, y no es la de arriba:
      // `suscripciones` mira lo que Beno **no usa** (regla 6.f: se detecta
      // sobre movimientos, porque casi nada está declarado como
      // recurrencia). Acá lo que se pregunta es qué se viene, y eso solo
      // lo sabe lo que sí está declarado en `recurrences`.
      const { data, error } = await supabase
        .from("recurrences")
        .select("*")
        .eq("activa", true);

      if (error) {
        return {
          clase: "aviso",
          titulo: "No pude mirar los vencimientos",
          cuerpo: error.message,
        };
      }

      const hoy = todayISO();
      const limite = addDays(hoy, DIAS_DE_VENCIMIENTO_PROXIMO);

      // `proximoVencimiento` es de `lib/recurrences.ts`, el módulo puro
      // donde vive esa regla y que ya usan el cron y la pantalla de
      // Recurrentes. Repetir acá el cálculo del día efectivo (el 31 en un
      // mes de 30) sería copiarse una regla que ya tiene dueño.
      const proximos = (data ?? [])
        .map((recurrencia) => ({
          recurrencia,
          fecha: proximoVencimiento(recurrencia, hoy),
        }))
        .filter(
          (v): v is { recurrencia: Recurrence; fecha: string } =>
            v.fecha !== null && v.fecha <= limite,
        )
        .sort((a, b) => compareISO(a.fecha, b.fecha));

      if (proximos.length === 0) {
        return {
          clase: "aviso",
          titulo: "No se te viene nada",
          cuerpo: `Ninguna recurrencia activa vence en los próximos ${DIAS_DE_VENCIMIENTO_PROXIMO} días.`,
        };
      }

      return {
        clase: "lista",
        destino: "vencimientos",
        titulo: `Lo que se te viene en los próximos ${DIAS_DE_VENCIMIENTO_PROXIMO} días`,
        items: proximos.map(({ recurrencia, fecha }) => ({
          titulo: recurrencia.descripcion,
          detalle: `${formatMoney(recurrencia.monto_origen, recurrencia.moneda_origen)} · vence el ${formatDate(fecha)}`,
        })),
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
          cuerpo: "Decime un tema y te busco en las lecciones y en la bitácora.",
        };
      }

      // Beno pregunta por sus "anotaciones", no por sus "lecciones": lo
      // que escribió puede estar en cualquiera de las dos tablas, así que
      // se buscan las dos y se muestran juntas. Cada ítem dice de dónde
      // salió, que es la única parte que no puede quedar implícita.
      const [leccionesRes, bitacoraRes] = await Promise.all([
        // Sin embedding: es el modo que la app declara válido cuando el
        // embedding falla o tarda (regla 7), y con el corpus actual es el
        // que mejor midió. `?? undefined` y no null: omitir el parámetro
        // deja que Postgres aplique su default.
        supabase.rpc("buscar_lecciones_hibrido", {
          p_consulta: consulta,
          p_embedding: undefined,
          p_limite: 5,
        }),
        buscarEnBitacora(supabase, consulta),
      ]);

      const items = [
        ...(leccionesRes.data ?? []).map((r) => ({
          titulo: `Lección · ${r.titulo}`,
          detalle: r.contenido,
        })),
        ...(bitacoraRes.data ?? []).map((d) => ({
          titulo: `Bitácora · ${formatDate(d.fecha)}`,
          detalle: d.contenido,
        })),
      ];

      if (items.length === 0) {
        // Que falle una de las dos no tapa lo que encontró la otra
        // (mismo criterio que la regla 7: media búsqueda es búsqueda).
        // Pero si no hay nada que mostrar y además hubo error, se dice,
        // en vez de hacer pasar una falla por "no hay resultados".
        const error = leccionesRes.error ?? bitacoraRes.error;

        if (error) {
          return {
            clase: "aviso",
            titulo: "No pude buscar",
            cuerpo: error.message,
          };
        }

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
        titulo: `Encontré ${items.length} sobre “${consulta}”`,
        items,
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
      // Cuando Beno elige una opción de la pregunta de abajo, el argumento
      // vuelve como "tema — slug". Se parte acá, explícito.
      //
      // Sin esto igual "funcionaba", pero por accidente: `resolverProyecto`
      // encontraba el proyecto porque su NOMBRE quedaba adentro del string
      // una vez normalizado, no por el slug. Eso se rompe con cualquier
      // proyecto cuyo slug no derive de su nombre —Pepe ya tiene uno,
      // `gentius`, que se llamaba HRKit— y además arrastraba el slug hasta
      // el prompt del modelo y hasta el texto en pantalla ("no encontré
      // material sobre «clientes — proder»").
      const [temaCrudo, slugElegido] = partirArgumento(decision.argumento);
      const tema = temaCrudo;

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

      // Si vino de la pregunta, el slug manda y no se adivina de nuevo.
      const proyecto = resolverProyecto(slugElegido ?? tema, proyectos ?? []);

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

    default:
      return {
        clase: "aviso",
        titulo: "No entendí qué necesitás",
        cuerpo:
          "Probá con algo como “cómo viene Proder”, “qué me toca hoy” o “qué estoy pagando que no uso”.",
      };
  }
}

/**
 * Palabras que no aportan nada a un `ilike` y que, si se dejan, hacen que
 * cualquier entrada de bitácora matchee. El full-text de lecciones las
 * saca solo (las stopwords del diccionario `spanish`); acá hay que
 * hacerlo a mano porque `ilike` no sabe de diccionarios.
 */
const PALABRAS_VACIAS = new Set([
  "al", "algo", "ante", "como", "con", "cosa", "cual", "cuál", "de", "del",
  "donde", "dónde", "el", "ella", "ellos", "en", "es", "esa", "ese", "esta",
  "este", "esto", "fue", "hay", "la", "las", "le", "lo", "los", "me", "mi",
  "mis", "más", "mas", "muy", "no", "para", "por", "que", "qué", "se", "ser",
  "si", "su", "sus", "sobre", "también", "tengo", "un", "una", "unas", "uno",
  "unos", "ya",
]);

/**
 * Parte la consulta en palabras buscables.
 *
 * Se descartan las vacías y las de una sola letra, y se corta en ocho: el
 * `or` de PostgREST viaja en la URL y una frase larga no aporta precisión,
 * la diluye.
 */
function palabrasDeConsulta(consulta: string): string[] {
  const palabras = consulta
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 2 && !PALABRAS_VACIAS.has(p));

  return [...new Set(palabras)].slice(0, 8);
}

/**
 * Busca en la bitácora por texto plano.
 *
 * No hay RPC híbrido para `daily_log`: el índice de texto y el embedding
 * viven solo en `lessons`. Acá la búsqueda es un `ilike` sobre
 * `contenido`, que es bastante peor — y está bien que se note, porque la
 * respuesta ya avisa que busca por texto y que las palabras exactas
 * importan.
 *
 * Las palabras se unen con **OR y no con AND**, por el mismo motivo por
 * el que el full-text de lecciones se cambió a OR: uno no se acuerda de
 * la frase que escribió, se acuerda del tema. Con AND, "gestión de
 * presupuestos" no encuentra la entrada que habla del presupuesto.
 *
 * **No se filtra `archivado_en`.** Es la regla 4 de AGENTS.md: lo
 * archivado se excluye de las listas de la interfaz, pero sigue
 * participando de la búsqueda. Un proyecto cerrado no tiene que ensuciar
 * las pantallas, pero su conocimiento no se pierde — y acá Beno está
 * pidiendo justamente que se busque. Mismo criterio que el RPC de
 * lecciones, que tampoco lo filtra.
 */
async function buscarEnBitacora(supabase: SupabaseClient, consulta: string) {
  const palabras = palabrasDeConsulta(consulta);

  const base = supabase
    .from("daily_log")
    .select("fecha, contenido")
    .order("fecha", { ascending: false })
    .limit(5);

  // Si no quedó ninguna palabra (una consulta de un caracter, o toda de
  // palabras vacías) se busca la frase entera. `%` y `_` se sacan porque
  // son comodines de LIKE y vendrían del texto del usuario.
  if (palabras.length === 0) {
    return await base.ilike("contenido", `%${consulta.replace(/[%_]/g, " ")}%`);
  }

  return await base.or(palabras.map((p) => `contenido.ilike.%${p}%`).join(","));
}

/**
 * Parte el argumento de `lecciones_tema` en tema y slug de proyecto.
 *
 * La rama arma las opciones de su propia pregunta como `"tema — slug"`,
 * así que este es el único lugar que conoce ese formato: entra por acá y
 * sale partido. Si nunca hubo pregunta de por medio, el slug es `null` y
 * el tema es la frase entera.
 *
 * Se parte por el guion largo con espacios, que es el separador que arma
 * la propia rama. Un tema escrito por Beno que lo contenga se partiría
 * mal, pero para eso tendría que tipear " — " a mano.
 */
function partirArgumento(argumento: string | null): [string, string | null] {
  const texto = argumento?.trim() ?? "";
  const corte = texto.lastIndexOf(" — ");

  if (corte === -1) return [texto, null];

  return [texto.slice(0, corte).trim(), texto.slice(corte + 3).trim() || null];
}
