-- Corrige violação de NOT NULL em meli_devolucoes_eventos.tracking_id
-- nos eventos de nível de romaneio (abrir/finalizar/cancelar/reabrir).

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

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_romaneio_codigo, p_base_id, 'romaneio_aberto',
            jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo', v_romaneio_codigo), v_uid);

    RETURN v_res || jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo_romaneio', v_romaneio_codigo);
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

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_finalizado', jsonb_build_object('romaneio_id', p_romaneio_id), v_uid);

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
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gerente'::public.app_role)) THEN
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

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_cancelado',
            jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_reabrir(p_romaneio_id UUID, p_justificativa TEXT)
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
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gerente'::public.app_role)) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem reabrir romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'em_andamento',
        concluido_em = NULL,
        concluido_por = NULL,
        cancelado_em = NULL,
        cancelado_por = NULL,
        justificativa_cancelamento = NULL
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_reaberto',
            jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

DO $$
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_abrir_com_primeiro_pacote', 'meli_romaneio_finalizar', 'meli_romaneio_cancelar', 'meli_romaneio_reabrir'];
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;