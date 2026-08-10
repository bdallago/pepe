import type { Moneda } from "@/lib/supabase/database.types";
import type { TipoCliente } from "@/lib/presupuestos";

/**
 * La forma del documento que se imprime.
 *
 * **No depende de la tabla `quotes`**, que la crea otra etapa: el
 * documento recibe todo por props y se puede ver hoy con
 * `PRESUPUESTO_DE_EJEMPLO`. El día que la tabla exista, quien la lea
 * arma este objeto y el documento no se entera.
 *
 * Todos los números vienen ya calculados y **congelados**. El documento
 * no calcula nada: si recalculara el total contra la cotización de hoy,
 * un presupuesto de marzo diría en agosto un precio que nunca se mandó.
 */

export interface ItemImprimible {
  titulo: string;
  detalle?: string | null;
  /** Solo se muestra si `mostrar_horas` está en true. */
  horas: number;
}

export interface PresupuestoImprimible {
  /** El correlativo que dice el documento: "Presupuesto Nº 7". */
  numero: number;
  /** "YYYY-MM-DD". Nunca un Date: se formatea con `lib/dates`. */
  fecha: string;
  validez_dias: number;

  titulo: string;
  resumen_alcance?: string | null;

  cliente_nombre: string;
  cliente_tipo: TipoCliente;

  emisor_nombre?: string | null;
  emisor_contacto?: string | null;

  items: ItemImprimible[];
  supuestos?: string[];
  preguntas?: string[];
  condiciones?: string | null;

  moneda: Moneda;
  /** Congelado. Es el precio del documento, no se recalcula al leerlo. */
  total_origen: number;

  horas_estimadas: number;
  semanas_estimadas: number;

  /**
   * Si las horas van al papel. **Default false**, y no es pudor: mostrar
   * las horas convierte la charla con el cliente en una discusión de
   * tarifa horaria, que es justo el mecanismo por el que Beno termina
   * cobrándole a todos el precio del cliente más chico. El switch existe
   * por si en algún cliente conviene.
   */
  mostrar_horas?: boolean;
}
