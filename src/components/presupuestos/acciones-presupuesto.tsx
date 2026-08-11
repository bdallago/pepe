"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  Check,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import { ETIQUETA_MOTIVO } from "@/components/presupuestos/presupuestos-lista";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  aceptarPresupuesto,
  archivarPresupuesto,
  descartarPresupuesto,
  marcarEnviado,
  type DescarteInput,
} from "@/lib/actions/presupuestos";
import { todayISO } from "@/lib/dates";
import {
  cortesDelReparto,
  calcularParticipaciones,
  type ProyectoParaReparto,
} from "@/lib/prorrateo";
import type { EstadoPresupuesto } from "@/lib/presupuestos-server";

/**
 * Enviar, aceptar, descartar y archivar.
 *
 * ⚠ **Aceptar crea un proyecto, y eso mueve el prorrateo.** Un proyecto
 * más se lleva su parte de los gastos compartidos, así que le cambia a
 * Beno los balances por proyecto que viene mirando (el general no se
 * toca: suma el compartido una sola vez). Está advertido en el
 * encabezado de `20260810000001_proyectos_fechas.sql` y **acá la
 * pantalla lo dice antes de crear**, con los porcentajes de antes y de
 * después. Que un número cambie es tolerable; que cambie sin que nadie
 * lo dijera, no.
 *
 * La ventana que se simula la abre **la fecha de inicio del
 * formulario**, que es la que se va a insertar. Con la de hoy el aviso
 * mentía apenas Beno retrocedía el campo: `calcularParticipaciones()`
 * reparte entre los que estaban vivos en la fecha de cada gasto, así que
 * una fecha vieja mete al proyecto nuevo en el reparto de gastos que ya
 * pasaron — que es justo el caso sobre el que este recuadro existe para
 * avisar.
 *
 * Y dentro de esa ventana el efecto **no tiene por qué ser uno solo**:
 * si hay proyectos que abren o cierran en el medio, el reparto cambia
 * varias veces y ningún par "antes → después" lo representa.
 * `cortesDelReparto()` detecta ese caso y ahí el panel lo dice en
 * palabras. Hubo un intento de mostrarlo como rangos y **se descartó
 * midiendo**: el 01/04 alcanza a los 15 compartidos y el 01/06 a 7, y
 * los dos imprimían exactamente los mismos porcentajes. Un número que no
 * se mueve cuando movés la entrada parece una medición y no lo es.
 */

/**
 * Los ocho tonos validados, los mismos que ofrece Ajustes. No es un picker
 * libre para que los gráficos no se llenen de colores sin validar.
 */
const COLORES = [
  "#008f8f",
  "#d63f00",
  "#2a78d6",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
] as const;

const MOTIVOS: DescarteInput["motivo"][] = [
  "no_era_lo_que_queria",
  "quedo_desactualizado",
  "no_prospero",
  "otro",
];

/** Qué enseña cada motivo. No es adorno: es para qué existe el campo. */
const QUE_ENSENA: Record<DescarteInput["motivo"], string> = {
  no_era_lo_que_queria: "Leíste mal el pedido: apunta a la estimación.",
  quedo_desactualizado:
    "Tardaste: apunta al proceso, y se cruza con los días entre enviado y resuelto.",
  no_prospero:
    "Casi nada. Es la bolsa: el cliente desapareció, se cayó el proyecto de su lado.",
  otro: "Lo que enseña está en el detalle, no en el motivo.",
};

function porcentaje(fraccion: number): string {
  return `${(fraccion * 100).toFixed(1)} %`;
}

/**
 * La `fecha_inicio` más vieja de los proyectos cargados, o hoy si
 * ninguno tiene.
 *
 * Es el piso de la simulación cuando el campo de inicio quedó vacío: eso
 * inserta `fecha_inicio: null`, que para `estaVivo()` es **desde
 * siempre**, así que hace falta alguna fecha desde donde mirar.
 *
 * ⚠ Es el arranque del proyecto más viejo, **no el del gasto más viejo**:
 * son cosas distintas y acá no hay movimientos a mano. Un compartido
 * anterior a todos los proyectos hoy cae en `sinRepartir`, y un proyecto
 * nuevo con `fecha_inicio: null` se lo llevaría entero — efecto real que
 * este panel no muestra.
 */
function inicioMasViejo(projects: { fecha_inicio: string | null }[]): string {
  const fechas = projects
    .map((p) => p.fecha_inicio)
    .filter((f): f is string => f !== null);
  if (fechas.length === 0) return todayISO();
  return fechas.reduce((a, b) => (a < b ? a : b));
}

