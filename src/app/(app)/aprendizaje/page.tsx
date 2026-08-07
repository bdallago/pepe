import type { Metadata } from "next";

import { HoyView } from "@/components/aprendizaje/hoy-view";
import { todayISO } from "@/lib/dates";
import {
  getBitacora,
  getBlocks,
  getSessions,
  getTracks,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Hoy" };

/** Cuántas entradas de bitácora se muestran como atajo en Hoy. */
const ENTRADAS_RECIENTES = 5;

export default async function AprendizajeHoyPage() {
  const [tracks, blocks, sessions, bitacora] = await Promise.all([
    getTracks(),
    getBlocks(),
    getSessions(),
    getBitacora(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hoy</h1>
        <p className="text-muted-foreground text-sm">
          Lo que toca estudiar hoy. Teoría y aplicación se marcan por
          separado.
        </p>
      </div>

      {/*
        La fecha se resuelve en el servidor y baja como prop: si cada mitad
        llamara a `todayISO()` por su cuenta, un render a las 23:59:59
        podría hidratar con dos días distintos.
      */}
      <HoyView
        fecha={todayISO()}
        tracks={tracks}
        blocks={blocks}
        sessions={sessions}
        bitacora={bitacora.slice(0, ENTRADAS_RECIENTES)}
      />
    </div>
  );
}
