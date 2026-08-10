"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Quote, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Destino, RespuestaAgente } from "@/lib/agentes/tipos";

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

  async function enviar(destino?: Destino, argumento?: string | null) {
    const texto = frase.trim();
    if (!texto || cargando) return;

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

    setCargando(true);
    setRespuesta(null);

    try {
      const r = await fetch("/api/agentes/interpretar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frase: texto, destino, argumento: dato }),
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

  return (
    <div className="space-y-3">
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
          placeholder="¿Qué querés hacer?"
          disabled={cargando}
          autoFocus={autoFocus}
          aria-label="Pedile algo a Pepe"
        />
        <Button type="submit" disabled={cargando || frase.trim().length === 0}>
          {cargando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          {cargando ? "Pensando…" : "Dale"}
        </Button>
      </form>

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
              pagando que no uso”.
            </p>
          )
        )}
      </div>
    </div>
  );
}

/** Cómo se llama cada especialista en pantalla. */
const ETIQUETA_DESTINO: Record<Destino, string> = {
  consultas: "Números",
  buscador: "Buscador",
  roadmap: "Roadmap",
  estudio: "Estudio",
  tema_estudio: "Tema nuevo",
  retro: "Retro",
  lecciones_tema: "Lecciones",
  suscripciones: "Suscripciones",
  vencimientos: "Vencimientos",
  movimientos: "Movimientos",
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
  onElegir: (destino: Destino, argumento?: string | null) => void;
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
                onClick={() => onElegir(o.destino, o.argumento)}
              >
                {o.etiqueta}
              </Button>
            ))}
          </div>
        </div>
      );

    case "aviso":
      return (
        <div className={TARJETA}>
          <p className="text-sm font-semibold">{respuesta.titulo}</p>
          <p className="text-muted-foreground text-sm">{respuesta.cuerpo}</p>
        </div>
      );
  }
}
