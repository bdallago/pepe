"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Pedir lecciones sobre un tema (spec 6.3).
 *
 * Lo que se escribe acá no se guarda en ningún lado: va al modelo y
 * vuelve como propuestas a la bandeja. Por eso el botón dice "Proponer" y
 * no "Crear", y por eso el diálogo avisa adónde fueron a parar. Si dijera
 * "listo, creadas", la próxima vez nadie iría a buscarlas.
 */
export function GenerarLecciones() {
  const router = useRouter();
  const { proyectosActivos, projects } = useAppData();

  const [abierto, setAbierto] = useState(false);
  const [tema, setTema] = useState("");
  const [projectId, setProjectId] = useState<string>(
    proyectosActivos[0]?.id ?? "",
  );
  const [generando, setGenerando] = useState(false);

  // Los activos primero, pero se puede elegir uno archivado: pedir
  // lecciones sobre un proyecto cerrado es un caso legítimo.
  const elegibles = [
    ...proyectosActivos,
    ...projects.filter((p) => !proyectosActivos.some((a) => a.id === p.id)),
  ];

  async function proponer() {
    if (tema.trim().length < 3 || !projectId) return;

    setGenerando(true);
    try {
      const respuesta = await fetch("/api/lecciones/generar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tema: tema.trim(), projectId }),
      });
      const resultado = await respuesta.json();

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      const { propuestas, repetidas, sinNovedad } = resultado.data;

      if (propuestas === 0) {
        toast.info(
          sinNovedad
            ? "El modelo no encontró nada que no supieras ya sobre ese tema."
            : "Todas las que propuso ya estaban esperando en la bandeja.",
        );
      } else {
        toast.success(
          `${propuestas} ${propuestas === 1 ? "propuesta nueva" : "propuestas nuevas"} en la bandeja` +
            (repetidas > 0 ? `, ${repetidas} ya estaban.` : "."),
        );
      }

      setAbierto(false);
      setTema("");
      // El contador de la bandeja vive en el layout.
      router.refresh();
    } catch {
      toast.error("No pude hablar con el modelo. Probá de nuevo.");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <Sparkles className="size-4" aria-hidden="true" />
        Proponer lecciones sobre un tema
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proponer lecciones sobre un tema</DialogTitle>
            <DialogDescription>
              El modelo mira las lecciones que ya tenés de ese proyecto para no
              repetirlas. Lo que proponga va a la bandeja: nada se guarda hasta
              que lo aceptes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tema-lecciones">Tema</Label>
              <Textarea
                id="tema-lecciones"
                rows={3}
                autoFocus
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                placeholder="pricing de SaaS para clientes chicos"
              />
              <p className="text-muted-foreground text-xs">
                Cuanto más concreto el tema, menos lugares comunes vuelven.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="proyecto-lecciones">Proyecto</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="proyecto-lecciones">
                  <SelectValue placeholder="Elegí un proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {elegibles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                      {p.archivado_en ? " (archivado)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setAbierto(false)}
              disabled={generando}
            >
              Cancelar
            </Button>
            <Button
              onClick={proponer}
              disabled={generando || tema.trim().length < 3 || !projectId}
            >
              {generando && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {generando ? "Pensando…" : "Proponer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
