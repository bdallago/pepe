import "server-only";

import { observarBalances } from "@/lib/agentes/observaciones";
import { describirRango, resolverRango } from "@/lib/agentes/rango";
import { resolverProyecto, resolverTrack } from "@/lib/agentes/resolver";
import { computeToday, trackProgress } from "@/lib/aprendizaje";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { addDays, compareISO, formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { generarLecciones } from "@/lib/generacion";
import { mensajeDeErrorLLM } from "@/lib/llm";
import { proximoVencimiento } from "@/lib/recurrences";
import { generarRetro } from "@/lib/retro";
import { crearSesionAlFinalDelTrack } from "@/lib/sesiones";
import { sugerirQueEstudiar } from "@/lib/sugerencias";
import { escanearZombies } from "@/lib/zombies";
import type { Observacion } from "@/lib/agentes/observaciones";
import type { Balances } from "@/lib/balances";
import type { ItemDeHoy } from "@/lib/aprendizaje";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Recurrence, StudySession } from "@/lib/supabase/database.types";
import type { Decision, RespuestaSimple } from "@/lib/agentes/tipos";

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
 *
 * Recibe **una** decisión y devuelve **una** respuesta, incluso cuando la
 * frase pedía varias cosas: encadenarlas es trabajo de `cadena.ts`. Por
 * eso el retorno es `RespuestaSimple` y no `RespuestaAgente` — de acá no
 * sale nunca una cadena.
 */
