-- ============================================================
-- Adjuntos: la tabla, su RLS y el bucket.
--
-- `attachments` **no es una tabla de dominio**, y la distinción es lo que
-- sostiene la regla 6: es una antesala, como `inbox`. Que exista una fila
-- acá no cambia ni un peso de un balance, ni una lección, ni una entrada
-- de bitácora. Lo que sale del archivo y quiere ser una entidad pasa por
-- `inbox` igual que todo lo demás.
--
-- Convención del esquema: tabla y claves foráneas en inglés, columnas y
-- enums en español.
-- ============================================================

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Nullable a propósito: al pegar un archivo puede no saberse a qué
  -- proyecto va. La resolución pasa al momento de aceptar la propuesta
  -- —`daily_log.project_id` sí es not null— y ahí la tarjeta de la
  -- bandeja pide elegirlo antes de habilitar el botón.
  -- `on delete set null` y no `cascade`: borrar un proyecto no tiene por
  -- qué llevarse puesto un archivo que Beno subió.
  project_id uuid references public.projects (id) on delete set null,

  -- El archivo, tal como quedó en el bucket `adjuntos`.
  storage_path text not null,
  nombre_original text not null check (length(trim(nombre_original)) > 0),
  mime text not null,
  bytes bigint not null check (bytes > 0),

  tipo public.tipo_adjunto not null,
  estado public.estado_adjunto not null default 'pendiente',

  -- Lo que Beno escribió al pegarlo. **Es el pedido, no el archivo**:
  -- "hacé lecciones con esto" y "mirá lo que me contestó el cliente"
  -- piden cosas distintas sobre el mismo PDF.
  frase text,

  -- De un PDF es extracción mecánica; de una imagen es producción de un
  -- modelo (qwen leyendo píxeles). Conviven en la misma columna pero no
  -- tienen el mismo estatuto, y por eso una captura NUNCA escribe directo
  -- en `daily_log`: ahí el texto sería de un modelo, no de Beno.
  texto_extraido text,
  paginas integer check (paginas is null or paginas > 0),

  -- Lo que hace retomable al pase del PDF.
  --
  -- `resumenes` no está en el spec y hace falta: sin persistir el resumen
  -- de cada trozo, "retomable" sería mentira — una corrida cortada por
  -- tiempo perdería las quince llamadas que ya hizo y la siguiente
  -- volvería a pagarlas. Los trozos se recalculan siempre desde
  -- `texto_extraido`, que también queda guardado, así que los cortes son
  -- idénticos entre corridas y `trozos_hechos` indexa lo mismo siempre.
  trozos_totales integer not null default 0 check (trozos_totales >= 0),
  trozos_hechos integer not null default 0 check (trozos_hechos >= 0),
  resumenes jsonb not null default '[]'::jsonb,

  -- Qué falló, en pantalla y no en un log al que nadie entra.
  error_detalle text,

  -- Regla 4: el borrado por defecto es archivado.
  archivado_en timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un path del storage es un uuid: si aparece dos veces es que se
  -- registró dos veces el mismo archivo, no que hay dos archivos.
  unique (user_id, storage_path),
  check (trozos_hechos <= trozos_totales)
);

-- La lista de adjuntos de la pantalla: los últimos primero.
create index attachments_user_idx
  on public.attachments (user_id, created_at desc)
  where archivado_en is null;

-- Lo que el pase tiene que mirar. Parcial porque lo terminado es la
-- inmensa mayoría de la tabla y no se vuelve a tocar nunca.
create index attachments_pendientes_idx
  on public.attachments (user_id, created_at)
  where estado in ('pendiente', 'procesando') and archivado_en is null;

create trigger attachments_set_updated_at
  before update on public.attachments
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del esquema.
-- ------------------------------------------------------------
alter table public.attachments enable row level security;

create policy "attachments_select_own" on public.attachments
  for select to authenticated
  using (auth.uid() = user_id);

create policy "attachments_insert_own" on public.attachments
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "attachments_update_own" on public.attachments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "attachments_delete_own" on public.attachments
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Bucket `adjuntos`, separado de `comprobantes`.
--
-- Las políticas son las mismas cuatro de `20260101000002_storage.sql`
-- cambiando el `bucket_id`: leen el primer segmento del path como dueño
-- y no consultan ninguna tabla. Se separa el bucket porque los ciclos de
-- vida son distintos —borrar un movimiento borra su comprobante, y un
-- adjunto no tiene por qué quedar atrapado en esa lógica— y porque
-- "borrá todo lo que pegué" no se puede expresar sobre un bucket
-- mezclado.
--
-- `image/heic` queda AFUERA aunque `comprobantes` lo acepte: acá la
-- imagen va a un modelo y no se midió que Groq decodifique HEIC. Fallar
-- en la puerta con un mensaje claro es mejor que fallar tres minutos
-- después adentro del pase. Se agrega el día que se mida.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adjuntos',
  'adjuntos',
  false,
  10485760, -- 10 MB, los mismos que comprobantes
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "adjuntos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "adjuntos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "adjuntos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "adjuntos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
