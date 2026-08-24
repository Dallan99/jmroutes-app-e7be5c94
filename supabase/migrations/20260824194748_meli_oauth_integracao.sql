-- Integração oficial Mercado Livre. As tabelas são exclusivamente server-side:
-- nenhuma permissão é concedida ao cliente web.

create table if not exists public.meli_oauth_states (
  state_hash text primary key,
  code_verifier text not null,
  solicitado_por uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '10 minutes'),
  usado_em timestamptz
);

create table if not exists public.meli_api_conexoes (
  id uuid primary key default gen_random_uuid(),
  meli_user_id bigint not null unique,
  apelido text,
  access_token_criptografado text not null,
  refresh_token_criptografado text not null,
  token_expira_em timestamptz not null,
  scopes text[] not null default '{}',
  conectado_por uuid references auth.users(id) on delete set null,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ativo boolean not null default true
);

create table if not exists public.meli_api_notificacoes (
  id uuid primary key default gen_random_uuid(),
  notification_id text unique,
  topic text not null,
  resource text not null,
  meli_user_id bigint,
  application_id bigint,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

create index if not exists meli_api_notificacoes_pendentes_idx
  on public.meli_api_notificacoes (recebido_em)
  where processado_em is null;

alter table public.meli_oauth_states enable row level security;
alter table public.meli_api_conexoes enable row level security;
alter table public.meli_api_notificacoes enable row level security;

revoke all on public.meli_oauth_states from anon, authenticated;
revoke all on public.meli_api_conexoes from anon, authenticated;
revoke all on public.meli_api_notificacoes from anon, authenticated;

grant all on public.meli_oauth_states to service_role;
grant all on public.meli_api_conexoes to service_role;
grant all on public.meli_api_notificacoes to service_role;
