-- 1. Tipos e Tabelas
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meli_romaneio_status') THEN
        CREATE TYPE public.meli_romaneio_status AS ENUM ('em_andamento', 'concluido', 'cancelado');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.meli_devolucao_romaneios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE NOT NULL,
    base_id UUID NOT NULL REFERENCES public.bases(id),
    data_operacional DATE NOT NULL,
    sequencial INTEGER NOT NULL CHECK (sequencial > 0),
    status public.meli_romaneio_status NOT NULL DEFAULT 'em_andamento',
    route_id TEXT,
    motorista TEXT,
    observacao_inicial TEXT,
    aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    aberto_por UUID NOT NULL REFERENCES auth.users(id),
    concluido_em TIMESTAMPTZ,
    concluido_por UUID REFERENCES auth.users(id),
    cancelado_em TIMESTAMPTZ,
    cancelado_por UUID REFERENCES auth.users(id),
    justificativa_cancelamento TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meli_romaneio_sequencial_unico UNIQUE (base_id, data_operacional, sequencial),
    CONSTRAINT meli_romaneio_formato_codigo CHECK (codigo ~ '^EXP-REC-\d{8}-[A-Z0-9]+-\d{3}$'),
    CONSTRAINT meli_romaneio_coerencia_status CHECK (
        (status = 'em_andamento' AND concluido_em IS NULL AND concluido_por IS NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'concluido' AND concluido_em IS NOT NULL AND concluido_por IS NOT NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'cancelado' AND cancelado_em IS NOT NULL AND cancelado_por IS NOT NULL AND justificativa_cancelamento IS NOT NULL AND concluido_em IS NULL AND concluido_por IS NULL)
    )
);

ALTER TABLE public.meli_devolucoes 
ADD COLUMN IF NOT EXISTS romaneio_id UUID REFERENCES public.meli_devolucao_romaneios(id);

-- Índices
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_base_data_status ON public.meli_devolucao_romaneios(base_id, data_operacional, status);
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_codigo ON public.meli_devolucao_romaneios(codigo);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_romaneio_id ON public.meli_devolucoes(romaneio_id);

-- Trigger updated_at
CREATE TRIGGER trg_meli_devolucao_romaneios_updated_at
    BEFORE UPDATE ON public.meli_devolucao_romaneios
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 2. Segurança e RLS
ALTER TABLE public.meli_devolucao_romaneios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meli_devolucao_romaneios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meli_devolucao_romaneios TO authenticated;
GRANT ALL ON public.meli_devolucao_romaneios TO service_role;

CREATE POLICY "Romaneios visiveis por base ou admin" 
ON public.meli_devolucao_romaneios
FOR SELECT 
TO authenticated
USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR 
    public.has_base_access(auth.uid(), base_id)
);

