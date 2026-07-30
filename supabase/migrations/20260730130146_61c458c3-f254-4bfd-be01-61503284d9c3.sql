-- =========================================================
-- Fase 1 — Fundação Meli. Aditiva. Não altera dados existentes.
-- =========================================================

-- --- 1.1 bases: mapa ESP -> SSP -----------------------------------
ALTER TABLE public.bases
  ADD COLUMN IF NOT EXISTS meli_service_center_id text,
  ADD COLUMN IF NOT EXISTS meli_site_id text;

UPDATE public.bases SET meli_service_center_id = 'SSP20'
  WHERE codigo = 'ESP15' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP15'
  WHERE codigo = 'ESP16' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP34'
  WHERE codigo = 'ESP17' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP25'
  WHERE codigo = 'ESP18' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_site_id = 'MLB'
  WHERE meli_service_center_id IS NOT NULL AND meli_site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bases_meli_scid_uniq
  ON public.bases (meli_service_center_id)
  WHERE meli_service_center_id IS NOT NULL;

-- --- 1.2 meli_rotas: colunas normalizadas -------------------------
ALTER TABLE public.meli_rotas
  ADD COLUMN IF NOT EXISTS base_id           uuid REFERENCES public.bases(id),
  ADD COLUMN IF NOT EXISTS route_status      text,
  ADD COLUMN IF NOT EXISTS route_substatus   text,
  ADD COLUMN IF NOT EXISTS driver_name       text,
  ADD COLUMN IF NOT EXISTS driver_id         text,
  ADD COLUMN IF NOT EXISTS vehicle_license   text,
  ADD COLUMN IF NOT EXISTS delivered_total   integer,
  ADD COLUMN IF NOT EXISTS occurrence_total  integer,
  ADD COLUMN IF NOT EXISTS pending_total     integer,
  ADD COLUMN IF NOT EXISTS stops_total       integer,
  ADD COLUMN IF NOT EXISTS init_date         timestamptz,
  ADD COLUMN IF NOT EXISTS finish_date       timestamptz,
  ADD COLUMN IF NOT EXISTS executed_finish_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at    timestamptz;

CREATE INDEX IF NOT EXISTS meli_rotas_base_data_idx
  ON public.meli_rotas (base_id, data_rota);
CREATE INDEX IF NOT EXISTS meli_rotas_status_idx
  ON public.meli_rotas (route_status);
