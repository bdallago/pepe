"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Clock, Pencil, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  aceptarLeccion,
  aceptarMovimientoDictado,
  aceptarNotaDeAdjunto,
  aceptarProyectoDictado,
  aceptarZombie,
  descartarErrorBandeja,
  posponerItemBandeja,
  rechazarItemBandeja,
  type EdicionMovimiento,
} from "@/lib/actions/inbox";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { Json } from "@/lib/supabase/database.types";
import type {
  CategoriaLeccion,
  EstadoBandeja,
  TipoBandeja,
} from "@/lib/supabase/database.types";

/**
 * Triage de la bandeja.
 *
 * La vara del spec es explícita: procesar la cola tiene que ser rapidísimo,
 * al estilo de Linear. **Un ítem por vez, sin scroll, todo con teclado.**
 * Si revisar veinte propuestas cuesta veinte clicks, la bandeja se abandona
 * en dos semanas y todo el diseño de confirmación humana pierde sentido.
 *
 * De ahí las tres decisiones que mandan sobre el resto del componente:
 *
 * 1. **La acción se aplica al instante y en optimista.** El ítem sale de la
 *    lista antes de que conteste el servidor y aparece el siguiente. Si la
 *    escritura falla, vuelve a su lugar y se avisa. Esperar el round-trip
 *    entre ítem e ítem rompe el ritmo, que es justamente lo que hay que
 *    cuidar.
 * 2. **El embedding de la lección aceptada no se espera.** Se dispara
 *    contra `/api/lecciones/indexar` y se sigue: el modelo frío tarda
 *    decenas de segundos y no hay razón para que el triage los pague.
 * 3. **En mobile el equivalente del teclado es el swipe.** Derecha acepta,
 *    izquierda rechaza, con el gesto acompañado en pantalla para que se vea
 *    qué va a pasar antes de soltar.
 */

const CATEGORIAS: { valor: CategoriaLeccion; label: string }[] = [
  { valor: "tecnica", label: "Técnica" },
  { valor: "producto", label: "Producto" },
  { valor: "comercial", label: "Comercial" },
  { valor: "proceso", label: "Proceso" },
  { valor: "personal", label: "Personal" },
];

const TIPO_LABEL: Record<TipoBandeja, string> = {
  categorizacion: "Categoría de movimiento",
  zombie: "Suscripción zombie",
  leccion_sugerida: "Lección sugerida",
  leccion_extraida: "Lección de la bitácora",
  retro: "Retro de proyecto",
  nota_de_adjunto: "Nota de una captura",
  // Los cinco que entran por el conector MCP. "Dictado" y no "de Claude":
  // lo que importa no es qué programa lo mandó, es que lo dijo él.
  movimiento_dictado: "Movimiento dictado",
  leccion_dictada: "Lección dictada",
  proyecto_dictado: "Proyecto dictado",
  presupuesto_dictado: "Presupuesto dictado",
  nota_dictada: "Nota dictada",
};

/** El valor del selector de proyecto que significa "gasto compartido". */
const COMPARTIDO = "compartido";

const BUCKET_ADJUNTOS = "adjuntos";

/** Cuánto hay que arrastrar para que el swipe cuente como decisión. */
const UMBRAL_SWIPE = 90;

export interface ItemBandeja {
  id: string;
  tipo: TipoBandeja;
  estado: EstadoBandeja;
  payload: Json;
  errorDetalle: string | null;
  /** La entrada de bitácora de la que salió, para verla al lado. */
  entrada: { fecha: string; contenido: string } | null;
}

interface Propuesta {
  titulo: string;
  contenido: string;
  categoria: CategoriaLeccion;
  fecha: string;
  /**
   * Opcional solo para las que salieron de un archivo pegado: al pegarlo
   * puede no saberse a qué proyecto va. Las demás lo heredan resuelto.
   */
  project_id?: string;
  /** Solo en las generadas: el pedido que las originó (spec 6.3). */
  tema?: string;
  /** Solo en las de retro: de qué cierre salieron (spec 6.5). */
  retro_titulo?: string;
  /** Solo en las que salieron de un adjunto: de qué archivo. */
  adjunto_nombre?: string;
  /** Lo que Beno escribió al pegar el archivo. */
  frase?: string;
}

/**
 * Lo que propone una captura: una **entrada de bitácora**, no una
 * lección.
 *
 * "Esto me contestó un cliente" es algo que pasó. Y una vez que la
 * entrada existe, el pase de extracción que ya está hecho la mira y, si
 * tiene una lección adentro, la propone.
 */
interface Nota {
  contenido: string;
  fecha: string;
  project_id?: string;
  de_que_es: string;
  adjunto_nombre: string;
  storage_path: string;
  frase?: string;
}

function leerNota(payload: Json): Nota | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.contenido !== "string" || typeof p.fecha !== "string") {
    return null;
  }
  return {
    contenido: p.contenido,
    fecha: p.fecha,
    project_id: typeof p.project_id === "string" ? p.project_id : undefined,
    de_que_es: typeof p.de_que_es === "string" ? p.de_que_es : "Una imagen",
    adjunto_nombre:
      typeof p.adjunto_nombre === "string" ? p.adjunto_nombre : "la captura",
    storage_path: typeof p.storage_path === "string" ? p.storage_path : "",
    frase: typeof p.frase === "string" ? p.frase : undefined,
  };
}

/** Lo que muestra un aviso de suscripción sin uso (spec 6.2). */
interface Zombie {
  descripcion: string;
  aviso: string;
  monto_origen: number;
  moneda_origen: "ARS" | "USD";
  project_id: string | null;
  meses_con_cargo: number;
  ultimo_cargo: string;
  ultima_actividad: string;
  dias_sin_actividad: number;
  recurrence_id: string | null;
}

