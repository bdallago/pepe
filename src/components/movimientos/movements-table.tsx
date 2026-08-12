"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Download,
  FileText,
  Paperclip,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import { MovementDialog } from "@/components/movimientos/movement-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { borrarMovimiento, efectuarMovimiento } from "@/lib/actions/movements";
import { descargarCsv, movimientosACsv } from "@/lib/csv";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/format";
import { montoEnMoneda } from "@/lib/fx";
import type { Movement } from "@/lib/supabase/database.types";
import type { MovimientoConReparto } from "@/lib/prorrateo";
import { cn } from "@/lib/utils";

type Columna = "fecha" | "descripcion" | "monto" | "proyecto" | "categoria";
type Direccion = "asc" | "desc";

interface Filtros {
  busqueda: string;
  proyecto: string;
  categoria: string;
  tipo: string;
  estado: string;
  moneda: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: Filtros = {
  busqueda: "",
  proyecto: "todos",
  categoria: "todas",
  tipo: "todos",
  estado: "todos",
  moneda: "todas",
  desde: "",
  hasta: "",
};

export function MovementsTable({ movements }: { movements: MovimientoConReparto[] }) {
  const router = useRouter();
  const { projects, categories, moneda } = useAppData();

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [orden, setOrden] = useState<{ columna: Columna; dir: Direccion }>({
    columna: "fecha",
    dir: "desc",
  });
  const [editando, setEditando] = useState<MovimientoConReparto | null>(null);
  const [borrando, setBorrando] = useState<MovimientoConReparto | null>(null);

  const nombreProyecto = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const nombreCategoria = useMemo(
    () => new Map(categories.map((c) => [c.id, c.nombre])),
    [categories],
  );

  const filtrados = useMemo(() => {
    const busqueda = filtros.busqueda.trim().toLowerCase();

    const lista = movements.filter((m) => {
      if (busqueda && !m.descripcion.toLowerCase().includes(busqueda))
        return false;
      if (filtros.proyecto === "compartido" && m.project_id !== null)
        return false;
      if (
        filtros.proyecto !== "todos" &&
        filtros.proyecto !== "compartido" &&
        m.project_id !== filtros.proyecto
      )
        return false;
      if (filtros.categoria !== "todas" && m.category_id !== filtros.categoria)
        return false;
      if (filtros.tipo !== "todos" && m.tipo !== filtros.tipo) return false;
      if (filtros.estado !== "todos" && m.estado !== filtros.estado)
        return false;
      if (filtros.moneda !== "todas" && m.moneda_origen !== filtros.moneda)
        return false;
      if (filtros.desde && m.fecha < filtros.desde) return false;
      if (filtros.hasta && m.fecha > filtros.hasta) return false;
      return true;
    });

    const signo = orden.dir === "asc" ? 1 : -1;

    return [...lista].sort((a, b) => {
      switch (orden.columna) {
        case "fecha":
          return signo * a.fecha.localeCompare(b.fecha);
        case "descripcion":
          return signo * a.descripcion.localeCompare(b.descripcion, "es-AR");
        case "monto":
          return (
            signo * (montoEnMoneda(a, moneda) - montoEnMoneda(b, moneda))
          );
        case "proyecto": {
          const na = a.project_id
            ? (nombreProyecto.get(a.project_id)?.nombre ?? "")
            : "Compartido";
          const nb = b.project_id
            ? (nombreProyecto.get(b.project_id)?.nombre ?? "")
            : "Compartido";
          return signo * na.localeCompare(nb, "es-AR");
        }
        case "categoria": {
          const na = nombreCategoria.get(a.category_id) ?? "";
          const nb = nombreCategoria.get(b.category_id) ?? "";
          return signo * na.localeCompare(nb, "es-AR");
        }
      }
    });
  }, [movements, filtros, orden, moneda, nombreProyecto, nombreCategoria]);

  const totales = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;
    for (const m of filtrados) {
      const monto = montoEnMoneda(m, moneda);
      if (m.tipo === "ingreso") ingresos += monto;
      else egresos += monto;
    }
    return { ingresos, egresos, balance: ingresos - egresos };
  }, [filtrados, moneda]);

  function alternarOrden(columna: Columna) {
    setOrden((actual) =>
      actual.columna === columna
        ? { columna, dir: actual.dir === "asc" ? "desc" : "asc" }
        : { columna, dir: columna === "fecha" ? "desc" : "asc" },
    );
  }

  function IconoOrden({ columna }: { columna: Columna }) {
    if (orden.columna !== columna) {
      return <ArrowUpDown className="text-muted-foreground/50 size-3" />;
    }
    return orden.dir === "asc" ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    );
  }

  function exportar() {
    if (filtrados.length === 0) {
      toast.error("No hay movimientos para exportar con estos filtros.");
      return;
    }
    const csv = movimientosACsv(filtrados, projects, categories);
    descargarCsv(csv, `movimientos-${todayISO()}.csv`);
    toast.success(`${filtrados.length} movimientos exportados.`);
  }

  async function efectuar(movimiento: Movement) {
    const resultado = await efectuarMovimiento(movimiento.id, todayISO());
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Marcado como efectuado con la cotización de hoy.");
    router.refresh();
  }

  async function confirmarBorrado() {
    if (!borrando) return;
    const resultado = await borrarMovimiento(borrando.id);
    setBorrando(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Movimiento borrado.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Filtros, todos en una fila arriba de la tabla. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="busqueda" className="text-muted-foreground text-xs">
            Buscar
          </Label>
          <Input
            id="busqueda"
            value={filtros.busqueda}
            onChange={(e) =>
              setFiltros({ ...filtros, busqueda: e.target.value })
            }
            placeholder="Descripción…"
            className="h-8"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Proyecto</Label>
          <Select
            value={filtros.proyecto}
            onValueChange={(v) => setFiltros({ ...filtros, proyecto: v })}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="compartido">Compartido</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Categoría</Label>
          <Select
            value={filtros.categoria}
            onValueChange={(v) => setFiltros({ ...filtros, categoria: v })}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre} ({c.tipo})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Tipo</Label>
          <Select
            value={filtros.tipo}
            onValueChange={(v) => setFiltros({ ...filtros, tipo: v })}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="ingreso">Ingresos</SelectItem>
              <SelectItem value="egreso">Egresos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Estado</Label>
          <Select
            value={filtros.estado}
            onValueChange={(v) => setFiltros({ ...filtros, estado: v })}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="efectuado">Efectuados</SelectItem>
              <SelectItem value="planificado">Planificados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Moneda</Label>
          <Select
            value={filtros.moneda}
            onValueChange={(v) => setFiltros({ ...filtros, moneda: v })}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="ARS">ARS</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="f-desde" className="text-muted-foreground text-xs">
            Desde
          </Label>
          <Input
            id="f-desde"
            type="date"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
            className="h-8 w-[9.5rem]"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="f-hasta" className="text-muted-foreground text-xs">
            Hasta
          </Label>
          <Input
            id="f-hasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
            className="h-8 w-[9.5rem]"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFiltros(FILTROS_VACIOS)}
        >
          Limpiar
        </Button>

        <Button variant="outline" size="sm" onClick={exportar}>
          <Download className="size-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Resumen de lo filtrado: es también la vista de tabla de los gráficos. */}
      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>{filtrados.length} movimientos</span>
        <span>
          Ingresos:{" "}
          <span className="text-foreground font-medium cifra">
            {formatMoney(totales.ingresos, moneda)}
          </span>
        </span>
        <span>
          Egresos:{" "}
          <span className="text-foreground font-medium cifra">
            {formatMoney(totales.egresos, moneda)}
          </span>
        </span>
        <span>
          Balance:{" "}
          <span
            className={cn(
              "font-medium cifra",
              totales.balance >= 0
                ? "text-positivo"
                : "text-destructive",
            )}
          >
            {formatMoney(totales.balance, moneda)}
          </span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  ["fecha", "Fecha"],
                  ["descripcion", "Descripción"],
                  ["proyecto", "Proyecto"],
                  ["categoria", "Categoría"],
                ] as const
              ).map(([columna, label]) => (
                <TableHead key={columna}>
                  <button
                    type="button"
                    onClick={() => alternarOrden(columna)}
                    className="hover:text-foreground flex items-center gap-1"
                  >
                    {label}
                    <IconoOrden columna={columna} />
                  </button>
                </TableHead>
              ))}
              <TableHead className="text-right">
                <button
                  type="button"
                  onClick={() => alternarOrden("monto")}
                  className="hover:text-foreground ml-auto flex items-center gap-1"
                >
                  Monto ({moneda})
                  <IconoOrden columna="monto" />
                </button>
              </TableHead>
              <TableHead className="w-28 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtrados.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground h-24 text-center"
                >
                  No hay movimientos con estos filtros.
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((m) => {
                const proyecto = m.project_id
                  ? nombreProyecto.get(m.project_id)
                  : null;

                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap cifra">
                      {formatDate(m.fecha)}
                    </TableCell>

                    <TableCell className="max-w-64">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{m.descripcion}</span>
                        {m.comprobante_path ? (
                          <Paperclip className="text-muted-foreground size-3 shrink-0" />
                        ) : null}
                        {m.recurrence_id ? (
                          <FileText className="text-muted-foreground size-3 shrink-0" />
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {m.estado === "planificado" ? (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            planificado
                          </Badge>
                        ) : null}
                        <span className="text-muted-foreground text-[10px]">
                          {m.moneda_origen} origen · {formatRate(Number(m.tasa_usada))}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap">
                      {proyecto ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="size-2 rounded-full"
                            style={{ backgroundColor: proyecto.color }}
                          />
                          {proyecto.nombre}
                        </span>
                      ) : (
                        <Badge variant="secondary" className="font-normal">
                          Compartido
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {nombreCategoria.get(m.category_id) ?? "—"}
                    </TableCell>

                    <TableCell
                      className={cn(
                        "text-right font-medium whitespace-nowrap cifra",
                        m.tipo === "ingreso"
                          ? "text-positivo"
                          : "text-foreground",
                      )}
                    >
                      {m.tipo === "ingreso" ? "+" : "−"}
                      {formatMoney(montoEnMoneda(m, moneda), moneda)}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {m.estado === "planificado" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Marcar como efectuado"
                            onClick={() => void efectuar(m)}
                          >
                            <Check className="size-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Editar"
                          onClick={() => setEditando(m)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Borrar"
                          onClick={() => setBorrando(m)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <MovementDialog
        movimiento={editando ?? undefined}
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null);
        }}
      />

      <AlertDialog
        open={borrando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setBorrando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a borrar «{borrando?.descripcion}»
              {borrando?.comprobante_path ? " y su comprobante" : ""}. No se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarBorrado}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
