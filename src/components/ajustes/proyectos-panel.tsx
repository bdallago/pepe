"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  actualizarProyecto,
  borrarProyecto,
  crearProyecto,
} from "@/lib/actions/projects";
import { projectSchema, type ProjectInput } from "@/lib/schemas";
import { todayISO } from "@/lib/dates";
import { calcularParticipaciones, estaVivo } from "@/lib/prorrateo";
import type { Project } from "@/lib/supabase/database.types";

/**
 * Los ocho tonos de la paleta de gráficos, en el mismo orden.
 *
 * Que el color del proyecto salga de acá y no de un picker libre es lo que
 * mantiene los gráficos legibles: son tonos ya validados para daltonismo y
 * contraste contra las superficies de la app.
 */
const COLORES = [
  "#008f8f", // teal de marca
  "#d63f00", // naranja de marca
  "#2a78d6", // azul
  "#eda100", // amarillo
  "#e87ba4", // magenta
  "#008300", // verde
  "#4a3aa7", // violeta
  "#e34948", // rojo
] as const;

/**
 * Un `<input type="date">` vacío devuelve `""`, y `""` no es una fecha ni
 * es null: no pasa el regex de `isoDate` y el formulario se traba con un
 * "Fecha inválida" para un campo que el usuario dejó en blanco a
 * propósito, que es un estado válido de las dos puntas de la ventana.
 */
const vacioEsNull = (valor: unknown) =>
  typeof valor === "string" && valor.trim() === "" ? null : valor;

export function ProyectosPanel() {
  const router = useRouter();
  const { projects } = useAppData();

  const [editando, setEditando] = useState<Project | null>(null);
  const [creando, setCreando] = useState(false);
  const [borrando, setBorrando] = useState<Project | null>(null);

  const participaciones = calcularParticipaciones(projects, todayISO());

  async function confirmarBorrado() {
    if (!borrando) return;
    const resultado = await borrarProyecto(borrando.id);
    setBorrando(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Proyecto borrado.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Proyectos</CardTitle>
          <CardDescription>
            Cada gasto compartido se reparte, según su peso, entre los que
            estaban abiertos ese día.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreando(true)}>
          <Plus className="size-4" />
          Nuevo
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {projects.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            Todavía no hay proyectos.
          </p>
        ) : (
          projects.map((proyecto) => {
            const participacion = participaciones.get(proyecto.id);

            return (
              <div
                key={proyecto.id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: proyecto.color }}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{proyecto.nombre}</p>
                  <p className="text-muted-foreground text-xs">
                    /{proyecto.slug} · peso {proyecto.peso_prorrateo}
                    {participacion
                      ? ` · ${(participacion.fraccion * 100).toFixed(1)}% de lo compartido`
                      : ""}
                  </p>
                </div>

                {!estaVivo(proyecto) ? (
                  <Badge variant="outline">cerrado</Badge>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Editar ${proyecto.nombre}`}
                  onClick={() => setEditando(proyecto)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Borrar ${proyecto.nombre}`}
                  onClick={() => setBorrando(proyecto)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })
        )}
      </CardContent>

      {/* key fuerza el remount para que defaultValues tome el proyecto
          que se está editando en vez del de la apertura anterior. */}
      <ProyectoDialog
        key={editando?.id ?? "nuevo"}
        open={creando || editando !== null}
        proyecto={editando ?? undefined}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setCreando(false);
            setEditando(null);
          }
        }}
      />

      <AlertDialog
        open={borrando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setBorrando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{borrando?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Los movimientos del proyecto no se borran: pasan a contar como
              gastos compartidos. Si solo querés sacarlo del prorrateo de
              acá en adelante, ponele una fecha de cierre en vez de
              borrarlo: así conserva la parte que le tocó mientras estuvo
              abierto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarBorrado}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProyectoDialog({
  proyecto,
  open,
  onOpenChange,
}: {
  proyecto?: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      nombre: proyecto?.nombre ?? "",
      color: proyecto?.color ?? COLORES[0],
      // Un proyecto nuevo nace hoy y sin cierre. Dejar `fecha_inicio` en
      // null sería "existió desde siempre", que para uno que se crea
      // ahora es falso: se llevaría su parte de gastos compartidos de
      // años anteriores a que existiera.
      fecha_inicio: proyecto?.fecha_inicio ?? todayISO(),
      fecha_fin: proyecto?.fecha_fin ?? null,
      peso_prorrateo: proyecto ? Number(proyecto.peso_prorrateo) : 1,
    },
  });

  const { register, handleSubmit, watch, setValue, formState, reset } = form;

  async function onSubmit(values: ProjectInput) {
    const resultado = proyecto
      ? await actualizarProyecto(proyecto.id, values)
      : await crearProyecto(values);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    toast.success(proyecto ? "Proyecto actualizado." : "Proyecto creado.");
    reset();
    router.refresh();
    onOpenChange(false);
  }

  const color = watch("color");

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        if (!abierto) reset();
        onOpenChange(abierto);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {proyecto ? "Editar proyecto" : "Nuevo proyecto"}
          </DialogTitle>
          <DialogDescription>
            El peso define qué parte de los gastos compartidos le toca.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-nombre">Nombre</Label>
            <Input
              id="p-nombre"
              {...register("nombre")}
              placeholder="Ej: App de gastos"
              autoComplete="off"
            />
            {formState.errors.nombre ? (
              <p className="text-destructive text-xs">
                {formState.errors.nombre.message}
              </p>
            ) : null}
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
                  onClick={() => setValue("color", opcion)}
                  className="size-7 rounded-full transition-transform data-[activo=true]:scale-110 data-[activo=true]:ring-2 data-[activo=true]:ring-offset-2"
                  data-activo={color === opcion}
                  style={{ backgroundColor: opcion }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-peso">Peso de prorrateo</Label>
            <Input
              id="p-peso"
              type="number"
              step="0.1"
              min="0.1"
              {...register("peso_prorrateo", { valueAsNumber: true })}
              className="cifra"
            />
            <p className="text-muted-foreground text-xs">
              1 en todos los proyectos = partes iguales.
            </p>
            {formState.errors.peso_prorrateo ? (
              <p className="text-destructive text-xs">
                {formState.errors.peso_prorrateo.message}
              </p>
            ) : null}
          </div>

          {/* La ventana reemplazó a la vieja bandera `activo`, y no es lo
              mismo con otra forma: un gasto compartido se reparte entre
              los proyectos que estaban vivos EN SU FECHA, así que mover
              estas dos fechas reescribe el pasado a propósito. Vaciar el
              inicio es "desde siempre" y vaciar el cierre es "sigue
              abierto"; los dos bordes son inclusivos. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-inicio">Inicio</Label>
              <Input
                id="p-inicio"
                type="date"
                className="cifra"
                {...register("fecha_inicio", { setValueAs: vacioEsNull })}
              />
              {formState.errors.fecha_inicio ? (
                <p className="text-destructive text-xs">
                  {formState.errors.fecha_inicio.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-fin">Cierre</Label>
              <Input
                id="p-fin"
                type="date"
                className="cifra"
                {...register("fecha_fin", { setValueAs: vacioEsNull })}
              />
              {formState.errors.fecha_fin ? (
                <p className="text-destructive text-xs">
                  {formState.errors.fecha_fin.message}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">
            Sin cierre el proyecto sigue abierto y se lleva su parte de los
            gastos compartidos de hoy en adelante.
          </p>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={formState.isSubmitting}
              className="flex-1"
            >
              {formState.isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {proyecto ? "Guardar cambios" : "Crear proyecto"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
