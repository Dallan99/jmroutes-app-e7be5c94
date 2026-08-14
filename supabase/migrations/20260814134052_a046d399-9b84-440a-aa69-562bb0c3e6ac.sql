-- ─────────────────────────────────────────────────────────────────────────────
-- Lotes de devolução automáticos + motivo real do Meli
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devolucao_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nome_exibicao text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  sequencia integer NOT NULL,
  estado text NOT NULL DEFAULT 'aberta',
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_por uuid,
  finalizado_em timestamptz,
  reaberto_por uuid,
  reaberto_em timestamptz,
  reabertura_justificativa text,
  total_pacotes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devolucao_lotes_estado_chk CHECK (estado IN ('aberta','finalizada')),
  CONSTRAINT devolucao_lotes_seq_uk UNIQUE (base_id, data_operacional, sequencia),
  CONSTRAINT devolucao_lotes_codigo_uk UNIQUE (codigo)
);

GRANT SELECT ON public.devolucao_lotes TO authenticated;
GRANT ALL ON public.devolucao_lotes TO service_role;
REVOKE ALL ON public.devolucao_lotes FROM anon;
REVOKE ALL ON public.devolucao_lotes FROM PUBLIC;

ALTER TABLE public.devolucao_lotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lotes visiveis por base permitida" ON public.devolucao_lotes;
CREATE POLICY "lotes visiveis por base permitida"
  ON public.devolucao_lotes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

DROP TRIGGER IF EXISTS trg_devolucao_lotes_updated_at ON public.devolucao_lotes;
CREATE TRIGGER trg_devolucao_lotes_updated_at
  BEFORE UPDATE ON public.devolucao_lotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Devoluções: vínculo com lote + ocorrência real do Meli + correção manual
ALTER TABLE public.devolucoes
  ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES public.devolucao_lotes(id),
  ADD COLUMN IF NOT EXISTS occurrence_code text,
  ADD COLUMN IF NOT EXISTS meli_status text,
  ADD COLUMN IF NOT EXISTS meli_substatus text,
  ADD COLUMN IF NOT EXISTS motivo_descricao text,
  ADD COLUMN IF NOT EXISTS tratamento text,
  ADD COLUMN IF NOT EXISTS divergencia_delivered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_original motivo_devolucao,
  ADD COLUMN IF NOT EXISTS motivo_corrigido motivo_devolucao,
  ADD COLUMN IF NOT EXISTS correcao_justificativa text,
  ADD COLUMN IF NOT EXISTS corrigido_por uuid,
  ADD COLUMN IF NOT EXISTS corrigido_em timestamptz;

CREATE INDEX IF NOT EXISTS devolucoes_lote_id_idx ON public.devolucoes(lote_id);

-- Mapa ocorrência Meli -> motivo/tratamento/descrição
CREATE OR REPLACE FUNCTION public.devolucao_motivo_do_meli(p_codigo text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(trim(p_codigo), ''))
    WHEN 'buyer_absent' THEN jsonb_build_object('motivo','cliente_ausente','descricao','Cliente ausente','tratamento','retorno_obrigatorio')
    WHEN 'buyer_rejected' THEN jsonb_build_object('motivo','recusado','descricao','Recusado pelo cliente','tratamento','retorno_obrigatorio')
    WHEN 'business_closed' THEN jsonb_build_object('motivo','comercio_fechado','descricao','Comércio fechado','tratamento','retorno_obrigatorio')
    WHEN 'unvisited_address' THEN jsonb_build_object('motivo','endereco_nao_localizado','descricao','Endereço não visitado','tratamento','retorno_obrigatorio')
    WHEN 'damaged' THEN jsonb_build_object('motivo','avaria','descricao','Pacote avariado','tratamento','retorno_obrigatorio')
    WHEN 'bad_address' THEN jsonb_build_object('motivo','endereco_nao_localizado','descricao','Endereço incorreto/incompleto','tratamento','retorno_obrigatorio')
    WHEN 'missrouted' THEN jsonb_build_object('motivo','outros','descricao','Fora da região','tratamento','retorno_obrigatorio')
    WHEN 'blocked_by_keyword' THEN jsonb_build_object('motivo','zona_de_risco','descricao','Bloqueio operacional','tratamento','retorno_obrigatorio')
    WHEN 'missing' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação','tratamento','investigacao')
    WHEN 'lost' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação','tratamento','investigacao')
    WHEN 'stolen' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação (roubo)','tratamento','investigacao')
    WHEN 'transferred' THEN jsonb_build_object('motivo','outros','descricao','Transferido','tratamento','transferencia')
    ELSE jsonb_build_object('motivo','outros','descricao','Revisão necessária — ocorrência não reconhecida','tratamento','revisao_necessaria')
  END
