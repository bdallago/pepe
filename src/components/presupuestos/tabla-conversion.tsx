import { ETIQUETA_SEGMENTO } from "@/lib/avisos-tarifa";
import { formatMoney } from "@/lib/format";
import {
  UMBRAL_LECTURA,
  type Conversion,
  type MotivoDescarte,
} from "@/lib/presupuestos/conversion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * La tabla de conversión: qué pasó con lo que cotizaste.
 *
 * El cálculo entero vive en `lib/presupuestos/conversion.ts`, que es puro.
 * Acá no se calcula nada — ni un porcentaje — a propósito: si la pantalla
 * hiciera su propia aritmética habría dos lugares donde vive la misma
 * regla y podrían contestar distinto.
 *
 * **Lo que este panel no hace es opinar.** No hay una sola frase que diga
 * qué hacer con los números. Es la etapa 3 del spec y es deliberado: la
 * lectura comercial hecha por un modelo es la etapa 6 y no se habilita
 * hasta que haya ≥ 10 resueltos, porque con cuatro filas un razonador
 * produce exactamente el consejo genérico que la regla número uno de
 * `lib/sugerencias.ts` prohíbe. Lo único que se permite es **nombrar** lo
 * que cada motivo enseña, y eso es texto del spec, no producción de un
 * modelo.
 */

/**
 * Qué te dice cada motivo. Salen textuales de la tabla del spec, y están
 * acá porque un enum crudo (`no_era_lo_que_queria: 2`) no se puede leer:
 * el valor del panel es justamente que los tres no enseñan lo mismo.
 */
const LECTURA_MOTIVO: Record<MotivoDescarte, { etiqueta: string; dice: string }> =
  {
    no_era_lo_que_queria: {
      etiqueta: "No era lo que quería",
      dice: "Leíste mal el pedido. Apunta a la estimación.",
    },
    quedo_desactualizado: {
      etiqueta: "Quedó desactualizado",
      dice: "Tardaste. Apunta al proceso, y se cruza con los días.",
    },
    no_prospero: {
      etiqueta: "No prosperó",
      dice: "Casi nada: el cliente desapareció o se cayó de su lado.",
    },
    otro: {
      etiqueta: "Otro",
      dice: "Lo que enseña está en el detalle, no en el motivo.",
    },
  };

function porcentaje(fraccion: number): string {
  return `${Math.round(fraccion * 100)} %`;
}

function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{etiqueta}</p>
      <p className="cifra text-lg font-medium">{children}</p>
    </div>
  );
}