function leerZombie(payload: Json): Zombie | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.descripcion !== "string" || typeof p.aviso !== "string") {
    return null;
  }
  return {
    descripcion: p.descripcion,
    aviso: p.aviso,
    monto_origen: Number(p.monto_origen ?? 0),
    moneda_origen: p.moneda_origen === "USD" ? "USD" : "ARS",
    project_id: typeof p.project_id === "string" ? p.project_id : null,
    meses_con_cargo: Number(p.meses_con_cargo ?? 0),
    ultimo_cargo: typeof p.ultimo_cargo === "string" ? p.ultimo_cargo : "",
    ultima_actividad:
      typeof p.ultima_actividad === "string" ? p.ultima_actividad : "",
    dias_sin_actividad: Number(p.dias_sin_actividad ?? 0),
    recurrence_id:
      typeof p.recurrence_id === "string" ? p.recurrence_id : null,
  };
}

/**
 * Lo que propone `registrar_movimiento` del conector MCP.
 *
 * `compartido` y "no vino `project_id`" son dos cosas distintas y por eso
 * son dos campos: el primero es una decisión —se reparte entre los
 * proyectos que estaban abiertos en la fecha del gasto— y el segundo es
 * que Claude no supo a cuál va. En la
 * base los dos terminan en `project_id = null`, así que confundirlos
 * guardaría "no sé de quién es" como "es de todos", en silencio.
 */
interface Movimiento {
  descripcion: string;
  fecha: string;
  monto_origen: number;
  moneda_origen: "ARS" | "USD";
  estado: "efectuado" | "planificado";
  project_id?: string;
  compartido?: boolean;
  category_id?: string;
  categoria_nombre?: string;
  /** Cómo salió la categoría propuesta, en castellano. */
  sugerencia?: string;
}

function leerMovimiento(payload: Json): Movimiento | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.descripcion !== "string" ||
    typeof p.fecha !== "string" ||
    typeof p.monto_origen !== "number"
  ) {
    return null;
  }
  return {
    descripcion: p.descripcion,
    fecha: p.fecha,
    monto_origen: p.monto_origen,
    moneda_origen: p.moneda_origen === "USD" ? "USD" : "ARS",
    estado: p.estado === "planificado" ? "planificado" : "efectuado",
    project_id: typeof p.project_id === "string" ? p.project_id : undefined,
    compartido: p.compartido === true,
    category_id: typeof p.category_id === "string" ? p.category_id : undefined,
    categoria_nombre:
      typeof p.categoria_nombre === "string" ? p.categoria_nombre : undefined,
    sugerencia: typeof p.sugerencia === "string" ? p.sugerencia : undefined,
  };
}

/** Lee el payload jsonb con desconfianza: la base no garantiza su forma. */
function leerPropuesta(payload: Json): Propuesta | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.titulo !== "string" ||
    typeof p.contenido !== "string" ||
    typeof p.categoria !== "string" ||
    typeof p.fecha !== "string"
  ) {
    return null;
  }
  return {
    titulo: p.titulo,
    contenido: p.contenido,
    categoria: p.categoria as CategoriaLeccion,
    fecha: p.fecha,
    project_id: typeof p.project_id === "string" ? p.project_id : undefined,
    tema: typeof p.tema === "string" ? p.tema : undefined,
    retro_titulo:
      typeof p.retro_titulo === "string" ? p.retro_titulo : undefined,
    adjunto_nombre:
      typeof p.adjunto_nombre === "string" ? p.adjunto_nombre : undefined,
    frase: typeof p.frase === "string" ? p.frase : undefined,
  };
}

/**
 * La imagen de la que salió la nota, al lado del texto propuesto.
 *
 * **No es decoración: es la salvaguarda contra lo inventado.** Es el mismo
 * criterio que el `ancla` de las sugerencias de estudio y el `dato` de las
 * observaciones — poder ver la fuente al lado es lo único que deja
 * descartar de un vistazo una transcripción que no se parece a nada.
 * Acá pesa más que en ningún otro lado, porque el texto propuesto se lee
 * como si lo hubiera dicho un cliente.
 *
 * La URL se firma en el browser y dura una hora, igual que en
 * `comprobante-input.tsx`. El bucket es privado y nunca hay URL pública.
 */
/** Lo que propone `registrar_proyecto`. */
interface ProyectoDictado {
  nombre: string;
  de_que_se_trata?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  presupuesto?: PresupuestoDictado;
}

/** Lo que propone `registrar_presupuesto`, y lo que viaja adentro del otro. */
interface PresupuestoDictado {
  cliente_nombre: string;
  cliente_tipo: "particular" | "pyme" | "empresa";
  titulo: string;
  resumen_alcance?: string;
  items: {
    titulo: string;
    detalle?: string;
    horas: number;
    ancla?: string | null;
  }[];
  supuestos?: string[];
  preguntas?: string[];
}

function leerPresupuestoDictado(valor: unknown): PresupuestoDictado | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return null;
  }
  const p = valor as Record<string, unknown>;
  if (typeof p.cliente_nombre !== "string" || typeof p.titulo !== "string") {
    return null;
  }
  if (!Array.isArray(p.items) || p.items.length === 0) return null;

  return {
    cliente_nombre: p.cliente_nombre,
    cliente_tipo:
      p.cliente_tipo === "empresa" || p.cliente_tipo === "pyme"
        ? p.cliente_tipo
        : "particular",
    titulo: p.titulo,
    resumen_alcance:
      typeof p.resumen_alcance === "string" ? p.resumen_alcance : undefined,
    items: (p.items as Record<string, unknown>[]).map((i) => ({
      titulo: typeof i.titulo === "string" ? i.titulo : "Sin título",
      detalle: typeof i.detalle === "string" ? i.detalle : undefined,
      horas: Number(i.horas ?? 0),
      ancla: typeof i.ancla === "string" ? i.ancla : null,
    })),
    supuestos: Array.isArray(p.supuestos)
      ? (p.supuestos as string[])
      : undefined,
    preguntas: Array.isArray(p.preguntas)
      ? (p.preguntas as string[])
      : undefined,
  };
}

function leerProyectoDictado(payload: Json): ProyectoDictado | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.nombre !== "string") return null;

  return {
    nombre: p.nombre,
    de_que_se_trata:
      typeof p.de_que_se_trata === "string" ? p.de_que_se_trata : undefined,
    fecha_inicio: typeof p.fecha_inicio === "string" ? p.fecha_inicio : undefined,
    fecha_fin: typeof p.fecha_fin === "string" ? p.fecha_fin : undefined,
    presupuesto: leerPresupuestoDictado(p.presupuesto) ?? undefined,
  };
}

