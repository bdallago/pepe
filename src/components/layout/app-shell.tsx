"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  CalendarDays,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Menu,
  Map,
  NotebookPen,
  Plus,
  Repeat,
  Settings,
  Sun,
  Wallet,
} from "lucide-react";

import { MonedaToggle } from "@/components/layout/moneda-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { QuickAddDialog } from "@/components/movimientos/quick-add-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * La app tiene tres secciones y cada una tiene sus propias pantallas.
 *
 * La navegación es de dos pisos a propósito: arriba la sección, abajo las
 * pantallas de esa sección. Con las nueve pantallas en una sola fila no
 * entraban, y sobre todo no se entendía que Movimientos y Roadmap son
 * cosas de mundos distintos.
 *
 * Ajustes queda afuera: es configuración de toda la app (proyectos,
 * categorías, cotización, cadencia de los tracks), no una cuarta sección.
 * Vive como icono a la derecha, al lado del menú de usuario.
 */
const SECCIONES = [
  {
    href: "/",
    label: "Finanzas",
    icon: Wallet,
    pantallas: [
      { href: "/", label: "Balance", icon: LayoutDashboard },
      { href: "/proyectos", label: "Proyectos", icon: Wallet },
      { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
      { href: "/recurrentes", label: "Recurrentes", icon: Repeat },
    ],
  },
  {
    href: "/aprendizaje",
    label: "Aprendizaje",
    icon: GraduationCap,
    pantallas: [
      { href: "/aprendizaje", label: "Hoy", icon: Sun },
      { href: "/aprendizaje/semana", label: "Semana", icon: CalendarDays },
      { href: "/aprendizaje/roadmap", label: "Roadmap", icon: Map },
      { href: "/aprendizaje/artefactos", label: "Artefactos", icon: ListChecks },
      { href: "/aprendizaje/repaso", label: "Repaso", icon: GraduationCap },
      { href: "/aprendizaje/lecciones", label: "Lecciones", icon: Lightbulb },
    ],
  },
  {
    href: "/bitacora",
    label: "Bitácora",
    icon: NotebookPen,
    pantallas: [],
  },
] as const;

/**
 * Marca de la app: dos barras enfrentadas, ingreso arriba y egreso abajo,
 * en los mismos dos colores que usan los gráficos.
 *
 * Reemplaza al wordmark "Balance", que repetía el nombre del primer ítem
 * del menú. Un logo que dice lo mismo que el botón de al lado no ancla
 * nada; esto sí dice de qué se trata la app.
 */
function Marca() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2" y="4" width="18" height="6" rx="2" fill="var(--chart-ingreso)" />
      <rect x="2" y="12" width="11" height="6" rx="2" fill="var(--chart-egreso)" />
    </svg>
  );
}

/**
 * Qué sección está abierta, o null si estamos en Ajustes.
 *
 * Finanzas cuelga de "/", así que no se puede resolver por prefijo: se
 * resuelve por descarte. Si se agrega una sección nueva y no se la suma
 * acá, Finanzas se queda marcada de más.
 */
function seccionActiva(pathname: string) {
  const especifica = SECCIONES.find(
    (s) => s.href !== "/" && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
  );
  if (especifica) return especifica;
  // Ajustes y Bandeja no son secciones: son de toda la app y viven como
  // iconos a la derecha. Sin esto, Finanzas quedaría marcada de más.
  for (const suelta of ["/ajustes", "/bandeja"]) {
    if (pathname === suelta || pathname.startsWith(`${suelta}/`)) return null;
  }
  return SECCIONES[0];
}

function esPantallaActiva(pathname: string, href: string): boolean {
  // "/" y "/aprendizaje" son índices de su sección: sin match exacto
  // quedarían activos en todas las pantallas de abajo.
  if (href === "/" || href === "/aprendizaje") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function claseNav(activo: boolean) {
  return cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    activo
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
  );
}

