-- ============================================================================
-- FASE B1 — TELEMETRIA DO WORKER MELI (NÃO APLICADA)
-- Arquivo apenas preparado para revisão. Não executar sem autorização.
-- Nada aqui altera meli_rotas, meli_pacotes, escalas, recebimentos,
-- triagem, RLS operacional existente ou qualquer RPC já publicada.
-- ============================================================================

-- 1) Tabela de execuções do worker
CREATE TABLE IF NOT EXISTS public.meli_worker_execucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  origem text NOT NULL DEFAULT 'worker'
    CHECK (origem IN ('worker', 'extensao', 'manual')),
  worker_versao text,
  sync_batch_id uuid,
  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz,
  duracao_ms integer NOT NULL DEFAULT 0,
  rotas_encontradas integer NOT NULL DEFAULT 0,
  rotas_processadas integer NOT NULL DEFAULT 0,
  pacotes_enviados integer NOT NULL DEFAULT 0,
  erros integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN (
    'sucesso', 'sucesso_parcial', 'erro', 'rate_limit',
    'circuito_pausado', 'sessao_expirada', 'aguardando_autenticacao',
    'jmroutes_sem_sessao'
  )),
  sessao_status text NOT NULL DEFAULT 'ok'
    CHECK (sessao_status IN ('ok', 'expirada', 'ausente')),
  mensagem_segura text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- 2) GRANTs (obrigatórios para o Data API alcançar a tabela)
GRANT SELECT ON public.meli_worker_execucoes TO authenticated;
GRANT ALL ON public.meli_worker_execucoes TO service_role;

-- 3) RLS
ALTER TABLE public.meli_worker_execucoes ENABLE ROW LEVEL SECURITY;

-- 4) Policies — leitura gerencial conforme permissões já existentes.
--    Escrita SOMENTE via RPC SECURITY DEFINER (nenhuma policy de INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS "meli_worker_execucoes_select" ON public.meli_worker_execucoes;
CREATE POLICY "meli_worker_execucoes_select"
  ON public.meli_worker_execucoes
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_base_access(auth.uid(), base_id)
  );

CREATE INDEX IF NOT EXISTS idx_meli_worker_exec_base_data
  ON public.meli_worker_execucoes (base_id, iniciado_em DESC);

-- 5) RPC de registro. Contrato fechado: nenhum campo arbitrário,
--    nenhuma credencial, cookie ou token. Não toca meli_rotas/meli_pacotes.
CREATE OR REPLACE FUNCTION public.meli_worker_registrar_execucao(
  p_base_code text,
  p_worker_versao text,
  p_sync_batch_id uuid,
  p_iniciado_em timestamptz,
  p_finalizado_em timestamptz,
  p_rotas_encontradas integer,
  p_rotas_processadas integer,
  p_pacotes_enviados integer,
  p_erros integer,
  p_status text,
  p_sessao_status text,
  p_mensagem_segura text DEFAULT NULL,
  p_origem text DEFAULT 'worker'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_id uuid;
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  -- Sessão autenticada obrigatória (nunca anon, nunca service_role implícito).
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'nao_autenticado');
  END IF;

  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sem_permissao');
  END IF;

  -- Fase B1: telemetria aceita SOMENTE a base piloto.
  IF upper(btrim(coalesce(p_base_code, ''))) <> 'ESP16' THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'base_fora_do_piloto');
  END IF;

  -- Fase B1: origem aceita SOMENTE 'worker' (campo é apenas auditoria).
  IF coalesce(p_origem, 'worker') <> 'worker' THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'origem_invalida');
  END IF;

  SELECT id INTO v_base_id
  FROM public.bases
  WHERE upper(codigo) = upper(btrim(coalesce(p_base_code, '')))
  LIMIT 1;

  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'base_nao_encontrada');
  END IF;

  IF coalesce(p_status, '') NOT IN (
    'sucesso', 'sucesso_parcial', 'erro', 'rate_limit',
    'circuito_pausado', 'sessao_expirada', 'aguardando_autenticacao',
    'jmroutes_sem_sessao'
  ) THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'status_invalido');
  END IF;

  IF coalesce(p_sessao_status, 'ok') NOT IN ('ok', 'expirada', 'ausente') THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sessao_status_invalido');
  END IF;

  -- Validação real de acesso à base pelo usuário autenticado.
  IF NOT (
    public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'gerente')
    OR public.has_base_access(v_uid, v_base_id)
  ) THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sem_acesso_a_base');
  END IF;

  -- Contadores: NULL é aceito (campo opcional não informado), negativo é REJEITADO.
  -- Nunca converter silenciosamente para zero.
  IF coalesce(p_rotas_encontradas, 0) < 0
     OR coalesce(p_rotas_processadas, 0) < 0
     OR coalesce(p_pacotes_enviados, 0) < 0
     OR coalesce(p_erros, 0) < 0 THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'telemetria_invalida');
  END IF;

  -- duracao_ms é derivada dos timestamps; janela invertida é telemetria inválida.
  v_duracao_ms := (
    EXTRACT(EPOCH FROM (coalesce(p_finalizado_em, now()) - coalesce(p_iniciado_em, now()))) * 1000
  )::int;

  IF v_duracao_ms IS NULL OR v_duracao_ms < 0 THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'telemetria_invalida');
  END IF;

  INSERT INTO public.meli_worker_execucoes (
    base_id, origem, worker_versao, sync_batch_id,
    iniciado_em, finalizado_em, duracao_ms,
    rotas_encontradas, rotas_processadas, pacotes_enviados, erros,
    status, sessao_status, mensagem_segura
  ) VALUES (
    v_base_id,
    'worker',
    left(coalesce(p_worker_versao, ''), 40),
    p_sync_batch_id,
    coalesce(p_iniciado_em, now()),
    p_finalizado_em,
    v_duracao_ms,
    coalesce(p_rotas_encontradas, 0),
    coalesce(p_rotas_processadas, 0),
    coalesce(p_pacotes_enviados, 0),
    coalesce(p_erros, 0),
    p_status,
    coalesce(p_sessao_status, 'ok'),
    left(coalesce(p_mensagem_segura, ''), 240)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'ok', 'execucao_id', v_id, 'base_id', v_base_id);
END;
$$;

REVOKE ALL ON FUNCTION public.meli_worker_registrar_execucao(
  text, text, uuid, timestamptz, timestamptz, integer, integer, integer, integer,
  text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_worker_registrar_execucao(
  text, text, uuid, timestamptz, timestamptz, integer, integer, integer, integer,
  text, text, text, text
) TO authenticated;