$$;

REVOKE ALL ON FUNCTION public.devolucao_motivo_do_meli(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolucao_motivo_do_meli(text) TO authenticated, service_role;

-- Criar lote com sequência atômica por base + data
CREATE OR REPLACE FUNCTION public.devolucao_lote_criar(p_base_id uuid, p_data_operacional date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_base_codigo text;
  v_seq integer;
  v_nome text;
  v_codigo text;
  v_aberto public.devolucao_lotes;
  v_novo public.devolucao_lotes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  IF NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso a esta base.');
  END IF;

  SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
  IF v_base_codigo IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Base não encontrada.');
  END IF;

  SELECT * INTO v_aberto FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional AND estado = 'aberta'
   ORDER BY sequencia DESC LIMIT 1;
  IF v_aberto.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','ja_aberto','lote', to_jsonb(v_aberto));
  END IF;

  -- Bloqueio contra concorrência: serializa a geração por base + data
  PERFORM pg_advisory_xact_lock(hashtext(p_base_id::text || '|' || p_data_operacional::text));

  SELECT coalesce(max(sequencia), 0) + 1 INTO v_seq
    FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional;

  v_nome := 'EXP - REC ' || to_char(p_data_operacional, 'DD/MM/YYYY') || ' ' || v_base_codigo
            || ' - ' || lpad(v_seq::text, 3, '0');
  v_codigo := 'EXPREC' || to_char(p_data_operacional, 'YYYYMMDD') || v_base_codigo
            || lpad(v_seq::text, 3, '0');

  INSERT INTO public.devolucao_lotes (codigo, nome_exibicao, base_id, data_operacional, sequencia, estado, criado_por)
  VALUES (v_codigo, v_nome, p_base_id, p_data_operacional, v_seq, 'aberta', v_uid)
  RETURNING * INTO v_novo;

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_novo));
END;
$$;

-- Lote aberto atual
CREATE OR REPLACE FUNCTION public.devolucao_lote_aberto(p_base_id uuid, p_data_operacional date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_criador text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso a esta base.');
  END IF;

  SELECT * INTO v_lote FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional AND estado = 'aberta'
   ORDER BY sequencia DESC LIMIT 1;

  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','sem_lote');
  END IF;

  SELECT nome INTO v_criador FROM public.profiles WHERE id = v_lote.criado_por;
  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote) || jsonb_build_object('criado_por_nome', v_criador));
END;
$$;