CREATE INDEX IF NOT EXISTS meli_rotas_synced_idx
  ON public.meli_rotas (last_synced_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS meli_rotas_driver_idx
  ON public.meli_rotas (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_rotas_placa_idx
  ON public.meli_rotas (vehicle_license) WHERE vehicle_license IS NOT NULL;

-- --- 1.3 meli_pacotes: ocorrências e parada -----------------------
ALTER TABLE public.meli_pacotes
  ADD COLUMN IF NOT EXISTS substatus        text,
  ADD COLUMN IF NOT EXISTS occurrence_code  text,
  ADD COLUMN IF NOT EXISTS stop_id          text;

CREATE INDEX IF NOT EXISTS meli_pacotes_tracking_idx
  ON public.meli_pacotes (tracking_id);
CREATE INDEX IF NOT EXISTS meli_pacotes_shipment_idx
  ON public.meli_pacotes (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_pacotes_occurrence_idx
  ON public.meli_pacotes (occurrence_code) WHERE occurrence_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_pacotes_rota_status_idx
  ON public.meli_pacotes (rota_id, status);

-- --- 1.4 catálogo de ocorrências ----------------------------------
CREATE TABLE IF NOT EXISTS public.meli_ocorrencia_codigos (
  codigo           text PRIMARY KEY,
  descricao        text NOT NULL,
  peso             integer NOT NULL DEFAULT 1,
  responsabilidade text,
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_ocorrencia_codigos TO authenticated;
GRANT ALL    ON public.meli_ocorrencia_codigos TO service_role;

ALTER TABLE public.meli_ocorrencia_codigos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ocorrencia_codigos_read_authenticated"
  ON public.meli_ocorrencia_codigos;
CREATE POLICY "ocorrencia_codigos_read_authenticated"
  ON public.meli_ocorrencia_codigos FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.meli_ocorrencia_codigos (codigo, descricao) VALUES
  ('transferred',          'Transferido'),
  ('buyer_rejected',       'O pacote foi recusado'),
  ('business_closed',      'Negócio fechado'),
  ('missing',              'O pacote foi perdido'),
  ('buyer_absent',         'Não havia ninguém no endereço'),
  ('unvisited_address',    'Endereço não visitado'),
  ('missrouted',           'O pacote não pertence à minha região'),
  ('inaccessible_address', 'Fica em uma área inacessível'),
  ('bad_address',          'Faltam dados do endereço'),
  ('damaged',              'O pacote está avariado')
ON CONFLICT (codigo) DO NOTHING;

-- --- 1.5 policy: payload bruto restrito a admin -------------------
ALTER TABLE public.meli_rotas_payload ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payload_admin_only_select"
  ON public.meli_rotas_payload;
CREATE POLICY "payload_admin_only_select"
  ON public.meli_rotas_payload FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- --- 1.6 RPC: status leve de sincronização ------------------------
CREATE OR REPLACE FUNCTION public.meli_sync_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest timestamptz;
  v_imp    jsonb;
  v_erros  bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT max(last_synced_at) INTO v_latest FROM public.meli_rotas;

  SELECT to_jsonb(i) INTO v_imp
  FROM public.meli_importacoes i
  ORDER BY i.iniciado_em DESC
  LIMIT 1;

  SELECT count(*) INTO v_erros
  FROM public.meli_importacoes
  WHERE status = 'erro'
    AND iniciado_em >= now() - interval '24 hours';

  RETURN jsonb_build_object(
    'status',            'ok',
    'latest_synced_at',  v_latest,
    'server_time',       now(),
    'running',           null,
    'next_sync_at',      null,
    'last_result',       CASE WHEN v_imp IS NULL THEN null
                              ELSE v_imp->>'status' END,
    'ultima_importacao', v_imp,
    'erros_24h',         v_erros,
    'fonte_running',     'indisponivel_no_backend',
    'observacao',        'running/next_sync_at requerem heartbeat da extensão ou fila server-side; ainda não implementados.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.meli_sync_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_sync_status() TO authenticated;

-- =========================================================
-- 2. Patch aditivo em meli_importar_rota
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_importar_rota(
  p_payload jsonb,
  p_arquivo_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    -- data_rota: parsing seguro (aceita apenas YYYY-MM-DD; erro -> NULL)
    BEGIN
      v_data_rota := CASE
        WHEN nullif(btrim(p_payload->>'data_rota'), '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN to_date(btrim(p_payload->>'data_rota'), 'YYYY-MM-DD')
        ELSE NULL
      END;
    EXCEPTION WHEN OTHERS THEN
      v_data_rota := NULL;
    END;

    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao,
      base_id, route_status, route_substatus,
      driver_name, driver_id, vehicle_license,
      delivered_total, occurrence_total, pending_total, stops_total,
      init_date, finish_date, executed_finish_date, last_synced_at
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
      v_init_date, v_finish_date, v_exec_finish, now()
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
      last_synced_at       = now()
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
        elem->>'sequencia' AS sequencia_raw,
        public._meli_safe_int(elem->>'sequencia') AS ordem_int
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
        stop_id, printed_label, ordem
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, substatus, occurrence_code,
             stop_id, printed_label, ordem_int
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
        ordem           = EXCLUDED.ordem
      WHERE
        public.meli_pacotes.shipment_id     IS DISTINCT FROM EXCLUDED.shipment_id     OR
        public.meli_pacotes.destinatario    IS DISTINCT FROM EXCLUDED.destinatario    OR
        public.meli_pacotes.endereco        IS DISTINCT FROM EXCLUDED.endereco        OR
        public.meli_pacotes.bairro          IS DISTINCT FROM EXCLUDED.bairro          OR
        public.meli_pacotes.cidade          IS DISTINCT FROM EXCLUDED.cidade          OR
        public.meli_pacotes.uf              IS DISTINCT FROM EXCLUDED.uf              OR
        public.meli_pacotes.cep             IS DISTINCT FROM EXCLUDED.cep             OR
        public.meli_pacotes.status          IS DISTINCT FROM EXCLUDED.status          OR
        public.meli_pacotes.substatus       IS DISTINCT FROM EXCLUDED.substatus       OR
        public.meli_pacotes.occurrence_code IS DISTINCT FROM EXCLUDED.occurrence_code OR
        public.meli_pacotes.stop_id         IS DISTINCT FROM EXCLUDED.stop_id         OR
        public.meli_pacotes.printed_label   IS DISTINCT FROM EXCLUDED.printed_label   OR
        public.meli_pacotes.ordem           IS DISTINCT FROM EXCLUDED.ordem
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
                              AND printed_label IS NOT NULL AND printed_label <> '')
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