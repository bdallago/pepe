"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  GripVertical,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  actualizarPresupuesto,
  crearPresupuesto,
} from "@/lib/actions/presupuestos";
import { ETIQUETA_SEGMENTO } from "@/lib/avisos-tarifa";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/format";
import type { TasaAplicable } from "@/lib/fx";
import {
  calcularPresupuesto,
  multiplicadorDe,
  sumarHoras,
  type Multiplicadores,
  type TipoCliente,
} from "@/lib/presupuestos";
import { quoteSchema, type QuoteInput, type QuoteItemInput } from "@/lib/schemas";
import type { ActionResult } from "@/lib/actions/shared";
// Solo el tipo: `lib/presupuestos/estimacion.ts` es `server-only` y el
// `import type` se borra al compilar, así que nada de eso llega al
// browser. Mismo criterio que `AjustesPresupuesto` en Ajustes.
import type { EstimacionEsfuerzo } from "@/lib/presupuestos/estimacion";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * El formulario de un presupuesto.
 *
 * Es **un formulario entero, no una vista previa con un botón**: se edita
 * todo —título del entregable, detalle, horas, orden, supuestos,
 * preguntas, condiciones, validez— y **también el total final**, porque a
 * veces el número que sale de la cuenta no es el número que uno quiere
 * mandar.
 *
 * Arriba, siempre visible: **horas → semanas → precio**, recalculándose
 * con cada tecla. Que la relación entre las tres cosas se vea mientras se
 * edita es la mitad del valor de esta pantalla, y por eso el cálculo vive
 * en `lib/presupuestos.ts`, que es puro y lo corren igual el navegador y
 * el servidor al guardar.
 *
 * ── Qué NO se edita, y por qué ────────────────────────────────────────
 *
 * En **edición** quedan bloqueados el tipo de cliente y la moneda. No es
 * una limitación técnica: los dos eligen valores que ya se congelaron
 * (`multiplicador`, `tasa_usada`, `tasa_fecha`). Dejar cambiar el tipo de
 * cliente sin mover el multiplicador mostraría "Empresa" al lado del
 * precio de un particular, que es peor que no dejar cambiarlo. La salida,
 * la que dice el spec, es explícita: descartar este como
 * `quedo_desactualizado` y hacer uno nuevo.
 */

export type ModoFormulario = "crear" | "editar";

/** Lo que el cálculo necesita y no sale del formulario. */
export interface BaseCalculo {
  tarifa_hora: number;
  tarifa_moneda: Moneda;
  horas_por_semana: number;
  /** Congelado en edición; en el alta lo elige el tipo de cliente. */
  multiplicador: number | null;
  multiplicadores: Multiplicadores;
  /** Congelada en edición. En el alta se resuelve contra la fecha. */
  tasa: TasaAplicable | null;
}

const TIPOS: TipoCliente[] = ["particular", "pyme", "empresa"];

function itemVacio(): QuoteItemInput {
  return {
    titulo: "",
    detalle: "",
    horas: 0,
    origen: "manual",
    ancla: null,
    ancla_verificada: false,
    confianza: null,
  };
}

