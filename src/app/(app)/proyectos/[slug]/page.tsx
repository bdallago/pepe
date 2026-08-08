import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProyectoView } from "@/components/proyectos/proyecto-view";
import { hayModeloConfigurado } from "@/lib/llm";
import { getMovimientos, getProyectoPorSlug, getRetros } from "@/lib/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const proyecto = await getProyectoPorSlug(slug);
  return { title: proyecto?.nombre ?? "Proyecto" };
}

export default async function ProyectoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [proyecto, movements] = await Promise.all([
    getProyectoPorSlug(slug),
    getMovimientos(),
  ]);

  if (!proyecto) notFound();

  const retros = await getRetros(proyecto.id);

  return (
    <ProyectoView
      proyecto={proyecto}
      movements={movements}
      retros={retros}
      hayModelo={hayModeloConfigurado()}
    />
  );
}