-- 3. Função Interna de Recebimento (Encapsulada)
CREATE OR REPLACE FUNCTION public.internal_meli_devolucao_processar_bip(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT,
    p_usuario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r public.meli_devolucao_romaneios;
    v_d public.meli_devolucoes;
    v_delivered BOOLEAN;
    v_estado_novo TEXT;
BEGIN
    -- Lock no romaneio
    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_invalido', 'mensagem', 'Romaneio não encontrado.');
    END IF;

    IF v_r.status <> 'em_andamento' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_fechado', 'mensagem', 'Este romaneio não permite novas bipagens.');
    END IF;

    IF v_r.base_id <> p_base_id THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_invalida', 'mensagem', 'Base informada não coincide com a base do romaneio.');
    END IF;

    -- Lock no pacote
    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;

    IF v_d.id IS NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (upper(btrim(p_tracking_id)), p_base_id, 'pacote_desconhecido', jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrado', 'mensagem', 'Pacote não encontrado nos registros do Meli.');
    END IF;

    IF v_d.base_id <> p_base_id THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'base_divergente', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'base_lida', p_base_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente', 'mensagem', 'Este pacote pertence a outra base.');
    END IF;

    IF v_d.romaneio_id IS NOT NULL OR v_d.recebido_em IS NOT NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'bipagem_duplicada', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'romaneio_original', v_d.romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado', 'mensagem', 'Este pacote já foi recebido.');
    END IF;

    v_delivered := lower(coalesce(v_d.situacao_meli, '')) IN ('entregue', 'delivered');

    IF v_delivered AND coalesce(btrim(p_observacao), '') = '' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria', 'mensagem', 'Pacote consta como entregue. Observação obrigatória.');
    END IF;

    v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

    UPDATE public.meli_devolucoes
    SET romaneio_id = p_romaneio_id,
        estado = v_estado_novo,
        recebido_em = now(),
        recebido_por = p_usuario_id,
        recebido_base_id = p_base_id,
        metodo_confirmacao = 'scanner',
        divergencia_delivered = v_delivered,
        observacao_recebimento = nullif(btrim(p_observacao), '')
    WHERE id = v_d.id;

    INSERT INTO public.meli_devolucoes_eventos (
        devolucao_id, tracking_id, base_id, tipo, 
        estado_anterior, estado_novo, detalhes, registrado_por
    )
    VALUES (
        v_d.id, v_d.tracking_id, v_d.base_id, 
        CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'bipagem_ok' END,
        v_d.estado, v_estado_novo, jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id
    );

    RETURN jsonb_build_object('status', 'ok', 'tracking_id', v_d.tracking_id, 'divergencia_delivered', v_delivered);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_meli_devolucao_processar_bip FROM PUBLIC, anon, authenticated;

-- 4. RPCs Externas
CREATE OR REPLACE FUNCTION public.meli_romaneio_abrir_com_primeiro_pacote(
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_hoje DATE := timezone('America/Sao_Paulo', now())::date;
    v_base_codigo TEXT;
    v_sequencial INT;
    v_romaneio_id UUID;
    v_romaneio_codigo TEXT;
    v_d RECORD;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    -- Lock por base e data
    PERFORM pg_advisory_xact_lock(hashtext('meli_romaneio_seq_' || p_base_id::text || '_' || v_hoje::text));

    SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
    IF v_base_codigo IS NULL OR v_base_codigo = '' THEN RAISE EXCEPTION 'Código da base não encontrado'; END IF;

    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;
    IF v_d.id IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;

    SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_sequencial
    FROM public.meli_devolucao_romaneios
    WHERE base_id = p_base_id AND data_operacional = v_hoje;

    v_romaneio_codigo := 'EXP-REC-' || to_char(v_hoje, 'YYYYMMDD') || '-' || v_base_codigo || '-' || LPAD(v_sequencial::TEXT, 3, '0');

    INSERT INTO public.meli_devolucao_romaneios (
        codigo, base_id, data_operacional, sequencial, 
        route_id, motorista, aberto_por
    )
    VALUES (
        v_romaneio_codigo, p_base_id, v_hoje, v_sequencial,
        v_d.route_id, v_d.motorista, v_uid
    )
    RETURNING id INTO v_romaneio_id;

    v_res := public.internal_meli_devolucao_processar_bip(v_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
    
    IF v_res->>'status' = 'erro' THEN
        RAISE EXCEPTION '%', v_res->>'mensagem';
    END IF;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (p_base_id, 'romaneio_aberto', jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo', v_romaneio_codigo), v_uid);

    RETURN v_res || jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo_romaneio', v_romaneio_codigo);
END;
$$;

-- Aplicação de Permissões nas RPCs
DO $$ 
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_abrir_com_primeiro_pacote']; -- Adicionar outras conforme implementadas
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;

-- Continuação das RPCs Externas

CREATE OR REPLACE FUNCTION public.meli_romaneio_bipar(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    RETURN public.internal_meli_devolucao_processar_bip(p_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_finalizar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT public.has_base_access(v_uid, v_r.base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    IF v_r.status = 'concluido' THEN
        RETURN jsonb_build_object('status', 'ok', 'mensagem', 'Romaneio já estava concluído.');
    END IF;

    IF v_r.status = 'cancelado' THEN RAISE EXCEPTION 'Não é possível finalizar um romaneio cancelado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'concluido',
        concluido_em = now(),
        concluido_por = v_uid
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_finalizado', jsonb_build_object('romaneio_id', p_romaneio_id), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_cancelar(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'gerente')) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem cancelar romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'cancelado',
        cancelado_em = now(),
        cancelado_por = v_uid,
        justificativa_cancelamento = p_justificativa
    WHERE id = p_romaneio_id;

    -- Opcional: desvincular pacotes ou mantê-los vinculados ao romaneio cancelado?
    -- Decisão: Mantemos o vínculo para auditoria, mas o estado do pacote permanece 'recebido' 
    -- a menos que explicitamente revertido.

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_cancelado', jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- Permissões Adicionais
DO $$ 
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_bipar', 'meli_romaneio_finalizar', 'meli_romaneio_cancelar'];
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.meli_romaneios_listar(
    p_base_id UUID DEFAULT NULL,
    p_data_de DATE DEFAULT NULL,
    p_data_ate DATE DEFAULT NULL,
    p_status public.meli_romaneio_status DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    codigo TEXT,
    base_id UUID,
    base_codigo TEXT,
    data_operacional DATE,
    sequencial INTEGER,
    status public.meli_romaneio_status,
    route_id TEXT,
    motorista TEXT,
    aberto_em TIMESTAMPTZ,
    aberto_por_nome TEXT,
    total_pacotes BIGINT,
    concluido_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.codigo,
        r.base_id,
        b.codigo as base_codigo,
        r.data_operacional,
        r.sequencial,
        r.status,
        r.route_id,
        r.motorista,
        r.aberto_em,
        p.nome as aberto_por_nome,
        (SELECT count(*) FROM public.meli_devolucoes d WHERE d.romaneio_id = r.id) as total_pacotes,
        r.concluido_em
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    WHERE (p_base_id IS NULL OR r.base_id = p_base_id)
      AND (p_data_de IS NULL OR r.data_operacional >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_operacional <= p_data_ate)
      AND (p_status IS NULL OR r.status = p_status)
      AND (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), r.base_id))
    ORDER BY r.aberto_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_detalhar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r RECORD;
    v_pacotes JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT 
        r.*, 
        b.codigo as base_codigo, 
        p.nome as aberto_por_nome,
        pc.nome as concluido_por_nome
    INTO v_r
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    LEFT JOIN public.profiles pc ON pc.id = r.concluido_por
    WHERE r.id = p_romaneio_id;

    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), v_r.base_id)) THEN
        RAISE EXCEPTION 'Sem acesso a este romaneio';
    END IF;

    SELECT jsonb_agg(t) INTO v_pacotes
    FROM (
        SELECT 
            d.tracking_id, d.estado, d.recebido_em, d.divergencia_delivered, d.observacao_recebimento,
            d.meli_status, d.meli_substatus, d.occurrence_code
        FROM public.meli_devolucoes d
        WHERE d.romaneio_id = p_romaneio_id
        ORDER BY d.recebido_em DESC
    ) t;

    RETURN to_jsonb(v_r) || jsonb_build_object('pacotes', coalesce(v_pacotes, '[]'::jsonb));
END;
$$;

-- Permissões
REVOKE ALL ON FUNCTION public.meli_romaneios_listar FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_romaneios_listar TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.meli_romaneio_detalhar FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_romaneio_detalhar TO authenticated, service_role;