export async function despachar(
  supabase: SupabaseClient,
  userId: string,
  decision: Decision,
): Promise<RespuestaSimple> {
  switch (decision.destino) {
    case "roadmap": {
      // "Qué me toca hoy" NO es "qué me sugerís estudiar". Esto es lectura
      // pura del plan que ya está armado: sale entero de la base y no toca
      // ningún modelo. Antes caía en `estudio`, o sea que una pregunta por
      // el temario existente se contestaba con temas inventados por el
      // razonador — la respuesta equivocada, y la más cara de dar.
      //
      // Las tres consultas calcan a `getTracks` / `getBlocks` /
      // `getSessions` de `lib/queries.ts`: sin archivados y por `orden`.
      // No se llaman directo porque esas arman su propio cliente desde las
      // cookies y acá el cliente ya viene dado. Si el criterio se separara,
      // el agente contestaría un plan distinto al de la pantalla.
      const [tracksRes, blocksRes, sessionsRes] = await Promise.all([
        supabase
          .from("tracks")
          .select("*")
          .is("archivado_en", null)
          .order("orden"),
        supabase
          .from("blocks")
          .select("*")
          .is("archivado_en", null)
          .order("orden"),
        supabase
          .from("sessions")
          .select("*")
          .is("archivado_en", null)
          .order("orden"),
      ]);

      const tracks = tracksRes.data ?? [];
      const blocks = blocksRes.data ?? [];
      const sessions = sessionsRes.data ?? [];

      // Los mismos argumentos que le pasa la pantalla "Hoy". La fecha se
      // resuelve una sola vez, acá.
      const hoy = computeToday({ fecha: todayISO(), tracks, blocks, sessions });

      if (!hoy.algunTrackArranco) {
        return {
          clase: "aviso",
          titulo: "El plan todavía no arrancó",
          cuerpo:
            "Ningún track activo tiene una fecha de inicio ya cumplida. Poné una desde el Roadmap y esto empieza a contestar qué toca cada día.",
        };
      }

      // Primero lo que toca hoy y después lo que descansa, igual que la
      // pantalla; dentro de cada grupo manda el orden de los tracks.
      const conSesion = (esHoy: boolean) =>
        hoy.items.filter(
          (i): i is ItemDeHoy & { session: StudySession } =>
            i.esHoy === esHoy && i.session !== null,
        );

      const items = [...conSesion(true), ...conSesion(false)];

      if (items.length === 0) {
        return {
          clase: "aviso",
          titulo: "No te queda nada pendiente",
          cuerpo:
            "Todos los tracks activos están terminados. Podés agregar sesiones desde el Roadmap o pedirme sugerencias de qué estudiar.",
        };
      }

      const tocanHoy = items.filter((i) => i.esHoy).length;

      let titulo = "Esto es lo que te toca hoy";
      if (tocanHoy === 0) {
        titulo = "Hoy no hay sesión programada. Esto es lo que sigue";
      } else if (hoy.diaDoble) {
        titulo = `Hoy tocan ${tocanHoy} tracks`;
      }

      return {
        clase: "lista",
        destino: "roadmap",
        titulo,
        items: items.map(({ track, block, session, esHoy }) => {
          const progreso = trackProgress(track.id, blocks, sessions);

          return {
            titulo: `${track.nombre} · ${session.titulo}`,
            detalle: [
              esHoy
                ? "Toca hoy."
                : "Hoy no toca; queda para el próximo día del track.",
              block ? `Bloque: ${block.titulo}` : null,
              // Teoría y aplicación van SEPARADAS y no colapsadas en un
              // "hecha / no hecha" (regla 5): "leí el tema pero todavía no
              // lo apliqué" es un estado real y es el punto de la sección.
              // La pantalla las muestra como dos checks independientes;
              // acá son dos marcas, no una.
              `Teoría ${session.teoria_hecha ? "hecha" : "pendiente"} · Aplicación ${
                session.aplicacion_hecha ? "hecha" : "pendiente"
              }`,
              `Track: ${progreso.hechas} de ${progreso.total} sesiones completas (${progreso.pct} %)`,
            ]
              .filter((linea): linea is string => linea !== null)
              .join("\n"),
          };
        }),
      };
    }

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
          // El `ancla` es la salvaguarda de 6.4 contra el consejo
          // genérico: el dato de Beno que justifica la sugerencia. Tirarlo
          // acá debilitaba justo lo que la función está construida para
          // garantizar — quedaba un motivo lindo sin nada que lo sostenga,
          // que se lee igual que un consejo de manual.
          //
          // `consigna` NO entra, y es una decisión, no un olvido: la caja
          // no tiene el botón de "convertir en sesión" —eso vive en la
          // pantalla de Sugerencias—, así que el qué-hacer no se puede
          // accionar desde acá. Y cuatro sugerencias con motivo + ancla +
          // consigna convierten una caja de respuesta rápida en un muro de
          // texto donde el ancla se pierde entre la prosa: el mismo daño
          // que este cambio vino a arreglar.
          ancla: s.ancla,
        })),
      };
    }

    case "tema_estudio": {
      /*
        Esta rama ESCRIBE en la base y no pasa por la bandeja, y eso no
        contradice la regla 6. Lo que la regla 6 protege es que no se
        guarde **producción de un modelo** sin que Beno la confirme: una
        lección redactada por el razonador, el texto de una retro, una
        propuesta de zombie. Acá lo único que se guarda es el tema que
        Beno escribió, tal como lo escribió — el modelo no lo redacta, y
        el recepcionista tiene prohibido reformularlo; solo recorta de la
        frase el tema y a qué track va. Es el mismo razonamiento del
        agente de bitácora: cuando el texto es de Beno, hacerle confirmar
        lo que acaba de tipear es fricción sin nada del otro lado.

        Pero eso obliga a dos cuidados, y son los dos de abajo:

        1. Si no queda claro a qué track va, se PREGUNTA. Adivinar mal no
           se nota —la sesión queda creada igual— y le ensucia el plan.
        2. La respuesta dice exactamente qué se creó y dónde, para que
           pueda deshacerlo. Como acá borrar es archivar (regla 4), eso
           se hace desde el Roadmap y no se pierde nada.
      */
      const [tema, slugElegido] = partirArgumento(decision.argumento);

      if (!tema) {
        return {
          clase: "aviso",
          titulo: "¿Sobre qué querés aprender?",
          cuerpo:
            "Decime el tema y te lo agrego como sesión al final de un track.",
        };
      }

      // Solo tracks vivos: uno archivado no se ve en ninguna pantalla y
      // uno pausado (`activo = false`) no reparte días, así que la sesión
      // nueva no aparecería nunca por sí sola.
      const { data: tracks } = await supabase
        .from("tracks")
        .select("*")
        .is("archivado_en", null)
        .eq("activo", true)
        .order("orden");

      const activos = tracks ?? [];

      if (activos.length === 0) {
        return {
          clase: "aviso",
          titulo: "No tenés ningún track activo",
          cuerpo:
            "Creá o reactivá un track desde el Roadmap y te agrego el tema ahí.",
        };
      }

      // Si vino de la pregunta de abajo, el slug manda y no se adivina de
      // nuevo. Si no, se busca el track dentro del tema que escribió Beno.
      const encontrado = resolverTrack(slugElegido ?? tema, activos);

      // Con un solo track activo no hay nada que preguntar: no existe el
      // track equivocado. La respuesta igual dice cuál fue.
      const track =
        encontrado !== "ambiguo" && encontrado
          ? encontrado
          : activos.length === 1
            ? activos[0]!
            : null;

      if (!track) {
        return {
          clase: "pregunta",
          titulo: `¿A qué track agrego “${tema}”?`,
          opciones: activos.map((t) => ({
            etiqueta: t.nombre,
            destino: "tema_estudio" as const,
            argumento: `${tema} — ${t.slug}`,
          })),
        };
      }

      // Título y nada más. `consigna` y `teoria_texto` quedan vacías a
      // propósito: son las dos cosas que un modelo podría escribir, y
      // esta rama justamente se saltea la bandeja porque no lo hace.
      const { data: sesion, error } = await crearSesionAlFinalDelTrack(
        supabase,
        userId,
        track.id,
        { titulo: tema, prefijoSlug: "tema" },
      );

      if (error || !sesion) {
        return {
          clase: "aviso",
          titulo: "No pude agregar el tema",
          cuerpo: error?.message ?? "La sesión no se creó.",
        };
      }

      return {
        clase: "texto",
        destino: "tema_estudio",
        titulo: `Agregué “${sesion.titulo}” a ${track.nombre}`,
        cuerpo: [
          `Quedó como última sesión del track ${track.nombre}, sin bloque: en el Roadmap la vas a ver en el grupo “Agregadas”.`,
          // Regla 5: los dos pasos son distintos y arrancan los dos sin
          // marcar. Decirlo evita que parezca que quedó "empezada".
          "Nace con la teoría y la aplicación sin marcar; se marcan por separado.",
          "El título es el que escribiste, sin consigna ni teoría cargadas: eso lo ponés vos desde el Roadmap.",
          "Si no era esto, archivala desde el Roadmap. Acá borrar es archivar, así que no se pierde.",
        ].join("\n"),
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

      // El rango sale del texto libre y se resuelve en código, no en el
      // modelo (ver `rango.ts`). Si no se reconoce ninguno vale `null` y
      // los filtros quedan como estaban: todo el histórico.
      const hoy = todayISO();
      const rango = resolverRango(decision.argumento, hoy);
      const filtros = {
        estado: "efectuado" as const,
        desde: rango?.desde,
        hasta: rango?.hasta,
      };

      // El proyecto se busca en lo que queda **después** de sacarle la
      // expresión temporal. Si no, un argumento que es solo un rango
      // ("últimos 6 meses") puede matchear un proyecto de casualidad por
      // el `includes` de `resolverProyecto`.
      const proyecto = resolverProyecto(
        rango ? rango.restante : decision.argumento,
        proyectos,
      );

      if (proyecto === "ambiguo") {
        return {
          clase: "aviso",
          titulo: "No sé de qué proyecto me hablás",
          cuerpo: `Hay más de uno que coincide con “${decision.argumento}”.`,
        };
      }

      const balances: Balances = proyecto
        ? calcularBalancesProyecto(
            movimientos,
            proyectos,
            categorias,
            proyecto.id,
            moneda,
            filtros,
          )
        : calcularBalances(movimientos, proyectos, categorias, moneda, filtros);

      const alcance = proyecto ? proyecto.nombre : "Balance general";
      const lineaRango = describirRango(rango);

      const cuerpo = [
        // Primero el rango y después los números, y no al revés: si el
        // agente entendió otro período que el que Beno pidió, tiene que
        // verlo antes de leer un solo monto.
        lineaRango,
        `Ingresos: ${formatMoney(balances.efectuado.ingresos, moneda)}`,
        `Egresos: ${formatMoney(balances.efectuado.egresos, moneda)}`,
        `Balance: ${formatMoney(balances.efectuado.balance, moneda)}`,
        `Sobre ${balances.cantidadMovimientos} movimientos.`,
      ];

      // Las observaciones son un extra y no pueden tumbar la consulta
      // (regla 7): si el modelo falla, los números salen igual y el aviso
      // va discreto al pie. Sin movimientos no se gasta la llamada: no
      // hay número contra el cual anclar nada.
      let observaciones: Observacion[] | undefined;

      if (decision.analizar && balances.cantidadMovimientos > 0) {
        try {
          observaciones = await observarBalances({
            alcance,
            rango: lineaRango,
            moneda,
            balances,
            hoy,
          });
        } catch (error: unknown) {
          console.warn("[agentes] observaciones:", error);
          cuerpo.push(
            `No pude sacar observaciones esta vez: ${mensajeDeErrorLLM(error)}`,
          );
        }
      }

      return {
        clase: "texto",
        destino: "consultas",
        titulo: alcance,
        cuerpo: cuerpo.join("\n"),
        observaciones,
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
 * Parte un argumento con forma `"tema — slug"` en sus dos partes.
 *
 * Lo usan las dos ramas que preguntan a qué entidad va un tema —
 * `lecciones_tema` (a qué proyecto) y `tema_estudio` (a qué track)—:
 * cada una arma las opciones de su propia pregunta con ese formato, y
 * este es el único lugar que lo conoce. Si nunca hubo pregunta de por
 * medio, el slug es `null` y el tema es la frase entera.
 *
 * Se parte por el guion largo con espacios, que es el separador que arman
 * las ramas. Un tema escrito por Beno que lo contenga se partiría mal,
 * pero para eso tendría que tipear " — " a mano.
 */
function partirArgumento(argumento: string | null): [string, string | null] {
  const texto = argumento?.trim() ?? "";
  const corte = texto.lastIndexOf(" — ");

  if (corte === -1) return [texto, null];

  return [texto.slice(0, corte).trim(), texto.slice(corte + 3).trim() || null];
}