-- Bipagem no lote com motivo automático do Meli
CREATE OR REPLACE FUNCTION public.devolucao_lote_bipar(p_lote_id uuid, p_codigo text, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_pac record;
  v_map jsonb;
  v_motivo motivo_devolucao;
  v_tratamento text;
  v_descricao text;
  v_diverg boolean := false;
  v_existente record;
  v_base_certa text;
  v_ins public.devolucoes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  IF v_cod = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Informe o tracking do pacote.');
  END IF;

  SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado.');
  END IF;
  IF NOT public.has_base_access(v_uid, v_lote.base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso à base do lote.');
  END IF;
  IF v_lote.estado <> 'aberta' THEN
    RETURN jsonb_build_object('status','lote_finalizado','mensagem','Este lote já foi finalizado. Crie uma nova devolução.');
  END IF;

  -- Duplicidade na base (independente do lote)
  SELECT d.id, d.devolvido_em, d.lote_id INTO v_existente
    FROM public.devolucoes d
   WHERE upper(d.shipment_codigo) = v_cod AND d.base_id = v_lote.base_id AND d.cancelado = false
   ORDER BY d.devolvido_em DESC LIMIT 1;
  IF v_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicado','mensagem','Pacote ' || v_cod || ' já recebido nesta base.',
                              'devolvido_em', v_existente.devolvido_em);
  END IF;

  -- Pacote importado do Meli (última atualização vence)
  SELECT p.occurrence_code, p.status, p.substatus, r.base_id AS rota_base_id,
         r.route_id, r.driver_name
    INTO v_pac
    FROM public.meli_pacotes p
    JOIN public.meli_rotas r ON r.id = p.rota_id
   WHERE upper(p.tracking_id) = v_cod OR upper(coalesce(p.shipment_id,'')) = v_cod
   ORDER BY p.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_pac IS NOT NULL AND v_pac.rota_base_id IS NOT NULL AND v_pac.rota_base_id <> v_lote.base_id THEN
    SELECT codigo INTO v_base_certa FROM public.bases WHERE id = v_pac.rota_base_id;
    RETURN jsonb_build_object('status','base_divergente',
      'mensagem','Pacote pertence à base ' || coalesce(v_base_certa,'?') || '. Receba na base correta.',
      'base_correta', v_base_certa);
  END IF;

  v_map := public.devolucao_motivo_do_meli(v_pac.occurrence_code);
  v_motivo := (v_map->>'motivo')::motivo_devolucao;
  v_descricao := v_map->>'descricao';
  v_tratamento := v_map->>'tratamento';

  IF v_pac IS NULL THEN
    v_tratamento := 'revisao_necessaria';
    v_descricao := 'Pacote sem ocorrência Meli elegível — revisão necessária';
  ELSIF coalesce(v_pac.occurrence_code,'') = '' THEN
    v_tratamento := 'revisao_necessaria';
    v_descricao := 'Pacote sem ocorrência Meli elegível — revisão necessária';
  END IF;

  IF lower(coalesce(v_pac.status,'')) = 'delivered' THEN
    v_diverg := true;
    IF coalesce(trim(p_observacao), '') = '' THEN
      RETURN jsonb_build_object('status','observacao_obrigatoria',
        'mensagem','ALERTA CRÍTICO: o Meli marca este pacote como ENTREGUE. Informe uma observação para registrar a divergência.',
        'motivo', v_motivo, 'motivo_descricao', v_descricao, 'occurrence_code', v_pac.occurrence_code);
    END IF;
  END IF;

  INSERT INTO public.devolucoes (
    base_id, lote_id, shipment_codigo, rota, motorista, motivo, motivo_original,
    observacao, devolvido_por, occurrence_code, meli_status, meli_substatus,
    motivo_descricao, tratamento, divergencia_delivered
  ) VALUES (
    v_lote.base_id, v_lote.id, v_cod, v_pac.route_id, v_pac.driver_name, v_motivo, v_motivo,
    nullif(trim(coalesce(p_observacao,'')), ''), v_uid, v_pac.occurrence_code, v_pac.status,
    v_pac.substatus, v_descricao, v_tratamento, v_diverg
  ) RETURNING * INTO v_ins;

  UPDATE public.devolucao_lotes
     SET total_pacotes = (SELECT count(*) FROM public.devolucoes WHERE lote_id = v_lote.id AND cancelado = false)
   WHERE id = v_lote.id;

  RETURN jsonb_build_object('status','ok',
    'mensagem','Pacote ' || v_cod || ' registrado — ' || v_descricao,
    'devolucao', to_jsonb(v_ins),
    'total_pacotes', (SELECT total_pacotes FROM public.devolucao_lotes WHERE id = v_lote.id));
END;
$$;

-- Finalizar lote com resumo por ocorrência
CREATE OR REPLACE FUNCTION public.devolucao_lote_finalizar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_resumo jsonb;
  v_trackings jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  IF v_lote.id IS NULL OR NOT public.has_base_access(v_uid, v_lote.base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado ou sem acesso.');
  END IF;

  UPDATE public.devolucao_lotes
     SET estado = 'finalizada', finalizado_por = v_uid, finalizado_em = now(),
         total_pacotes = (SELECT count(*) FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false)
   WHERE id = p_lote_id AND estado = 'aberta'
   RETURNING * INTO v_lote;

  IF v_lote.id IS NULL THEN
    SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  END IF;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_resumo FROM (
    SELECT jsonb_build_object('occurrence_code', coalesce(occurrence_code,'—'),
                              'motivo_descricao', coalesce(motivo_descricao,'—'),
                              'total', count(*)) AS x
      FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false
     GROUP BY 1,2 ORDER BY 1
  ) s;

  SELECT coalesce(jsonb_agg(shipment_codigo ORDER BY devolvido_em), '[]'::jsonb) INTO v_trackings
    FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false;

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote), 'resumo', v_resumo, 'trackings', v_trackings);
END;
$$;