export function AccionesPresupuesto({
  presupuestoId,
  estado,
  titulo,
  clienteNombre,
  projectId,
}: {
  presupuestoId: string;
  estado: EstadoPresupuesto;
  titulo: string;
  clienteNombre: string;
  projectId: string | null;
}) {
  const router = useRouter();
  const { projects } = useAppData();
  const [pendiente, empezar] = useTransition();

  const [aceptando, setAceptando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [archivando, setArchivando] = useState(false);

  const [modo, setModo] = useState<"nuevo" | "existente">("nuevo");
  const [nombreProyecto, setNombreProyecto] = useState(titulo || clienteNombre);
  const [color, setColor] = useState<string>(COLORES[0]);
  const [fechaInicio, setFechaInicio] = useState(todayISO());
  const [proyectoElegido, setProyectoElegido] = useState<string>("");

  const [motivo, setMotivo] =
    useState<DescarteInput["motivo"]>("no_prospero");
  const [detalle, setDetalle] = useState("");

  const resuelto = estado === "aceptado" || estado === "descartado";

  // ── El aviso del prorrateo, con números concretos ─────────────────
  //
  // La ventana la abre la fecha del campo de arriba —la misma que se
  // inserta— y no hoy: con una fecha retroactiva el proyecto nuevo entra
  // al reparto de gastos que ya pasaron.
  const conNuevo: ProyectoParaReparto[] = [
    ...projects,
    {
      id: "__nuevo__",
      // Tal cual lo inserta `aceptarPresupuesto`: el campo vacío es
      // `null`, y sin fecha de cierre el proyecto queda abierto.
      fecha_inicio: fechaInicio || null,
      fecha_fin: null,
      peso_prorrateo: 1,
    },
  ];
  const desde = fechaInicio || inicioMasViejo(projects);
  const antes = calcularParticipaciones(projects, desde);
  const despues = calcularParticipaciones(conNuevo, desde);
  const participantes = projects.filter((p) => despues.has(p.id));

  // Los cortes se usan **solo como detector**. Si el reparto cambia más
  // de una vez en la ventana, no hay un par "antes → después" que
  // mostrar: los porcentajes de una sola fecha no son el efecto: el 01/04
  // y el 01/06 alcanzan a 15 y a 7 gastos, y darían los mismos números.
  // Ahí el panel dice lo que pasa en palabras y no finge una medición.
  const variosRepartos = cortesDelReparto(conNuevo, desde).length > 1;

  const proyectoVinculado = projectId
    ? (projects.find((p) => p.id === projectId) ?? null)
    : null;

  function enviar() {
    empezar(async () => {
      const resultado = await marcarEnviado(presupuestoId);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Marcado como enviado.");
      router.refresh();
    });
  }

  function aceptar() {
    empezar(async () => {
      const resultado = await aceptarPresupuesto(
        presupuestoId,
        modo === "existente"
          ? { modo: "existente", projectId: proyectoElegido }
          : {
              modo: "nuevo",
              nombre: nombreProyecto.trim(),
              color,
              fecha_inicio: fechaInicio || null,
            },
      );

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      setAceptando(false);
      toast.success(
        resultado.data.creado
          ? "Aceptado. El proyecto quedó creado y activo."
          : "Aceptado y vinculado al proyecto.",
      );
      router.refresh();
    });
  }

  function descartar() {
    empezar(async () => {
      const resultado = await descartarPresupuesto(presupuestoId, {
        motivo,
        detalle: detalle.trim() === "" ? null : detalle.trim(),
      });

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      setDescartando(false);
      toast.success("Descartado. La fila queda: es lo que después enseña.");
      router.refresh();
    });
  }

  function archivar() {
    empezar(async () => {
      const resultado = await archivarPresupuesto(presupuestoId);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Archivado.");
      router.push("/presupuestos");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {estado === "borrador" ? (
        <Button variant="outline" size="sm" onClick={enviar} disabled={pendiente}>
          <Send className="size-4" />
          Marcar como enviado
        </Button>
      ) : null}

      {!resuelto ? (
        <>
          <Button size="sm" onClick={() => setAceptando(true)}>
            <Check className="size-4" />
            Aceptar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDescartando(true)}
          >
            <X className="size-4" />
            Descartar
          </Button>
        </>
      ) : null}

      {proyectoVinculado ? (
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/proyectos/${proyectoVinculado.slug}`}>
            Ver {proyectoVinculado.nombre}
          </Link>
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setArchivando(true)}
        disabled={pendiente}
      >
        <Archive className="size-4" />
        Archivar
      </Button>

      {/* ── Aceptar ─────────────────────────────────────────────── */}
      <Dialog open={aceptando} onOpenChange={setAceptando}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Aceptar el presupuesto</DialogTitle>
            <DialogDescription>
              Aceptar <strong>es</strong> crear o elegir el proyecto: sin eso,
              «aceptado» sería un rótulo que no cambia nada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={modo === "nuevo" ? "default" : "outline"}
                onClick={() => setModo("nuevo")}
              >
                Proyecto nuevo
              </Button>
              <Button
                type="button"
                size="sm"
                variant={modo === "existente" ? "default" : "outline"}
                onClick={() => setModo("existente")}
                disabled={projects.length === 0}
              >
                Uno que ya existe
              </Button>
            </div>

            {modo === "nuevo" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="p-nombre-nuevo">Nombre del proyecto</Label>
                  <Input
                    id="p-nombre-nuevo"
                    value={nombreProyecto}
                    onChange={(e) => setNombreProyecto(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {COLORES.map((opcion) => (
                      <button
                        key={opcion}
                        type="button"
                        aria-label={`Color ${opcion}`}
                        aria-pressed={color === opcion}
                        onClick={() => setColor(opcion)}
                        data-activo={color === opcion}
                        className="size-7 rounded-full transition-transform data-[activo=true]:scale-110 data-[activo=true]:ring-2 data-[activo=true]:ring-offset-2"
                        style={{ backgroundColor: opcion }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="p-inicio">Fecha de inicio</Label>
                  <Input
                    id="p-inicio"
                    type="date"
                    className="cifra"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                  />
                </div>

                {/*
                  El aviso, con números y no con una advertencia genérica.
                  Es lo que pide el encabezado de la migración de fechas de
                  proyecto: que el cambio se vea antes de que pase.
                */}
                <div className="space-y-2 rounded-md border border-[var(--mango)] p-3 text-xs">
                  <p className="font-medium text-[var(--mango)]">
                    Un proyecto más cambia el reparto de los gastos
                    compartidos.
                  </p>
                  <p className="text-muted-foreground">
                    Cada gasto compartido se reparte entre los proyectos que
                    estaban abiertos el día que lo cargaste, así que este toca
                    solo los que caen dentro de su ventana: con la fecha de
                    arriba, de ahí en adelante. Tu balance general no se mueve
                    —suma el compartido una sola vez—, pero los balances por
                    proyecto sí.
                  </p>
                  {variosRepartos ? (
                    <p className="text-muted-foreground">
                      Con esa fecha de inicio no hay un reparto solo que
                      mostrarte: entre esa fecha y hoy hay proyectos que abren
                      y otros que cierran, y cada gasto compartido se reparte
                      según cómo estaban las cosas ese día. Se van a mover los
                      balances de todos los que estuvieron abiertos en el
                      medio.
                    </p>
                  ) : participantes.length > 0 ? (
                    <ul className="space-y-0.5">
                      {participantes.map((p) => (
                        <li key={p.id} className="flex justify-between gap-4">
                          <span className="truncate">{p.nombre}</span>
                          <span className="cifra shrink-0">
                            {porcentaje(antes.get(p.id)?.fraccion ?? 0)} →{" "}
                            {porcentaje(despues.get(p.id)?.fraccion ?? 0)}
                          </span>
                        </li>
                      ))}
                      <li className="flex justify-between gap-4 font-medium">
                        <span className="truncate">
                          {nombreProyecto || "el proyecto nuevo"}
                        </span>
                        <span className="cifra shrink-0">
                          — → {porcentaje(despues.get("__nuevo__")?.fraccion ?? 0)}
                        </span>
                      </li>
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      Con esa fecha de inicio no hay ningún otro proyecto
                      abierto, así que el compartido no se reparte entre nadie.
                      Con este, pasa a llevárselo entero.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="p-existente">Proyecto</Label>
                <Select
                  value={proyectoElegido}
                  onValueChange={setProyectoElegido}
                >
                  <SelectTrigger id="p-existente">
                    <SelectValue placeholder="Elegí un proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                        {p.activo ? "" : " (inactivo)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Vincular a uno que ya existe y está activo no mueve el
                  prorrateo: la cantidad de proyectos activos no cambia.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAceptando(false)}
              disabled={pendiente}
            >
              Cancelar
            </Button>
            <Button
              onClick={aceptar}
              disabled={
                pendiente ||
                (modo === "nuevo"
                  ? nombreProyecto.trim() === ""
                  : proyectoElegido === "")
              }
            >
              {pendiente ? <Loader2 className="size-4 animate-spin" /> : null}
              {modo === "nuevo" ? "Crear proyecto y aceptar" : "Aceptar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Descartar ───────────────────────────────────────────── */}
      <Dialog open={descartando} onOpenChange={setDescartando}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Descartar el presupuesto</DialogTitle>
            <DialogDescription>
              La fila no se borra. Los motivos son los que te sirven para releer
              tu propio proceso, no una taxonomía prestada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="d-motivo">Motivo</Label>
              <Select
                value={motivo}
                onValueChange={(v) => setMotivo(v as DescarteInput["motivo"])}
              >
                <SelectTrigger id="d-motivo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {ETIQUETA_MOTIVO[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {QUE_ENSENA[motivo]}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="d-detalle">
                Detalle {motivo === "otro" ? "(obligatorio)" : "(opcional)"}
              </Label>
              <Textarea
                id="d-detalle"
                rows={3}
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder="Qué pasó, con tus palabras."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDescartando(false)}
              disabled={pendiente}
            >
              Cancelar
            </Button>
            <Button
              onClick={descartar}
              disabled={
                pendiente || (motivo === "otro" && detalle.trim() === "")
              }
            >
              {pendiente ? <Loader2 className="size-4 animate-spin" /> : null}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archivar ────────────────────────────────────────────── */}
      <AlertDialog open={archivando} onOpenChange={setArchivando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar «{titulo}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la lista pero no se borra: el borrado por defecto de toda
              la app es archivado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={archivar}>Archivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
