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
  aceptarZombie,
  descartarErrorBandeja,
  posponerItemBandeja,
  rechazarItemBandeja,
} from "@/lib/actions/inbox";
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
};

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
  project_id: string;
  /** Solo en las generadas: el pedido que las originó (spec 6.3). */
  tema?: string;
  /** Solo en las de retro: de qué cierre salieron (spec 6.5). */
  retro_titulo?: string;
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
    typeof p.fecha !== "string" ||
    typeof p.project_id !== "string"
  ) {
    return null;
  }
  return {
    titulo: p.titulo,
    contenido: p.contenido,
    categoria: p.categoria as CategoriaLeccion,
    fecha: p.fecha,
    project_id: p.project_id,
    tema: typeof p.tema === "string" ? p.tema : undefined,
    retro_titulo:
      typeof p.retro_titulo === "string" ? p.retro_titulo : undefined,
  };
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
  const { projects } = useAppData();
  const [items, setItems] = useState(itemsIniciales);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Propuesta | null>(null);
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
  const propuesta =
    actual && !esZombie ? leerPropuesta(actual.payload) : null;
  const zombie = actual && esZombie ? leerZombie(actual.payload) : null;
  const esError = actual?.estado === "error";

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

    if (!propuesta) return;
    const edicion = borrador
      ? {
          titulo: borrador.titulo,
          contenido: borrador.contenido,
          categoria: borrador.categoria,
        }
      : undefined;

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
  }, [actual, borrador, esError, esZombie, propuesta, resolver]);

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
    if (!actual || esError || !propuesta) return;
    setBorrador(borrador ?? propuesta);
    setEditando(true);
  }, [actual, borrador, esError, propuesta]);

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
                    : "Lo que pediste"}
              </h2>

              {actual.tipo === "leccion_extraida" ? (
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
                    <span>{nombreProyecto(mostrada.project_id)}</span>
                    <span className="cifra">{formatDate(mostrada.fecha)}</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Los mismos gestos, para el mouse y para el que recién llega. */}
      <div className="flex flex-wrap items-center gap-2">
        {!esError && (
          <Button
            onClick={aceptar}
            disabled={esZombie ? !zombie : !mostrada}
            className="gap-1.5"
          >
            <Check className="size-4" aria-hidden="true" />
            {esZombie ? "La doy de baja" : "Aceptar"}
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
            {/* Un zombie no se edita: no hay texto propuesto que corregir. */}
            {!esZombie && (
              <Button
                onClick={editar}
                variant="ghost"
                disabled={!mostrada || editando}
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
            {!esZombie && <Atajo tecla="E">editar</Atajo>}
          </>
        )}
        <span className="text-muted-foreground text-xs sm:hidden">
          o deslizá la tarjeta
        </span>
      </div>
    </div>
  );
}
