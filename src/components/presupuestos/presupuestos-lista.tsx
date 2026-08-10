import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { EstadoPresupuesto, Quote } from "@/lib/presupuestos-server";
import { ETIQUETA_SEGMENTO } from "@/lib/avisos-tarifa";

/**
 * La lista de presupuestos con su estado.
 *
 * Los cuatro estados se ven distinto porque significan cosas distintas:
 * `borrador` y `enviado` están vivos, `aceptado` y `descartado` son
 * terminales — y ninguno de los dos borra la fila, porque los dos enseñan.
 */

const ETIQUETA_ESTADO: Record<EstadoPresupuesto, string> = {
  borrador: "borrador",
  enviado: "enviado",
  aceptado: "aceptado",
  descartado: "descartado",
};

const VARIANTE_ESTADO: Record<
  EstadoPresupuesto,
  "default" | "secondary" | "outline"
> = {
  borrador: "outline",
  enviado: "secondary",
  aceptado: "default",
  descartado: "outline",
};

export const ETIQUETA_MOTIVO = {
  no_era_lo_que_queria: "No era lo que quería",
  quedo_desactualizado: "Quedó desactualizado",
  no_prospero: "No prosperó",
  otro: "Otro",
} as const;

export function PresupuestosLista({ presupuestos }: { presupuestos: Quote[] }) {
  if (presupuestos.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        Todavía no hay presupuestos. El primero es el que dice cuánto sale tu
        trabajo con nombre y apellido.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {presupuestos.map((quote) => (
        <li key={quote.id}>
          <Link
            href={`/presupuestos/${quote.id}`}
            className="hover:bg-secondary/40 flex flex-wrap items-center gap-3 rounded-md border p-3 transition-colors"
          >
            <span className="cifra text-muted-foreground w-10 shrink-0 text-sm">
              Nº {quote.numero}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{quote.titulo}</p>
              <p className="text-muted-foreground text-xs">
                {quote.cliente_nombre} ·{" "}
                {ETIQUETA_SEGMENTO[quote.cliente_tipo]} ·{" "}
                <span className="cifra">{formatDate(quote.fecha)}</span>
                {quote.motivo_descarte
                  ? ` · ${ETIQUETA_MOTIVO[quote.motivo_descarte]}`
                  : ""}
              </p>
            </div>

            <Badge
              variant={VARIANTE_ESTADO[quote.estado]}
              className="h-5 text-[10px] font-normal"
            >
              {ETIQUETA_ESTADO[quote.estado]}
            </Badge>

            <span className="cifra shrink-0 font-medium">
              {formatMoney(Number(quote.total_origen), quote.moneda)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