function LinksSeccion({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const actual = seccionActiva(pathname);

  return (
    <>
      {SECCIONES.map(({ href, label, icon: Icon }) => {
        const activo = actual?.href === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={activo ? "page" : undefined}
            className={claseNav(activo)}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </>
  );
}

/** El segundo piso: las pantallas de la sección abierta. */
function LinksPantallas() {
  const pathname = usePathname();
  const actual = seccionActiva(pathname);
  if (!actual || actual.pantallas.length === 0) return null;

  return (
    <div className="border-b">
      <nav
        aria-label={`Pantallas de ${actual.label}`}
        className="mx-auto flex w-full max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1.5"
      >
        {actual.pantallas.map(({ href, label }) => {
          const activo = esPantallaActiva(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={activo ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
                activo
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** En mobile no hay dos pisos: van las secciones con sus pantallas debajo. */
function MenuMobile({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {SECCIONES.map(({ href, label, icon: Icon, pantallas }) => (
        <div key={href}>
          <Link
            href={href}
            onClick={onNavigate}
            className={claseNav(seccionActiva(pathname)?.href === href)}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
          {pantallas.length > 0 && (
            <div className="mt-1 ml-4 flex flex-col gap-0.5 border-l pl-3">
              {pantallas.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  onClick={onNavigate}
                  aria-current={
                    esPantallaActiva(pathname, p.href) ? "page" : undefined
                  }
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm transition-colors",
                    esPantallaActiva(pathname, p.href)
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  email,
  nombre,
  avatarUrl,
  pendientesBandeja,
  children,
}: {
  email: string;
  nombre: string;
  avatarUrl?: string;
  /** Cuántas propuestas del modelo esperan una decisión. */
  pendientesBandeja: number;
  children: React.ReactNode;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cargaRapidaAbierta, setCargaRapidaAbierta] = useState(false);
  const pathname = usePathname();

  // El toggle de moneda y la carga rápida son de finanzas. En Aprendizaje
  // no significan nada, y un Ctrl+K que abre un formulario de gasto
  // mientras estás estudiando es ruido: el atajo vive dentro del diálogo,
  // así que desmontarlo lo apaga.
  const enFinanzas = seccionActiva(pathname)?.href === "/";

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 backdrop-blur">
        <div className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4">
            <Sheet open={menuAbierto} onOpenChange={setMenuAbierto}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Abrir menú"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>Pepe</SheetTitle>
                </SheetHeader>
                <MenuMobile onNavigate={() => setMenuAbierto(false)} />
              </SheetContent>
            </Sheet>

            <Link
              href="/"
              aria-label="Ir al balance general"
              className="mr-3 hidden items-center md:flex"
            >
              <Marca />
            </Link>

            <nav aria-label="Secciones" className="hidden items-center gap-1 md:flex">
              <LinksSeccion />
            </nav>

            <div className="ml-auto flex items-center gap-2">
              {enFinanzas && (
                <>
                  <MonedaToggle />
                  <Button
                    size="sm"
                    onClick={() => setCargaRapidaAbierta(true)}
                    className="gap-1.5"
                  >
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">Cargar</span>
                    <kbd className="bg-primary-foreground/15 ml-1 hidden rounded px-1.5 py-0.5 font-mono text-[10px] lg:inline">
                      Ctrl K
                    </kbd>
                  </Button>
                </>
              )}
              {/*
                La bandeja no es una sección: es el portón por donde entra
                todo lo que propone un modelo, para finanzas y para
                aprendizaje por igual. Vive al lado de Ajustes, con el
                contador visible — una cola de confirmación que no se ve
                es una cola que no se procesa.
              */}
              <Button
                variant="ghost"
                size="icon"
                asChild
                aria-label={
                  pendientesBandeja > 0
                    ? `Bandeja: ${pendientesBandeja} sin revisar`
                    : "Bandeja"
                }
                className={cn(
                  "relative",
                  pathname.startsWith("/bandeja") &&
                    "bg-secondary text-secondary-foreground",
                )}
              >
                <Link href="/bandeja">
                  <Inbox className="size-4" />
                  {pendientesBandeja > 0 && (
                    <span className="bg-primary text-primary-foreground cifra absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] leading-none">
                      {pendientesBandeja > 9 ? "9+" : pendientesBandeja}
                    </span>
                  )}
                </Link>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                asChild
                aria-label="Ajustes"
                className={cn(
                  pathname.startsWith("/ajustes") && "bg-secondary text-secondary-foreground",
                )}
              >
                <Link href="/ajustes">
                  <Settings className="size-4" />
                </Link>
              </Button>
              <UserMenu nombre={nombre} email={email} avatarUrl={avatarUrl} />
            </div>
          </div>
        </div>

        <LinksPantallas />
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>

      {enFinanzas && (
        <QuickAddDialog
          open={cargaRapidaAbierta}
          onOpenChange={setCargaRapidaAbierta}
        />
      )}
    </div>
  );
}
