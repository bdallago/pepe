import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PresupuestoForm } from "@/components/presupuestos/presupuesto-form";
import { todayISO } from "@/lib/dates";
import { getAjustesPresupuesto } from "@/lib/presupuestos-server";
import type { QuoteInput } from "@/lib/schemas";

export const metadata: Metadata = { title: "Nuevo presupuesto" };

/**
 * El alta a mano, sin modelo.
 *
 * Es la etapa 0 del spec y ya sirve sola: la estimación con modelo es un
 * acelerador, y cargar, calcular, exportar, aceptar y descartar tienen que
 * andar sin Groq (regla 7).
 */
export default async function NuevoPresupuestoPage() {
  const ajustes = await getAjustesPresupuesto();

  // Sin tarifa no hay precio posible. Se vuelve a la lista, que ya explica
  // dónde cargarla, en vez de mostrar un formulario que no puede guardar.
  if (!ajustes.tarifa_hora || ajustes.tarifa_hora <= 0) {
    redirect("/presupuestos");
  }

  const inicial: QuoteInput = {
    cliente_nombre: "",
    cliente_tipo: "particular",
    titulo: "",
    resumen_alcance: "",
    pedido_texto: "",
    moneda: ajustes.tarifa_moneda,
    fecha: todayISO(),
    validez_dias: 15,
    mostrar_horas: false,
    condiciones: ajustes.condiciones_default ?? "",
    total_origen: 0,
    total_editado: false,
    items: [],
    supuestos: [],
    preguntas: [],
    modelo: null,
    reemplaza_a: null,
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/presupuestos" className="hover:underline">
            Presupuestos
          </Link>{" "}
          / nuevo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nuevo presupuesto
        </h1>
      </div>

      <PresupuestoForm
        modo="crear"
        base={{
          tarifa_hora: ajustes.tarifa_hora,
          tarifa_moneda: ajustes.tarifa_moneda,
          horas_por_semana: ajustes.horas_por_semana,
          multiplicador: null,
          multiplicadores: ajustes.multiplicadores,
          tasa: null,
        }}
        inicial={inicial}
      />
    </div>
  );
}
