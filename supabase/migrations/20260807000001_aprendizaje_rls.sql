-- ============================================================
-- Row Level Security del módulo de aprendizaje.
--
-- Mismo patrón que las tablas de finanzas: aislamiento por
-- auth.uid() = user_id, cuatro políticas por tabla, rol `authenticated`.
-- No hay tablas globales acá (el equivalente a fx_rates no existe).
-- ============================================================

alter table public.tracks    enable row level security;
alter table public.blocks    enable row level security;
alter table public.sessions  enable row level security;
alter table public.artifacts enable row level security;
alter table public.daily_log enable row level security;
alter table public.lessons   enable row level security;
alter table public.inbox     enable row level security;

-- ------------------------------------------------------------
-- tracks
-- ------------------------------------------------------------
create policy "tracks_select_own" on public.tracks
  for select to authenticated
  using (auth.uid() = user_id);

create policy "tracks_insert_own" on public.tracks
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "tracks_update_own" on public.tracks
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tracks_delete_own" on public.tracks
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- blocks
-- ------------------------------------------------------------
create policy "blocks_select_own" on public.blocks
  for select to authenticated
  using (auth.uid() = user_id);

create policy "blocks_insert_own" on public.blocks
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "blocks_update_own" on public.blocks
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "blocks_delete_own" on public.blocks
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- sessions
-- ------------------------------------------------------------
create policy "sessions_select_own" on public.sessions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "sessions_insert_own" on public.sessions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "sessions_update_own" on public.sessions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sessions_delete_own" on public.sessions
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- artifacts
-- ------------------------------------------------------------
create policy "artifacts_select_own" on public.artifacts
  for select to authenticated
  using (auth.uid() = user_id);

create policy "artifacts_insert_own" on public.artifacts
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "artifacts_update_own" on public.artifacts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "artifacts_delete_own" on public.artifacts
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- daily_log
-- ------------------------------------------------------------
create policy "daily_log_select_own" on public.daily_log
  for select to authenticated
  using (auth.uid() = user_id);

create policy "daily_log_insert_own" on public.daily_log
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "daily_log_update_own" on public.daily_log
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "daily_log_delete_own" on public.daily_log
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- lessons
-- ------------------------------------------------------------
create policy "lessons_select_own" on public.lessons
  for select to authenticated
  using (auth.uid() = user_id);

create policy "lessons_insert_own" on public.lessons
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "lessons_update_own" on public.lessons
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "lessons_delete_own" on public.lessons
  for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- inbox
-- ------------------------------------------------------------
create policy "inbox_select_own" on public.inbox
  for select to authenticated
  using (auth.uid() = user_id);

create policy "inbox_insert_own" on public.inbox
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "inbox_update_own" on public.inbox
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "inbox_delete_own" on public.inbox
  for delete to authenticated
  using (auth.uid() = user_id);
