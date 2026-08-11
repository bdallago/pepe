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
import { estaVivo, participacionesEnFecha } from "@/lib/prorrateo";
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
 * Los dos repartos se simulan **en la fecha de inicio del formulario**,
 * que es la que se va a insertar. Con la de hoy el aviso mentía apenas
 * Beno retrocedía el campo: `participacionesEnFecha()` reparte entre los
 * que estaban vivos en la fecha de cada gasto, así que una fecha vieja
 * mete al proyecto nuevo en el reparto de gastos que ya pasaron —que es
 * justo el caso sobre el que este recuadro existe para avisar— y los
 * proyectos a listar son los de entonces, no los de hoy.
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
 * La fecha más vieja en la que ya había algo que repartir.
 *
 * Es dónde se simula cuando el campo de inicio quedó vacío: eso inserta
 * `fecha_inicio: null`, que para `estaVivo()` es **desde siempre**, así
 * que el efecto del proyecto nuevo arranca en el gasto más viejo y no
 * hoy. Sin proyectos con fecha, no hay histórico contra el cual avisar.
 */
function inicioDelHistorico(
  projects: { fecha_inicio: string | null }[],
): string {
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
  // Todo se mira en `desdeCuando`, que es la fecha del campo de arriba
  // —la misma que se inserta— y no hoy: con una fecha retroactiva el
  // proyecto nuevo entra al reparto de gastos que ya pasaron, y los que
  // tienen que aparecer en la lista son los que estaban vivos entonces.
  const desdeCuando = fechaInicio || inicioDelHistorico(projects);
  const activos = projects.filter((p) => estaVivo(p, desdeCuando));
  const antes = participacionesEnFecha(projects, desdeCuando);
  const despues = participacionesEnFecha(
    [
      ...projects,
      {
        id: "__nuevo__",
        // Tal cual lo inserta `aceptarPresupuesto`: el campo vacío es
        // `null`, y sin fecha de cierre el proyecto queda abierto.
        fecha_inicio: fechaInicio || null,
        fecha_fin: null,
        peso_prorrateo: 1,
      },
    ],
    desdeCuando,
  );

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
                    Un proyecto activo más cambia el reparto de los gastos
                    compartidos, y hacia atrás.
                  </p>
                  <p className="text-muted-foreground">
                    El prorrateo reparte entre los proyectos activos de hoy y
                    ese reparto se aplica a todo el histórico. Tu balance
                    general no se mueve —suma el compartido una sola vez—, pero
                    los balances por proyecto sí.
                  </p>
                  {activos.length > 0 ? (
                    <ul className="space-y-0.5">
                      {activos.map((p) => (
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
                      Hoy no hay proyectos activos, así que el compartido no se
                      reparte entre nadie. Con este, pasa a llevárselo entero.
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
