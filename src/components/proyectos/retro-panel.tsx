"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, FileText, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archivarRetro, guardarRetro } from "@/lib/actions/retros";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * Retro del proyecto (spec 6.5).
 *
 * Tres estados, y el del medio es el que importa:
 *
 * 1. **Las retros guardadas**, si hay. Se leen y se archivan.
 * 2. **El borrador recién generado**, editable campo por campo y todavía
 *    fuera de la base. Nada se guarda hasta que Beno aprieta "Guardar":
 *    es la misma regla de la bandeja, aplicada a un texto largo que se
 *    lee entero en vez de aceptarse de a un ítem.
 * 3. **El botón de generar**, con el aviso de que tarda.
 *
 * Las lecciones candidatas no aparecen acá: van a la bandeja y se
 * confirman de a una, como todo lo demás. Se avisa cuántas quedaron.
 */

export interface RetroGuardada {
  id: string;
  fecha: string;
  titulo: string;
  que_funciono: string;
  que_no_funciono: string;
  costo_real: string;
  conclusion: string;
  balance_ars: number | null;
  balance_usd: number | null;
  modelo: string | null;
}

interface Borrador {
  titulo: string;
  queFunciono: string;
  queNoFunciono: string;
  costoReal: string;
  conclusion: string;
  balanceArs: number;
  balanceUsd: number;
  modelo: string | null;
}

