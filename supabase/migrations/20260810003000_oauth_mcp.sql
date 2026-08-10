-- ------------------------------------------------------------
-- OAuth 2.1 para el conector MCP remoto
--
-- Pepe pasa a ser **authorization server**, no solo servidor MCP. Hay
-- que hacerlo así porque Supabase Auth no puede serlo: no expone
-- `registration_endpoint` ni emite tokens para un tercero. Entonces
-- Supabase se usa solo para **autenticar la identidad** (el login de
-- Google que ya existe) y Pepe emite sus propios tokens.
--
-- Estas tres tablas son infraestructura, no dominio: **no llevan
-- `archivado_en`** —un código de autorización vencido no se archiva, se
-- borra— y no aparecen en ninguna pantalla.
--
-- ⚠ RLS habilitado y **sin ninguna policy, a propósito**: sin policies,
-- RLS niega todo. Solo la service role las toca, y esa saltea RLS. Que
-- no haya policy es la garantía de que ningún cliente con la anon key
-- puede leer un token ni aunque adivine el nombre de la tabla.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- oauth_clients — lo que registra Claude por DCR (RFC 7591)
--
-- Ojo con el volumen: la documentación de conectores avisa que **DCR
-- registra un cliente nuevo en cada conexión fresca**. Con un solo
-- usuario son unas pocas filas, pero por eso hay `created_at` y un
-- índice: para poder limpiar los viejos si alguna vez molestan.
-- ------------------------------------------------------------
create table public.oauth_clients (
  client_id text primary key,
  client_name text,
  -- Claude se registra como **cliente público**: no hay secreto. La
  -- seguridad del intercambio la da PKCE, no un client_secret.
  redirect_uris text[] not null check (array_length(redirect_uris, 1) > 0),
  created_at timestamptz not null default now()
);

create index oauth_clients_created_idx on public.oauth_clients (created_at desc);

-- ------------------------------------------------------------
-- oauth_codes — el código de autorización, de un solo uso
--
-- Vive segundos: se emite en /authorize y se canjea en /token.
-- ------------------------------------------------------------
create table public.oauth_codes (
  -- Hash del código, nunca el código. Si alguien lee esta tabla, no se
  -- lleva nada canjeable.
  code_hash text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  -- PKCE. La documentación de conectores dice que Claude manda
  -- `code_challenge` con S256 **siempre**, sin importar cómo se registró,
  -- así que acá no es opcional.
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  scope text not null default '',
  expires_at timestamptz not null,
  -- Un código se canjea una sola vez. Si llega de nuevo, es un replay.
  usado_en timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_codes_expira_idx on public.oauth_codes (expires_at);

-- ------------------------------------------------------------
-- oauth_tokens — el access token y su refresh
--
-- **Los dos se guardan hasheados.** Un access token en claro en la base
-- es una credencial en reposo: quien lea la tabla entra como Beno.
--
-- La spec de autorización de MCP adopta el requisito de OAuth 2.1 de
-- **rotar el refresh token en clientes públicos**, y la documentación de
-- conectores lo repite. Por eso `rotado_de`: cada refresh emite uno
-- nuevo e invalida el anterior, y la cadena queda registrada para poder
-- detectar el reuso de uno viejo, que es la señal de que se filtró.
-- ------------------------------------------------------------
create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null default '',
  expires_at timestamptz not null,
  -- Cuál era el refresh anterior de esta cadena. Null en el primer token.
  rotado_de text,
  revocado_en timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_tokens_user_idx on public.oauth_tokens (user_id, created_at desc);
create index oauth_tokens_refresh_idx on public.oauth_tokens (refresh_token_hash)
  where refresh_token_hash is not null and revocado_en is null;
create index oauth_tokens_expira_idx on public.oauth_tokens (expires_at);

-- ------------------------------------------------------------
-- RLS: habilitado y sin policies. Ver el encabezado.
-- ------------------------------------------------------------
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
