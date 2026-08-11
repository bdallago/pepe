"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { resolverTasa, type TasaAplicable } from "@/lib/fx";
import { estaVivo } from "@/lib/prorrateo";
import type {
  Category,
  FxRate,
  Moneda,
  Project,
} from "@/lib/supabase/database.types";

/**
 * Estado compartido de la app.
 *
 * Es Context, no una librería de estado global: lo único que vive acá son
 * datos de referencia que ya vienen del servidor (proyectos, categorías,
 * serie de cotizaciones) más dos preferencias de UI.
 */

/*
  Las claves siguen diciendo "app-gastos", el nombre viejo del proyecto.
  **No las renombres.** Están escritas en el localStorage del browser de
  Beno: cambiarlas no migra nada, simplemente hace que la app deje de
  encontrar lo guardado y le resetee la moneda y el último proyecto. Es
  la única mención del nombre viejo que sobrevive a propósito.
*/
const STORAGE_MONEDA = "app-gastos:moneda";
const STORAGE_ULTIMO_PROYECTO = "app-gastos:ultimo-proyecto";

interface AppData {
  projects: Project[];
  categories: Category[];
  /** Serie histórica de cotizaciones, ascendente por fecha. */
  rates: Pick<FxRate, "fecha" | "venta">[];

  /** Conmutador global ARS/USD que afecta a todos los números y gráficos. */
  moneda: Moneda;
  setMoneda: (moneda: Moneda) => void;

  /** Último proyecto usado en la carga rápida. */
  ultimoProyecto: string | null;
  recordarProyecto: (projectId: string | null) => void;

  /** Cotización aplicable a una fecha, resuelta contra la serie local. */
  tasaPara: (fecha: string) => TasaAplicable | null;

  proyectosActivos: Project[];
  categoriasVigentes: Category[];
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({
  projects,
  categories,
  rates,
  children,
}: {
  projects: Project[];
  categories: Category[];
  rates: Pick<FxRate, "fecha" | "venta">[];
  children: React.ReactNode;
}) {
  // Arranca en ARS y se corrige tras el montaje: leer localStorage durante
  // el render rompería la hidratación.
  const [moneda, setMonedaState] = useState<Moneda>("ARS");
  const [ultimoProyecto, setUltimoProyecto] = useState<string | null>(null);

  useEffect(() => {
    const guardada = window.localStorage.getItem(STORAGE_MONEDA);
    if (guardada === "ARS" || guardada === "USD") setMonedaState(guardada);

    const proyecto = window.localStorage.getItem(STORAGE_ULTIMO_PROYECTO);
    setUltimoProyecto(proyecto === "compartido" ? null : proyecto);
  }, []);

  const setMoneda = useCallback((nueva: Moneda) => {
    setMonedaState(nueva);
    window.localStorage.setItem(STORAGE_MONEDA, nueva);
  }, []);

  const recordarProyecto = useCallback((projectId: string | null) => {
    setUltimoProyecto(projectId);
    window.localStorage.setItem(
      STORAGE_ULTIMO_PROYECTO,
      projectId ?? "compartido",
    );
  }, []);

  const tasaPara = useCallback(
    (fecha: string) => resolverTasa(rates, fecha),
    [rates],
  );

  const value = useMemo<AppData>(
    () => ({
      projects,
      categories,
      rates,
      moneda,
      setMoneda,
      ultimoProyecto,
      recordarProyecto,
      tasaPara,
      proyectosActivos: projects.filter((p) => estaVivo(p)),
      categoriasVigentes: categories.filter((c) => !c.archivada),
    }),
    [
      projects,
      categories,
      rates,
      moneda,
      setMoneda,
      ultimoProyecto,
      recordarProyecto,
      tasaPara,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData tiene que usarse dentro de <AppDataProvider>.");
  }
  return context;
}