export function PresupuestoForm({
  modo,
  presupuestoId,
  base,
  inicial,
}: {
  modo: ModoFormulario;
  presupuestoId?: string;
  base: BaseCalculo;
  inicial: QuoteInput;
}) {
  const router = useRouter();
  const { tasaPara } = useAppData();
  const [guardando, empezarGuardado] = useTransition();

  const [valores, setValores] = useState<QuoteInput>(inicial);

  /**
   * La estimación, y nada más que eso.
   *
   * `estimando` bloquea el botón: la llamada es el razonador con
   * `maxTokens 4500` y, como no entra en la ventana de un minuto del
   * limitador, puede tardar minutos (ver el comentario de `maxTokens` en
   * `lib/presupuestos/estimacion.ts`). Dos clicks serían dos llamadas
   * carísimas y la segunda pisaría a la primera.
   */
  const [estimando, setEstimando] = useState(false);
  /** Lo que la corrida quiere avisar: recorte del pedido, citas flojas. */
  const [avisoEstimacion, setAvisoEstimacion] = useState<string | null>(null);
  /** Pisar lo cargado se pregunta antes; acá espera el "sí". */
  const [confirmandoPisar, setConfirmandoPisar] = useState(false);

  function set<K extends keyof QuoteInput>(clave: K, valor: QuoteInput[K]) {
    setValores((previo) => ({ ...previo, [clave]: valor }));
  }

  // ── El cálculo, con los mismos valores que va a usar el servidor ────
  const multiplicador =
    modo === "editar" && base.multiplicador !== null
      ? base.multiplicador
      : multiplicadorDe(valores.cliente_tipo, base.multiplicadores);

  // En el alta la cotización se resuelve contra la fecha del presupuesto
  // (la de esa fecha o la última anterior). En edición ya está congelada y
  // no se vuelve a mirar: es la regla 1.
  const tasa =
    modo === "editar"
      ? base.tasa
      : valores.moneda === base.tarifa_moneda
        ? null
        : tasaPara(valores.fecha);

  const calculo = useMemo(
    () =>
      calcularPresupuesto({
        horas: sumarHoras(valores.items),
        tarifa_hora: base.tarifa_hora,
        tarifa_moneda: base.tarifa_moneda,
        cliente_tipo: valores.cliente_tipo,
        moneda: valores.moneda,
        multiplicadores: {
          particular: multiplicador,
          pyme: multiplicador,
          empresa: multiplicador,
        },
        horas_por_semana: base.horas_por_semana,
        tasa,
      }),
    [
      valores.items,
      valores.cliente_tipo,
      valores.moneda,
      base.tarifa_hora,
      base.tarifa_moneda,
      base.horas_por_semana,
      multiplicador,
      tasa,
    ],
  );

  const totalMostrado = valores.total_editado
    ? valores.total_origen
    : calculo.total_origen;

  // ── Ítems ───────────────────────────────────────────────────────────

  /**
   * Al tocar cualquier campo el ítem pasa a `manual` y su marca se apaga.
   * Es el mismo comportamiento que la sugerencia de categoría, que se
   * apaga apenas Beno elige a mano: la procedencia tiene que decir la
   * verdad, y un ítem editado ya no es lo que devolvió el modelo.
   */
  function tocarItem(indice: number, cambios: Partial<QuoteItemInput>) {
    setValores((previo) => ({
      ...previo,
      items: previo.items.map((item, i) =>
        i === indice ? { ...item, ...cambios, origen: "manual" } : item,
      ),
    }));
  }

  function moverItem(indice: number, delta: number) {
    const destino = indice + delta;
    if (destino < 0 || destino >= valores.items.length) return;

    setValores((previo) => {
      const items = [...previo.items];
      const [movido] = items.splice(indice, 1);
      items.splice(destino, 0, movido);
      return { ...previo, items };
    });
  }

  const anclasSinVerificar = valores.items.filter(
    (item) => item.ancla !== null && !item.ancla_verificada,
  ).length;

  // ── La estimación con el modelo ─────────────────────────────────────

  /**
   * Lo que se pisaría si la estimación entra: ítems, supuestos, preguntas
   * y el alcance. Se pregunta **antes** de llamar y no después: el
   * arrepentimiento llega cuando ya no hay a qué volver, y encima la
   * llamada tarda minutos.
   */
  const hayCargado =
    valores.items.length > 0 ||
    valores.supuestos.length > 0 ||
    valores.preguntas.length > 0 ||
    valores.resumen_alcance.trim().length > 0;

  const pedido = valores.pedido_texto.trim();

  function pedirEstimacion() {
    if (pedido.length < 10) {
      toast.error("Pegá el pedido del cliente para poder estimar.");
      return;
    }

    if (hayCargado) {
      setConfirmandoPisar(true);
      return;
    }

    void estimar();
  }

  /**
   * Llama a `/api/presupuestos/estimar` y **precarga** el formulario.
   *
   * Regla 7: si el modelo falla, si no hay `GROQ_API_KEY` (el handler
   * contesta 503) o si la respuesta no valida, se avisa con un toast y el
   * formulario queda **exactamente como estaba**. Cargar el presupuesto a
   * mano no depende de esto en ningún momento.
   */
  async function estimar() {
    setEstimando(true);
    setAvisoEstimacion(null);

    try {
      const respuesta = await fetch("/api/presupuestos/estimar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoTexto: pedido,
          tipoCliente: valores.cliente_tipo,
        }),
      });

      const resultado: ActionResult<EstimacionEsfuerzo> =
        await respuesta.json();

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      const estimacion = resultado.data;

      setValores((previo) => ({
        ...previo,
        resumen_alcance: estimacion.resumen_alcance,
        // `origen: "modelo"` es la marca de procedencia, igual que las del
        // formulario de movimientos: se apaga sola en `tocarItem()` apenas
        // Beno edita el ítem, porque a partir de ahí el valor es suyo.
        items: estimacion.entregables.map((entregable) => ({
          titulo: entregable.titulo,
          detalle: entregable.detalle,
          horas: entregable.horas,
          origen: "modelo" as const,
          ancla: entregable.ancla,
          ancla_verificada: entregable.ancla_verificada,
          confianza: entregable.confianza,
        })),
        supuestos: estimacion.supuestos,
        preguntas: estimacion.preguntas,
        modelo: estimacion.modelo,
        // El total vuelve a salir de la cuenta: los ítems son otros, así
        // que un total puesto a mano antes de estimar ya no dice nada.
        total_editado: false,
      }));

      // Lo que la corrida quiere que se sepa, en el orden en que importa.
      const avisos = [
        estimacion.pedido_recortado
          ? `El pedido entró recortado a ${estimacion.pedido_chars} caracteres: lo que quedó afuera no se estimó.`
          : null,
        estimacion.anclas_sin_verificar > 0
          ? `${estimacion.anclas_sin_verificar} de ${estimacion.entregables.length} citas no aparecen en el pedido. Están marcadas abajo.`
          : null,
      ].filter((linea): linea is string => linea !== null);

      setAvisoEstimacion(avisos.length > 0 ? avisos.join(" ") : null);

      toast.success(
        estimacion.entregables.length === 0
          ? "El pedido no alcanza para partirlo en entregables. Mirá las preguntas."
          : `${estimacion.entregables.length} entregables, ${estimacion.horas_totales} horas. Revisalos.`,
      );
    } catch {
      // Un fetch que no vuelve —red caída, timeout del navegador— es el
      // mismo caso que el 503: se avisa y se sigue a mano.
      toast.error("No pude estimar. Podés cargar los entregables a mano.");
    } finally {
      setEstimando(false);
    }
  }

  // ── Guardado ────────────────────────────────────────────────────────

  function guardar() {
    const aEnviar: QuoteInput = {
      ...valores,
      total_origen: totalMostrado,
      // Las líneas que se agregaron y quedaron vacías se descartan en vez
      // de fallar la validación: apretar "Agregar" y arrepentirse no es un
      // error del usuario.
      supuestos: valores.supuestos.map((t) => t.trim()).filter(Boolean),
      preguntas: valores.preguntas.map((t) => t.trim()).filter(Boolean),
    };

    const parsed = quoteSchema.safeParse(aEnviar);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Datos inválidos.");
      return;
    }

    empezarGuardado(async () => {
      if (modo === "editar" && presupuestoId) {
        const resultado = await actualizarPresupuesto(presupuestoId, parsed.data);
        if (!resultado.ok) {
          toast.error(resultado.error);
          return;
        }
        toast.success("Presupuesto guardado.");
        router.refresh();
        return;
      }

      const resultado = await crearPresupuesto(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      toast.success(`Presupuesto Nº ${resultado.data.numero} creado.`);
      router.push(`/presupuestos/${resultado.data.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ── El resumen que se recalcula con cada tecla ──────────────── */}
      <div className="bg-card sticky top-14 z-20 rounded-md border p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="flex flex-wrap gap-6 text-sm">
            <div>
              <dt className="rotulo text-muted-foreground">Horas</dt>
              <dd className="cifra text-lg">{calculo.horas}</dd>
            </div>
            <div>
              <dt className="rotulo text-muted-foreground">Semanas</dt>
              <dd className="cifra text-lg">{calculo.semanas}</dd>
            </div>
            <div>
              <dt className="rotulo text-muted-foreground">
                Hora × {multiplicador}
              </dt>
              <dd className="cifra text-lg">
                {formatMoney(calculo.precio_hora, base.tarifa_moneda)}
              </dd>
            </div>
          </dl>

          <div className="text-right">
            <p className="rotulo text-muted-foreground">Total</p>
            <p className="cifra text-2xl font-semibold text-[var(--teal)]">
              {formatMoney(totalMostrado, calculo.moneda)}
            </p>
          </div>
        </div>

        {calculo.sin_cotizacion ? (
          <p className="mt-2 text-xs text-[var(--mango)]">
            No hay ninguna cotización cargada, así que el presupuesto se hace en{" "}
            {base.tarifa_moneda} en vez de {valores.moneda}. No se inventa
            ninguna.
          </p>
        ) : null}

        {calculo.tasa_usada !== null ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Convertido a <span className="cifra">{formatRate(calculo.tasa_usada)}</span>{" "}
            del{" "}
            <span className="cifra">
              {calculo.tasa_fecha ? formatDate(calculo.tasa_fecha) : "—"}
            </span>
            {modo === "editar"
              ? ". Está congelada: no se mueve aunque cambies la fecha."
              : null}
          </p>
        ) : null}
      </div>

      {/* ── Cliente y documento ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente y documento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="q-cliente">Cliente</Label>
            <Input
              id="q-cliente"
              value={valores.cliente_nombre}
              onChange={(e) => set("cliente_nombre", e.target.value)}
              placeholder="Nombre o razón social"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-tipo">Tipo de cliente</Label>
            <Select
              value={valores.cliente_tipo}
              disabled={modo === "editar"}
              onValueChange={(v) => set("cliente_tipo", v as TipoCliente)}
            >
              <SelectTrigger id="q-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {ETIQUETA_SEGMENTO[tipo]} · ×
                    {base.multiplicadores[tipo]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modo === "editar" ? (
              <p className="text-muted-foreground text-xs">
                El multiplicador quedó congelado en ×{multiplicador}. Para
                cotizarle a otro tipo de cliente, descartá este y hacé uno
                nuevo.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="q-titulo">Título del presupuesto</Label>
            <Input
              id="q-titulo"
              value={valores.titulo}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder="Ej: Tienda online con carga de productos por Excel"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="q-alcance">Alcance</Label>
            <Textarea
              id="q-alcance"
              rows={3}
              value={valores.resumen_alcance}
              onChange={(e) => set("resumen_alcance", e.target.value)}
              placeholder="Qué incluye el trabajo, en dos o tres líneas."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-fecha">Fecha</Label>
            <Input
              id="q-fecha"
              type="date"
              className="cifra"
              value={valores.fecha}
              onChange={(e) => set("fecha", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-validez">Validez (días)</Label>
            <Input
              id="q-validez"
              type="number"
              min="1"
              max="365"
              className="cifra"
              value={valores.validez_dias}
              onChange={(e) =>
                set("validez_dias", Math.trunc(Number(e.target.value) || 0))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-moneda">Moneda</Label>
            <Select
              value={valores.moneda}
              disabled={modo === "editar"}
              onValueChange={(v) => set("moneda", v as Moneda)}
            >
              <SelectTrigger id="q-moneda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ARS">ARS</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
            {modo === "editar" ? (
              <p className="text-muted-foreground text-xs">
                Cambiarla sería recotizar, y eso crea un presupuesto nuevo.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="q-horas">Mostrar las horas en el PDF</Label>
              <p className="text-muted-foreground text-xs">
                Apagado por defecto: mostrarlas convierte la charla en una
                discusión de tarifa horaria.
              </p>
            </div>
            <Switch
              id="q-horas"
              checked={valores.mostrar_horas}
              onCheckedChange={(v) => set("mostrar_horas", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── El pedido del cliente, y el botón que lo estima ─────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">El pedido del cliente</CardTitle>
          <CardDescription>
            No sale en el PDF. Queda guardado porque es contra este texto que
            se verifican las citas de cada entregable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            id="q-pedido"
            aria-label="El pedido del cliente"
            rows={6}
            value={valores.pedido_texto}
            onChange={(e) => set("pedido_texto", e.target.value)}
            placeholder="Pegá acá lo que te escribió, o contalo con tus palabras."
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={pedirEstimacion}
              disabled={estimando || pedido.length < 10}
            >
              {estimando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              {estimando ? "Pensando…" : "Estimar los entregables"}
            </Button>
            <p className="text-muted-foreground text-xs">
              {estimando
                ? "Puede tardar un par de minutos: es el modelo que razona y espera su turno en el limitador. No cierres la pantalla."
                : "Propone entregables con horas, supuestos y preguntas. No guarda nada: queda todo editable acá."}
            </p>
          </div>

          {avisoEstimacion ? (
            <p className="rounded-md border border-[var(--mango)] p-3 text-xs text-[var(--mango)]">
              {avisoEstimacion}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Entregables ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Entregables</CardTitle>
            <CardDescription>
              El título dice <strong>qué se entrega</strong>, con nombre y
              apellido. &laquo;Desarrollo backend&raquo; es un rótulo;
              &laquo;endpoint de importación del CSV de productos, con
              validación y reporte de errores&raquo; es un entregable.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              set("items", [...valores.items, itemVacio()])
            }
          >
            <Plus className="size-4" />
            Agregar
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          {anclasSinVerificar > 0 &&
          anclasSinVerificar * 2 > valores.items.length ? (
            <p className="rounded-md border border-[var(--mango)] p-3 text-xs text-[var(--mango)]">
              Más de la mitad de los entregables se apoyan en citas que no
              están en el pedido. Suele querer decir que la estimación se fue
              de tema entera: conviene rehacerla antes que corregirla ítem por
              ítem.
            </p>
          ) : null}

          {valores.items.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
              Todavía no hay entregables. Sin ítems el total es cero.
            </p>
          ) : null}

          {valores.items.map((item, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Subir entregable"
                    className="text-muted-foreground hover:text-foreground text-xs leading-none"
                    onClick={() => moverItem(i, -1)}
                  >
                    ▲
                  </button>
                  <GripVertical
                    className="text-muted-foreground size-3"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    aria-label="Bajar entregable"
                    className="text-muted-foreground hover:text-foreground text-xs leading-none"
                    onClick={() => moverItem(i, 1)}
                  >
                    ▼
                  </button>
                </div>

                <Input
                  value={item.titulo}
                  onChange={(e) => tocarItem(i, { titulo: e.target.value })}
                  placeholder="Qué se entrega"
                  autoComplete="off"
                  className="min-w-40 flex-1"
                />

                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={item.horas}
                  onChange={(e) =>
                    tocarItem(i, { horas: Number(e.target.value) || 0 })
                  }
                  aria-label="Horas"
                  className="cifra w-24"
                />
                <span className="text-muted-foreground text-xs">h</span>

                {item.origen === "modelo" ? (
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    del pedido
                    {item.confianza ? ` · confianza ${item.confianza}` : ""}
                  </Badge>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Borrar entregable"
                  onClick={() =>
                    set(
                      "items",
                      valores.items.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <Textarea
                rows={2}
                value={item.detalle}
                onChange={(e) => tocarItem(i, { detalle: e.target.value })}
                placeholder="Qué incluye (opcional)"
              />

              {item.ancla ? (
                <p
                  className={
                    item.ancla_verificada
                      ? "text-muted-foreground text-xs"
                      : "text-xs text-[var(--mango)]"
                  }
                >
                  {item.ancla_verificada ? "✓" : "⚠"} &laquo;{item.ancla}&raquo;
                  {item.ancla_verificada
                    ? ""
                    : " — esta cita no está en el pedido"}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Supuestos y preguntas ───────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ListaDeTextos
          titulo="Supuestos"
          descripcion="Lo que este presupuesto da por sentado. Va escrito en el PDF."
          placeholder="Ej: el contenido y las fotos las aporta el cliente."
          textos={valores.supuestos}
          onChange={(textos) => set("supuestos", textos)}
        />
        <ListaDeTextos
          titulo="Preguntas pendientes"
          descripcion="Lo que hay que preguntar antes de cerrar el número. Acá, nunca en un ítem con horas inventadas."
          placeholder="Ej: ¿cuántos productos hay que migrar?"
          textos={valores.preguntas}
          onChange={(textos) => set("preguntas", textos)}
        />
      </div>

      {/* ── Condiciones, pedido y total ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condiciones y precio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-condiciones">Condiciones</Label>
            <Textarea
              id="q-condiciones"
              rows={3}
              value={valores.condiciones}
              onChange={(e) => set("condiciones", e.target.value)}
              placeholder="50 % al aceptar, 50 % a la entrega."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-total">Total final</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="q-total"
                type="number"
                min="0"
                step="0.01"
                className="cifra w-48"
                value={totalMostrado}
                onChange={(e) =>
                  setValores((previo) => ({
                    ...previo,
                    total_origen: Number(e.target.value) || 0,
                    total_editado: true,
                  }))
                }
              />
              <span className="text-muted-foreground text-sm">
                {calculo.moneda}
              </span>
              {valores.total_editado ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setValores((previo) => ({
                      ...previo,
                      total_editado: false,
                      total_origen: calculo.total_origen,
                    }))
                  }
                >
                  <RotateCcw className="size-3.5" />
                  Volver al calculado (
                  {formatMoney(calculo.total_origen, calculo.moneda)})
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {valores.total_editado
                ? "Estás mandando un número puesto a mano: la cuenta ya no lo mueve."
                : "Sale de horas × tarifa × multiplicador. Si lo tocás, queda fijo."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
          {modo === "editar" ? "Guardar cambios" : "Crear presupuesto"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/presupuestos")}
        >
          Volver a la lista
        </Button>
      </div>

      {/*
        Precarga, no reemplazo silencioso. Si ya había algo cargado, se dice
        qué se pisa **antes** de gastar la llamada: la estimación tarda
        minutos y arrepentirse después no devuelve los ítems.
      */}
      <AlertDialog open={confirmandoPisar} onOpenChange={setConfirmandoPisar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esto pisa lo que ya cargaste</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  La estimación reemplaza el alcance, los entregables, los
                  supuestos y las preguntas por lo que devuelva el modelo.
                  Ahora mismo hay{" "}
                  <span className="cifra">{valores.items.length}</span>{" "}
                  entregables,{" "}
                  <span className="cifra">{valores.supuestos.length}</span>{" "}
                  supuestos y{" "}
                  <span className="cifra">{valores.preguntas.length}</span>{" "}
                  preguntas.
                </p>
                <p>
                  El cliente, la fecha, la moneda y las condiciones no se
                  tocan.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Dejalo como está</AlertDialogCancel>
            <AlertDialogAction onClick={() => void estimar()}>
              Estimar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Supuestos y preguntas: dos listas de una línea, idénticas por dentro. */
function ListaDeTextos({
  titulo,
  descripcion,
  placeholder,
  textos,
  onChange,
}: {
  titulo: string;
  descripcion: string;
  placeholder: string;
  textos: string[];
  onChange: (textos: string[]) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{titulo}</CardTitle>
          <CardDescription>{descripcion}</CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...textos, ""])}
        >
          <Plus className="size-4" />
          Agregar
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {textos.length === 0 ? (
          <p className="text-muted-foreground text-sm">Ninguno por ahora.</p>
        ) : null}
        {textos.map((texto, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={texto}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(e) =>
                onChange(textos.map((t, j) => (j === i ? e.target.value : t)))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Borrar ${titulo.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(textos.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
