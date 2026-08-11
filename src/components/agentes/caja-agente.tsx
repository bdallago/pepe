"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Quote,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { MovementDialog } from "@/components/movimientos/movement-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type {
  AdjuntoSubido,
  Destino,
  RespuestaAgente,
  RespuestaSimple,
} from "@/lib/agentes/tipos";

/**
 * Lo que acepta el bucket `adjuntos`, y nada más.
 *
 * `image/heic` queda afuera aunque `comprobantes` lo acepte: acá la
 * imagen va a un modelo y no se midió que Groq decodifique HEIC. Fallar
 * en la puerta con un mensaje claro es mejor que fallar tres minutos
 * después adentro del pase.
 */
const TIPOS_ADJUNTO = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const MAX_BYTES_ADJUNTO = 10 * 1024 * 1024;

/** El mismo tope que valida el handler (`MAX_ADJUNTOS`). */
const MAX_ARCHIVOS = 6;

/**
 * La caja donde Beno escribe en castellano.
 *
 * Un componente, dos superficies: la pantalla de inicio y el atajo global.
 * El estado vive acá y no en un store: es una interacción de ida y vuelta,
 * no hay nada que compartir entre pantallas.
 */
export function CajaAgente({
  onCerrar,
  autoFocus = false,
}: {
  onCerrar?: () => void;
  /**
   * Solo lo pide el diálogo. En la pantalla de inicio la caja es el primer
   * bloque de una página que se lee, no un campo al que se entra: robarle
   * el foco en cada carga —y abrir el teclado en mobile— sería de más.
   */
  autoFocus?: boolean;
}) {
  const [frase, setFrase] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState<RespuestaAgente | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState(false);

  /**
   * Suma archivos a la cola, filtrando lo que el bucket va a rechazar.
   *
   * **Varios por mensaje, a propósito.** Beno escribió "te paso capturas"
   * en plural, y una sola captura no cubre el caso: son las tres o cuatro
   * de una conversación. Con el techo de qwen entran tres por minuto, así
   * que cuatro capturas son minuto y medio — y el pase es retomable, así
   * que si la tercera falla las dos primeras ya están en la bandeja.
   */
  const sumarArchivos = useCallback((nuevos: File[]) => {
    const buenos: File[] = [];

    for (const archivo of nuevos) {
      if (!TIPOS_ADJUNTO.includes(archivo.type)) {
        toast.error(`${archivo.name}: solo acepto JPG, PNG, WebP o PDF.`);
        continue;
      }
      if (archivo.size > MAX_BYTES_ADJUNTO) {
        toast.error(`${archivo.name}: supera los 10 MB.`);
        continue;
      }
      buenos.push(archivo);
    }

    if (buenos.length === 0) return;

    setArchivos((previos) => {
      const juntos = [...previos, ...buenos];
      if (juntos.length > MAX_ARCHIVOS) {
        toast.warning(`Me quedo con los primeros ${MAX_ARCHIVOS}.`);
      }
      return juntos.slice(0, MAX_ARCHIVOS);
    });
  }, []);

  /**
   * Sube los archivos **del browser directo a Supabase**, sin pasar por
   * Next.
   *
   * Es el mismo camino que `comprobante-input.tsx`, y no es un detalle de
   * implementación: como el archivo nunca atraviesa un route handler ni
   * una Server Action, ninguna discusión sobre el tamaño máximo de un
   * request aplica.
   */
  async function subirArchivos(): Promise<AdjuntoSubido[] | null> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Se cerró tu sesión.");
      return null;
    }

    const subidos: AdjuntoSubido[] = [];

    for (const archivo of archivos) {
      const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage
        .from("adjuntos")
        .upload(path, archivo, { contentType: archivo.type, upsert: false });

      if (error) {
        toast.error(`No pude subir ${archivo.name}: ${error.message}`);
        continue;
      }

      subidos.push({
        path,
        nombre: archivo.name,
        mime: archivo.type,
        bytes: archivo.size,
      });
    }

    return subidos;
  }

  async function enviar(
    destino?: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) {
    const texto = frase.trim();
    // Con archivos la frase puede ir vacía: arrastrar un PDF y nada más
    // es un pedido legítimo, y el handler lo acepta.
    if ((!texto && archivos.length === 0) || cargando || subiendo) return;

    /*
      Sin argumento propio, el argumento es la frase. "¿No era esto?"
      significa *la misma pregunta, otro especialista*: mandando `null`
      el buscador contesta "¿qué querés buscar?" con la consulta escrita
      ahí arriba, y la corrección no corrige nada. Las opciones de una
      pregunta sí traen el suyo —a veces `null` a propósito— y por eso
      solo se completa lo que llega sin definir.

      El recorte a 300 es el máximo que acepta el handler: la frase llega
      hasta 1000, así que sin esto una consulta larga corregida a mano
      volvería 400.
    */
    const dato = argumento === undefined ? texto.slice(0, 300) : argumento;

    setRespuesta(null);

    // La subida va primero y aparte del "Pensando…": es la parte que
    // depende de la conexión de Beno y no del modelo, y si falla el
    // archivo no llegó a ningún lado.
    let adjuntos: AdjuntoSubido[] | undefined;

    if (archivos.length > 0 && !destino) {
      setSubiendo(true);
      try {
        const subidos = await subirArchivos();
        if (!subidos || subidos.length === 0) {
          setRespuesta({
            clase: "aviso",
            titulo: "No pude subir los archivos",
            cuerpo: "Probá de nuevo. No se registró nada.",
          });
          return;
        }
        adjuntos = subidos;
      } finally {
        setSubiendo(false);
      }
    }

    setCargando(true);

    try {
      const r = await fetch("/api/agentes/interpretar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          frase: texto,
          destino,
          argumento: dato,
          ...(confirmado ? { confirmado } : {}),
          ...(adjuntos ? { adjuntos } : {}),
        }),
      });

      // El handler contesta un `RespuestaAgente` incluso cuando el modelo
      // falla; los códigos de error traen `{ error }` y no la unión, así
      // que se traducen acá en vez de renderizar nada.
      if (!r.ok) {
        const detalle = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        setRespuesta({
          clase: "aviso",
          titulo:
            r.status === 401 ? "Se cerró tu sesión" : "No pude procesar eso",
          cuerpo: detalle?.error ?? "Probá de nuevo, o usá el menú de arriba.",
        });
        return;
      }

      setRespuesta((await r.json()) as RespuestaAgente);
      // Los archivos ya están del otro lado: la cola de la caja se vacía.
      if (adjuntos) setArchivos([]);
    } catch {
      // Regla 7: si el modelo no está, la app sigue entera en modo manual.
      setRespuesta({
        clase: "aviso",
        titulo: "No pude conectarme",
        cuerpo: "Probá de nuevo, o usá el menú de arriba.",
      });
    } finally {
      setCargando(false);
    }
  }

  const ocupado = cargando || subiendo;

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        sumarArchivos(Array.from(e.dataTransfer.files));
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="flex gap-2"
      >
        <Input
          value={frase}
          onChange={(e) => setFrase(e.target.value)}
          /*
            Pegar es el gesto real: Beno saca la captura y hace Ctrl+V.
            Sin esto habría que guardarla a disco primero, que es
            exactamente la fricción que hace que no se use.
          */
          onPaste={(e) => {
            const pegados = Array.from(e.clipboardData.files);
            if (pegados.length > 0) {
              e.preventDefault();
              sumarArchivos(pegados);
            }
          }}
          placeholder="¿Qué querés hacer?"
          disabled={ocupado}
          autoFocus={autoFocus}
          aria-label="Pedile algo a Pepe"
        />

        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={ocupado}
          aria-label="Adjuntar un archivo"
          onClick={() => document.getElementById("adjuntos-caja")?.click()}
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </Button>

        <Button
          type="submit"
          disabled={
            ocupado || (frase.trim().length === 0 && archivos.length === 0)
          }
        >
          {ocupado ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          {subiendo ? "Subiendo…" : cargando ? "Pensando…" : "Dale"}
        </Button>

        <input
          id="adjuntos-caja"
          type="file"
          multiple
          accept={TIPOS_ADJUNTO.join(",")}
          className="hidden"
          onChange={(e) => {
            sumarArchivos(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </form>

      {archivos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {archivos.map((archivo, n) => (
            <li
              key={`${archivo.name}-${n}`}
              className="bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-xs"
            >
              {archivo.type === "application/pdf" ? (
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="max-w-48 truncate">{archivo.name}</span>
              <button
                type="button"
                aria-label={`Quitar ${archivo.name}`}
                className="hover:text-foreground text-muted-foreground"
                disabled={ocupado}
                onClick={() =>
                  setArchivos((previos) => previos.filter((_, i) => i !== n))
                }
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {respuesta ? (
          <Respuesta
            respuesta={respuesta}
            onElegir={enviar}
            onCerrar={onCerrar}
          />
        ) : (
          !cargando && (
            <p className="text-muted-foreground text-xs">
              Probá con “cómo viene Proder”, “qué me toca hoy” o “qué estoy
              pagando que no uso”. También podés pegar o arrastrar capturas y
              PDF acá.
            </p>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Falta un dato y hay que **escribirlo**.
 *
 * Es la contracara de `pregunta`: ahí se elige entre opciones que la app ya
 * conoce, acá el valor lo trae Beno y no hay botón posible —un monto tiene
 * infinitos valores—. Lo que escribe se mete en el hueco de `plantilla` y
 * vuelve como la frase completa, así que **no tiene que retipear nada de lo
 * que ya dijo**, que es la única razón por la que preguntar vale la pena en
 * vez de abrirle el formulario vacío.
 *
 * Los atajos de arriba (hoy / ayer para la fecha) son la misma plantilla
 * con el valor ya puesto: un click, y la caja no vuelve al modelo.
 */
function Completar({
  respuesta,
  onElegir,
}: {
  respuesta: Extract<RespuestaSimple, { clase: "completar" }>;
  onElegir: (
    destino: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) => void;
}) {
  const [valor, setValor] = useState("");

  function completar(texto: string) {
    const limpio = texto.trim();
    if (!limpio) return;
    onElegir(respuesta.destino, respuesta.plantilla.replace("{}", limpio));
  }

  return (
    <div className={TARJETA}>
      <p className="text-sm font-semibold">{respuesta.titulo}</p>
      <p className="text-muted-foreground text-sm">{respuesta.cuerpo}</p>

      {respuesta.opciones && respuesta.opciones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {respuesta.opciones.map((o) => (
            <Button
              key={o.etiqueta}
              variant="secondary"
              size="sm"
              onClick={() => completar(o.valor)}
            >
              {o.etiqueta}
            </Button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          completar(valor);
        }}
        className="flex gap-2"
      >
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={`Ej: ${respuesta.ejemplo}`}
          aria-label={respuesta.titulo}
          autoFocus
          className="cifra"
        />
        <Button type="submit" disabled={valor.trim().length === 0}>
          Listo
        </Button>
      </form>
    </div>
  );
}

/**
 * Un movimiento entendido, con de dónde salió cada campo.
 *
 * **Acá no se guardó nada todavía.** El botón abre el formulario de
 * siempre, precargado: ese formulario es el panel de confirmación que pide
 * la sección 6 del spec, y es también el único lugar donde se arma el par
 * ARS/USD con la cotización de la fecha (regla 1).
 */
function Movimiento({
  respuesta,
  onElegir,
  onCerrar,
}: {
  respuesta: Extract<RespuestaSimple, { clase: "movimiento" }>;
  onElegir: (
    destino: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) => void;
  onCerrar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className={TARJETA}>
      <p className="text-sm font-semibold">{respuesta.titulo}</p>
      {/* `cifra` porque acá hay un monto y una fecha. */}
      <pre className="cifra text-sm whitespace-pre-wrap">{respuesta.cuerpo}</pre>
      <p className="text-muted-foreground text-sm">
        Todavía no se guardó nada: se carga desde el formulario, y ahí podés
        corregir lo que haga falta.
      </p>

      <Button variant="outline" onClick={() => setAbierto(true)}>
        Revisar y cargar
      </Button>

      <MovementDialog
        precarga={respuesta.precarga}
        open={abierto}
        onOpenChange={setAbierto}
        // Cerrar la caja solo cuando el movimiento entró de verdad:
        // arrepentirse en el formulario tiene que devolverte a la respuesta,
        // no dejarte sin nada.
        onListo={onCerrar}
      />

      <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
    </div>
  );
}

/**
 * Los archivos ya guardados, y el pase corriendo encima.
 *
 * **La caja no espera el pase adentro de la llamada, lo maneja acá.** Un
 * PDF de 30 páginas son ~32 000 tokens contra un caño de 5500 por minuto:
 * diez minutos, contra un `maxDuration` de 300 segundos. Así que el
 * servidor procesa lo que entra en su presupuesto de tiempo, devuelve
 * `restantes` y esta pantalla vuelve a llamar — el mismo mecanismo que ya
 * usa el pase de extracción de la bandeja.
 *
 * Y por eso el corte por tiempo y el corte por falla se tratan distinto:
 * al primero se le vuelve a llamar solo, al segundo se le ofrece un botón.
 * Insistir en un bucle contra una cuota agotada es peor que esperar.
 */
function Adjuntos({
  respuesta,
  onCerrar,
}: {
  respuesta: Extract<RespuestaSimple, { clase: "adjuntos" }>;
  onCerrar?: () => void;
}) {
  const [corriendo, setCorriendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resumen, setResumen] = useState<{
    propuestas: number;
    notas: number;
    noProcesables: number;
    errores: number;
  } | null>(null);

  const ids = respuesta.items.map((i) => i.id);
  // El efecto de abajo corre una sola vez por respuesta; sin esto,
  // recrear el array de ids en cada render lo volvería a disparar.
  const clave = ids.join(",");
  const arrancado = useRef<string | null>(null);

  const correr = useCallback(async () => {
    setCorriendo(true);
    setAviso(null);

    const total = { propuestas: 0, notas: 0, noProcesables: 0, errores: 0 };
    // Tope de vueltas: 60 páginas son ~20 minutos y cada corrida gasta 4,
    // así que ocho vueltas cubren el peor caso con margen. Sin tope, un
    // bug del servidor que devolviera siempre lo mismo sería un bucle
    // infinito contra Groq.
    const MAX_VUELTAS = 8;

    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const r = await fetch("/api/adjuntos/procesar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: clave.split(",") }),
        });

        const resultado = (await r.json()) as
          | { ok: true; data: ReporteAdjuntosCliente }
          | { ok: false; error: string };

        if (!resultado.ok) {
          setAviso(resultado.error);
          return;
        }

        const d = resultado.data;
        total.propuestas += d.propuestas;
        total.notas += d.notas;
        total.noProcesables += d.noProcesables;
        total.errores += d.errores;
        setResumen({ ...total });

        if (d.restantes === 0) return;

        // Se cortó por una falla del modelo, no por tiempo: frenar y
        // ofrecer el botón. Los archivos quedaron guardados.
        if (!d.cortePorTiempo) {
          setAviso(
            `${d.interrumpidoPor ?? "Quedó a medias."} Lo que ya salió está en la bandeja.`,
          );
          return;
        }
      }

      setAviso("Todavía queda archivo por leer. Dale de nuevo para seguir.");
    } catch {
      setAviso("Se cortó la conexión. Los archivos quedaron guardados.");
    } finally {
      setCorriendo(false);
    }
  }, [clave]);

  useEffect(() => {
    if (!respuesta.procesar) return;
    if (arrancado.current === clave) return;
    arrancado.current = clave;
    void correr();
  }, [clave, correr, respuesta.procesar]);

  const salieron = (resumen?.propuestas ?? 0) + (resumen?.notas ?? 0);

  return (
    <div className={TARJETA}>
      <p className="text-sm font-semibold">{respuesta.titulo}</p>
      <p className="text-muted-foreground text-sm">{respuesta.cuerpo}</p>

      <ul className="text-muted-foreground space-y-1 text-xs">
        {respuesta.items.map((i) => (
          <li key={i.id} className="flex items-center gap-2">
            {i.tipo === "pdf" ? (
              <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{i.nombre}</span>
          </li>
        ))}
      </ul>

      {corriendo && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Leyendo… esto puede tardar unos minutos y podés seguir usando la app.
        </p>
      )}

      {resumen && salieron > 0 && (
        <Button asChild variant="outline" onClick={onCerrar}>
          <Link href={respuesta.href}>
            Ver las <span className="cifra">{salieron}</span> propuestas
          </Link>
        </Button>
      )}

      {resumen && !corriendo && salieron === 0 && (
        <p className="text-muted-foreground text-sm">
          {resumen.noProcesables > 0
            ? "No pude leer lo que había adentro. El archivo quedó guardado igual."
            : "No salió ninguna propuesta de ahí."}
        </p>
      )}

      {aviso && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{aviso}</p>
          <Button variant="outline" size="sm" onClick={() => void correr()}>
            Seguir
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Lo que devuelve `/api/adjuntos/procesar`.
 *
 * Se declara acá y no se importa de `lib/adjuntos.ts` porque ese módulo
 * es `server-only`: importarlo desde un componente cliente rompería el
 * build, que es justamente para lo que está esa marca.
 */
interface ReporteAdjuntosCliente {
  terminados: number;
  propuestas: number;
  notas: number;
  noProcesables: number;
  errores: number;
  restantes: number;
  interrumpidoPor?: string;
  cortePorTiempo: boolean;
}

/** Cómo se llama cada especialista en pantalla. */
const ETIQUETA_DESTINO: Record<Destino, string> = {
  consultas: "Números",
  buscador: "Buscador",
  bitacora: "Bitácora",
  roadmap: "Roadmap",
  estudio: "Estudio",
  tema_estudio: "Tema nuevo",
  retro: "Retro",
  proyecto: "Proyecto",
  lecciones_tema: "Lecciones",
  suscripciones: "Suscripciones",
  vencimientos: "Vencimientos",
  movimientos: "Movimientos",
  presupuesto: "Presupuesto",
  desconocido: "—",
};

/** Misma caja que usan las tarjetas de la bandeja y de Sugerencias. */
const TARJETA = "bg-card space-y-3 rounded-lg border p-4";

/**
 * Muestra a qué especialista fue y deja corregirlo.
 *
 * El spec lo pide explícitamente: el recepcionista puede derivar mal, y si
 * la pantalla no dice a dónde te llevó, no hay forma de darse cuenta ni de
 * arreglarlo. Sin esto, una derivación equivocada se ve igual que una
 * respuesta pobre.
 */
function PieDeDestino({
  destino,
  onElegir,
}: {
  destino: Destino;
  onElegir: (destino: Destino, argumento?: string | null) => void;
}) {
  const [mostrando, setMostrando] = useState(false);

  const alternativas = (Object.keys(ETIQUETA_DESTINO) as Destino[]).filter(
    (d) => d !== destino && d !== "desconocido",
  );

  return (
    <div className="space-y-2 border-t border-dashed pt-3">
      <p className="text-muted-foreground text-xs">
        → {ETIQUETA_DESTINO[destino]}{" "}
        <button
          type="button"
          className="hover:text-foreground underline underline-offset-2 transition-colors"
          onClick={() => setMostrando((v) => !v)}
        >
          ¿no era esto?
        </button>
      </p>

      {mostrando && (
        <div className="flex flex-wrap gap-2">
          {alternativas.map((d) => (
            <Button
              key={d}
              size="sm"
              variant="secondary"
              onClick={() => onElegir(d)}
            >
              {ETIQUETA_DESTINO[d]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Respuesta({
  respuesta,
  onElegir,
  onCerrar,
}: {
  respuesta: RespuestaAgente;
  onElegir: (
    destino: Destino,
    argumento?: string | null,
    confirmado?: boolean,
  ) => void;
  onCerrar?: () => void;
}) {
  switch (respuesta.clase) {
    case "texto":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          {/*
            `cifra` y no `tabular-nums` suelto: acá caen los balances, y
            las columnas de plata tienen que alinear en vertical.
          */}
          <pre className="cifra text-sm whitespace-pre-wrap">
            {respuesta.cuerpo}
          </pre>
          {/*
            Las observaciones van fuera del `pre`: son prosa y en
            monoespaciada se leen mal. Cada una muestra el dato que la
            sostiene citado y aparte, con el mismo tratamiento que el
            `ancla` de una sugerencia — es la salvaguarda contra la
            observación inventada, y solo sirve si se puede leer separada
            del texto que justifica.
          */}
          {respuesta.observaciones && respuesta.observaciones.length > 0 && (
            <ul className="space-y-3 border-t border-dashed pt-3">
              {respuesta.observaciones.map((o, n) => (
                <li key={n} className="space-y-1">
                  <p className="text-sm">{o.texto}</p>
                  <p className="text-muted-foreground border-l-2 pl-3 text-xs">
                    <Quote
                      className="mr-1 inline size-3 align-[-1px]"
                      aria-hidden="true"
                    />
                    <span className="cifra">{o.dato}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "lista":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <ul className="space-y-3">
            {respuesta.items.map((i, n) => (
              <li key={n} className="space-y-1">
                <p className="text-sm font-medium">{i.titulo}</p>
                <p className="text-muted-foreground text-sm whitespace-pre-line">
                  {i.detalle}
                </p>
                {/*
                  El dato que lo justifica, separado y a la vista. Mismo
                  tratamiento que en la pantalla de Sugerencias a propósito:
                  es la misma información y tiene que leerse igual en las
                  dos superficies. Citado y aparte, se descarta de un
                  vistazo lo que no se apoya en nada.
                */}
                {i.ancla && (
                  <p className="text-muted-foreground border-l-2 pl-3 text-xs">
                    <Quote
                      className="mr-1 inline size-3 align-[-1px]"
                      aria-hidden="true"
                    />
                    {i.ancla}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "propuestas":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <p className="text-muted-foreground text-sm">
            Nada se guardó todavía: te esperan en la bandeja para que
            confirmes.
          </p>
          <Button asChild variant="outline" onClick={onCerrar}>
            <Link href={respuesta.href}>
              Ver las <span className="cifra">{respuesta.cuantas}</span>{" "}
              propuestas
            </Link>
          </Button>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "presupuesto":
      /*
        Igual que `movimiento`: acá no se estimó ni se guardó nada. El
        botón lleva a la pantalla de alta con el pedido pegado y es Beno el
        que aprieta "Estimar los entregables". El porqué está en la rama de
        `despacho.ts`.
      */
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <p className="text-muted-foreground text-sm whitespace-pre-line">
            {respuesta.cuerpo}
          </p>
          <Button asChild variant="outline" onClick={onCerrar}>
            <Link href={respuesta.href}>Armar el presupuesto</Link>
          </Button>
          <PieDeDestino destino={respuesta.destino} onElegir={onElegir} />
        </div>
      );

    case "pregunta":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <div className="flex flex-wrap gap-2">
            {respuesta.opciones.map((o, n) => (
              <Button
                key={n}
                variant="secondary"
                size="sm"
                onClick={() => onElegir(o.destino, o.argumento, o.confirmado)}
              >
                {o.etiqueta}
              </Button>
            ))}
          </div>
        </div>
      );

    case "completar":
      return <Completar respuesta={respuesta} onElegir={onElegir} />;

    case "movimiento":
      return (
        <Movimiento
          respuesta={respuesta}
          onElegir={onElegir}
          onCerrar={onCerrar}
        />
      );

    /*
      Archivos guardados. No lleva pie de "¿no era esto?": no hubo
      derivación que corregir — el camino lo decidió la presencia del
      archivo y el pase lo decidió el MIME, las dos cosas sin modelo.
    */
    case "adjuntos":
      return <Adjuntos respuesta={respuesta} onCerrar={onCerrar} />;

    case "aviso":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <p className="text-muted-foreground text-sm">{respuesta.cuerpo}</p>
        </div>
      );

    /*
      Una frase que pidió varias cosas. Cada paso se dibuja con este mismo
      componente —son respuestas normales, con su pie de destino y sus
      botones— y quedan una abajo de otra en el orden en que Beno las
      escribió. El título de arriba dice cuántas salieron: sin eso habría
      que contar tarjetas para saber si se hizo todo.
    */
    case "cadena":
      return (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{respuesta.titulo}</p>

          {respuesta.pasos.map((paso, n) => (
            <Respuesta
              key={n}
              respuesta={paso.respuesta}
              onElegir={onElegir}
              onCerrar={onCerrar}
            />
          ))}

          {/*
            Lo que no se hizo se dice, no se omite: media docena de las
            acciones de Pepe dejan algo escrito, así que "esto no lo
            toqué" es información. Se descartan a propósito (ver
            `cadena.ts`), y por eso el texto dice que las vuelva a pedir.
          */}
          {respuesta.pendientes.length > 0 && (
            <div className={TARJETA}>
              <p className="text-sm font-semibold">Esto no lo hice</p>
              <p className="text-muted-foreground text-sm">
                Me quedó sin hacer{" "}
                {respuesta.pendientes
                  .map((p) => ETIQUETA_DESTINO[p.destino])
                  .join(", ")}
                . Contestame lo de arriba y, si lo seguís queriendo, pedímelo
                de nuevo.
              </p>
            </div>
          )}
        </div>
      );
  }
}
