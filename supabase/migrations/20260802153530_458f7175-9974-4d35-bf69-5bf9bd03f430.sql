CREATE OR REPLACE FUNCTION public.meli_importar_rota(p_payload jsonb, p_arquivo_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_importacao_id uuid;
  v_route_id text;
  v_rota_id uuid;
  v_pacotes jsonb;

  v_facility text;
  v_base_id uuid;
  v_route_status text;
  v_route_substatus text;
  v_driver_name text;
  v_driver_id text;
  v_vehicle text;
  v_delivered int;
  v_occurrence int;
  v_pending int;
  v_stops int;
  v_init_date timestamptz;
  v_finish_date timestamptz;
  v_exec_finish timestamptz;
  v_data_rota date;

  v_rota_risco boolean;
  v_risco_parcial boolean;
  v_risco_motivo text;
  v_risco_codigo text;
  v_risco_origem text;
  v_risco_valor jsonb;

  v_recebidos int := 0;
  v_unicos int := 0;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_inalterados int := 0;
  v_invalidos int := 0;
  v_duplicados int := 0;
  v_ordem_invalida int := 0;
  v_status text := 'ok';
  v_erro text := NULL;
  v_sqlstate text := NULL;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  INSERT INTO public.meli_importacoes (arquivo_nome, status, importado_por)
  VALUES (nullif(btrim(p_arquivo_nome), ''), 'processando', v_uid)
  RETURNING id INTO v_importacao_id;

  BEGIN
    v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages');
    IF v_pacotes IS NOT NULL AND jsonb_typeof(v_pacotes) <> 'array' THEN
      RAISE EXCEPTION 'pacotes_deve_ser_array' USING ERRCODE = '22023';
    END IF;
    IF v_pacotes IS NULL THEN v_pacotes := '[]'::jsonb; END IF;

    v_facility := nullif(btrim(coalesce(
      p_payload->>'facility',
      p_payload->>'serviceCenterId',
      p_payload->>'service_center_id',
      p_payload->>'service_center'
    )), '');

    IF v_facility IS NOT NULL THEN
      SELECT id INTO v_base_id
      FROM public.bases
      WHERE meli_service_center_id = v_facility
      LIMIT 1;
    END IF;

    v_route_status    := nullif(btrim(p_payload->>'status'), '');
    v_route_substatus := nullif(btrim(p_payload->>'substatus'), '');
    v_driver_name     := nullif(btrim(coalesce(
                          p_payload->>'driver_name',
                          p_payload->'driver'->>'name',
                          p_payload->'driver'->>'nickname')), '');
    v_driver_id       := nullif(btrim(coalesce(
                          p_payload->>'driver_id',
                          p_payload->'driver'->>'id',
                          p_payload->'driver'->>'user_id')), '');
    v_vehicle         := nullif(upper(btrim(coalesce(
                          p_payload->>'vehicle_license',
                          p_payload->>'plate',
                          p_payload->'vehicle'->>'license_plate'))), '');

    v_delivered  := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'delivered',
                      p_payload->>'delivered_total'));
    v_occurrence := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'notDelivered',
                      p_payload->'counters'->>'notDeliveredTotal',
                      p_payload->'counters'->>'occurrences',
                      p_payload->>'occurrence_total'));
    v_pending    := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'pending',
                      p_payload->>'pending_total'));
    v_stops      := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'stops',
                      p_payload->'counters'->>'totalStops',
                      p_payload->>'stops_total',
                      p_payload->>'totalStops'));
    IF v_stops IS NULL AND jsonb_typeof(p_payload->'stops') = 'array' THEN
      v_stops := jsonb_array_length(p_payload->'stops');
      IF v_stops = 0 THEN v_stops := NULL; END IF;
    END IF;

    v_init_date := CASE
      WHEN p_payload ? 'initDate' AND (p_payload->>'initDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'initDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'initDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'initDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'initDate')::bigint) END
      WHEN p_payload ? 'init_date' THEN nullif(p_payload->>'init_date','')::timestamptz
      ELSE NULL END;

    v_finish_date := CASE
      WHEN p_payload ? 'finishDate' AND (p_payload->>'finishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'finishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'finishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'finishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'finishDate')::bigint) END
      WHEN p_payload ? 'finish_date' THEN nullif(p_payload->>'finish_date','')::timestamptz
      ELSE NULL END;

    v_exec_finish := CASE
      WHEN p_payload ? 'executedFinishDate' AND (p_payload->>'executedFinishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'executedFinishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'executedFinishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'executedFinishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'executedFinishDate')::bigint) END
      ELSE NULL END;

    BEGIN
      v_data_rota := CASE
        WHEN nullif(btrim(p_payload->>'data_rota'), '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN to_date(btrim(p_payload->>'data_rota'), 'YYYY-MM-DD')
        ELSE NULL
      END;
    EXCEPTION WHEN OTHERS THEN
      v_data_rota := NULL;
    END;

    -- Área de risco no nível da rota (somente se o payload informar).
    v_rota_risco    := coalesce((p_payload->>'rota_area_risco')::boolean, false);
    v_risco_parcial := coalesce((p_payload->>'area_risco_parcial')::boolean, false);
    v_risco_motivo  := nullif(btrim(p_payload->>'motivo_area_risco'), '');
    v_risco_codigo  := nullif(btrim(p_payload->>'codigo_area_risco'), '');
    v_risco_origem  := nullif(btrim(p_payload->>'origem_area_risco'), '');
    IF v_risco_origem IS NOT NULL AND v_risco_origem NOT IN ('rota','parada','pacote','ocorrencia') THEN
      v_risco_origem := NULL;
    END IF;
    v_risco_valor := CASE WHEN p_payload ? 'valor_original_area_risco'
                          THEN p_payload->'valor_original_area_risco' ELSE NULL END;

    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao,
      base_id, route_status, route_substatus,
      driver_name, driver_id, vehicle_license,
      delivered_total, occurrence_total, pending_total, stops_total,
      init_date, finish_date, executed_finish_date, last_synced_at,
      rota_area_risco, area_risco_parcial, motivo_area_risco,
      codigo_area_risco, origem_area_risco, valor_original_area_risco,
      area_risco_detectado_em
    ) VALUES (
      v_route_id,
      nullif(btrim(p_payload->>'cluster'), ''),
      nullif(btrim(p_payload->>'carrier'), ''),
      v_facility,
      v_data_rota,
      v_importacao_id,
      v_base_id, v_route_status, v_route_substatus,
      v_driver_name, v_driver_id, v_vehicle,
      v_delivered, v_occurrence, v_pending, v_stops,
      v_init_date, v_finish_date, v_exec_finish, now(),
      v_rota_risco, v_risco_parcial, v_risco_motivo,
      v_risco_codigo, v_risco_origem, v_risco_valor,
      CASE WHEN v_rota_risco OR v_risco_parcial THEN now() ELSE NULL END
    )
    ON CONFLICT (route_id) DO UPDATE SET
      cluster              = COALESCE(EXCLUDED.cluster, public.meli_rotas.cluster),
      carrier              = COALESCE(EXCLUDED.carrier, public.meli_rotas.carrier),
      facility             = COALESCE(EXCLUDED.facility, public.meli_rotas.facility),
      data_rota            = COALESCE(EXCLUDED.data_rota, public.meli_rotas.data_rota),
      origem_importacao    = EXCLUDED.origem_importacao,
      base_id              = COALESCE(EXCLUDED.base_id, public.meli_rotas.base_id),
      route_status         = COALESCE(EXCLUDED.route_status, public.meli_rotas.route_status),
      route_substatus      = COALESCE(EXCLUDED.route_substatus, public.meli_rotas.route_substatus),
      driver_name          = COALESCE(EXCLUDED.driver_name, public.meli_rotas.driver_name),
      driver_id            = COALESCE(EXCLUDED.driver_id, public.meli_rotas.driver_id),
      vehicle_license      = COALESCE(EXCLUDED.vehicle_license, public.meli_rotas.vehicle_license),
      delivered_total      = COALESCE(EXCLUDED.delivered_total, public.meli_rotas.delivered_total),
      occurrence_total     = COALESCE(EXCLUDED.occurrence_total, public.meli_rotas.occurrence_total),
      pending_total        = COALESCE(EXCLUDED.pending_total, public.meli_rotas.pending_total),
      stops_total          = COALESCE(EXCLUDED.stops_total, public.meli_rotas.stops_total),
      init_date            = COALESCE(EXCLUDED.init_date, public.meli_rotas.init_date),
      finish_date          = COALESCE(EXCLUDED.finish_date, public.meli_rotas.finish_date),
      executed_finish_date = COALESCE(EXCLUDED.executed_finish_date, public.meli_rotas.executed_finish_date),
      last_synced_at       = now(),
      rota_area_risco      = public.meli_rotas.rota_area_risco OR EXCLUDED.rota_area_risco,
      area_risco_parcial   = public.meli_rotas.area_risco_parcial OR EXCLUDED.area_risco_parcial,
      motivo_area_risco    = COALESCE(EXCLUDED.motivo_area_risco, public.meli_rotas.motivo_area_risco),
      codigo_area_risco    = COALESCE(EXCLUDED.codigo_area_risco, public.meli_rotas.codigo_area_risco),
      origem_area_risco    = COALESCE(EXCLUDED.origem_area_risco, public.meli_rotas.origem_area_risco),
      valor_original_area_risco = COALESCE(EXCLUDED.valor_original_area_risco, public.meli_rotas.valor_original_area_risco),
      area_risco_detectado_em = COALESCE(public.meli_rotas.area_risco_detectado_em, EXCLUDED.area_risco_detectado_em)
    RETURNING id INTO v_rota_id;

    PERFORM 1 FROM public.meli_rotas WHERE id = v_rota_id FOR UPDATE;

    INSERT INTO public.meli_rotas_payload (rota_id, raw_payload)
    VALUES (v_rota_id, p_payload)
    ON CONFLICT (rota_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;

    WITH raw AS (
      SELECT
        ord AS pos,
        nullif(btrim(elem->>'tracking_id'), '') AS tracking_id,
        nullif(btrim(elem->>'shipment_id'), '') AS shipment_id,
        nullif(btrim(elem->>'destinatario'), '') AS destinatario,
        nullif(btrim(elem->>'endereco'), '') AS endereco,
        nullif(btrim(elem->>'bairro'), '') AS bairro,
        nullif(btrim(elem->>'cidade'), '') AS cidade,
        nullif(btrim(elem->>'uf'), '') AS uf,
        nullif(btrim(elem->>'cep'), '') AS cep,
        nullif(btrim(elem->>'status'), '') AS status,
        nullif(btrim(elem->>'substatus'), '') AS substatus,
        nullif(btrim(coalesce(elem->>'occurrence_code', elem->>'occurrenceCode')), '') AS occurrence_code,
        nullif(btrim(coalesce(elem->>'stop_id', elem->>'stopId')), '') AS stop_id,
        nullif(btrim(elem->>'printed_label'), '') AS printed_label,
        coalesce((elem->>'area_risco')::boolean, (elem->>'pacote_area_risco')::boolean, false) AS area_risco,
        nullif(btrim(elem->>'motivo_area_risco'), '') AS motivo_area_risco,
        nullif(btrim(elem->>'codigo_area_risco'), '') AS codigo_area_risco,
        CASE WHEN nullif(btrim(elem->>'origem_area_risco'), '') IN ('rota','parada','pacote','ocorrencia')
             THEN btrim(elem->>'origem_area_risco') END AS origem_area_risco,
        CASE WHEN elem ? 'valor_original_area_risco' THEN elem->'valor_original_area_risco' END AS valor_original_area_risco,
        coalesce(elem->>'ordem', elem->>'sequencia') AS sequencia_raw,
        public._meli_safe_int(coalesce(elem->>'ordem', elem->>'sequencia')) AS ordem_int
      FROM jsonb_array_elements(v_pacotes) WITH ORDINALITY AS t(elem, ord)
    ),
    validos AS (SELECT * FROM raw WHERE tracking_id IS NOT NULL),
    dedup AS (
      SELECT DISTINCT ON (tracking_id) *
      FROM validos
      ORDER BY tracking_id, pos DESC
    ),
    up AS (
      INSERT INTO public.meli_pacotes (
        rota_id, tracking_id, shipment_id, destinatario, endereco,
        bairro, cidade, uf, cep, status, substatus, occurrence_code,
        stop_id, printed_label, ordem,
        pacote_area_risco, motivo_area_risco, codigo_area_risco,
        origem_area_risco, valor_original_area_risco, area_risco_detectado_em,
        last_synced_at
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, substatus, occurrence_code,
             stop_id, printed_label, ordem_int,
             area_risco, motivo_area_risco, codigo_area_risco,
             origem_area_risco, valor_original_area_risco,
             CASE WHEN area_risco THEN now() END,
             now()
      FROM dedup
      ON CONFLICT (rota_id, tracking_id) DO UPDATE SET
        shipment_id     = EXCLUDED.shipment_id,
        destinatario    = EXCLUDED.destinatario,
        endereco        = EXCLUDED.endereco,
        bairro          = EXCLUDED.bairro,
        cidade          = EXCLUDED.cidade,
        uf              = EXCLUDED.uf,
        cep             = EXCLUDED.cep,
        status          = EXCLUDED.status,
        substatus       = EXCLUDED.substatus,
        occurrence_code = EXCLUDED.occurrence_code,
        stop_id         = EXCLUDED.stop_id,
        printed_label   = EXCLUDED.printed_label,
        ordem           = EXCLUDED.ordem,
        pacote_area_risco = public.meli_pacotes.pacote_area_risco OR EXCLUDED.pacote_area_risco,
        motivo_area_risco = COALESCE(EXCLUDED.motivo_area_risco, public.meli_pacotes.motivo_area_risco),
        codigo_area_risco = COALESCE(EXCLUDED.codigo_area_risco, public.meli_pacotes.codigo_area_risco),
        origem_area_risco = COALESCE(EXCLUDED.origem_area_risco, public.meli_pacotes.origem_area_risco),
        valor_original_area_risco = COALESCE(EXCLUDED.valor_original_area_risco, public.meli_pacotes.valor_original_area_risco),
        area_risco_detectado_em = COALESCE(public.meli_pacotes.area_risco_detectado_em, EXCLUDED.area_risco_detectado_em),
        last_synced_at  = now()
      RETURNING (xmax = 0) AS inserted
    ),
    stats AS (
      SELECT
        (SELECT count(*) FROM raw)::int      AS recebidos,
        (SELECT count(*) FROM raw WHERE tracking_id IS NULL)::int AS invalidos,
        (SELECT count(*) FROM dedup)::int    AS unicos,
        ((SELECT count(*) FROM validos) - (SELECT count(*) FROM dedup))::int AS duplicados,
        (SELECT count(*) FROM raw
           WHERE tracking_id IS NOT NULL
             AND sequencia_raw IS NOT NULL AND sequencia_raw <> ''
             AND ordem_int IS NULL)::int     AS ordem_invalida,
        (SELECT count(*) FROM up WHERE inserted)::int      AS inseridos,
        (SELECT count(*) FROM up WHERE NOT inserted)::int  AS atualizados
    )
    SELECT recebidos, invalidos, unicos, duplicados, ordem_invalida, inseridos, atualizados
    INTO v_recebidos, v_invalidos, v_unicos, v_duplicados, v_ordem_invalida, v_inseridos, v_atualizados
    FROM stats;

    v_inalterados := v_unicos - v_inseridos - v_atualizados;

    UPDATE public.meli_rotas
    SET total_pacotes = (SELECT count(*) FROM public.meli_pacotes WHERE rota_id = v_rota_id),
        total_impressos = (SELECT count(*) FROM public.meli_pacotes
                            WHERE rota_id = v_rota_id
                              AND printed_label IS NOT NULL AND printed_label <> ''),
        area_risco_parcial = CASE
          WHEN rota_area_risco THEN false
          ELSE EXISTS (SELECT 1 FROM public.meli_pacotes
                        WHERE rota_id = v_rota_id AND pacote_area_risco)
        END
    WHERE id = v_rota_id;

    v_status := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_erro := SQLERRM;
    v_status := 'erro';
    v_recebidos := 0; v_unicos := 0; v_inseridos := 0; v_atualizados := 0;
    v_inalterados := 0; v_invalidos := 0; v_duplicados := 0; v_ordem_invalida := 0;
    v_rota_id := NULL;
  END;

  UPDATE public.meli_importacoes
  SET status = v_status,
      total_rotas = CASE WHEN v_status = 'ok' THEN 1 ELSE 0 END,
      total_pacotes = v_inseridos + v_atualizados,
      total_erros = CASE WHEN v_status = 'erro' THEN 1 ELSE 0 END,
      mensagem_erro = v_erro,
      finalizado_em = now()
  WHERE id = v_importacao_id;

  IF v_status = 'erro' THEN
    RETURN jsonb_build_object(
      'status','erro','erro',v_erro,'sqlstate',v_sqlstate,
      'importacao_id',v_importacao_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'importacao_id', v_importacao_id,
    'rota_id', v_rota_id,
    'route_id', v_route_id,
    'pacotes_recebidos', v_recebidos,
    'pacotes_unicos', v_unicos,
    'pacotes_inseridos', v_inseridos,
    'pacotes_atualizados', v_atualizados,
    'pacotes_inalterados', v_inalterados,
    'pacotes_invalidos', v_invalidos,
    'pacotes_duplicados_no_payload', v_duplicados,
    'pacotes_com_ordem_invalida', v_ordem_invalida
  );
END;
$function$;

-- ── Publicação operacional: grava o nome operacional (cluster) em nro_rota.
-- planejada/otimizada continuam com route_id (identidade técnica usada na Triagem).
CREATE OR REPLACE FUNCTION public.meli_publicar_rota_operacional(p_rota_id uuid, p_data_operacional date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rota          public.meli_rotas;
  v_base_id       uuid;
  v_dia           date;
  v_importacao_id uuid;
  v_nome_op       text;
  v_inseridos     integer := 0;
  v_atualizados   integer := 0;
  v_total         integer := 0;
  v_rotas         integer := 0;
  v_motoristas    integer := 0;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT * INTO v_rota FROM public.meli_rotas WHERE id = p_rota_id;
  IF v_rota.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  v_base_id := v_rota.base_id;
  IF v_base_id IS NULL AND v_rota.facility IS NOT NULL THEN
    SELECT b.id INTO v_base_id
      FROM public.bases b
     WHERE b.meli_service_center_id = v_rota.facility
     LIMIT 1;
  END IF;
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_mapeada','facility',v_rota.facility);
  END IF;

  -- Dia operacional da rota: NUNCA a data de finalização.
  v_dia := COALESCE(p_data_operacional, v_rota.data_rota,
                    (v_rota.init_date AT TIME ZONE 'America/Sao_Paulo')::date,
                    (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_nome_op := COALESCE(nullif(btrim(v_rota.cluster), ''), v_rota.route_id);

  SELECT i.id INTO v_importacao_id
    FROM public.importacoes_escala i
   WHERE i.base_id = v_base_id
     AND i.data_operacional = v_dia
     AND i.ativa = true
   ORDER BY i.importado_em DESC
   LIMIT 1;

  IF v_importacao_id IS NULL THEN
    INSERT INTO public.importacoes_escala (
      base_id, data_operacional, versao, ativa, importado_por,
      arquivo_nome, total_linhas, total_pacotes, total_motoristas, total_rotas
    ) VALUES (
      v_base_id, v_dia,
      COALESCE((SELECT MAX(versao) FROM public.importacoes_escala
                 WHERE base_id = v_base_id AND data_operacional = v_dia), 0) + 1,
      true, auth.uid(),
      'meli:' || v_rota.route_id, 0, 0, 0, 0
    ) RETURNING id INTO v_importacao_id;
  END IF;

  WITH upd AS (
    UPDATE public.escalas e
       SET otimizada     = v_rota.route_id,
           planejada     = COALESCE(e.planejada, v_rota.route_id),
           nro_rota      = v_nome_op,
           cidade        = COALESCE(p.cidade, e.cidade),
           bairro        = COALESCE(p.bairro, e.bairro),
           cep           = COALESCE(p.cep, e.cep),
           rua           = COALESCE(p.endereco, e.rua),
           driver        = COALESCE(v_rota.driver_name, e.driver),
           placa         = COALESCE(v_rota.vehicle_license, e.placa),
           facility_id   = COALESCE(v_rota.facility, e.facility_id),
           transportadora= COALESCE(v_rota.carrier, e.transportadora),
           cluster       = COALESCE(v_rota.cluster, e.cluster),
           ordem         = COALESCE(p.ordem, e.ordem)
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND e.importacao_id = v_importacao_id
       AND (e.meli_pacote_id = p.id OR e.shipment = p.tracking_id)
    RETURNING e.id
  )
  SELECT count(*) INTO v_atualizados FROM upd;

  UPDATE public.escalas e
     SET meli_pacote_id = p.id
    FROM public.meli_pacotes p
   WHERE p.rota_id = v_rota.id
     AND e.importacao_id = v_importacao_id
     AND e.meli_pacote_id IS NULL
     AND e.shipment = p.tracking_id;

  WITH ins AS (
    INSERT INTO public.escalas (
      base_id, data_referencia, importacao_id, meli_pacote_id,
      shipment, planejada, otimizada, nro_rota, cluster,
      cidade, bairro, cep, rua, ordem,
      driver, placa, facility_id, transportadora,
      importado_por, triado, recebido, devolvido
    )
    SELECT v_base_id, v_dia, v_importacao_id, p.id,
           p.tracking_id, v_rota.route_id, v_rota.route_id, v_nome_op, v_rota.cluster,
           p.cidade, p.bairro, p.cep, p.endereco, p.ordem,
           v_rota.driver_name, v_rota.vehicle_license, v_rota.facility, v_rota.carrier,
           auth.uid(), false, false, false
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND p.tracking_id IS NOT NULL
       AND p.tracking_id <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.escalas e2
          WHERE e2.importacao_id = v_importacao_id
            AND (e2.meli_pacote_id = p.id OR e2.shipment = p.tracking_id)
       )
    RETURNING id
  )
  SELECT count(*) INTO v_inseridos FROM ins;

  SELECT count(*), count(DISTINCT COALESCE(NULLIF(otimizada,''), planejada)), count(DISTINCT driver)
    INTO v_total, v_rotas, v_motoristas
    FROM public.escalas
   WHERE importacao_id = v_importacao_id;

  UPDATE public.importacoes_escala
     SET total_linhas = v_total,
         total_pacotes = v_total,
         total_rotas = v_rotas,
         total_motoristas = v_motoristas,
         updated_at = now()
   WHERE id = v_importacao_id;

  RETURN jsonb_build_object(
    'status','ok',
    'rota_id', v_rota.id,
    'route_id', v_rota.route_id,
    'nome_operacional', v_nome_op,
    'base_id', v_base_id,
    'data_operacional', v_dia,
    'importacao_id', v_importacao_id,
    'esperados_inseridos', v_inseridos,
    'esperados_atualizados', v_atualizados,
    'total_importacao', v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','erro','erro', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;