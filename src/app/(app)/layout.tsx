import { redirect } from "next/navigation";

import { AtajoGlobal } from "@/components/agentes/atajo-global";
import { AppShell } from "@/components/layout/app-shell";
import { AppDataProvider } from "@/components/providers/app-data-provider";
import { getSerieTasas } from "@/lib/fx-server";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Shell de las pantallas privadas.
 *
 * Carga una sola vez los datos de referencia (proyectos, categorías y la
 * serie de cotizaciones) y los baja al cliente por contexto. Así el
 * formulario de carga puede convertir ARS↔USD en tiempo real sin ir al
 * servidor por cada tecla.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const ahora = new Date().toISOString();

  const [projectsResult, categoriesResult, rates, bandejaResult] =
    await Promise.all([
      supabase.from("projects").select("*").order("nombre"),
      supabase.from("categories").select("*").order("tipo").order("nombre"),
      getSerieTasas(),
      // Contador de la bandeja: mismo criterio que la pantalla — lo
      // pendiente, lo que ya venció de pospuesto, y los errores que hay
      // que mirar. Es un `head: true`, así que trae el número y nada más.
      supabase
        .from("inbox")
        .select("id", { count: "exact", head: true })
        .or(
          `estado.eq.pendiente,estado.eq.error,and(estado.eq.pospuesto,posponer_hasta.lte.${ahora})`,
        ),
    ]);

  return (
    <AppDataProvider
      projects={projectsResult.data ?? []}
      categories={categoriesResult.data ?? []}
      rates={rates}
    >
      <AppShell
        pendientesBandeja={bandejaResult.count ?? 0}
        email={user.email ?? ""}
        nombre={
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          "Mi cuenta"
        }
        avatarUrl={user.user_metadata?.avatar_url as string | undefined}
      >
        {children}
      </AppShell>

      {/*
        Vive fuera del shell y no ocupa lugar hasta que lo pedís con
        Ctrl/⌘+K: es la misma caja del inicio, disponible desde cualquier
        pantalla.
      */}
      <AtajoGlobal />
    </AppDataProvider>
  );
}
