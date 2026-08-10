import { addDays, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { PresupuestoImprimible } from "@/components/presupuestos/tipos";

/**
 * El documento que se manda al cliente.
 *
 * **El PDF es esta misma pantalla.** No hay librería de PDF ni segundo
 * layout: se ve en el navegador y se exporta con Ctrl+P → "Guardar como
 * PDF", con la hoja de impresión que vive al final de `globals.css`.
 *
 * Por qué así, en orden de peso:
 *
 *   1. Cero dependencias nuevas.
 *   2. La tipografía ya está cargada. Fira Sans y Fira Code llegan por
 *      `next/font`; con una librería de PDF habría que conseguir los
 *      `.ttf` aparte para llegar a la misma tipografía que el navegador
 *      ya tiene.
 *   3. Un renderer menos que mantener. Con dos layouts, el que se rompe
 *      en silencio es el que nadie mira: el que se manda al cliente.
 *
 * Lo que cuesta, dicho derecho: el navegador imprime su propio encabezado
 * y pie (URL, fecha, numeración) salvo que se destilde "Encabezados y
 * pies de página" en el diálogo de impresión. Chrome se acuerda de la
 * elección, así que es una vez, pero hay que saberlo.
 *
 * **No guarda los bytes del PDF, y no hace falta**: lo que se congela son
 * las entradas —tarifa, multiplicador, tasa, horas por semana, los
 * ítems—, así que la misma fila renderiza el mismo documento hoy y en dos
 * años. Es el razonamiento de la regla 1 aplicado al papel.
 */

const ETIQUETA_CLIENTE = {
  particular: "Particular / emprendedor",
  pyme: "Pyme",
  empresa: "Empresa",
} as const;

export function PresupuestoDocumento({
  presupuesto,
}: {
  presupuesto: PresupuestoImprimible;
}) {
  const {
    numero,
    fecha,
    validez_dias,
    titulo,
    resumen_alcance,
    cliente_nombre,
    cliente_tipo,
    emisor_nombre,
    emisor_contacto,
    items,
    supuestos = [],
    preguntas = [],
    condiciones,
    moneda,
    total_origen,
    horas_estimadas,
    semanas_estimadas,
    mostrar_horas = false,
  } = presupuesto;

  // `addDays` trabaja a mediodía local: `new Date(iso)` a secas parsea en
  // UTC y en Argentina devuelve el día anterior.
  const vence = addDays(fecha, validez_dias);

  return (
    <article className="hoja mx-auto w-full max-w-[820px] rounded-lg border border-border bg-card p-8 text-foreground sm:p-12">
      {/* ── Encabezado ───────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
        <div>
          <p className="rotulo text-muted-foreground">
            Presupuesto Nº <span className="cifra">{numero}</span>
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--teal)]">
            {titulo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Para <span className="font-medium">{cliente_nombre}</span> ·{" "}
            {ETIQUETA_CLIENTE[cliente_tipo]}
          </p>
        </div>

        <dl className="text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Fecha</dt>
            <dd className="cifra">{formatDate(fecha)}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Válido hasta</dt>
            <dd className="cifra">{formatDate(vence)}</dd>
          </div>
          {emisor_nombre ? (
            <div className="mt-3 text-right">
              <p className="font-medium">{emisor_nombre}</p>
              {emisor_contacto ? (
                <p className="text-muted-foreground">{emisor_contacto}</p>
              ) : null}
            </div>
          ) : null}
        </dl>
      </header>

      {/* ── Alcance ──────────────────────────────────────────── */}
      {resumen_alcance ? (
        <section className="mt-8">
          <h2 className="rotulo text-muted-foreground">Alcance</h2>
          <p className="mt-2 whitespace-pre-line leading-relaxed">
            {resumen_alcance}
          </p>
        </section>
      ) : null}

      {/* ── Entregables ──────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="rotulo text-muted-foreground">Entregables</h2>

        <ul className="mt-3 divide-y divide-border">
          {items.map((item, i) => (
            <li
              key={`${i}-${item.titulo}`}
              className="evitar-corte flex items-start justify-between gap-6 py-3"
            >
              <div>
                <p className="font-medium">{item.titulo}</p>
                {item.detalle ? (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {item.detalle}
                  </p>
                ) : null}
              </div>

              {mostrar_horas ? (
                <p className="cifra shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                  {item.horas} h
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Total ────────────────────────────────────────────── */}
      <section className="evitar-corte mt-8 rounded-md border border-border bg-[var(--accent)] px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="rotulo text-muted-foreground">Total</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Plazo estimado:{" "}
              <span className="cifra">{semanas_estimadas}</span> semanas
              {mostrar_horas ? (
                <>
                  {" "}
                  · <span className="cifra">{horas_estimadas}</span> horas
                </>
              ) : null}
            </p>
          </div>
          <p className="cifra text-3xl font-semibold text-[var(--teal)]">
            {formatMoney(total_origen, moneda)}
          </p>
        </div>
      </section>

      {/* ── Supuestos y preguntas ────────────────────────────── */}
      {supuestos.length > 0 ? (
        <section className="evitar-corte mt-8">
          <h2 className="rotulo text-muted-foreground">
            Supuestos sobre los que se hizo este presupuesto
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {supuestos.map((texto, i) => (
              <li key={i}>{texto}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {preguntas.length > 0 ? (
        <section className="evitar-corte mt-6">
          <h2 className="rotulo text-muted-foreground">
            Preguntas pendientes
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {preguntas.map((texto, i) => (
              <li key={i}>{texto}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Condiciones ──────────────────────────────────────── */}
      {condiciones ? (
        <footer className="evitar-corte mt-8 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
          <h2 className="rotulo">Condiciones</h2>
          <p className="mt-2 whitespace-pre-line">{condiciones}</p>
        </footer>
      ) : null}
    </article>
  );
}
