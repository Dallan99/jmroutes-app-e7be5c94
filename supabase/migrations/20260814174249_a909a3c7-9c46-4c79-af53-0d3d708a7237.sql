-- Migração: Recebimento Automático em Devoluções
-- Adiciona a coluna recebimento_id e a função de geração de sequência.

ALTER TABLE public.meli_devolucoes ADD COLUMN IF NOT EXISTS recebimento_id text;
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_recebimento_id ON public.meli_devolucoes(recebimento_id);

-- Função para gerar o próximo ID de recebimento (ex: REC20260814001)
CREATE OR REPLACE FUNCTION public.gerar_sequencia_recebimento(p_base_id uuid, p_data date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_count int;
  v_rec_id text;
BEGIN
  v_prefix := 'REC' || to_char(p_data, 'YYYYMMDD');
  
  -- Conta quantos IDs de recebimento diferentes já foram gerados nesta base e dia
  SELECT count(DISTINCT recebimento_id) INTO v_count
  FROM public.meli_devolucoes
  WHERE base_id = p_base_id
    AND (recebido_em AT TIME ZONE 'America/Sao_Paulo')::date = p_data
    AND recebimento_id LIKE v_prefix || '%';

  v_rec_id := v_prefix || lpad((v_count + 1)::text, 3, '0');
  RETURN v_rec_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_sequencia_recebimento(uuid, date) TO authenticated, service_role;

-- Atualiza a RPC de recebimento para aceitar o p_recebimento_id
CREATE OR REPLACE FUNCTION public.meli_devolucao_receber(
  p_tracking text,
  p_base_id uuid,
  p_metodo text DEFAULT 'scanner',
  p_observacao text DEFAULT NULL,
  p_recebimento_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tracking text := upper(btrim(coalesce(p_tracking, '')));
  v_d public.meli_devolucoes;
  v_delivered boolean;
  v_estado_novo text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_autenticado', 'mensagem', 'Não autenticado.');
  END IF;
  IF v_tracking = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'invalido', 'mensagem', 'Informe o código de rastreio.');
  END IF;
  IF p_base_id IS NULL OR NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base', 'mensagem', 'Sem acesso à base informada.');
  END IF;

  SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = v_tracking;

  IF v_d.id IS NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_tracking, p_base_id, 'recebimento_sem_devolucao',
            jsonb_build_object('metodo', p_metodo), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrada',
      'mensagem', 'Nenhuma devolução pendente para este rastreio.');
  END IF;

  IF NOT public.has_base_access(v_uid, v_d.base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base',
      'mensagem', 'Sem acesso à base de origem deste pacote.');
  END IF;

  IF v_d.recebido_em IS NOT NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_duplicado', v_d.estado, v_d.estado,
            jsonb_build_object('metodo', p_metodo, 'recebido_em_original', v_d.recebido_em), v_uid);
    RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado',
      'mensagem', 'Este pacote já foi recebido na base.',
      'devolucao', to_jsonb(v_d));
  END IF;

  IF v_d.base_id <> p_base_id THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_base_divergente', v_d.estado,
            jsonb_build_object('base_informada', p_base_id, 'base_esperada', v_d.base_id), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente',
      'mensagem', 'Base receptora diferente da base de origem esperada.',
      'base_esperada', (SELECT codigo FROM public.bases WHERE id = v_d.base_id));
  END IF;

  v_delivered := coalesce(v_d.situacao_meli, '') = 'entregue';

  IF v_delivered AND coalesce(btrim(coalesce(p_observacao, '')), '') = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria',
      'mensagem', 'Pacote consta como entregue. Observação do operador é obrigatória.');
  END IF;

  v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

  UPDATE public.meli_devolucoes
     SET estado = v_estado_novo,
         recebido_em = now(),
         recebido_por = v_uid,
         recebido_base_id = p_base_id,
         recebimento_id = p_recebimento_id,
         metodo_confirmacao = coalesce(nullif(btrim(p_metodo), ''), 'scanner'),
         observacao_recebimento = nullif(btrim(coalesce(p_observacao, '')), ''),
         divergencia_delivered = v_delivered
   WHERE id = v_d.id;

  INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
  VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_fisico', v_d.estado, v_estado_novo,
          jsonb_build_object('metodo', p_metodo, 'recebimento_id', p_recebimento_id, 'observacao', nullif(btrim(coalesce(p_observacao, '')), ''),
                             'situacao_meli', v_d.situacao_meli), v_uid);

  RETURN jsonb_build_object('status', 'ok', 'codigo', v_estado_novo,
    'divergencia_delivered', v_delivered,
    'no_prazo', now() <= v_d.prazo_retorno_em,
    'mensagem', CASE WHEN v_delivered
      THEN 'ALERTA CRÍTICO: pacote recebido fisicamente, porém consta ENTREGUE. Encaminhe para prevenção de perdas.'
      ELSE 'Retorno registrado na base.' END,
    'devolucao', (SELECT to_jsonb(d) FROM public.meli_devolucoes d WHERE d.id = v_d.id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text, text) TO authenticated, service_role;
