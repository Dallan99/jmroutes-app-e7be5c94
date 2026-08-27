-- ─────────────────────────────────────────────────────────────────────────────
-- P0 — Fundação estrutural da integração Meli (ADITIVA, NÃO DESTRUTIVA).
--
-- NÃO APLICADA. Arquivo versionado como proposta.
-- Observação: supabase/migrations/ é gerenciado pela ferramenta de migration da
-- plataforma e não aceita arquivos criados manualmente; por isso este SQL está
-- em supabase/propostas/ aguardando aprovação explícita para execução.
--
-- Nada aqui altera fluxos operacionais (recebimento, triagem, contagem,
-- auditoria, histórico, bipagem, permissões). Nenhum trigger é criado.
-- Nenhum backfill, delete, rename ou alteração destrutiva.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) meli_pacotes: colunas aditivas (tracking_id permanece intacto)
ALTER TABLE public.meli_pacotes
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS facility text,
  ADD COLUMN IF NOT EXISTS service_center_id text,
  ADD COLUMN IF NOT EXISTS integration_source text NOT NULL DEFAULT 'adminml';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meli_pacotes_integration_source_check'
      AND conrelid = 'public.meli_pacotes'::regclass
  ) THEN
    ALTER TABLE public.meli_pacotes
      ADD CONSTRAINT meli_pacotes_integration_source_check
      CHECK (integration_source IN ('adminml', 'meli_carrier_api', 'manual'));
  END IF;
END $$;

-- 2) meli_rotas: colunas aditivas (vehicle_license preservada; sem veiculo_id
--    porque não existe entidade canônica de veículos no JM)
ALTER TABLE public.meli_rotas
  ADD COLUMN IF NOT EXISTS service_center_id text,
  ADD COLUMN IF NOT EXISTS integration_source text NOT NULL DEFAULT 'adminml',
  ADD COLUMN IF NOT EXISTS motorista_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meli_rotas_integration_source_check'
      AND conrelid = 'public.meli_rotas'::regclass
  ) THEN
    ALTER TABLE public.meli_rotas
      ADD CONSTRAINT meli_rotas_integration_source_check
      CHECK (integration_source IN ('adminml', 'meli_carrier_api', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meli_rotas_motorista_id_fkey'
      AND conrelid = 'public.meli_rotas'::regclass
  ) THEN
    ALTER TABLE public.meli_rotas
      ADD CONSTRAINT meli_rotas_motorista_id_fkey
      FOREIGN KEY (motorista_id) REFERENCES public.motoristas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Outbox interna de eventos de rastreio (nada é enviado nesta fase)
CREATE TABLE IF NOT EXISTS public.meli_tracking_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text,
  tracking_number text,
  rota_id uuid NULL REFERENCES public.meli_rotas(id) ON DELETE SET NULL,
  meli_pacote_id uuid NULL REFERENCES public.meli_pacotes(id) ON DELETE SET NULL,
  tipo_evento text NOT NULL CHECK (tipo_evento IN (
    'RECEBIDO_BASE', 'TRIADO', 'CARREGADO', 'SAIU_ENTREGA', 'ENTREGUE', 'INSUCESSO', 'DEVOLUCAO'
  )),
  event_date timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_envio text NOT NULL DEFAULT 'NAO_ENVIAR' CHECK (status_envio IN (
    'NAO_ENVIAR', 'PENDENTE', 'PROCESSANDO', 'ENVIADO', 'ERRO'
  )),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  resposta_meli jsonb,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT meli_tracking_eventos_identificador_check
    CHECK (shipment_id IS NOT NULL OR tracking_number IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS meli_tracking_eventos_shipment_id_idx
  ON public.meli_tracking_eventos (shipment_id);
CREATE INDEX IF NOT EXISTS meli_tracking_eventos_tracking_number_idx
  ON public.meli_tracking_eventos (tracking_number);
CREATE INDEX IF NOT EXISTS meli_tracking_eventos_status_created_idx
  ON public.meli_tracking_eventos (status_envio, created_at);
CREATE INDEX IF NOT EXISTS meli_tracking_eventos_rota_id_idx
  ON public.meli_tracking_eventos (rota_id);

-- Tabela server-only: RLS habilitada e nenhuma policy de cliente.
ALTER TABLE public.meli_tracking_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.meli_tracking_eventos FROM anon;
REVOKE ALL ON public.meli_tracking_eventos FROM authenticated;
GRANT ALL ON public.meli_tracking_eventos TO service_role;
