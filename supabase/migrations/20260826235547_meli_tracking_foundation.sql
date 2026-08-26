-- Fundação aditiva para a futura integração oficial de Carrier/Tracking.
-- Não cria triggers operacionais, não envia notificações e não altera o worker AdminML.

alter table public.meli_pacotes
  add column if not exists tracking_number text;

create index if not exists meli_pacotes_tracking_number_idx
  on public.meli_pacotes (tracking_number)
  where tracking_number is not null;

create table if not exists public.meli_tracking_eventos (
  id uuid primary key default gen_random_uuid(),
  meli_pacote_id uuid references public.meli_pacotes(id) on delete set null,
  rota_id uuid references public.meli_rotas(id) on delete set null,
  shipment_id text not null,
  tracking_number text not null,
  tipo_evento_interno text not null check (tipo_evento_interno in (
    'RECEBIDO_BASE',
    'TRIADO',
    'CARREGADO',
    'SAIU_ENTREGA',
    'ENTREGUE',
    'INSUCESSO',
    'DEVOLUCAO'
  )),
  event_date timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status_envio text not null default 'REGISTRO_INTERNO' check (status_envio in (
    'REGISTRO_INTERNO',
    'PENDENTE',
    'ENVIANDO',
    'ENVIADO',
    'ERRO',
    'CANCELADO'
  )),
  numero_tentativas integer not null default 0 check (numero_tentativas >= 0),
  resposta_mercado_livre jsonb,
  mensagem_erro text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists meli_tracking_eventos_pendentes_idx
  on public.meli_tracking_eventos (created_at)
  where status_envio in ('PENDENTE', 'ERRO');

create index if not exists meli_tracking_eventos_shipment_idx
  on public.meli_tracking_eventos (shipment_id, event_date desc);

-- Cache por audience para reutilização e renovação preventiva do token.
-- O token deve ser criptografado pela camada server-side antes da persistência.
create table if not exists public.meli_carrier_oauth_tokens (
  audience text primary key,
  access_token_criptografado text not null,
  token_expira_em timestamptz not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (length(btrim(audience)) > 0)
);

alter table public.meli_tracking_eventos enable row level security;
alter table public.meli_carrier_oauth_tokens enable row level security;

revoke all on public.meli_tracking_eventos from public, anon, authenticated;
revoke all on public.meli_carrier_oauth_tokens from public, anon, authenticated;

grant all on public.meli_tracking_eventos to service_role;
grant all on public.meli_carrier_oauth_tokens to service_role;

comment on table public.meli_tracking_eventos is
  'Fila interna inativa de eventos de tracking; envio oficial ainda não implementado.';
comment on table public.meli_carrier_oauth_tokens is
  'Cache server-side criptografado de tokens client_credentials por audience.';