export function TablaConversion({ conversion }: { conversion: Conversion }) {
  // Sin un solo presupuesto no hay nada que leer, y la lista de arriba ya
  // dice que no hay ninguno. Un panel vacío al lado sería repetirlo.
  if (conversion.total === 0) return null;

  const {
    resueltos,
    aceptados,
    descartados,
    sinResolver,
    tasaGlobal,
    porTipo,
    techos,
    motivos,
    demora,
    rehechos,
    cadenaMasLarga,
    suficiente,
  } = conversion;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversión</CardTitle>
        <p className="text-muted-foreground text-sm">
          Qué pasó con lo que cotizaste. Son cuentas sobre tus filas: no
          interviene ningún modelo.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {resueltos === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no se resolvió ninguno.{" "}
            {sinResolver === 1
              ? "Hay uno en curso"
              : `Hay ${sinResolver} en curso`}
            : la conversión aparece cuando alguno se acepte o se descarte.
          </p>
        ) : (
          <>
            {/*
              El aviso va arriba y no al pie: si los números no significan
              nada todavía, eso hay que saberlo antes de leerlos, no
              después de haber sacado una conclusión.
            */}
            {!suficiente ? (
              <p className="rounded-md border border-[var(--mango)] p-3 text-sm">
                Con <span className="cifra">{resueltos}</span>{" "}
                {resueltos === 1 ? "resuelto" : "resueltos"} estos números
                todavía no significan nada — hacen falta{" "}
                <span className="cifra">{UMBRAL_LECTURA}</span> para que una
                tasa deje de moverse entera con cada presupuesto. Están acá
                para mirarlos, no para decidir con ellos.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Dato etiqueta="Aceptados">
                {aceptados} / {resueltos}
              </Dato>
              <Dato etiqueta="Tasa de aceptación">
                {tasaGlobal === null ? "—" : porcentaje(tasaGlobal)}
              </Dato>
              <Dato etiqueta="Descartados">{descartados}</Dato>
              <Dato etiqueta="Sin resolver">{sinResolver}</Dato>
            </div>

            {/* ── Por tipo de cliente ──────────────────────────────── */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Por tipo de cliente</h3>
              <p className="text-muted-foreground text-xs">
                Si un segmento entero se cae, su multiplicador está mal
                calibrado <em>para tus clientes</em>, que no es lo mismo que
                estar mal en abstracto.
              </p>
              <ul className="divide-y rounded-md border">
                {porTipo.map((fila) => (
                  <li
                    key={fila.tipo}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span>{ETIQUETA_SEGMENTO[fila.tipo]}</span>
                    {fila.resueltos === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        sin resueltos
                      </span>
                    ) : (
                      <span className="cifra">
                        {fila.aceptados} / {fila.resueltos} ·{" "}
                        {porcentaje(fila.tasa!)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* ── El techo ─────────────────────────────────────────── */}
            {techos.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Dónde está el techo</h3>
                <ul className="space-y-2">
                  {techos.map((techo) => (
                    <li
                      key={techo.moneda}
                      className="rounded-md border px-3 py-2 text-sm"
                    >
                      <p className="text-muted-foreground text-xs">
                        {techo.moneda}
                      </p>
                      <p>
                        Aceptado más caro:{" "}
                        <span className="cifra font-medium">
                          {techo.aceptadoMasCaro === null
                            ? "—"
                            : formatMoney(techo.aceptadoMasCaro, techo.moneda)}
                        </span>
                        {" · "}
                        Descartado más barato:{" "}
                        <span className="cifra font-medium">
                          {techo.descartadoMasBarato === null
                            ? "—"
                            : formatMoney(
                                techo.descartadoMasBarato,
                                techo.moneda,
                              )}
                        </span>
                      </p>
                      {techo.seCruzan ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Los dos se cruzan: te aceptaron uno más caro que
                          otro que se cayó, así que el precio no es lo que
                          está decidiendo.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* ── Por qué se cayeron ───────────────────────────────── */}
            {motivos.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Por qué se cayeron</h3>
                <ul className="divide-y rounded-md border">
                  {motivos.map(({ motivo, n }) => (
                    <li key={motivo} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span>{LECTURA_MOTIVO[motivo].etiqueta}</span>
                        <span className="cifra">{n}</span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {LECTURA_MOTIVO[motivo].dice}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* ── Cuánto tardan y cuántas veces se rehicieron ──────── */}
            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">
                  Días de enviado a resuelto (mediana)
                </p>
                <p className="cifra text-lg font-medium">
                  {demora.mediana === null ? "—" : demora.mediana}
                </p>
                <p className="text-muted-foreground text-xs">
                  {demora.n === 0
                    ? "Ninguno tiene fecha de envío y de resolución."
                    : `Sobre ${demora.n} con las dos fechas.`}
                  {demora.medianaDesactualizados !== null
                    ? ` Los que quedaron desactualizados tardaron ${demora.medianaDesactualizados}.`
                    : ""}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs">
                  Presupuestos rehechos
                </p>
                <p className="cifra text-lg font-medium">{rehechos}</p>
                <p className="text-muted-foreground text-xs">
                  {cadenaMasLarga > 1
                    ? `El mismo pedido se cotizó hasta ${cadenaMasLarga} veces.`
                    : "Ninguno hubo que rehacerlo."}
                </p>
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
