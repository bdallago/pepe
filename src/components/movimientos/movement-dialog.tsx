"use client";

import { MovementForm } from "@/components/movimientos/movement-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PrecargaMovimiento } from "@/lib/agentes/tipos";
import type { Movement } from "@/lib/supabase/database.types";

/** Alta o edición de un movimiento en modal. */
export function MovementDialog({
  movimiento,
  precarga,
  projectIdInicial,
  open,
  onOpenChange,
  onListo,
}: {
  movimiento?: Movement;
  /** Un movimiento dictado a la caja de agentes, ya leído y clasificado. */
  precarga?: PrecargaMovimiento;
  projectIdInicial?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Se guardó de verdad. Aparte de `onOpenChange` porque cerrar y guardar
   * no son lo mismo: quien abrió esto desde la caja quiere cerrar también
   * la caja cuando el movimiento entró, y no cuando Beno se arrepintió.
   */
  onListo?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {movimiento ? "Editar movimiento" : "Cargar movimiento"}
          </DialogTitle>
          <DialogDescription>
            Escribí el monto en pesos o en dólares: el otro se completa solo.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <MovementForm
            key={movimiento?.id ?? "nuevo"}
            movimiento={movimiento}
            precarga={precarga}
            projectIdInicial={projectIdInicial}
            onListo={() => {
              onOpenChange(false);
              onListo?.();
            }}
            onCancelar={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
