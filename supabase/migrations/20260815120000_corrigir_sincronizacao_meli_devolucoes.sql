-- Corrige a classificacao e a reconciliacao estrutural de Devolucoes.
-- Esta migration redefine a RPC publica existente, mas nao a executa.

ALTER TABLE public.meli_devolucoes
  ALTER COLUMN prazo_retorno_em DROP NOT NULL;

UPDATE public.meli_devolucoes
   SET prazo_retorno_em = NULL
 WHERE estado <> 'aguardando_retorno'
   AND prazo_retorno_em IS NOT NULL;

CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 7);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_criadas integer := 0;
  v_atualizadas integer := 0;
  v_reconciliadas integer := 0;
  v_revisao integer := 0;
  v_conflitos_base integer := 0;
  v_eventos integer := 0;
  v_base record;
  v_item record;
  v_atual public.meli_devolucoes%ROWTYPE;
  v_codigo text;
  v_estado_novo text;
  v_prazo_novo timestamptz;
  v_ocorrido_novo timestamptz;
  v_situacao_nova text;
  v_inseriu boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Usuario nao autenticado.';
  END IF;
  IF v_de > v_ate THEN
    RAISE EXCEPTION USING ERRCODE = '22007', MESSAGE = 'Intervalo de datas invalido.';
  END IF;
  IF p_base_id IS NOT NULL AND NOT public.has_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Usuario sem acesso a base solicitada.';
  END IF;

  -- Trava todas as bases antes da primeira escrita e sempre na mesma ordem.
  FOR v_base IN
    SELECT DISTINCT ro.base_id
      FROM public.meli_rotas_ativas ro
     WHERE ro.base_id IS NOT NULL
       AND ro.data_rota BETWEEN v_de AND v_ate
       AND public.has_base_access(v_uid, ro.base_id)
       AND (p_base_id IS NULL OR ro.base_id = p_base_id)
     ORDER BY ro.base_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('meli_devolucoes_sincronizar:' || v_base.base_id::text, 0)
    );
  END LOOP;

  FOR v_item IN
    WITH candidatos AS (
      SELECT DISTINCT ON (ro.base_id, p.tracking_id)
             p.tracking_id,
             lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) AS codigo_bruto,
             lower(btrim(coalesce(p.status, ''))) AS status_normalizado,
             p.status, p.substatus,
             coalesce(p.last_synced_at, p.updated_at, p.created_at) AS ocorrido_em,
             p.last_synced_at, ro.id AS rota_id, ro.route_id, ro.cluster,
             ro.base_id, ro.driver_name, ro.carrier
        FROM public.meli_pacotes p
        JOIN public.meli_rotas_ativas ro ON ro.id = p.rota_id
       WHERE ro.base_id IS NOT NULL
         AND nullif(btrim(p.tracking_id), '') IS NOT NULL
         AND ro.data_rota BETWEEN v_de AND v_ate
         AND public.has_base_access(v_uid, ro.base_id)
         AND (p_base_id IS NULL OR ro.base_id = p_base_id)
       ORDER BY ro.base_id, p.tracking_id,
                coalesce(p.last_synced_at, p.updated_at, p.created_at) DESC, p.id DESC
    )
    SELECT * FROM candidatos
     WHERE status_normalizado IN ('delivered', 'picked_up') OR codigo_bruto <> ''
     ORDER BY base_id, tracking_id
  LOOP
    v_codigo := CASE v_item.codigo_bruto
      WHEN 'unvisited' THEN 'unvisited_address'
      WHEN 'blocked' THEN 'blocked_by_keyword'
      WHEN 'blocked_kw' THEN 'blocked_by_keyword'
      ELSE v_item.codigo_bruto
    END;

    SELECT * INTO v_atual
      FROM public.meli_devolucoes d
     WHERE d.tracking_id = v_item.tracking_id
     FOR UPDATE;

    -- A constraint historica e global; colisao de outra base e somente relatada.
    IF v_atual.id IS NOT NULL AND v_atual.base_id <> v_item.base_id THEN
      v_conflitos_base := v_conflitos_base + 1;
      CONTINUE;
    END IF;

    -- Sucessos nao criam devolucao. Se havia retorno pendente, encerram-no sem
    -- preencher qualquer campo de recebimento fisico.
    IF v_item.status_normalizado IN ('delivered', 'picked_up') THEN
      IF v_atual.id IS NOT NULL AND v_atual.estado = 'aguardando_retorno' THEN
        UPDATE public.meli_devolucoes d
           SET meli_status = v_item.status,
               meli_substatus = v_item.substatus,
               situacao_meli = CASE WHEN v_item.status_normalizado = 'delivered'
                                    THEN 'entregue' ELSE 'retirado' END,
               last_synced_at = v_item.last_synced_at,
               estado = 'encerrado', prazo_retorno_em = NULL
         WHERE d.id = v_atual.id AND d.base_id = v_item.base_id
           AND (d.meli_status, d.meli_substatus, d.situacao_meli, d.last_synced_at,
                d.estado, d.prazo_retorno_em) IS DISTINCT FROM
               (v_item.status, v_item.substatus,
                CASE WHEN v_item.status_normalizado = 'delivered' THEN 'entregue' ELSE 'retirado' END,
                v_item.last_synced_at, 'encerrado'::text, NULL::timestamptz);
        IF FOUND THEN
          v_atualizadas := v_atualizadas + 1;
          v_reconciliadas := v_reconciliadas + 1;
          INSERT INTO public.meli_devolucoes_eventos
            (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
          VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'reconciliacao_meli',
                  v_atual.estado, 'encerrado',
                  jsonb_build_object('meli_status', v_item.status_normalizado,
                                     'recebimento_fisico', false), v_uid);
          v_eventos := v_eventos + 1;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF v_codigo IN ('buyer_rejected','buyer_absent','business_closed','unvisited_address',
                    'damaged','bad_address','missrouted','blocked_by_keyword') THEN
      v_estado_novo := 'aguardando_retorno';
    ELSIF v_codigo IN ('missing','lost','stolen') THEN
      v_estado_novo := 'em_investigacao';
    ELSIF v_codigo = 'transferred' THEN
      v_estado_novo := 'transferido';
    ELSE
      v_estado_novo := 'revisao_necessaria';
    END IF;

    v_situacao_nova := CASE v_estado_novo
      WHEN 'aguardando_retorno' THEN 'insucesso'
      WHEN 'em_investigacao' THEN 'investigacao'
      WHEN 'transferido' THEN 'transferido'
      ELSE 'revisao_necessaria'
    END;
    v_ocorrido_novo := v_item.ocorrido_em;
    v_prazo_novo := CASE WHEN v_estado_novo = 'aguardando_retorno'
                         THEN v_ocorrido_novo + interval '3 days' ELSE NULL END;
    v_inseriu := false;

    IF v_atual.id IS NULL THEN
      BEGIN
        INSERT INTO public.meli_devolucoes (
          tracking_id, base_id, rota_id, route_id, cluster, motorista, transportadora,
          occurrence_code, meli_status, meli_substatus, situacao_meli,
          ocorrido_em, prazo_retorno_em, last_synced_at, estado
        ) VALUES (
          v_item.tracking_id, v_item.base_id, v_item.rota_id, v_item.route_id,
          v_item.cluster, v_item.driver_name, v_item.carrier, v_codigo,
          v_item.status, v_item.substatus, v_situacao_nova, v_ocorrido_novo,
          v_prazo_novo, v_item.last_synced_at, v_estado_novo
        ) RETURNING * INTO v_atual;
        v_inseriu := true;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_atual FROM public.meli_devolucoes d
         WHERE d.tracking_id = v_item.tracking_id FOR UPDATE;
        IF v_atual.id IS NULL OR v_atual.base_id <> v_item.base_id THEN
          v_conflitos_base := v_conflitos_base + 1;
          CONTINUE;
        END IF;
      END;
    END IF;

    IF v_inseriu THEN
      v_criadas := v_criadas + 1;
      IF v_estado_novo = 'revisao_necessaria' THEN v_revisao := v_revisao + 1; END IF;
      INSERT INTO public.meli_devolucoes_eventos
        (devolucao_id, tracking_id, base_id, tipo, estado_novo, detalhes, registrado_por)
      VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'criada', v_atual.estado,
              jsonb_build_object('occurrence_code', v_codigo, 'origem', 'sincronizacao'), v_uid);
      v_eventos := v_eventos + 1;
      CONTINUE;
    END IF;

    -- Preserva os estados que dependem de acao fisica/manual.
    IF v_atual.estado IN ('recebido_na_base','divergencia_delivered','encerrado') THEN
      v_estado_novo := v_atual.estado;
      v_prazo_novo := v_atual.prazo_retorno_em;
    END IF;

    UPDATE public.meli_devolucoes d
       SET rota_id = v_item.rota_id, route_id = v_item.route_id,
           cluster = v_item.cluster, motorista = v_item.driver_name,
           transportadora = v_item.carrier, occurrence_code = v_codigo,
           meli_status = v_item.status, meli_substatus = v_item.substatus,
           situacao_meli = v_situacao_nova,
           ocorrido_em = CASE WHEN d.occurrence_code IS DISTINCT FROM v_codigo
                              THEN v_ocorrido_novo ELSE d.ocorrido_em END,
           prazo_retorno_em = CASE
             WHEN v_estado_novo <> 'aguardando_retorno' THEN v_prazo_novo
             WHEN d.occurrence_code IS DISTINCT FROM v_codigo THEN v_prazo_novo
             ELSE d.prazo_retorno_em END,
           last_synced_at = v_item.last_synced_at, estado = v_estado_novo
     WHERE d.id = v_atual.id AND d.base_id = v_item.base_id
       AND (d.rota_id, d.route_id, d.cluster, d.motorista, d.transportadora,
            d.occurrence_code, d.meli_status, d.meli_substatus, d.situacao_meli,
            d.last_synced_at, d.estado) IS DISTINCT FROM
           (v_item.rota_id, v_item.route_id, v_item.cluster, v_item.driver_name,
            v_item.carrier, v_codigo, v_item.status, v_item.substatus,
            v_situacao_nova, v_item.last_synced_at, v_estado_novo);

    IF FOUND THEN
      v_atualizadas := v_atualizadas + 1;
      IF v_estado_novo = 'revisao_necessaria' AND v_atual.estado <> 'revisao_necessaria' THEN
        v_revisao := v_revisao + 1;
      END IF;
      INSERT INTO public.meli_devolucoes_eventos
        (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
      VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'atualizacao_meli',
              v_atual.estado, v_estado_novo,
              jsonb_build_object('occurrence_code', v_codigo, 'meli_status', v_item.status,
                                 'meli_substatus', v_item.substatus), v_uid);
      v_eventos := v_eventos + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok', 'criadas', v_criadas, 'atualizadas', v_atualizadas,
    'reconciliadas', v_reconciliadas, 'revisao_necessaria', v_revisao,
    'conflitos_base', v_conflitos_base, 'eventos', v_eventos,
    'data_de', v_de, 'data_ate', v_ate, 'server_time', clock_timestamp()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid)
  TO authenticated;