export function RetroPanel({
  projectId,
  nombreProyecto,
  retros,
  hayModelo,
  moneda,
}: {
  projectId: string;
  nombreProyecto: string;
  retros: RetroGuardada[];
  hayModelo: boolean;
  moneda: Moneda;
}) {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [fecha, setFecha] = useState(todayISO());

  async function generar() {
    setGenerando(true);
    try {
      const respuesta = await fetch("/api/proyectos/retro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const resultado = await respuesta.json();

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      const d = resultado.data;
      setBorrador({
        titulo: d.borrador.titulo,
        queFunciono: d.borrador.que_funciono,
        queNoFunciono: d.borrador.que_no_funciono,
        costoReal: d.borrador.costo_real,
        conclusion: d.borrador.conclusion,
        balanceArs: d.balanceArs,
        balanceUsd: d.balanceUsd,
        modelo: null,
      });
      setFecha(todayISO());

      if (d.leccionesPropuestas > 0) {
        toast.success(
          `${d.leccionesPropuestas} ${d.leccionesPropuestas === 1 ? "lección candidata" : "lecciones candidatas"} en la bandeja.`,
        );
      } else {
        toast.info("No salieron lecciones candidatas de esta retro.");
      }
    } catch {
      toast.error("No pude hablar con el modelo. Probá de nuevo.");
    } finally {
      setGenerando(false);
    }
  }

  async function guardar() {
    if (!borrador) return;

    setGuardando(true);
    const resultado = await guardarRetro({
      projectId,
      fecha,
      titulo: borrador.titulo,
      queFunciono: borrador.queFunciono,
      queNoFunciono: borrador.queNoFunciono,
      costoReal: borrador.costoReal,
      conclusion: borrador.conclusion,
      balanceArs: borrador.balanceArs,
      balanceUsd: borrador.balanceUsd,
      modelo: borrador.modelo,
    });
    setGuardando(false);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    setBorrador(null);
    toast.success("Retro guardada.");
    router.refresh();
  }

  async function archivar(id: string) {
    const resultado = await archivarRetro(id);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Retro archivada.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retro</CardTitle>
        <CardDescription>
          El cierre de {nombreProyecto}: qué funcionó, qué no y cuánto costó de
          verdad.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* --- Las guardadas ---------------------------------- */}
        {retros.map((r) => (
          <article key={r.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{r.titulo}</h3>
                <p className="text-muted-foreground cifra text-xs">
                  {formatDate(r.fecha)}
                  {r.balance_ars !== null && (
                    <>
                      {" · balance al cerrar: "}
                      {formatMoney(
                        moneda === "ARS"
                          ? Number(r.balance_ars)
                          : Number(r.balance_usd ?? 0),
                        moneda,
                      )}
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => archivar(r.id)}
                aria-label="Archivar retro"
              >
                <Archive className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <Seccion titulo="Qué funcionó" texto={r.que_funciono} />
            <Seccion titulo="Qué no funcionó" texto={r.que_no_funciono} />
            <Seccion titulo="Cuánto costó de verdad" texto={r.costo_real} />
            <Seccion titulo="Conclusión" texto={r.conclusion} />

            {r.modelo && (
              <p className="text-muted-foreground text-xs">
                Borrador redactado por {r.modelo} y aprobado por vos.
              </p>
            )}
          </article>
        ))}

        {/* --- El borrador sin guardar ------------------------ */}
        {borrador && (
          <div className="border-primary space-y-4 rounded-lg border-2 border-dashed p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Borrador sin guardar</p>
              <p className="text-muted-foreground text-xs">
                Editá lo que quieras antes de guardarlo.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="retro-titulo">Título</Label>
                <Input
                  id="retro-titulo"
                  value={borrador.titulo}
                  onChange={(e) =>
                    setBorrador({ ...borrador, titulo: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retro-fecha">Fecha de cierre</Label>
                <Input
                  id="retro-fecha"
                  type="date"
                  className="cifra"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
            </div>

            <CampoLargo
              id="retro-funciono"
              etiqueta="Qué funcionó"
              valor={borrador.queFunciono}
              alCambiar={(v) => setBorrador({ ...borrador, queFunciono: v })}
            />
            <CampoLargo
              id="retro-no-funciono"
              etiqueta="Qué no funcionó"
              valor={borrador.queNoFunciono}
              alCambiar={(v) => setBorrador({ ...borrador, queNoFunciono: v })}
            />
            <CampoLargo
              id="retro-costo"
              etiqueta="Cuánto costó de verdad"
              valor={borrador.costoReal}
              alCambiar={(v) => setBorrador({ ...borrador, costoReal: v })}
            />
            <CampoLargo
              id="retro-conclusion"
              etiqueta="Conclusión"
              valor={borrador.conclusion}
              alCambiar={(v) => setBorrador({ ...borrador, conclusion: v })}
            />

            <p className="text-muted-foreground text-xs">
              Se guarda el balance de hoy congelado (
              <span className="cifra">
                {formatMoney(
                  moneda === "ARS" ? borrador.balanceArs : borrador.balanceUsd,
                  moneda,
                )}
              </span>
              ). Una retro dice lo que el proyecto costó cuando se cerró, no lo
              que diría recalculada el año que viene.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Guardar retro
              </Button>
              <Button
                variant="ghost"
                onClick={() => setBorrador(null)}
                disabled={guardando}
              >
                Descartar
              </Button>
            </div>
          </div>
        )}

        {/* --- Generar --------------------------------------- */}
        {!borrador &&
          (hayModelo ? (
            <div className="space-y-2">
              <Button onClick={generar} disabled={generando} variant="outline">
                {generando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-4" aria-hidden="true" />
                )}
                {generando
                  ? "Leyendo todo el proyecto…"
                  : retros.length > 0
                    ? "Generar otra retro"
                    : "Generar la retro"}
              </Button>
              <p className="text-muted-foreground text-xs" aria-live="polite">
                {generando
                  ? "Está mirando los movimientos, las lecciones y la bitácora del proyecto. Es la llamada más pesada de la app: puede tardar un par de minutos."
                  : "Mira los movimientos, las lecciones y la bitácora del proyecto. Tarda; las lecciones candidatas van a la bandeja."}
              </p>
            </div>
          ) : (
            retros.length === 0 && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <FileText className="size-4" aria-hidden="true" />
                No hay modelo configurado. La retro se puede escribir a mano
                cuando quieras.
              </p>
            )
          ))}
      </CardContent>
    </Card>
  );
}

function Seccion({ titulo, texto }: { titulo: string; texto: string }) {
  if (!texto.trim()) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {titulo}
      </h4>
      <p className="text-sm whitespace-pre-line">{texto}</p>
    </div>
  );
}

function CampoLargo({
  id,
  etiqueta,
  valor,
  alCambiar,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Textarea
        id={id}
        rows={4}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
      />
    </div>
  );
}
