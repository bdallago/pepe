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
import type { PrecargaMovimiento } from "@/lib/agentes/tipos";
import type { MovimientoConReparto } from "@/lib/prorrateo";
import type {
  EstadoMovimiento,
  Moneda,
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
  /**
   * Los proyectos elegidos a mano para repartir un compartido. Vacío es
   * el default y significa "los que estén vivos en la fecha del gasto",
   * que es lo que hizo la app siempre.
   */
  proyectos_explicitos: z.array(z.string()),
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

/**
 * De dónde salió cada campo cuando el formulario llegó precargado. Se apaga
 * campo por campo apenas Beno lo toca.
 */
type Marcas = { [K in keyof PrecargaMovimiento["procedencia"]]: string | null };

interface Props {
  /**
   * Si viene, el formulario edita en vez de crear.
   *
   * Lleva `proyectos_explicitos` porque editar un compartido con
   * subconjunto y no precargarlo lo borraría en silencio: el formulario
   * manda siempre la lista, así que una lista vacía por no haberla leído
   * se guarda como "sacale el subconjunto".
   */
  movimiento?: MovimientoConReparto;
  /**
   * Un movimiento dictado a la caja de agentes, ya leído y clasificado.
   * Precarga los campos y muestra de dónde salió cada uno.
   *
   * Es excluyente con `movimiento`: uno edita algo que ya está guardado y
   * el otro propone algo que todavía no existe.
   */
  precarga?: PrecargaMovimiento;
  /** Proyecto preseleccionado (vista por proyecto). */
  projectIdInicial?: string | null;
  onListo?: () => void;
  /** Enfoca la descripción al montar (carga rápida). */
  autoFocus?: boolean;
  onCancelar?: () => void;
}

export function MovementForm({
  movimiento,
  precarga,
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

  /*
    Las marcas de dónde salió cada campo cuando el movimiento llegó
    dictado. No es adorno: esto es un libro de cuentas, y si el modelo leyó
    "15 mil" donde eran 15 y el formulario se ve igual que siempre, se
    guarda sin mirar. Al tocar un campo, su marca se apaga — a partir de
    ahí el valor es de Beno y decir de dónde vino sería mentir.
  */
  const [marcas, setMarcas] = useState<Marcas | null>(
    () => precarga?.procedencia ?? null,
  );

  const apagarMarca = useCallback((campo: keyof Marcas) => {
    setMarcas((previas) =>
      previas && previas[campo] ? { ...previas, [campo]: null } : previas,
    );
  }, []);

  /**
   * La descripción que vino precargada. Ya se clasificó del lado del
   * servidor con el mismo `sugerirClasificacion`, así que el efecto de
   * abajo no vuelve a pedirla: sería la misma respuesta y una llamada de
   * más mientras Beno mira el formulario.
   */
  const descripcionPrecargada = useRef(precarga?.descripcion ?? null);

  const proyectoInicial = movimiento
    ? movimiento.project_id
    : precarga
      ? // `null` es compartido y es una decisión, no un "sin dato": si el
        // dictado no nombró ningún proyecto, va compartido y no al último
        // usado.
        precarga.projectId
      : projectIdInicial !== undefined
        ? projectIdInicial
        : ultimoProyecto;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      // La fecha va en los valores iniciales y no en un `setValue` de
      // después por una razón concreta: de ella sale la tasa con la que se
      // convierte el monto. Si el formulario naciera en hoy y la fecha se
      // corrigiera en un efecto, el par ARS/USD se armaría con la
      // cotización de hoy para un gasto de la semana pasada (regla 1).
      fecha: movimiento?.fecha ?? precarga?.fecha ?? todayISO(),
      descripcion: movimiento?.descripcion ?? precarga?.descripcion ?? "",
      tipo: movimiento?.tipo ?? precarga?.tipo ?? "egreso",
      estado: movimiento?.estado ?? "efectuado",
      project_id: proyectoInicial ?? "compartido",
      proyectos_explicitos: [...(movimiento?.proyectos_explicitos ?? [])],
      category_id: movimiento?.category_id ?? precarga?.categoryId ?? "",
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

    // Lo que llegó dictado ya pasó por el histórico y, si hizo falta, por
    // el modelo. Su marca de procedencia está en `marcas.categoria`.
    if (texto === descripcionPrecargada.current) return;

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

  /*
    El monto dictado entra **por `escribirMonto`**, igual que si lo tipeara.
    Setear `monto_ars` / `monto_usd` a mano dejaría el par inconsistente: el
    efecto de arriba excluye a propósito esos dos campos de sus
    dependencias (regla 3), así que nadie calcularía el derivado y el
    formulario mostraría un importe en una moneda y nada en la otra.

    Corre una sola vez, al montar. Puede hacerlo desde un efecto sin
    arriesgar la tasa porque la fecha llegó en los valores iniciales: ya en
    el primer render `tasaEfectiva` es la de la fecha del movimiento, no la
    de hoy.
  */
  useEffect(() => {
    if (!precarga) return;
    escribirMonto(precarga.moneda, String(precarga.monto));
    // Sin dependencias a propósito: es una precarga, no una sincronización.
    // Volver a correrlo pisaría lo que Beno esté escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const esCompartido = values.project_id === "compartido";

    const payload = {
      fecha: values.fecha,
      descripcion: values.descripcion.trim(),
      tipo: values.tipo as TipoMovimiento,
      project_id: esCompartido ? null : values.project_id,
      // Solo viaja si el gasto es compartido: con proyecto imputado la
      // lista no se usa y el schema del servidor la rechaza. Y `null`
      // cuando está vacía, que es lo que borra el subconjunto anterior
      // al editar — vaciar la lista tiene que poder deshacerse.
      proyectos_explicitos:
        esCompartido && values.proyectos_explicitos.length > 0
          ? values.proyectos_explicitos
          : null,
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

  // El subconjunto explícito ofrece **todos** los proyectos, también los
  // cerrados, y no solo los activos como el selector de arriba: el punto
  // de nombrarlos a mano es poder incluir a uno que la ventana de fecha
  // dejaría afuera. Filtrarlos acá volvería la lista redundante con el
  // default.
  const explicitos = watch("proyectos_explicitos");
  const descripcionRegister = register("descripcion");
  const fechaRegister = register("fecha");

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={alPresionarTecla}
      className="space-y-4"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="descripcion">Descripción</Label>
          <Marca texto={marcas?.descripcion} />
        </div>
        <Input
          id="descripcion"
          {...descripcionRegister}
          onChange={(e) => {
            apagarMarca("descripcion");
            return descripcionRegister.onChange(e);
          }}
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
          <div className="flex items-center gap-1.5">
            <Label htmlFor="tipo">Tipo</Label>
            <Marca texto={marcas?.tipo} />
          </div>
          <Select
            value={tipo}
            onValueChange={(v) => {
              elegirAMano();
              apagarMarca("tipo");
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
          <div className="flex items-center gap-1.5">
            <Label htmlFor="fecha">Fecha</Label>
            <Marca texto={marcas?.fecha} />
          </div>
          <Input
            id="fecha"
            type="date"
            {...fechaRegister}
            onChange={(e) => {
              apagarMarca("fecha");
              return fechaRegister.onChange(e);
            }}
          />
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
            {monedaOrigen === "ARS" ? <Marca texto={marcas?.monto} /> : null}
          </Label>
          <Input
            id="monto-ars"
            inputMode="decimal"
            value={montoArs}
            onChange={(e) => {
              apagarMarca("monto");
              escribirMonto("ARS", e.target.value);
            }}
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
            {monedaOrigen === "USD" ? <Marca texto={marcas?.monto} /> : null}
          </Label>
          <Input
            id="monto-usd"
            inputMode="decimal"
            value={montoUsd}
            onChange={(e) => {
              apagarMarca("monto");
              escribirMonto("USD", e.target.value);
            }}
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
          <div className="flex items-center gap-1.5">
            <Label htmlFor="proyecto">Proyecto</Label>
            <Marca texto={marcas?.proyecto} />
          </div>
          <Select
            value={watch("project_id")}
            onValueChange={(v) => {
              apagarMarca("proyecto");
              setValue("project_id", v);
            }}
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
            ) : (
              // La misma información para el camino dictado: ahí la
              // clasificación ya la resolvió el servidor y su procedencia
              // llega redactada en `marcas`.
              <Marca texto={marcas?.categoria} />
            )}
          </div>
          <Select
            value={categoryId}
            onValueChange={(v) => {
              elegirAMano();
              apagarMarca("categoria");
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

      {/*
        ── Compartido entre proyectos elegidos a mano ──────────────────

        Solo aparece con "Compartido" elegido: con un proyecto imputado
        el gasto no pasa por el reparto y la lista no se usaría.

        Arranca **vacío y significando "todos los vivos"**, que es lo que
        la app hizo siempre. Es la diferencia entre agregar una opción y
        cambiarle el default a todo lo que ya está cargado.
      */}
      {watch("project_id") === "compartido" ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label>Compartido entre</Label>
            {explicitos.length > 0 ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline"
                onClick={() => setValue("proyectos_explicitos", [])}
              >
                volver al reparto automático
              </button>
            ) : null}
          </div>

          <p className="text-muted-foreground text-xs">
            {explicitos.length === 0
              ? "Se reparte entre los proyectos que estén abiertos en la fecha del gasto. Tildá algunos solo si este gasto es de unos y no de otros."
              : `Se reparte solo entre estos ${explicitos.length}, aunque haya otros abiertos ese día.`}
          </p>

          <div className="flex flex-wrap gap-2">
            {projects.map((p) => {
              const tildado = explicitos.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={tildado}
                  onClick={() =>
                    setValue(
                      "proyectos_explicitos",
                      tildado
                        ? explicitos.filter((id) => id !== p.id)
                        : [...explicitos, p.id],
                    )
                  }
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    tildado
                      ? "border-[var(--teal)] bg-[var(--teal)]/10 font-medium"
                      : "text-muted-foreground hover:bg-secondary/40",
                  )}
                >
                  {p.nombre}
                </button>
              );
            })}
          </div>

          {/*
            Un solo proyecto tildado es "es de ese proyecto", y eso ya se
            escribe con el selector de arriba. Se avisa acá y no recién al
            guardar: el servidor lo rechaza igual, pero enterarse después
            de apretar Guardar es peor.
          */}
          {explicitos.length === 1 ? (
            <p className="text-destructive text-xs">
              Con uno solo no es un compartido. Elegí otro, o imputáselo
              directo a ese proyecto arriba.
            </p>
          ) : null}
        </div>
      ) : null}

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

/**
 * De dónde salió un campo precargado.
 *
 * Discreta a propósito: tiene que poder leerse de un vistazo antes de
 * apretar Enter, sin competir con el valor. Cuando el campo se toca,
 * `apagarMarca` la borra y esto no dibuja nada.
 */
function Marca({ texto }: { texto?: string | null }) {
  if (!texto) return null;

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
      <span aria-hidden="true">●</span>
      {texto}
    </span>
  );
}
