"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { History, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ComprobanteInput } from "@/components/movimientos/comprobante-input";
import { useAppData } from "@/components/providers/app-data-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, todayISO } from "@/lib/dates";
import { convertir, round2, round4 } from "@/lib/fx";
import { formatRate, parseAmount } from "@/lib/format";
import { actualizarMovimiento, crearMovimiento } from "@/lib/actions/movements";
import type {
  EstadoMovimiento,
  Moneda,
  Movement,
  TipoMovimiento,
} from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Formulario de movimiento.
 *
 * Los dos campos de monto (ARS y USD) están visibles a la vez. Se escribe
 * en cualquiera y el otro se completa solo con la tasa de la fecha
 * elegida. El campo que se tocó queda como `moneda_origen`: ese es el
 * importe real, el otro es derivado. Cambiar la fecha recalcula el derivado.
 */

/** Schema de la UI: todo string, como lo que realmente hay en los inputs. */
const formSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  descripcion: z
    .string()
    .trim()
    .min(1, "Poné una descripción.")
    .max(200, "Máximo 200 caracteres."),
  tipo: z.enum(["ingreso", "egreso"]),
  estado: z.enum(["efectuado", "planificado"]),
  /** "compartido" o el uuid del proyecto. */
  project_id: z.string().min(1),
  category_id: z.string().min(1, "Elegí una categoría."),
  monto_ars: z.string(),
  monto_usd: z.string(),
  moneda_origen: z.enum(["ARS", "USD"]),
  tasa_manual: z.boolean(),
  tasa_texto: z.string(),
  comprobante_path: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

/**
 * Lo que devuelve `/api/movimientos/sugerir`. Se declara acá y no se
 * importa de `lib/clasificacion.ts` porque ese módulo es `server-only`.
 */
interface Sugerencia {
  tipo: TipoMovimiento;
  categoryId: string;
  categoriaNombre: string;
  origen: "historico" | "modelo";
  veces?: number;
  exacto?: boolean;
}

/**
 * Cuánto se espera después de la última tecla antes de pedir sugerencia.
 *
 * Suficiente para que escribir "Suscripción a Vercel" sea un pedido y no
 * veinte, y poco como para que la sugerencia llegue mientras todavía se
 * está mirando el formulario.
 */
const ESPERA_SUGERENCIA_MS = 600;

interface Props {
  /** Si viene, el formulario edita en vez de crear. */
  movimiento?: Movement;
  /** Proyecto preseleccionado (vista por proyecto). */
  projectIdInicial?: string | null;
  onListo?: () => void;
  /** Enfoca la descripción al montar (carga rápida). */
  autoFocus?: boolean;
  onCancelar?: () => void;
}

