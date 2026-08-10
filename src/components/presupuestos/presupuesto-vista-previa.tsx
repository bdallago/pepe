import { BotonImprimir } from "@/components/presupuestos/boton-imprimir";
import { PresupuestoDocumento } from "@/components/presupuestos/presupuesto-documento";
import { PRESUPUESTO_DE_EJEMPLO } from "@/components/presupuestos/presupuesto-ejemplo";
import type { PresupuestoImprimible } from "@/components/presupuestos/tipos";

/**
 * El documento con su botón de imprimir arriba.
 *
 * Es lo que va a montar la pantalla `/presupuestos/[id]` cuando exista la
 * tabla `quotes`. Sin `presupuesto` muestra el de ejemplo, así que el
 * documento se puede mirar hoy sin ninguna fila cargada.
 *
 * La barra lleva `no-imprimir`: al papel va el documento y nada más.
 */
export function PresupuestoVistaPrevia({
  presupuesto = PRESUPUESTO_DE_EJEMPLO,
}: {
  presupuesto?: PresupuestoImprimible;
}) {
  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Se exporta con Ctrl+P → &ldquo;Guardar como PDF&rdquo;. Conviene
          destildar &ldquo;Encabezados y pies de página&rdquo; en el diálogo:
          el navegador se acuerda de la elección.
        </p>
        <BotonImprimir
          titulo={`Presupuesto ${presupuesto.numero} – ${presupuesto.cliente_nombre}`}
        />
      </div>

      <PresupuestoDocumento presupuesto={presupuesto} />
    </div>
  );
}