-- Reabrir lote: somente administrador, com justificativa
CREATE OR REPLACE FUNCTION public.devolucao_lote_reabrir(p_lote_id uuid, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('status','erro','mensagem','Somente administrador pode reabrir um lote.');
  END IF;
  IF coalesce(trim(p_justificativa), '') = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Justificativa obrigatória.');
  END IF;

  UPDATE public.devolucao_lotes
     SET estado = 'aberta', reaberto_por = v_uid, reaberto_em = now(),
         reabertura_justificativa = trim(p_justificativa)
   WHERE id = p_lote_id
   RETURNING * INTO v_lote;

  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado.');
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'devolucao_lote_reaberto', 'devolucao_lotes', p_lote_id::text,
          jsonb_build_object('justificativa', trim(p_justificativa)));

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote));
END;
$$;

-- Correção manual do motivo: somente administrador, preserva o original do Meli
CREATE OR REPLACE FUNCTION public.devolucao_corrigir_motivo(p_devolucao_id uuid, p_motivo text, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.devolucoes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('status','erro','mensagem','Somente administrador pode corrigir o motivo.');
  END IF;
  IF coalesce(trim(p_justificativa), '') = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Justificativa obrigatória.');
  END IF;

  UPDATE public.devolucoes
     SET motivo_original = coalesce(motivo_original, motivo),
         motivo_corrigido = p_motivo::motivo_devolucao,
         motivo = p_motivo::motivo_devolucao,
         correcao_justificativa = trim(p_justificativa),
         corrigido_por = v_uid,
         corrigido_em = now()
   WHERE id = p_devolucao_id
   RETURNING * INTO v_dev;

  IF v_dev.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Devolução não encontrada.');
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'devolucao_motivo_corrigido', 'devolucoes', p_devolucao_id::text,
          jsonb_build_object('motivo_original', v_dev.motivo_original,
                             'motivo_corrigido', v_dev.motivo_corrigido,
                             'occurrence_code', v_dev.occurrence_code,
                             'justificativa', trim(p_justificativa)));

  RETURN jsonb_build_object('status','ok','devolucao', to_jsonb(v_dev));
END;
$$;

REVOKE ALL ON FUNCTION public.devolucao_lote_criar(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_aberto(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_bipar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_finalizar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_reabrir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_corrigir_motivo(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.devolucao_lote_criar(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_aberto(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_bipar(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_finalizar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_reabrir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_corrigir_motivo(uuid, text, text) TO authenticated, service_role;