export function MovementForm({
  movimiento,
  projectIdInicial,
  onListo,
  autoFocus,
  onCancelar,
}: Props) {
  const router = useRouter();
  const {
    proyectosActivos,
    projects,
    categoriasVigentes,
    tasaPara,
    ultimoProyecto,
    recordarProyecto,
  } = useAppData();

  const editando = Boolean(movimiento);
  const descripcionRef = useRef<HTMLInputElement>(null);

  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  // Una vez que Beno elige tipo o categoría a mano, se deja de sugerir en
  // este formulario. La sugerencia sirve para ahorrarle el paso, no para
  // discutirle: pisarle lo que acaba de elegir sería peor que no sugerir.
  const decidioAMano = useRef(false);

  const proyectoInicial =
    movimiento?.project_id ??
    (projectIdInicial !== undefined ? projectIdInicial : ultimoProyecto);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fecha: movimiento?.fecha ?? todayISO(),
      descripcion: movimiento?.descripcion ?? "",
      tipo: movimiento?.tipo ?? "egreso",
      estado: movimiento?.estado ?? "efectuado",
      project_id: proyectoInicial ?? "compartido",
      category_id: movimiento?.category_id ?? "",
      monto_ars: movimiento ? String(movimiento.monto_ars) : "",
      monto_usd: movimiento ? String(movimiento.monto_usd) : "",
      moneda_origen: movimiento?.moneda_origen ?? "ARS",
      tasa_manual: false,
      tasa_texto: movimiento ? String(movimiento.tasa_usada) : "",
      comprobante_path: movimiento?.comprobante_path ?? null,
    },
  });

  const { register, watch, setValue, handleSubmit, formState } = form;

  const fecha = watch("fecha");
  const tipo = watch("tipo");
  const monedaOrigen = watch("moneda_origen");
  const montoArs = watch("monto_ars");
  const montoUsd = watch("monto_usd");
  const tasaManual = watch("tasa_manual");
  const tasaTexto = watch("tasa_texto");
  const categoryId = watch("category_id");
  const comprobantePath = watch("comprobante_path");

  const descripcion = watch("descripcion");

  const tasaDeFecha = useMemo(() => tasaPara(fecha), [tasaPara, fecha]);

  /**
   * Sugerencia de tipo y categoría a partir de la descripción (spec 6.1).
   *
   * Se dispara sola mientras se escribe, con espera: el endpoint resuelve
   * primero contra el histórico (instantáneo, sin modelo) y solo llama a
   * Groq si no encontró nada.
   *
   * Tres cosas que no se negocian:
   *  - **Solo al crear.** Editar un movimiento viejo y que le cambie la
   *    categoría sola sería una sorpresa desagradable.
   *  - **Nunca pisa una decisión manual** (`decidioAMano`).
   *  - **Si falla, no pasa nada.** El endpoint contesta `null` en vez de
   *    error justamente para eso: sin Groq, el formulario anda igual.
   */
  useEffect(() => {
    if (editando || decidioAMano.current) return;

    const texto = descripcion.trim();
    if (texto.length < 3) {
      setSugerencia(null);
      return;
    }

    const controlador = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const respuesta = await fetch("/api/movimientos/sugerir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ descripcion: texto }),
          signal: controlador.signal,
        });
        const resultado = await respuesta.json();
        if (!resultado.ok || !resultado.data) return;

        // Entre que salió el pedido y volvió, Beno pudo elegir a mano.
        if (decidioAMano.current) return;

        const propuesta = resultado.data as Sugerencia;
        setSugerencia(propuesta);
        setValue("tipo", propuesta.tipo);
        setValue("category_id", propuesta.categoryId);
      } catch {
        // Abortado o sin red. No se avisa: es una comodidad, no un paso.
      }
    }, ESPERA_SUGERENCIA_MS);

    return () => {
      clearTimeout(temporizador);
      controlador.abort();
    };
  }, [descripcion, editando, setValue]);

  /** Deja de sugerir y limpia la marca: a partir de acá manda el usuario. */
  const elegirAMano = useCallback(() => {
    decidioAMano.current = true;
    setSugerencia(null);
  }, []);

  const tasaEfectiva = useMemo(() => {
    if (tasaManual) {
      const parsed = parseAmount(tasaTexto);
      if (parsed && parsed > 0) {
        return { valor: parsed, fecha, esAproximada: false, manual: true };
      }
    }
    if (tasaDeFecha) return { ...tasaDeFecha, manual: false };
    return null;
  }, [tasaManual, tasaTexto, tasaDeFecha, fecha]);

  useEffect(() => {
    if (autoFocus) descripcionRef.current?.focus();
  }, [autoFocus]);

  // Sin cotización manual, el input de tasa refleja la de la fecha.
  useEffect(() => {
    if (!tasaManual && tasaDeFecha) {
      setValue("tasa_texto", String(round4(tasaDeFecha.valor)));
    }
  }, [tasaManual, tasaDeFecha, setValue]);

  const categoriasDelTipo = useMemo(
    () => categoriasVigentes.filter((c) => c.tipo === tipo),
    [categoriasVigentes, tipo],
  );

  // Al cambiar de tipo, la categoría elegida puede dejar de aplicar.
  useEffect(() => {
    const sigueValiendo = categoriasDelTipo.some((c) => c.id === categoryId);
    if (!sigueValiendo) {
      setValue("category_id", categoriasDelTipo[0]?.id ?? "");
    }
  }, [categoriasDelTipo, categoryId, setValue]);

  /** Recalcula el campo derivado a partir del que escribió el usuario. */
  const sincronizar = useCallback(
    (origen: Moneda, texto: string, tasa: number | undefined) => {
      const monto = parseAmount(texto);
      const destino = origen === "ARS" ? "monto_usd" : "monto_ars";

      if (monto === null || !tasa || tasa <= 0) {
        setValue(destino, "");
        return;
      }

      const convertido =
        origen === "ARS"
          ? convertir(monto, "ARS", "USD", tasa)
          : convertir(monto, "USD", "ARS", tasa);

      setValue(destino, String(convertido));
    },
    [setValue],
  );

  // Cambiar la fecha (y con ella la tasa) recalcula el derivado. El importe
  // real, el que escribió el usuario, nunca se toca.
  const valorTasa = tasaEfectiva?.valor;
  useEffect(() => {
    const texto = monedaOrigen === "ARS" ? montoArs : montoUsd;
    if (texto === "") return;
    sincronizar(monedaOrigen, texto, valorTasa);
    // montoArs/montoUsd quedan fuera a propósito: incluirlos dispararía el
    // efecto con cada tecla y pisaría lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorTasa, monedaOrigen, sincronizar]);

  function escribirMonto(origen: Moneda, valor: string) {
    setValue("moneda_origen", origen);
    setValue(origen === "ARS" ? "monto_ars" : "monto_usd", valor);
    sincronizar(origen, valor, tasaEfectiva?.valor);
  }

  async function onSubmit(values: FormValues) {
    const montoOrigen = parseAmount(
      values.moneda_origen === "ARS" ? values.monto_ars : values.monto_usd,
    );

    if (montoOrigen === null) {
      toast.error("Poné un monto.");
      return;
    }

    if (!tasaEfectiva) {
      toast.error(
        "No hay ninguna cotización cargada. Actualizala desde Ajustes.",
      );
      return;
    }

    const payload = {
      fecha: values.fecha,
      descripcion: values.descripcion.trim(),
      tipo: values.tipo as TipoMovimiento,
      project_id:
        values.project_id === "compartido" ? null : values.project_id,
      category_id: values.category_id,
      monto_origen: round2(montoOrigen),
      moneda_origen: values.moneda_origen as Moneda,
      tasa_usada: round4(tasaEfectiva.valor),
      tasa_fecha: tasaEfectiva.fecha,
      estado: values.estado as EstadoMovimiento,
      comprobante_path: values.comprobante_path,
    };

    const resultado = movimiento
      ? await actualizarMovimiento(movimiento.id, payload)
      : await crearMovimiento(payload);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    recordarProyecto(payload.project_id);
    toast.success(editando ? "Movimiento actualizado." : "Movimiento cargado.");
    router.refresh();
    onListo?.();
  }

  /** Enter guarda desde cualquier input que no sea un textarea. */
  function alPresionarTecla(event: React.KeyboardEvent<HTMLFormElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (event.target as HTMLElement).tagName !== "TEXTAREA"
    ) {
      event.preventDefault();
      void handleSubmit(onSubmit)();
    }
  }

  const proyectosDisponibles = editando ? projects : proyectosActivos;
  const descripcionRegister = register("descripcion");

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={alPresionarTecla}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="descripcion">Descripción</Label>
        <Input
          id="descripcion"
          {...descripcionRegister}
          ref={(el) => {
            descripcionRegister.ref(el);
            descripcionRef.current = el;
          }}
          placeholder="Ej: Suscripción a Vercel"
          autoComplete="off"
          aria-invalid={Boolean(formState.errors.descripcion)}
        />
        {formState.errors.descripcion ? (
          <p className="text-destructive text-xs">
            {formState.errors.descripcion.message}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="tipo">Tipo</Label>
          <Select
            value={tipo}
            onValueChange={(v) => {
              elegirAMano();
              setValue("tipo", v as TipoMovimiento);
            }}
          >
            <SelectTrigger id="tipo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="egreso">Egreso</SelectItem>
              <SelectItem value="ingreso">Ingreso</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="fecha">Fecha</Label>
          <Input id="fecha" type="date" {...register("fecha")} />
        </div>
      </div>

      {/* Doble campo de monto: el que se escribe manda. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="monto-ars" className="flex items-center gap-1.5">
            Pesos
            {monedaOrigen === "ARS" && montoArs !== "" ? (
              <span className="bg-secondary text-muted-foreground rounded px-1 py-0.5 text-[10px] font-medium">
                importe real
              </span>
            ) : null}
          </Label>
          <Input
            id="monto-ars"
            inputMode="decimal"
            value={montoArs}
            onChange={(e) => escribirMonto("ARS", e.target.value)}
            placeholder="0"
            className={cn(
              "cifra",
              monedaOrigen === "USD" && "text-muted-foreground",
            )}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="monto-usd" className="flex items-center gap-1.5">
            Dólares
            {monedaOrigen === "USD" && montoUsd !== "" ? (
              <span className="bg-secondary text-muted-foreground rounded px-1 py-0.5 text-[10px] font-medium">
                importe real
              </span>
            ) : null}
          </Label>
          <Input
            id="monto-usd"
            inputMode="decimal"
            value={montoUsd}
            onChange={(e) => escribirMonto("USD", e.target.value)}
            placeholder="0,00"
            className={cn(
              "cifra",
              monedaOrigen === "ARS" && "text-muted-foreground",
            )}
          />
        </div>
      </div>

      {/* Indicador de la tasa aplicada. */}
      <div className="text-xs">
        {!tasaEfectiva ? (
          <p className="text-destructive flex items-center gap-1.5">
            <TriangleAlert className="size-3.5" />
            No hay cotizaciones cargadas. Actualizá desde Ajustes.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-muted-foreground",
                tasaEfectiva.esAproximada &&
                  "text-amber-600 dark:text-amber-500",
              )}
            >
              {tasaEfectiva.manual
                ? `Tasa manual: ${formatRate(tasaEfectiva.valor)}`
                : `Tasa del ${formatDate(tasaEfectiva.fecha)}: ${formatRate(tasaEfectiva.valor)}`}
              {tasaEfectiva.esAproximada && !tasaEfectiva.manual
                ? " (última disponible)"
                : ""}
            </span>
            <button
              type="button"
              onClick={() => setValue("tasa_manual", !tasaManual)}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {tasaManual ? "usar la del día" : "forzar otra"}
            </button>
          </div>
        )}
      </div>

      {tasaManual ? (
        <div className="space-y-2">
          <Label htmlFor="tasa">Cotización a usar</Label>
          <Input
            id="tasa"
            inputMode="decimal"
            {...register("tasa_texto")}
            className="cifra"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="proyecto">Proyecto</Label>
          <Select
            value={watch("project_id")}
            onValueChange={(v) => setValue("project_id", v)}
          >
            <SelectTrigger id="proyecto" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compartido">Compartido</SelectItem>
              {proyectosDisponibles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="categoria">Categoría</Label>
            {/*
              De dónde salió la sugerencia, dicho sin vueltas. Que venga
              del histórico o de un modelo cambia cuánto conviene
              confiarle: lo primero es una decisión propia repetida, lo
              segundo es una opinión ajena.
            */}
            {sugerencia ? (
              <span
                className="text-muted-foreground inline-flex items-center gap-1 text-[10px]"
                title={
                  sugerencia.origen === "historico"
                    ? sugerencia.exacto
                      ? "Ya cargaste esta misma descripción con esta categoría."
                      : "Coincide con cargas anteriores salvo por el mes."
                    : "Propuesta por el modelo. Revisala."
                }
              >
                {sugerencia.origen === "historico" ? (
                  <>
                    <History className="size-3" aria-hidden="true" />
                    {!sugerencia.exacto
                      ? "como los meses anteriores"
                      : sugerencia.veces === 1
                        ? "como la vez anterior"
                        : `como las ${sugerencia.veces} veces anteriores`}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3" aria-hidden="true" />
                    sugerida
                  </>
                )}
              </span>
            ) : null}
          </div>
          <Select
            value={categoryId}
            onValueChange={(v) => {
              elegirAMano();
              setValue("category_id", v);
            }}
          >
            <SelectTrigger id="categoria" className="w-full">
              <SelectValue placeholder="Elegí una" />
            </SelectTrigger>
            <SelectContent>
              {categoriasDelTipo.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formState.errors.category_id ? (
            <p className="text-destructive text-xs">
              {formState.errors.category_id.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="estado">Estado</Label>
        <Select
          value={watch("estado")}
          onValueChange={(v) => setValue("estado", v as EstadoMovimiento)}
        >
          <SelectTrigger id="estado" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="efectuado">Efectuado</SelectItem>
            <SelectItem value="planificado">Planificado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ComprobanteInput
        value={comprobantePath}
        onChange={(path) => setValue("comprobante_path", path)}
      />

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={formState.isSubmitting || !categoryId}
          className="flex-1"
        >
          {formState.isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {editando ? "Guardar cambios" : "Cargar movimiento"}
        </Button>
        {onCancelar ? (
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