/**
 * El presupuesto propuesto, con **las horas y ningún precio**.
 *
 * ⚠ El precio no está y no es un olvido: lo calcula la app al aceptar, con
 * la tarifa de Ajustes y el multiplicador del tipo de cliente. Mostrar acá
 * un número que dijo el modelo sería mostrar un precio que no es el que se
 * va a guardar.
 */
function PresupuestoPropuesto({ p }: { p: PresupuestoDictado }) {
  const horas = p.items.reduce((total, i) => total + i.horas, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{p.titulo}</p>
        <span className="text-muted-foreground text-xs">
          {p.cliente_nombre} · {p.cliente_tipo}
        </span>
      </div>

      {p.resumen_alcance && <p className="text-sm">{p.resumen_alcance}</p>}

      <ul className="space-y-2">
        {p.items.map((i, indice) => (
          <li key={indice} className="text-sm">
            <span className="font-medium">{i.titulo}</span>{" "}
            <span className="cifra text-muted-foreground">{i.horas} h</span>
            {i.detalle && (
              <p className="text-muted-foreground text-xs">{i.detalle}</p>
            )}
            {/*
              La cita del pedido al lado del entregable es la salvaguarda
              contra el ítem inventado, igual que el `ancla` de las
              sugerencias de estudio. Se guarda SIN verificar —del lado del
              conector nadie la comprobó contra el pedido— y por eso se
              muestra como cita y no como respaldo.
            */}
            {i.ancla && (
              <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">
                “{i.ancla}”
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-xs">
        <span className="cifra">{horas}</span> horas en total.{" "}
        <strong>El precio no lo puso Claude</strong>: lo calcula Pepe con tu
        tarifa de Ajustes y el multiplicador de “{p.cliente_tipo}” cuando
        aceptes. Nace en borrador y no queda colgado de ningún proyecto hasta
        que lo aceptes desde Presupuestos.
      </p>

      {p.supuestos && p.supuestos.length > 0 && (
        <div className="text-muted-foreground text-xs">
          <p className="font-medium">Supuestos</p>
          <ul className="list-disc pl-4">
            {p.supuestos.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {p.preguntas && p.preguntas.length > 0 && (
        <div className="text-muted-foreground text-xs">
          <p className="font-medium">Preguntas para el cliente</p>
          <ul className="list-disc pl-4">
            {p.preguntas.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProyectoPropuesto({ p }: { p: ProyectoDictado }) {
  const desde = p.fecha_inicio ? formatDate(p.fecha_inicio) : "siempre";
  const hasta = p.fecha_fin ? formatDate(p.fecha_fin) : "sigue abierto";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">{p.nombre}</p>
        <p className="text-muted-foreground cifra text-xs">
          De {desde} a {hasta}
        </p>
      </div>

      {p.de_que_se_trata && <p className="text-sm">{p.de_que_se_trata}</p>}

      {/*
        ⚠ El aviso más importante de esta tarjeta. Un proyecto sin
        `fecha_inicio` está vivo DESDE SIEMPRE (`estaVivo()` con la punta
        nula es "desde siempre"), así que entra en el reparto de TODOS los
        gastos compartidos del histórico y reescribe cuánto costó cada uno
        de los otros. Sin decirlo acá, se descubre tres pantallas después.
      */}
      {!p.fecha_inicio && (
        <p className="text-muted-foreground border-l-2 pl-3 text-xs">
          Sin fecha de inicio, este proyecto cuenta como abierto{" "}
          <strong>desde siempre</strong>: entra en el reparto de todos los
          gastos compartidos que ya tenés cargados y cambia cuánto costó cada
          uno de los otros. Si arrancó en una fecha, ponésela en Ajustes
          después de aceptar.
        </p>
      )}

      {p.presupuesto && (
        <div className="border-t border-dashed pt-3">
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            Con este presupuesto adentro
          </h3>
          <PresupuestoPropuesto p={p.presupuesto} />
        </div>
      )}

      <p className="text-muted-foreground border-t border-dashed pt-3 text-xs">
        Aceptar <strong>crea el proyecto</strong>
        {p.presupuesto ? " y su presupuesto en borrador" : ""}. El color y el
        peso de prorrateo quedan en los valores por defecto: se cambian desde
        Ajustes.
      </p>
    </div>
  );
}

function MiniaturaAdjunto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    if (!path) return;

    void (async () => {
      const { data } = await createClient()
        .storage.from(BUCKET_ADJUNTOS)
        .createSignedUrl(path, 60 * 60);
      if (!cancelado) setUrl(data?.signedUrl ?? null);
    })();

    return () => {
      cancelado = true;
    };
  }, [path]);

  if (!url) {
    return (
      <div className="bg-muted text-muted-foreground flex h-48 items-center justify-center rounded-md text-xs">
        Cargando la imagen…
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="max-h-96 w-full rounded-md border object-contain"
      />
    </a>
  );
}

function Atajo({ tecla, children }: { tecla: string; children: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
        {tecla}
      </kbd>
      {children}
    </span>
  );
}

export function BandejaView({
  items: itemsIniciales,
  hayModelo,
}: {
  items: ItemBandeja[];
  hayModelo: boolean;
}) {
  const { projects, categoriasVigentes } = useAppData();
  const [items, setItems] = useState(itemsIniciales);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Propuesta | null>(null);
  const [borradorNota, setBorradorNota] = useState<string | null>(null);
  /**
   * Solo se usa cuando el payload **no trae proyecto**, que es el caso de
   * lo que entró por un archivo pegado. Con proyecto en el payload, esto
   * ni se muestra: mover una lección a otro proyecto sería inventar de
   * dónde vino.
   */
  const [proyectoElegido, setProyectoElegido] = useState<string | null>(null);
  /**
   * Los dos selectores de un movimiento dictado.
   *
   * Van aparte de `proyectoElegido` porque acá el selector de proyecto
   * tiene una opción que allá no existe —"compartido"— y porque siempre
   * está a la vista: no aparece solo cuando falta el dato, sino que
   * muestra lo propuesto y deja corregirlo.
   */
  const [categoriaMovimiento, setCategoriaMovimiento] = useState<string | null>(
    null,
  );
  const [proyectoMovimiento, setProyectoMovimiento] = useState<string | null>(
    null,
  );
  const [extrayendo, setExtrayendo] = useState(false);
  const [arrastre, setArrastre] = useState(0);
  const [, iniciarTransicion] = useTransition();

  const inicioTouch = useRef<{ x: number; y: number } | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  // El servidor manda una lista nueva después de cada revalidate. Se
  // adopta sin pisar el optimismo: si acá ya sacamos el ítem, la lista de
  // arriba tampoco lo trae.
  useEffect(() => {
    setItems(itemsIniciales);
  }, [itemsIniciales]);

  const actual = items[0] ?? null;
  const esZombie = actual?.tipo === "zombie";
  // Los dos tipos que terminan en una entrada de bitácora. Comparten el
  // payload, la action de aceptación y la mitad derecha de la tarjeta; lo
  // único que cambia es de dónde salió el texto, que es la columna
  // izquierda.
  const esNota =
    actual?.tipo === "nota_de_adjunto" || actual?.tipo === "nota_dictada";
  const esNotaDictada = actual?.tipo === "nota_dictada";
  const esMovimiento = actual?.tipo === "movimiento_dictado";
  const esProyecto = actual?.tipo === "proyecto_dictado";
  const propuesta =
    actual && !esZombie && !esNota && !esMovimiento && !esProyecto
      ? leerPropuesta(actual.payload)
      : null;
  const zombie = actual && esZombie ? leerZombie(actual.payload) : null;
  const nota = actual && esNota ? leerNota(actual.payload) : null;
  const movimiento =
    actual && esMovimiento ? leerMovimiento(actual.payload) : null;
  const proyectoDictado =
    actual && esProyecto ? leerProyectoDictado(actual.payload) : null;
  const esError = actual?.estado === "error";

  // Falta el proyecto y hay que elegirlo. Pasa solo con lo que entró por
  // un archivo pegado: `lessons.project_id` y `daily_log.project_id` son
  // los dos NOT NULL, así que sin esto no hay nada que aceptar. Un
  // movimiento no pasa por acá: tiene su propio selector, siempre a la
  // vista y con la opción "compartido" que este no tiene.
  const proyectoDelPayload = esNota ? nota?.project_id : propuesta?.project_id;
  const faltaProyecto =
    !esError &&
    !esZombie &&
    !esMovimiento &&
    // Un proyecto dictado no tiene proyecto que elegir: **es** el
    // proyecto. Sin esta línea el selector aparecería y bloquearía el
    // botón de aceptar para siempre.
    !esProyecto &&
    (esNota ? Boolean(nota) : Boolean(propuesta)) &&
    !proyectoDelPayload;
  const projectId = proyectoDelPayload ?? proyectoElegido ?? null;

  // Lo que muestran los selectores del movimiento: lo elegido a mano si
  // lo hay, y si no lo que vino propuesto. "" = todavía no hay nada.
  const categoriaActual =
    categoriaMovimiento ?? movimiento?.category_id ?? "";
  const proyectoActual =
    proyectoMovimiento ??
    (movimiento?.compartido ? COMPARTIDO : movimiento?.project_id) ??
    "";
  const movimientoCompleto = Boolean(categoriaActual && proyectoActual);
  /**
   * El signo del monto sale de la categoría elegida, no del payload.
   *
   * Es la misma regla que aplica la action al aceptar —el tipo lo define
   * la categoría— y por eso el número cambia de signo en pantalla apenas
   * se cambia el selector: lo que se ve es lo que se va a guardar.
   */
  const tipoElegido = categoriasVigentes.find(
    (c) => c.id === categoriaActual,
  )?.tipo;

  const nombreProyecto = (id: string) =>
    projects.find((p) => p.id === id)?.nombre ?? "Proyecto archivado";

  /** Saca el ítem de la cola ya mismo y corre la escritura por atrás. */
  const resolver = useCallback(
    (
      item: ItemBandeja,
      accion: () => Promise<{ ok: boolean; error?: string }>,
      exito?: string,
    ) => {
      setItems((previos) => previos.filter((i) => i.id !== item.id));
      setEditando(false);
      setBorrador(null);
      setBorradorNota(null);
      setProyectoElegido(null);
      setCategoriaMovimiento(null);
      setProyectoMovimiento(null);
      setArrastre(0);

      iniciarTransicion(async () => {
        const resultado = await accion();
        if (!resultado.ok) {
          // Vuelve a la cola, adelante: es lo que Beno estaba mirando.
          setItems((previos) => [item, ...previos]);
          toast.error(resultado.error ?? "No se pudo guardar.");
          return;
        }
        if (exito) toast.success(exito);
      });
    },
    [],
  );

  const aceptar = useCallback(() => {
    if (!actual || esError) return;

    // Un zombie no crea nada: confirma que lo diste de baja. Si había
    // una recurrencia declarada se desactiva; si no, el gasto era un
    // patrón de movimientos y la baja la hiciste vos en el proveedor.
    if (esZombie) {
      resolver(actual, async () => {
        const resultado = await aceptarZombie(actual.id);
        if (resultado.ok && resultado.data.recurrenciaDesactivada) {
          toast.success("Recurrencia desactivada: no se genera más.");
        }
        return resultado;
      });
      return;
    }

    // Un movimiento dictado: hasta acá no hay ni un peso cargado, la
    // propuesta es una fila de `inbox` y nada más. Esto es el botón que
    // pide la regla 6.
    if (esMovimiento) {
      if (!movimiento || !movimientoCompleto) return;

      const edicion: EdicionMovimiento = {
        categoryId: categoriaActual,
        projectId: proyectoActual === COMPARTIDO ? null : proyectoActual,
      };

      resolver(
        actual,
        () => aceptarMovimientoDictado(actual.id, edicion),
        "Movimiento cargado.",
      );
      return;
    }

    // Un proyecto dictado crea el proyecto y, si viene adentro, su
    // presupuesto en borrador. Va antes del chequeo de `faltaProyecto`
    // porque no hay proyecto que elegir: **es** el proyecto.
    if (esProyecto) {
      if (!proyectoDictado) return;
      resolver(
        actual,
        async () => {
          const r = await aceptarProyectoDictado(actual.id);
          if (r.ok && r.data.avisoPresupuesto) {
            // El proyecto se creó igual: no es un fallo del ítem, es una
            // mitad que no salió, y se dice en vez de tragársela.
            toast.warning(
              `El proyecto quedó creado, pero el presupuesto no: ${r.data.avisoPresupuesto}`,
            );
          }
          return r;
        },
        "Proyecto creado.",
      );
      return;
    }

    // Falta elegir el proyecto: el botón está apagado, pero la tecla A no
    // pasa por el botón.
    if (faltaProyecto && !proyectoElegido) return;

    // Una captura propone una entrada de bitácora, no una lección: otra
    // tabla y otra acción.
    if (esNota) {
      if (!nota) return;
      const contenido = borradorNota ?? undefined;
      resolver(
        actual,
        () =>
          aceptarNotaDeAdjunto(actual.id, {
            ...(contenido ? { contenido } : {}),
            ...(nota.project_id ? {} : { projectId: proyectoElegido! }),
          }),
        "Nota guardada en la bitácora.",
      );
      return;
    }

    if (!propuesta) return;
    const edicion = {
      ...(borrador
        ? {
            titulo: borrador.titulo,
            contenido: borrador.contenido,
            categoria: borrador.categoria,
          }
        : {}),
      ...(propuesta.project_id ? {} : { projectId: proyectoElegido! }),
    };

    resolver(
      actual,
      async () => {
        const resultado = await aceptarLeccion(actual.id, edicion);
        if (resultado.ok) {
          // Indexación en segundo plano: el triage no la espera.
          void fetch("/api/lecciones/indexar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: resultado.data.lessonId }),
          }).catch(() => {
            // Sin embedding la lección sigue siendo buscable por texto y
            // el backfill la levanta después. No se molesta al usuario.
          });
        }
        return resultado;
      },
      "Lección guardada.",
    );
  }, [
    actual,
    borrador,
    borradorNota,
    categoriaActual,
    esError,
    esMovimiento,
    esNota,
    esProyecto,
    esZombie,
    faltaProyecto,
    movimiento,
    movimientoCompleto,
    nota,
    propuesta,
    proyectoActual,
    proyectoDictado,
    proyectoElegido,
    resolver,
  ]);

  const rechazar = useCallback(() => {
    if (!actual) return;
    resolver(actual, () =>
      esError ? descartarErrorBandeja(actual.id) : rechazarItemBandeja(actual.id),
    );
  }, [actual, esError, resolver]);

  const posponer = useCallback(() => {
    if (!actual || esError) return;
    resolver(actual, () => posponerItemBandeja(actual.id), "Lo vemos en 7 días.");
  }, [actual, esError, resolver]);

  const editar = useCallback(() => {
    if (!actual || esError) return;
    if (esNota) {
      if (!nota) return;
      setBorradorNota(borradorNota ?? nota.contenido);
      setEditando(true);
      return;
    }
    if (!propuesta) return;
    setBorrador(borrador ?? propuesta);
    setEditando(true);
  }, [actual, borrador, borradorNota, esError, esNota, nota, propuesta]);

  // --- Teclado ------------------------------------------------
  //
  // Los atajos son de una tecla, así que hay que apagarlos mientras se
  // escribe: sin esto, tipear "aparte" en el contenido aceptaría el ítem
  // en la primera letra.
  useEffect(() => {
    function alPresionar(evento: KeyboardEvent) {
      const destino = evento.target as HTMLElement | null;
      const escribiendo =
        destino instanceof HTMLInputElement ||
        destino instanceof HTMLTextAreaElement ||
        destino?.isContentEditable === true;

      if (escribiendo) {
        if (evento.key === "Escape") {
          setEditando(false);
          setBorrador(null);
          setBorradorNota(null);
          contenedor.current?.focus();
        }
        // Ctrl/⌘+Enter guarda desde adentro del campo: es el gesto que ya
        // existe en el resto de la app para "listo, mandalo".
        if (evento.key === "Enter" && (evento.metaKey || evento.ctrlKey)) {
          evento.preventDefault();
          aceptar();
        }
        return;
      }

      if (evento.metaKey || evento.ctrlKey || evento.altKey) return;

      switch (evento.key.toLowerCase()) {
        case "a":
          evento.preventDefault();
          aceptar();
          break;
        case "r":
          evento.preventDefault();
          rechazar();
          break;
        case "p":
          evento.preventDefault();
          posponer();
          break;
        case "e":
          evento.preventDefault();
          editar();
          break;
      }
    }

    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [aceptar, editar, posponer, rechazar]);

  // --- Swipe --------------------------------------------------
  function alTocar(evento: React.TouchEvent) {
    const t = evento.touches[0]!;
    inicioTouch.current = { x: t.clientX, y: t.clientY };
  }

  function alMover(evento: React.TouchEvent) {
    if (!inicioTouch.current || editando) return;
    const t = evento.touches[0]!;
    const dx = t.clientX - inicioTouch.current.x;
    const dy = t.clientY - inicioTouch.current.y;
    // Si el gesto es más vertical que horizontal, es scroll: no se toca.
    if (Math.abs(dy) > Math.abs(dx)) return;
    setArrastre(dx);
  }

  function alSoltar() {
    const dx = arrastre;
    inicioTouch.current = null;
    if (dx > UMBRAL_SWIPE) aceptar();
    else if (dx < -UMBRAL_SWIPE) rechazar();
    else setArrastre(0);
  }

  async function correrPase() {
    setExtrayendo(true);
    try {
      const respuesta = await fetch("/api/bandeja/extraer", { method: "POST" });
      const resultado = await respuesta.json();

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      const { propuestas, sinLeccion, errores, restantes, interrumpidoPor } =
        resultado.data;

      if (propuestas === 0 && sinLeccion === 0 && errores === 0) {
        toast.info("No quedaban entradas nuevas para revisar.");
      } else {
        toast.success(
          `${propuestas} ${propuestas === 1 ? "propuesta" : "propuestas"}. ` +
            `${sinLeccion} sin lección${errores > 0 ? `, ${errores} con error` : ""}.`,
        );
      }

      if (interrumpidoPor) {
        toast.warning(`Quedó a mitad: ${interrumpidoPor} Volvé a intentar.`);
      } else if (restantes > 0) {
        toast.info(`Quedan ${restantes} entradas. Dale de nuevo para seguir.`);
      }

      // La lista la trae el servidor: el revalidate no alcanza porque el
      // pase corrió en un route handler.
      window.location.reload();
    } catch {
      toast.error("No pude correr el pase. Probá de nuevo.");
    } finally {
      setExtrayendo(false);
    }
  }

  // --- Vacío --------------------------------------------------
  if (!actual) {
    return (
      <div className="space-y-4">
        <div className="text-muted-foreground rounded-md border border-dashed p-10 text-center text-sm">
          <p className="text-foreground font-medium">La bandeja está vacía.</p>
          <p className="mt-1">
            Acá aparecen las propuestas del modelo antes de que existan de
            verdad. Nada se guarda solo.
          </p>
        </div>
        {hayModelo && (
          <div className="flex justify-center">
            <Button onClick={correrPase} disabled={extrayendo} variant="outline">
              <Sparkles className="size-4" aria-hidden="true" />
              {extrayendo
                ? "Leyendo la bitácora…"
                : "Buscar lecciones en la bitácora"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const mostrada = borrador ?? propuesta;

  return (
    <div
      ref={contenedor}
      tabIndex={-1}
      className="space-y-4 outline-none"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{TIPO_LABEL[actual.tipo]}</Badge>
          <span className="text-muted-foreground text-xs">
            <span className="cifra">{items.length}</span>{" "}
            {items.length === 1 ? "pendiente" : "pendientes"}
          </span>
        </div>
        {hayModelo && (
          <Button
            onClick={correrPase}
            disabled={extrayendo}
            variant="ghost"
            size="sm"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {extrayendo ? "Leyendo…" : "Buscar más"}
          </Button>
        )}
      </div>

      <div
        onTouchStart={alTocar}
        onTouchMove={alMover}
        onTouchEnd={alSoltar}
        style={{
          transform: `translateX(${arrastre}px)`,
          transition: arrastre === 0 ? "transform 150ms ease-out" : undefined,
        }}
        className="bg-card relative touch-pan-y rounded-lg border p-4 sm:p-6"
      >
        {/* Qué va a pasar si soltás acá. Solo aparece con el gesto. */}
        {arrastre > 20 && (
          <span className="text-chart-ingreso absolute top-1/2 -left-14 -translate-y-1/2 text-sm font-medium">
            Aceptar
          </span>
        )}
        {arrastre < -20 && (
          <span className="text-destructive absolute top-1/2 -right-14 -translate-y-1/2 text-sm font-medium">
            Rechazar
          </span>
        )}

        {esError ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-4" aria-hidden="true" />
              <p className="text-sm font-semibold">
                El modelo contestó algo que no se pudo usar
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              Queda a la vista en vez de desaparecer en silencio. No hay nada
              que aceptar: descartalo y, si querés, volvé a correr el pase.
            </p>
            {actual.errorDetalle && (
              <p className="bg-muted text-muted-foreground rounded-md p-3 font-mono text-xs break-words">
                {actual.errorDetalle}
              </p>
            )}
          </div>
        ) : esZombie ? (
          zombie ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm font-semibold">{zombie.descripcion}</p>
                <span className="cifra text-muted-foreground text-sm">
                  {formatMoney(zombie.monto_origen, zombie.moneda_origen)} por mes
                </span>
              </div>

              <p className="text-sm">{zombie.aviso}</p>

              <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2 sm:justify-start">
                  <dt>Meses con cargo</dt>
                  <dd className="cifra">{zombie.meses_con_cargo}</dd>
                </div>
                <div className="flex justify-between gap-2 sm:justify-start">
                  <dt>Último cargo</dt>
                  <dd className="cifra">{formatDate(zombie.ultimo_cargo)}</dd>
                </div>
                <div className="flex justify-between gap-2 sm:justify-start">
                  <dt>Imputado a</dt>
                  <dd>
                    {zombie.project_id
                      ? nombreProyecto(zombie.project_id)
                      : "Compartido"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 sm:justify-start">
                  <dt>Sin actividad hace</dt>
                  <dd className="cifra">{zombie.dias_sin_actividad} días</dd>
                </div>
              </dl>

              <p className="text-muted-foreground border-t border-dashed pt-3 text-xs">
                {zombie.recurrence_id ? (
                  <>
                    Aceptar <strong>desactiva la recurrencia</strong>: deja de
                    generarse el movimiento todos los meses. La baja con el
                    proveedor la hacés vos.
                  </>
                ) : (
                  <>
                    Este gasto no tiene una recurrencia declarada, así que{" "}
                    <strong>aceptar no da de baja nada</strong>: solo cierra el
                    aviso. La baja la hacés en el sitio del proveedor.
                  </>
                )}{" "}
                Rechazar lo marca como falso positivo y{" "}
                <strong>no te lo vuelve a mostrar</strong>.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Este aviso quedó incompleto. Rechazalo.
            </p>
          )
        ) : esMovimiento ? (
          movimiento ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm font-semibold">{movimiento.descripcion}</p>
                <span
                  className={`cifra text-sm ${
                    tipoElegido === "ingreso"
                      ? "text-chart-ingreso"
                      : "text-chart-egreso"
                  }`}
                >
                  {tipoElegido === "ingreso" ? "+" : "−"}
                  {formatMoney(movimiento.monto_origen, movimiento.moneda_origen)}
                </span>
                <span className="text-muted-foreground cifra text-xs">
                  {formatDate(movimiento.fecha)}
                </span>
                {movimiento.estado === "planificado" && (
                  <Badge variant="outline">Planificado</Badge>
                )}
              </div>

              {/*
                Los dos selectores están siempre a la vista, no detrás de
                "Editar". Son justo lo que el conector NO puede saber
                —a qué proyecto va, con qué categoría— y verlos al lado
                del monto es lo que deja decidir de un vistazo.
              */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs font-medium">
                    Categoría
                  </span>
                  <Select
                    value={categoriaActual}
                    onValueChange={setCategoriaMovimiento}
                  >
                    <SelectTrigger aria-label="Categoría">
                      <SelectValue placeholder="Elegí una" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasVigentes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nombre} ({c.tipo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs font-medium">
                    Proyecto
                  </span>
                  <Select
                    value={proyectoActual}
                    onValueChange={setProyectoMovimiento}
                  >
                    <SelectTrigger aria-label="Proyecto">
                      <SelectValue placeholder="Elegí uno" />
                    </SelectTrigger>
                    <SelectContent>
                      {/*
                        "Compartido" no es un proyecto: es project_id
                        null, el gasto que se reparte entre los proyectos
                        que estaban abiertos en SU fecha. Va primero
                        porque es lo que son casi todas las
                        suscripciones.
                      */}
                      <SelectItem value={COMPARTIDO}>
                        Compartido (se reparte)
                      </SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {movimiento.sugerencia && (
                <p className="text-muted-foreground text-xs">
                  La categoría vino propuesta porque{" "}
                  <strong>{movimiento.sugerencia}</strong>.
                </p>
              )}

              <p className="text-muted-foreground border-t border-dashed pt-3 text-xs">
                Aceptar <strong>lo carga de verdad</strong> en Finanzas, y
                recién ahí se congela la cotización contra la fecha del
                movimiento. El monto, la fecha y la descripción son lo que
                dictaste y no se editan acá: si alguno está mal, rechazalo y
                cargalo desde Finanzas.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Esta propuesta quedó incompleta y no se puede aceptar. Rechazala.
            </p>
          )
        ) : esProyecto ? (
          proyectoDictado ? (
            <ProyectoPropuesto p={proyectoDictado} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Esta propuesta quedó incompleta y no se puede aceptar. Rechazala.
            </p>
          )
        ) : esNota ? (
          nota ? (
            <div className="grid gap-6 md:grid-cols-2">
              {/*
                La fuente a la izquierda, siempre. Una transcripción que
                se lee como si la hubiera dicho un cliente no se puede
                juzgar sin tener la imagen al lado.
              */}
              <section className="space-y-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {esNotaDictada ? "De dónde salió" : "Lo que pegaste"}
                </h2>
                {esNotaDictada ? (
                  <>
                    <p className="text-sm">La dictaste desde Claude.</p>
                    {/*
                      La fuente a la izquierda es la salvaguarda contra lo
                      inventado, igual que la miniatura de una captura.
                      Acá la fuente no es una imagen: es la conversación,
                      que la app no tiene. Lo único honesto que se puede
                      mostrar es que el texto NO es de Beno.

                      ⚠ Y por eso esta rama NO renderiza
                      `MiniaturaAdjunto`: `leerNota()` pone
                      `storage_path: ""` cuando no viene, y la miniatura
                      con el path vacío se queda en "Cargando la imagen…"
                      para siempre.
                    */}
                    <p className="text-muted-foreground text-xs">
                      El texto lo <strong>escribió Claude</strong>, no vos: es
                      un resumen de lo que charlaron. Por eso pasa por acá y
                      no se guarda solo. Si le falta algo o suena a otra
                      persona, editalo antes de aceptar.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">{nota.de_que_es}</p>
                    <MiniaturaAdjunto
                      path={nota.storage_path}
                      alt={`Captura ${nota.adjunto_nombre}`}
                    />
                    {nota.frase && (
                      <p className="text-muted-foreground text-xs">
                        Escribiste: “{nota.frase}”
                      </p>
                    )}
                  </>
                )}
              </section>

              <section className="space-y-3 md:border-l md:pl-6">
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Entrada de bitácora propuesta
                </h2>

                {editando && borradorNota !== null ? (
                  <Textarea
                    autoFocus
                    rows={12}
                    value={borradorNota}
                    onChange={(e) => setBorradorNota(e.target.value)}
                    aria-label="Contenido de la nota"
                  />
                ) : (
                  <p className="max-h-96 overflow-y-auto text-sm whitespace-pre-line">
                    {borradorNota ?? nota.contenido}
                  </p>
                )}

                <p className="text-muted-foreground text-xs">
                  Lo transcribió un modelo mirando la imagen, así que{" "}
                  <strong>no es tuyo palabra por palabra</strong>. Corregilo
                  antes de aceptar si hace falta. Una vez guardado, el pase de
                  la bandeja lo mira y, si tiene una lección adentro, te la
                  propone.
                </p>

                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  <span className="cifra">{formatDate(nota.fecha)}</span>
                  {nota.project_id && <span>{nombreProyecto(nota.project_id)}</span>}
                </div>
              </section>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Esta nota quedó incompleta y no se puede aceptar. Rechazala.
            </p>
          )
        ) : !mostrada ? (
          <p className="text-muted-foreground text-sm">
            Esta propuesta quedó incompleta y no se puede aceptar. Rechazala.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {/*
              De dónde salió la propuesta. Cambia según el tipo, y no es
              cosmética: es lo que te deja juzgarla sin adivinar. Una
              lección extraída se juzga contra lo que escribiste ese día;
              una generada, contra el tema que pediste — y sabiendo que
              nadie la vivió.
            */}
            <section className="space-y-2">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {actual.tipo === "leccion_extraida"
                  ? "Lo que escribiste"
                  : actual.tipo === "retro"
                    ? "De qué retro salió"
                    : actual.tipo === "leccion_dictada"
                      ? "De dónde salió"
                      : mostrada.adjunto_nombre
                        ? "De qué archivo salió"
                        : "Lo que pediste"}
              </h2>

              {mostrada.adjunto_nombre ? (
                <div className="space-y-3">
                  <p className="text-sm break-words">
                    {mostrada.adjunto_nombre}
                  </p>
                  {mostrada.frase && (
                    <p className="text-muted-foreground text-xs">
                      Escribiste: “{mostrada.frase}”
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Salió de un <strong>archivo que pegaste</strong>, no de algo
                    que hayas vivido ni de un tema que hayas pedido. El modelo
                    leyó el documento y propuso esto; si la aceptás, queda
                    marcada así en la lista de Lecciones.
                  </p>
                </div>
              ) : actual.tipo === "leccion_dictada" ? (
                <div className="space-y-3">
                  <p className="text-sm">La dictaste vos, desde Claude.</p>
                  {/*
                    Pasa por la bandeja aunque el contenido sea suyo, y
                    conviene decir por qué: del otro lado hay un modelo
                    redactando y no hay garantía de que no haya
                    reformulado. Si algo suena a "mejorado", la tecla E
                    está justo al lado. Nace como `manual`, igual que si
                    la hubiera escrito en el formulario.
                  */}
                  <p className="text-muted-foreground text-xs">
                    Tendría que estar con <strong>tus palabras</strong>, no
                    reformulada. Si te suena a resumen o le falta el dato
                    concreto que dijiste, editala antes de aceptar.
                  </p>
                </div>
              ) : actual.tipo === "leccion_extraida" ? (
                actual.entrada ? (
                  <>
                    <p className="text-muted-foreground cifra text-xs">
                      {formatDate(actual.entrada.fecha)}
                    </p>
                    <p className="max-h-64 overflow-y-auto text-sm whitespace-pre-line">
                      {actual.entrada.contenido}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    La entrada original ya no está.
                  </p>
                )
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    {actual.tipo === "retro"
                      ? (mostrada.retro_titulo ??
                        "Del cierre de este proyecto.")
                      : (mostrada.tema ?? "Sin tema registrado.")}
                  </p>
                  {actual.tipo === "leccion_sugerida" && (
                    <p className="text-muted-foreground text-xs">
                      Es una <strong>hipótesis</strong>: la propuso el modelo
                      sobre ese tema, no salió de nada que hayas vivido. Si la
                      aceptás queda marcada así en la lista de Lecciones.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Propuesta */}
            <section className="space-y-3 md:border-l md:pl-6">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Lección propuesta
              </h2>

              {editando && borrador ? (
                <div className="space-y-3">
                  <Input
                    autoFocus
                    value={borrador.titulo}
                    onChange={(e) =>
                      setBorrador({ ...borrador, titulo: e.target.value })
                    }
                    aria-label="Título de la lección"
                  />
                  <Textarea
                    rows={6}
                    value={borrador.contenido}
                    onChange={(e) =>
                      setBorrador({ ...borrador, contenido: e.target.value })
                    }
                    aria-label="Contenido de la lección"
                  />
                  <Select
                    value={borrador.categoria}
                    onValueChange={(valor) =>
                      setBorrador({
                        ...borrador,
                        categoria: valor as CategoriaLeccion,
                      })
                    }
                  >
                    <SelectTrigger aria-label="Categoría">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
                      Ctrl ↵
                    </kbd>{" "}
                    guarda ·{" "}
                    <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
                      Esc
                    </kbd>{" "}
                    descarta los cambios
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{mostrada.titulo}</p>
                  <p className="text-sm whitespace-pre-line">
                    {mostrada.contenido}
                  </p>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">
                      {CATEGORIAS.find((c) => c.valor === mostrada.categoria)
                        ?.label ?? mostrada.categoria}
                    </Badge>
                    {mostrada.project_id && (
                      <span>{nombreProyecto(mostrada.project_id)}</span>
                    )}
                    <span className="cifra">{formatDate(mostrada.fecha)}</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/*
        Falta el proyecto y hay que elegirlo antes de poder aceptar.
        Pasa solo con lo que entró por un archivo pegado: al pegarlo puede
        no saberse a qué proyecto va, y `lessons.project_id` /
        `daily_log.project_id` son los dos NOT NULL. Es el mismo patrón
        que usa la caja cuando le falta un dato, y elegir entre tres
        proyectos es un click.
      */}
      {faltaProyecto && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm">¿A qué proyecto va?</p>
          <Select
            value={proyectoElegido ?? ""}
            onValueChange={(valor) => setProyectoElegido(valor)}
          >
            <SelectTrigger aria-label="Proyecto" className="w-56">
              <SelectValue placeholder="Elegí uno" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Los mismos gestos, para el mouse y para el que recién llega. */}
      <div className="flex flex-wrap items-center gap-2">
        {!esError && (
          <Button
            onClick={aceptar}
            disabled={
              (esZombie
                ? !zombie
                : esNota
                  ? !nota
                  : esMovimiento
                    ? !movimiento || !movimientoCompleto
                    : // ⚠ Sin esta rama el botón queda apagado para
                      // siempre: `mostrada` es `borrador ?? propuesta`, y
                      // `propuesta` es null para todo lo que no sea una
                      // lección.
                      esProyecto
                      ? !proyectoDictado
                      : !mostrada) || (faltaProyecto && !projectId)
            }
            className="gap-1.5"
          >
            <Check className="size-4" aria-hidden="true" />
            {esZombie
              ? "La doy de baja"
              : esMovimiento
                ? "Cargarlo"
                : esProyecto
                  ? "Crearlo"
                  : "Aceptar"}
          </Button>
        )}
        <Button onClick={rechazar} variant="outline" className="gap-1.5">
          <X className="size-4" aria-hidden="true" />
          {esError
            ? "Descartar"
            : esZombie
              ? "La sigo usando"
              : "Rechazar"}
        </Button>
        {!esError && (
          <>
            <Button onClick={posponer} variant="ghost" className="gap-1.5">
              <Clock className="size-4" aria-hidden="true" />
              Después
            </Button>
            {/*
              Ni un zombie ni un movimiento se editan acá. El zombie no
              tiene texto propuesto que corregir; el movimiento tiene sus
              dos selectores siempre a la vista y el resto son datos que
              dictó Beno, no una redacción de un modelo.
            */}
            {!esZombie && !esMovimiento && (
              <Button
                onClick={editar}
                variant="ghost"
                disabled={(esNota ? !nota : !mostrada) || editando}
                className="gap-1.5"
              >
                <Pencil className="size-4" aria-hidden="true" />
                Editar
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Atajo tecla="A">aceptar</Atajo>
        <Atajo tecla="R">rechazar</Atajo>
        {!esError && (
          <>
            <Atajo tecla="P">posponer</Atajo>
            {!esZombie && !esMovimiento && <Atajo tecla="E">editar</Atajo>}
          </>
        )}
        <span className="text-muted-foreground text-xs sm:hidden">
          o deslizá la tarjeta
        </span>
      </div>
    </div>
  );
}
