import "server-only";

import { leerAnotacion } from "@/lib/agentes/bitacora";
import { leerMovimiento } from "@/lib/agentes/movimientos";
import { observarBalances } from "@/lib/agentes/observaciones";
import {
  describirRango,
  resolverMesDeVencimientos,
  resolverRango,
} from "@/lib/agentes/rango";
import { resolverProyecto, resolverTrack } from "@/lib/agentes/resolver";
import { computeToday, trackProgress } from "@/lib/aprendizaje";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import {
  crearEntradaDeBitacora,
  proyectoPorDefectoDeBitacora,
} from "@/lib/bitacora";
import { sugerirClasificacion } from "@/lib/clasificacion";
import { addDays, compareISO, formatDate, formatDayMonth, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { generarLecciones } from "@/lib/generacion";
import { mensajeDeErrorLLM } from "@/lib/llm";
import { proximoVencimiento } from "@/lib/recurrences";
import { generarRetro } from "@/lib/retro";
import { crearSesionAlFinalDelTrack } from "@/lib/sesiones";
import { sugerirQueEstudiar } from "@/lib/sugerencias";
import { escanearZombies } from "@/lib/zombies";
import type { MovimientoLeido } from "@/lib/agentes/movimientos";
import type { Observacion } from "@/lib/agentes/observaciones";
import type { Balances } from "@/lib/balances";
import type { Sugerencia } from "@/lib/clasificacion";
import type { ItemDeHoy } from "@/lib/aprendizaje";
import type { SupabaseClient } from "@/lib/supabase/server";
import type {
  Moneda,
  Recurrence,
  StudySession,
  TipoMovimiento,
} from "@/lib/supabase/database.types";
import type { Decision, RespuestaSimple } from "@/lib/agentes/tipos";

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
 *
 * `frase` es el texto tal como llegó (o el fragmento que le toca a esta
 * acción cuando vino en cadena). Lo usa **solo** `movimientos`, que es el
 * único destino donde el recorte del recepcionista puede perder un dato
 * que no se recupera: el monto.
 */
export async function despachar(
  supabase: SupabaseClient,
  userId: string,
  decision: Decision,
  frase: string,
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

      // Mes de **calendario**, no una ventana de 30 días corridos, y no es
      // el mismo criterio que usa `resolverRango` para las consultas de
      // plata. La facturación funciona por mes: una suscripción no "vence
      // dentro de 30 días", vence en septiembre. El porqué completo —y qué
      // pasa con "el mes pasado"— está en `resolverMesDeVencimientos`.
      const ventana = resolverMesDeVencimientos(decision.argumento, hoy);

      // `proximoVencimiento` es de `lib/recurrences.ts`, el módulo puro
      // donde vive esa regla y que ya usan el cron y la pantalla de
      // Recurrentes. Repetir acá el cálculo del día efectivo (el 31 en un
      // mes de 30) sería copiarse una regla que ya tiene dueño.
      //
      // Alcanza con el próximo de cada recurrencia porque la ventana es un
      // mes: mensual cae una vez y anual, a lo sumo una. Si algún día
      // hubiera frecuencia quincenal, esto pasa a `vencimientosEnRango`.
      const enElMes = (data ?? [])
        .map((recurrencia) => ({
          recurrencia,
          fecha: proximoVencimiento(recurrencia, ventana.desde),
        }))
        .filter(
          (v): v is { recurrencia: Recurrence; fecha: string } =>
            v.fecha !== null && v.fecha <= ventana.hasta,
        )
        .sort((a, b) => compareISO(a.fecha, b.fecha));

      // El mes en curso arranca hoy, así que es "lo que queda de agosto" y
      // no "agosto": decir el mes entero prometería cargos que ya pasaron.
      const cuando = ventana.enCurso
        ? `lo que queda de ${ventana.mes}`
        : ventana.mes;

      if (enElMes.length === 0) {
        return {
          clase: "aviso",
          titulo: ventana.pasado ? "No te venció nada" : "No se te viene nada",
          cuerpo: ventana.pasado
            ? `Ninguna recurrencia activa venció en ${ventana.mes}.`
            : `Ninguna recurrencia activa vence en ${cuando}.`,
        };
      }

      return {
        clase: "lista",
        destino: "vencimientos",
        titulo: ventana.pasado
          ? `Lo que te venció en ${ventana.mes}`
          : `Lo que se te viene en ${ventana.mes}`,
        items: enElMes.map(({ recurrencia, fecha }) => ({
          titulo: recurrencia.descripcion,
          detalle: `${formatMoney(recurrencia.monto_origen, recurrencia.moneda_origen)} · ${
            ventana.pasado ? "venció" : "vence"
          } el ${formatDate(fecha)}`,
        })),
      };
    }

    case "movimientos": {
      /*
        El único agente con lógica nueva de todo el roster, y el orden de
        adentro es el que manda:

        1. **Extracción** (`agentes/movimientos.ts`): monto, moneda,
           descripción y fecha. Primero un regex sobre el estilo telegráfico
           de Beno —que resuelve el caso común sin modelo, gratis y con Groq
           caído— y el modelo solo si esa forma no matcheó.
        2. **Si falta un dato necesario, se PREGUNTA.** Beno lo pidió con
           todas las letras: "acá me olvido de la fecha, me la tiene que
           preguntar, aplica también por si me olvido la cantidad de dinero,
           el motivo y cualquier otro dato relevante para clasificar".
        3. **Clasificación** con `lib/clasificacion.ts`, que ya existe y no
           se toca: primero el histórico (SQL puro, contra índice) y el
           modelo solo si no encontró nada. Regla 6.c, y no se negocia.
        4. El formulario precargado, que es el panel de confirmación. Nada
           se escribe acá.
      */
      const hoy = todayISO();
      const texto = textoDelMovimiento(decision.argumento, frase);

      if (!texto) {
        return {
          clase: "aviso",
          titulo: "¿Qué querés anotar?",
          cuerpo:
            "Decime algo como “-20usd Claude Code 06/08” o “pagué 20 dólares de Claude Code”.",
        };
      }

      const leido = await leerMovimiento(texto, hoy);

      // Los datos necesarios son tres: monto, descripción y fecha. Se
      // preguntan de a uno y en este orden —de lo más caro de equivocar a
      // lo menos— y cada pregunta vuelve con lo ya entendido adentro, así
      // que contestarla no cuesta retipear nada.
      const faltante = preguntarPorLoQueFalta(leido, hoy);
      if (faltante) return faltante;

      // El TypeScript no lo sabe, pero `preguntarPorLoQueFalta` ya
      // garantizó que estos tres están.
      const monto = leido.monto!;
      const descripcion = leido.descripcion!;
      const fecha = leido.fecha!;

      // Sin moneda dicha, pesos. Es la moneda del país y la que Beno usa
      // en la mayoría de las cargas; la respuesta lo dice para que se vea.
      const moneda: Moneda = leido.moneda ?? "ARS";

      // Regla 6.c en una línea: histórico primero, modelo solo si no
      // encontró nada. Nunca se reimplementa acá.
      const sugerencia = await sugerirClasificacion(supabase, descripcion);

      /*
        El signo le gana a la clasificación para el tipo, y no es un
        empate arbitrario: el "-" lo escribió Beno en esta frase, mientras
        que el histórico habla de otras veces. Si no hay ninguno de los
        dos, egreso — que es lo que dice el prompt del clasificador
        ("ante la duda sobre el tipo, es egreso: la enorme mayoría de los
        movimientos lo son") y lo que el formulario ya trae por defecto.
      */
      const tipo: TipoMovimiento = leido.tipo ?? sugerencia?.tipo ?? "egreso";

      /*
        Y si la categoría que salió es del otro tipo, no se precarga. Pasa
        cuando el signo dice una cosa y el histórico otra: una categoría de
        ingreso puesta en un egreso desaparecería sola del `select` en
        cuanto el formulario filtra por tipo, y Beno vería la marca de
        "como las 3 veces anteriores" al lado de un campo vacío.
      */
      const categoria = sugerencia && sugerencia.tipo === tipo ? sugerencia : null;

      // El proyecto sale del texto de la descripción, igual que en la
      // bitácora: "Venta Proder" nombra un proyecto. Si nombra más de uno o
      // ninguno, va compartido, que es el default del formulario.
      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const nombrado = resolverProyecto(descripcion, proyectos ?? []);
      // Sin filtro por estado, y es deliberado: que un proyecto esté
      // cerrado no impide imputarle un gasto. Al revés — un gasto de un
      // proyecto cerrado va a ese proyecto, que para eso se cerró en esa
      // fecha y no en otra. Filtrar acá mandaba el movimiento a
      // "Compartido" en silencio, que es lo que le pasó a Beno el
      // 2026-08-10 al cargar un gasto en Gentius.
      const proyecto = nombrado !== "ambiguo" ? nombrado : null;

      const procedencia = {
        descripcion: describirFuente(leido.fuentes.descripcion),
        monto: `${describirFuente(leido.fuentes.monto)}${
          leido.moneda ? "" : ", en pesos porque no dijiste la moneda"
        }`,
        // Cómo la nombró él, salvo que la haya escrito en números: repetir
        // "10/08/2026 — de tu frase (10/08/2026)" no informa nada.
        fecha:
          leido.etiquetaFecha && leido.etiquetaFecha !== formatDate(fecha)
            ? `de tu frase, por el “${leido.etiquetaFecha}”`
            : "de tu frase",
        tipo:
          leido.tipo !== null
            ? `del signo “${tipo === "ingreso" ? "+" : "-"}” de tu frase`
            : sugerencia
              ? describirHistorico(sugerencia)
              : "por defecto: casi todo es egreso",
        categoria: categoria ? describirHistorico(categoria) : null,
        proyecto: proyecto ? "lo nombraste en la descripción" : "compartido",
      };

      const cuerpo = [
        `Descripción: ${descripcion} — ${procedencia.descripcion}`,
        `Monto: ${formatMoney(monto, moneda)} — ${procedencia.monto}`,
        `Tipo: ${tipo} — ${procedencia.tipo}`,
        categoria
          ? `Categoría: ${categoria.categoriaNombre} — ${procedencia.categoria}`
          : "Categoría: sin elegir — elegila vos",
        `Fecha: ${formatDate(fecha)} — ${procedencia.fecha}`,
        `Proyecto: ${proyecto ? proyecto.nombre : "Compartido"} — ${procedencia.proyecto}`,
        leido.degradado
          ? "\nEsto lo saqué con un regex porque no pude hablar con el modelo: revisalo bien."
          : null,
      ]
        .filter((linea): linea is string => linea !== null)
        .join("\n");

      return {
        clase: "movimiento",
        destino: "movimientos",
        titulo: "Esto entendí. Revisalo y cargalo",
        cuerpo,
        precarga: {
          descripcion,
          monto,
          moneda,
          fecha,
          tipo,
          categoryId: categoria?.categoryId ?? null,
          projectId: proyecto?.id ?? null,
          procedencia,
        },
      };
    }

    case "presupuesto": {
      /*
        ⚠ **Esta rama no llama a `estimarEsfuerzo()`, a propósito.**

        Podría: la función existe y el route handler también. Pero lo que
        devuelve es producción de un modelo que termina, palabra por
        palabra, adentro de un PDF que se le manda a un cliente con el
        nombre de Beno. Que eso arranque solo porque una frase se pareció
        a un pedido de presupuesto es exactamente lo que la regla 6
        prohíbe, y además cuesta el razonador con `maxTokens 4500` y la
        espera entera del limitador — minutos, por una derivación que el
        recepcionista puede haber leído mal.

        Así que esto hace lo mismo que `movimientos`: deja el pedido
        pegado en la pantalla de alta y **el botón lo aprieta Beno**. Ahí
        el formulario es el panel de confirmación, con los ítems marcados
        como del modelo y cada cita verificada contra el pedido.
      */
      /*
        La frase entera y no el argumento recortado, por el mismo motivo
        por el que `movimientos` tiene `textoDelMovimiento()`: el pedido
        del cliente ES el texto, y contra ese texto se verifican después
        las citas de cada entregable. Un argumento que se comió media
        frase produciría un presupuesto sobre medio pedido. El argumento
        queda como red por si la frase pedía varias cosas y solo una parte
        era el pedido.
      */
      const pedido = frase.trim() || (decision.argumento?.trim() ?? "");

      // Viaja por la query, así que tiene que entrar en una URL. Hoy no
      // puede no entrar —el handler capa `frase` en 1000 caracteres— y el
      // chequeo está igual: el día que ese tope suba, medio pedido pegado
      // en silencio produce medio presupuesto sin que nada lo avise.
      const entra = pedido.length > 0 && pedido.length <= PEDIDO_EN_URL_CHARS;

      return {
        clase: "presupuesto",
        destino: "presupuesto",
        titulo: "Te abro el presupuesto para armarlo",
        cuerpo: [
          entra
            ? "Te llevo lo que escribiste al campo del pedido."
            : "No te llevo el texto: pegalo en la pantalla y estimá desde ahí.",
          "Todavía no estimé nada. Ahí adentro apretás “Estimar los entregables” y el modelo propone los ítems con horas, supuestos y preguntas — todo editable, y nada se guarda hasta que crees el presupuesto.",
        ].join("\n"),
        href: entra
          ? `/presupuestos/nuevo?pedido=${encodeURIComponent(pedido)}`
          : "/presupuestos/nuevo",
      };
    }

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

    case "bitacora": {
      /*
        Esta rama ESCRIBE en `daily_log`, directo y sin pasar por la
        bandeja. No contradice la regla 6, y **no como excepción**: lo que
        la regla 6 protege es que no se guarde producción de un modelo sin
        que Beno la confirme, y acá el texto es de Beno palabra por
        palabra. El agente **transcribe literal** — no reformula, no
        resume, no corrige y no mejora—. Lo único que un modelo toca es
        recortar de la frase qué parte es la anotación (el recepcionista,
        que tiene prohibido reformular el argumento) y, en código, la
        fecha cuando la frase la menciona.

        ⚠ Si alguna vez se le mete a ese prompt una instrucción de
        mejorar, resumir o corregir el texto, el razonamiento deja de
        valer y esta rama pasa a necesitar la bandeja. El desarrollo está
        en `agentes/bitacora.ts` y en el spec de agentes; no lo borres.

        Lo que sí obliga es a que la respuesta diga **exactamente** qué se
        escribió, con qué fecha y en qué proyecto: el riesgo que queda no
        es el texto, es la derivación equivocada. Como borrar es archivar
        (regla 4), deshacerlo desde Bitácora no pierde nada.
      */
      const anotacion = leerAnotacion(decision.argumento);

      if (!anotacion.contenido) {
        return {
          clase: "aviso",
          titulo: "¿Qué querés que anote?",
          cuerpo:
            "Decime qué pasó y lo guardo en la bitácora tal cual me lo escribas.",
        };
      }

      const { data: proyectos } = await supabase
        .from("projects")
        .select("*")
        .order("nombre");

      const todos = proyectos ?? [];

      // El proyecto se busca en la anotación entera: si nombra uno, va
      // ahí. `"ambiguo"` (más de un nombre adentro del texto) cae al de
      // por defecto igual que si no hubiera nombrado ninguno — preguntar
      // costaría hacerle retipear lo que acaba de escribir, y la
      // respuesta ya dice a qué proyecto fue.
      const nombrado = resolverProyecto(anotacion.contenido, todos);
      const porNombre = nombrado !== "ambiguo" ? nombrado : null;

      // Mismo criterio que el formulario de Bitácora, y de un solo lugar
      // para que no se separen: el proyecto de estudio y si no, el
      // primero de la lista, abierto o cerrado.
      // `daily_log.project_id` es NOT NULL, así que sin ninguno no hay
      // entrada posible.
      const proyecto = porNombre ?? proyectoPorDefectoDeBitacora(todos);

      // Ojo con el texto: esto dispara cuando no hay NINGÚN proyecto, no
      // cuando no hay ninguno abierto. Un proyecto cerrado sirve igual
      // para colgarle una entrada.
      if (!proyecto) {
        return {
          clase: "aviso",
          titulo: "Todavía no tenés ningún proyecto",
          cuerpo:
            "Una entrada de bitácora cuelga siempre de un proyecto. Creá uno desde Ajustes y te la guardo ahí.",
        };
      }

      const { data: entrada, error } = await crearEntradaDeBitacora(
        supabase,
        userId,
        {
          contenido: anotacion.contenido,
          fecha: anotacion.fecha,
          projectId: proyecto.id,
        },
      );

      if (error || !entrada) {
        return {
          clase: "aviso",
          titulo: "No pude anotarlo",
          cuerpo: error?.message ?? "La entrada no se guardó.",
        };
      }

      return {
        clase: "texto",
        destino: "bitacora",
        titulo: `Anoté en la bitácora del ${formatDate(entrada.fecha)}`,
        cuerpo: [
          // Primero el texto guardado y entre comillas: es lo único que
          // no se puede verificar de memoria, y va literal para que se
          // note al toque si el recepcionista recortó de más.
          `“${entrada.contenido}”`,
          "",
          anotacion.fechaExplicita
            ? `Fecha: ${formatDate(entrada.fecha)}, por el “${anotacion.etiquetaFecha}” de tu frase.`
            : `Fecha: ${formatDate(entrada.fecha)} (hoy). No dijiste ninguna.`,
          porNombre
            ? `Proyecto: ${proyecto.nombre}, porque lo nombraste.`
            : `Proyecto: ${proyecto.nombre}. Es donde van las entradas cuando no decís cuál; si iba a otro, cambialo desde Bitácora.`,
          "Lo guardé tal cual lo escribiste, sin reformular nada.",
          "Si no era esto, archivalo desde Bitácora. Acá borrar es archivar, así que no se pierde.",
        ].join("\n"),
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
 * Hasta cuánto pedido viaja por la query de `/presupuestos/nuevo`.
 *
 * Node corta la línea de pedido de una request bastante antes que los
 * headers (el `--max-http-header-size=32768` del `dev` y el `start` no
 * cubre esto), y 1500 caracteres codificados son ~4500 en el peor caso.
 * Es de sobra para lo que se escribe en la caja: el argumento del
 * recepcionista está capado en 300.
 */
const PEDIDO_EN_URL_CHARS = 1_500;

// ─────────────────────────────────────────────────────────────
// Movimientos
// ─────────────────────────────────────────────────────────────

/**
 * Con qué texto trabaja el agente de movimientos.
 *
 * Normalmente el argumento del recepcionista, que ya viene con la parte de
 * plata recortada y es lo único que sirve cuando la frase pidió varias
 * cosas. Pero **si ese recorte se comió el número, gana la frase entera**:
 * un argumento sin monto no se puede cargar, y volver a preguntar algo que
 * Beno ya escribió es el peor final posible. Es una red barata —un test
 * sobre un string, sin llamadas— contra la única forma de fallar de este
 * destino que no se recupera sola.
 */
function textoDelMovimiento(argumento: string | null, frase: string): string {
  const recortado = argumento?.trim() ?? "";
  const entera = frase.trim();

  if (!recortado) return entera;
  if (/\d/.test(recortado)) return recortado;

  return /\d/.test(entera) ? entera : recortado;
}

/**
 * Lo que falta, preguntado de a uno.
 *
 * Los datos necesarios son **monto, descripción y fecha**. La moneda no
 * está en esa lista: sin decir nada son pesos, y la respuesta lo aclara.
 * El tipo tampoco: sale del signo, del histórico o —última opción— del
 * default de egreso.
 *
 * Cada pregunta vuelve con **todo lo ya entendido adentro** de
 * `plantilla`, así que contestar cuesta escribir el dato que falta y nada
 * más. Sin eso, preguntar sería peor que abrir el formulario.
 */
function preguntarPorLoQueFalta(
  leido: MovimientoLeido,
  hoy: string,
): RespuestaSimple | null {
  const aclaracion = leido.degradado
    ? " No pude hablar con el modelo, así que leí lo que pude con un regex."
    : "";

  if (leido.monto === null) {
    return {
      clase: "completar",
      destino: "movimientos",
      titulo: "¿De cuánto fue?",
      cuerpo: `No encontré ningún monto en lo que escribiste, y no me lo voy a inventar.${aclaracion}`,
      ejemplo: "20 usd",
      plantilla: plantillaCanonica(leido, "monto"),
    };
  }

  if (!leido.descripcion) {
    return {
      clase: "completar",
      destino: "movimientos",
      titulo: "¿De qué era?",
      cuerpo: `Sin descripción no puedo buscar en el histórico cómo lo clasificaste las veces anteriores.${aclaracion}`,
      ejemplo: "Claude Code",
      plantilla: plantillaCanonica(leido, "descripcion"),
    };
  }

  if (!leido.fecha) {
    return {
      clase: "completar",
      destino: "movimientos",
      titulo: "¿De qué día es?",
      cuerpo:
        "No dijiste ninguna y no la asumo: un gasto de la semana pasada anotado hoy cae en el mes equivocado y también agarra la cotización equivocada.",
      ejemplo: "06/08",
      plantilla: plantillaCanonica(leido, "fecha"),
      // Los dos días que cubren casi todas las cargas van de un click; el
      // resto se escribe, que es justamente para lo que existe `completar`.
      opciones: [
        { etiqueta: "Hoy", valor: formatDayMonth(hoy) },
        { etiqueta: "Ayer", valor: formatDayMonth(addDays(hoy, -1)) },
      ],
    };
  }

  return null;
}

/**
 * Rearma lo entendido como una frase telegráfica, con `{}` donde falta.
 *
 * La gracia es que lo que vuelve **es del formato que el regex resuelve
 * solo**: la segunda vuelta no gasta ninguna llamada al modelo y no puede
 * leer distinto lo que ya había leído bien. Es el mismo truco que usa la
 * pregunta de proyecto de `lecciones_tema` con su `"tema — slug"`, pero en
 * el idioma en el que Beno ya escribe.
 */
function plantillaCanonica(
  leido: MovimientoLeido,
  hueco: "monto" | "descripcion" | "fecha",
): string {
  const signo =
    leido.tipo === "ingreso" ? "+" : leido.tipo === "egreso" ? "-" : "";

  const cabeza =
    hueco === "monto"
      ? "{}"
      : `${signo}${leido.monto} ${leido.moneda ?? ""}`.trim();

  const descripcion = hueco === "descripcion" ? "{}" : (leido.descripcion ?? "");

  const fecha =
    hueco === "fecha" ? "{}" : leido.fecha ? formatDayMonth(leido.fecha) : "";

  return [cabeza, descripcion, fecha].filter(Boolean).join(" ");
}

/** De dónde salió un campo, en criollo y listo para mostrar. */
function describirFuente(fuente: MovimientoLeido["fuentes"]["monto"]): string {
  switch (fuente) {
    case "modelo":
      return "de tu frase, leída por el modelo";
    case "signo":
      return "del signo de tu frase";
    case "defecto":
      return "por defecto";
    default:
      return "de tu frase";
  }
}

/**
 * Lo mismo para la clasificación, con las palabras exactas que ya usa el
 * formulario: "como las 3 veces anteriores" no es lo mismo que "como los
 * meses anteriores", y ninguna de las dos es lo mismo que "sugerida".
 */
function describirHistorico(sugerencia: Sugerencia): string {
  if (sugerencia.origen !== "historico") return "sugerida por el modelo";
  if (!sugerencia.exacto) return "como los meses anteriores";

  return sugerencia.veces === 1
    ? "como la vez anterior"
    : `como las ${sugerencia.veces} veces anteriores`;
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
