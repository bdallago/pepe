import { AlertTriangle, Info } from "lucide-react";

import {
  ETIQUETA_SEGMENTO,
  FACTOR_AUTONOMO,
  HORAS_POR_MES,
  UMBRAL_DESVIO,
  type AvisoTarifa,
} from "@/lib/avisos-tarifa";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";

/**
 * Las referencias de mercado al lado de la tarifa de Beno.
 *
 * ⚠ **Avisa, no ajusta.** No hay ningún botón acá que le cambie la tarifa:
 * la app pone las columnas al lado y él decide, que es literalmente lo que
 * pidió. Y muestra el número, nunca un consejo — nada de "deberías subir".
 *
 * Se muestran **las dos fechas, que no son la misma**: cuándo corrió el
 * cron y de cuándo son los datos. Salancy es una encuesta de enero que
 * probablemente no se actualice nunca, y eso no es un error; lo que sí
 * sería un error es que la **corrida** quedara vieja. Mezclarlas en una
 * sola fecha es cómo se termina confiando en un número de hace un año.
 */

const NOMBRE_FUENTE: Record<string, string> = {
  flamahaus: "flamahaus",
  salancy: "salancy",
};

function Desvio({ desvio }: { desvio: number | null }) {
  if (desvio === null) return null;

  const porciento = (desvio * 100).toFixed(0);
  const fuerte = Math.abs(desvio) >= UMBRAL_DESVIO;

  return (
    <span
      className={
        fuerte ? "cifra text-[var(--mango)]" : "cifra text-muted-foreground"
      }
    >
      {desvio > 0 ? "+" : ""}
      {porciento} %
    </span>
  );
}

export function AvisoTarifaPanel({ aviso }: { aviso: AvisoTarifa }) {
  const moneda = aviso.tarifa_moneda;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-start gap-2">
        {aviso.hay_desfasaje ? (
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-[var(--mango)]"
            aria-hidden="true"
          />
        ) : (
          <Info
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
        )}
        <div>
          <h3 className="rotulo">Contra el mercado</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {aviso.hay_desfasaje
              ? `Hay al menos un segmento a más de ${(UMBRAL_DESVIO * 100).toFixed(0)} % de la referencia. La app te lo dice y no toca nada: la tarifa la ponés vos.`
              : `Tu tarifa está dentro del ±${(UMBRAL_DESVIO * 100).toFixed(0)} % de las referencias.`}
          </p>
        </div>
      </div>

      {aviso.vencidas.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {aviso.vencidas.map((v) => (
            <li key={v.fuente} className="text-[var(--mango)]">
              Las referencias de {NOMBRE_FUENTE[v.fuente] ?? v.fuente}{" "}
              {v.desde ? (
                <>
                  están vencidas desde el{" "}
                  <span className="cifra">{formatDate(v.desde)}</span>
                </>
              ) : (
                "nunca se bajaron"
              )}
              ; no se está comparando contra nada.
            </li>
          ))}
        </ul>
      ) : null}

      {aviso.sin_comparacion ? (
        <p className="text-muted-foreground text-xs">{aviso.sin_comparacion}</p>
      ) : null}

      {aviso.flamahaus ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Referencia <strong>flamahaus</strong>, datos del{" "}
            <span className="cifra">{formatDate(aviso.flamahaus.fecha)}</span> ·{" "}
            {aviso.flamahaus.clave}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <tr className="text-muted-foreground rotulo text-left">
                  <th className="py-1 font-normal">Segmento</th>
                  <th className="py-1 text-right font-normal">Vos</th>
                  <th className="py-1 text-right font-normal">Referencia</th>
                  <th className="py-1 text-right font-normal">Desvío</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {aviso.flamahaus.segmentos.map((s) => (
                  <tr key={s.segmento}>
                    <td className="py-1.5">{ETIQUETA_SEGMENTO[s.segmento]}</td>
                    <td className="cifra py-1.5 text-right">
                      {formatMoney(s.tuyo_ars, "ARS")}
                    </td>
                    <td className="cifra text-muted-foreground py-1.5 text-right">
                      {s.referencia_ars === null
                        ? "—"
                        : formatMoney(s.referencia_ars, "ARS")}
                    </td>
                    <td className="py-1.5 text-right">
                      <Desvio desvio={s.desvio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {aviso.salancy ? (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            Referencia <strong>salancy</strong>, datos del{" "}
            <span className="cifra">{formatDate(aviso.salancy.fecha)}</span> ·{" "}
            {aviso.salancy.clave.replace("salario-", "")} en relación de
            dependencia
          </p>
          <p>
            <span className="cifra">
              {formatMoney(aviso.salancy.bruto_mensual, "ARS")}
            </span>{" "}
            brutos por mes ÷ <span className="cifra">{HORAS_POR_MES}</span> h ={" "}
            <span className="cifra">
              {formatMoney(aviso.salancy.por_hora, "ARS")}
            </span>
            /hora → ×<span className="cifra">{FACTOR_AUTONOMO}</span> por costos
            propios (aguinaldo, obra social, vacaciones, monotributo y horas no
            facturables) ={" "}
            <span className="cifra font-medium">
              {formatMoney(aviso.salancy.autonomo_hora, "ARS")}
            </span>
            /hora como autónomo.
          </p>
          <p className="text-muted-foreground">
            Vos, a un particular:{" "}
            <span className="cifra">{formatMoney(aviso.tuyos.particular, "ARS")}</span>{" "}
            · desvío <Desvio desvio={aviso.salancy.desvio} />
          </p>
        </div>
      ) : null}

      {aviso.tarifa_moneda !== "ARS" && aviso.tarifa_hora ? (
        <p className="text-muted-foreground text-xs">
          Tu tarifa está en {moneda} y las referencias en pesos: los números de
          arriba están convertidos con la última cotización cargada.
        </p>
      ) : null}
    </div>
  );
}
