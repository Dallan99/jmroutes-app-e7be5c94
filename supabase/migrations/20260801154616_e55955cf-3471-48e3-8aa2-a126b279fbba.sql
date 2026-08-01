-- ============ Fase 3 (aditiva) — colunas de área de risco + sync por pacote ============
ALTER TABLE public.meli_rotas
  ADD COLUMN IF NOT EXISTS rota_area_risco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS area_risco_parcial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_area_risco text,
  ADD COLUMN IF NOT EXISTS codigo_area_risco text,
  ADD COLUMN IF NOT EXISTS origem_area_risco text,
  ADD COLUMN IF NOT EXISTS valor_original_area_risco jsonb,
  ADD COLUMN IF NOT EXISTS area_risco_detectado_em timestamptz;

ALTER TABLE public.meli_pacotes
  ADD COLUMN IF NOT EXISTS pacote_area_risco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_area_risco text,
  ADD COLUMN IF NOT EXISTS codigo_area_risco text,
  ADD COLUMN IF NOT EXISTS origem_area_risco text,
  ADD COLUMN IF NOT EXISTS valor_original_area_risco jsonb,
  ADD COLUMN IF NOT EXISTS area_risco_detectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meli_rotas_origem_area_risco_chk') THEN
    ALTER TABLE public.meli_rotas ADD CONSTRAINT meli_rotas_origem_area_risco_chk
      CHECK (origem_area_risco IS NULL OR origem_area_risco IN ('rota','parada','pacote','ocorrencia'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meli_pacotes_origem_area_risco_chk') THEN
    ALTER TABLE public.meli_pacotes ADD CONSTRAINT meli_pacotes_origem_area_risco_chk
      CHECK (origem_area_risco IS NULL OR origem_area_risco IN ('rota','parada','pacote','ocorrencia'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS meli_rotas_dia_base_idx ON public.meli_rotas (data_rota, base_id);
CREATE INDEX IF NOT EXISTS meli_rotas_risco_idx ON public.meli_rotas (data_rota) WHERE rota_area_risco OR area_risco_parcial;
CREATE INDEX IF NOT EXISTS meli_pacotes_rota_status_idx ON public.meli_pacotes (rota_id, status);
CREATE INDEX IF NOT EXISTS meli_pacotes_risco_idx ON public.meli_pacotes (rota_id) WHERE pacote_area_risco;

-- ============ Normalização central de status (fonte única, também usada no TS) ============
CREATE OR REPLACE FUNCTION public.meli_status_normalizado(p_status text, p_substatus text, p_occurrence_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH v AS (
    SELECT lower(btrim(coalesce(p_occurrence_code,''))) AS oc,
           lower(btrim(coalesce(p_substatus,'')))       AS sub,
           lower(btrim(coalesce(p_status,'')))          AS st
  ), c AS (
    SELECT CASE WHEN oc <> '' THEN oc WHEN sub <> '' THEN sub ELSE st END AS chave, st FROM v
  )
  SELECT CASE
    WHEN chave = '' THEN 'desconhecido'
    WHEN chave IN ('delivered','entregue','delivered_to_buyer') THEN 'entregue'
    WHEN chave IN ('cancelled','canceled','cancelado') THEN 'cancelado'
    WHEN chave IN ('pending','planned','ready_to_deliver','to_be_delivered','not_started','created') THEN 'nao_iniciado'
    WHEN chave IN ('picked_up','in_route','out_for_delivery','active','on_route','shipped','in_transit') THEN 'em_rota'
    WHEN chave IN ('buyer_absent','buyer_rejected','buyer_moved','business_closed','bad_address',
                   'unvisited_address','inaccessible_address','missrouted','missing','damaged',
                   'blocked','blocked_by_keyword','risk_area','dangerous_area','return_to_station',
                   'not_delivered','refused','lost','stolen','vehicle_issue') THEN 'insucesso'
    ELSE 'desconhecido'
  END
  FROM c;
$$;

REVOKE ALL ON FUNCTION public.meli_status_normalizado(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_status_normalizado(text,text,text) TO authenticated, service_role;

-- ============ RPC do Dashboard Meli em tempo real ============
CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(
  p_data date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_motorista text DEFAULT NULL,
  p_rota text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_transportadora text DEFAULT NULL,
  p_risco text DEFAULT NULL   -- null | qualquer | integral | parcial
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dia date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_rotas jsonb := '[]'::jsonb;
  v_cards jsonb;
  v_motivos jsonb := '[]'::jsonb;
  v_bases jsonb := '[]'::jsonb;
  v_risco jsonb;
  v_sync timestamptz;
  v_sync_bases jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _dash_pac (
    rota_id uuid, route_id text, cluster text, base_id uuid, base_codigo text,
    base_nome text, service_center text, driver_name text, vehicle_license text,
    carrier text, data_rota date, last_synced_at timestamptz,
    rota_area_risco boolean, area_risco_parcial boolean,
    pacote_area_risco boolean, motivo_area_risco text,
    situacao text, occurrence_code text, substatus text, status text
  ) ON COMMIT DROP;
  DELETE FROM _dash_pac;

  INSERT INTO _dash_pac
  SELECT r.id, r.route_id, r.cluster, r.base_id, b.codigo, b.nome, b.meli_service_center_id,
         r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco, coalesce(p.motivo_area_risco, r.motivo_area_risco),
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code),
         p.occurrence_code, p.substatus, p.status
    FROM public.meli_rotas r
    LEFT JOIN public.bases b ON b.id = r.base_id
    JOIN public.meli_pacotes p ON p.rota_id = r.id
   WHERE r.data_rota = v_dia
     AND (p_base_id IS NULL OR r.base_id = p_base_id)
     AND (p_motorista IS NULL OR r.driver_name ILIKE '%'||p_motorista||'%')
     AND (p_rota IS NULL OR r.route_id ILIKE '%'||p_rota||'%' OR coalesce(r.cluster,'') ILIKE '%'||p_rota||'%')
     AND (p_transportadora IS NULL OR r.carrier ILIKE '%'||p_transportadora||'%')
     AND (p_risco IS NULL
          OR (p_risco = 'qualquer'  AND (r.rota_area_risco OR r.area_risco_parcial))
          OR (p_risco = 'integral'  AND r.rota_area_risco)
          OR (p_risco = 'parcial'   AND r.area_risco_parcial));

  IF p_status IS NOT NULL THEN
    DELETE FROM _dash_pac WHERE situacao <> p_status;
  END IF;

  SELECT jsonb_build_object(
    'total',        count(*),
    'nao_iniciado', count(*) FILTER (WHERE situacao = 'nao_iniciado'),
    'em_rota',      count(*) FILTER (WHERE situacao = 'em_rota'),
    'entregue',     count(*) FILTER (WHERE situacao = 'entregue'),
    'insucesso',    count(*) FILTER (WHERE situacao = 'insucesso'),
    'cancelado',    count(*) FILTER (WHERE situacao = 'cancelado'),
    'desconhecido', count(*) FILTER (WHERE situacao = 'desconhecido'),
    'area_risco_pacotes', count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'elegiveis',    count(*) FILTER (WHERE situacao <> 'cancelado'),
    'perc_entrega', CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                         THEN round(100.0 * count(*) FILTER (WHERE situacao = 'entregue')
                              / count(*) FILTER (WHERE situacao <> 'cancelado'), 1)
                         ELSE 0 END,
    'rotas',        count(DISTINCT route_id),
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)
  ) INTO v_cards FROM _dash_pac;

  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'total')::int DESC), '[]'::jsonb) INTO v_motivos
  FROM (
    SELECT jsonb_build_object(
             'codigo', k,
             'descricao', coalesce(c.descricao, k),
             'cadastrado', c.codigo IS NOT NULL,
             'total', t
           ) AS x
    FROM (
      SELECT coalesce(nullif(occurrence_code,''), nullif(substatus,''), nullif(status,''), 'sem_codigo') AS k,
             count(*)::int AS t
        FROM _dash_pac WHERE situacao = 'insucesso' GROUP BY 1
    ) s
    LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = s.k
  ) y;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.insucesso DESC, r.perc_entrega ASC, r.em_rota DESC, r.pacotes_risco DESC), '[]'::jsonb)
    INTO v_rotas
  FROM (
    SELECT rota_id, route_id,
           coalesce(nullif(btrim(cluster),''), route_id) AS nome_operacional,
           cluster, base_id, base_codigo, base_nome, service_center,
           driver_name, vehicle_license, carrier, data_rota, max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           count(*)::int AS total,
           count(*) FILTER (WHERE situacao='nao_iniciado')::int AS nao_iniciado,
           count(*) FILTER (WHERE situacao='em_rota')::int      AS em_rota,
           count(*) FILTER (WHERE situacao='entregue')::int     AS entregue,
           count(*) FILTER (WHERE situacao='insucesso')::int    AS insucesso,
           count(*) FILTER (WHERE situacao='cancelado')::int    AS cancelado,
           count(*) FILTER (WHERE pacote_area_risco)::int       AS pacotes_risco,
           CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                     / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
      FROM _dash_pac
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome, service_center,
              driver_name, vehicle_license, carrier, data_rota
  ) r;

  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb)
    INTO v_bases
  FROM (
    SELECT base_id, base_codigo, base_nome, service_center,
           count(DISTINCT route_id)::int AS rotas,
           count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)::int AS rotas_risco,
           count(DISTINCT route_id) FILTER (WHERE rota_area_risco)::int AS rotas_risco_integral,
           count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco)::int AS rotas_risco_parcial,
           count(*)::int AS total,
           count(*) FILTER (WHERE pacote_area_risco)::int AS pacotes_risco,
           count(*) FILTER (WHERE situacao='entregue')::int AS entregue,
           count(*) FILTER (WHERE situacao='em_rota')::int AS em_rota,
           count(*) FILTER (WHERE situacao='insucesso')::int AS insucesso,
           CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                     / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
      FROM _dash_pac
     GROUP BY base_id, base_codigo, base_nome, service_center
  ) b;

  SELECT jsonb_build_object(
    'rotas',      count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial),
    'integrais',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco),
    'parciais',   count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco),
    'pacotes',    count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'entregue',   count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue'),
    'em_rota',    count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='em_rota'),
    'insucesso',  count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='insucesso'),
    'perc_conclusao', CASE WHEN count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco) > 0
      THEN round(100.0 * count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue')
           / count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco), 1) ELSE 0 END
  ) INTO v_risco FROM _dash_pac;

  SELECT max(last_synced_at) INTO v_sync FROM public.meli_rotas WHERE data_rota = v_dia;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', base_id, 'base_codigo', base_codigo,
           'last_synced_at', ls) ORDER BY ls NULLS FIRST), '[]'::jsonb)
    INTO v_sync_bases
  FROM (SELECT base_id, base_codigo, max(last_synced_at) AS ls FROM _dash_pac GROUP BY 1,2) s;

  RETURN jsonb_build_object(
    'status','ok',
    'data_operacional', v_dia,
    'server_time', now(),
    'cards', v_cards,
    'motivos_insucesso', v_motivos,
    'rotas', v_rotas,
    'bases', v_bases,
    'area_risco', v_risco,
    'ultima_sincronizacao', v_sync,
    'sincronizacao_por_base', v_sync_bases
  );
END;
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) TO authenticated, service_role;

-- ============ Detalhe dos pacotes de uma rota (Meli + status físico JM) ============
CREATE OR REPLACE FUNCTION public.meli_dashboard_pacotes_rota(p_rota_id uuid, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit,500),1),2000);
  v_rows jsonb := '[]'::jsonb;
  v_rota jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT jsonb_build_object(
           'id', r.id, 'route_id', r.route_id, 'cluster', r.cluster,
           'nome_operacional', coalesce(nullif(btrim(r.cluster),''), r.route_id),
           'base_codigo', b.codigo, 'base_nome', b.nome,
           'driver_name', r.driver_name, 'vehicle_license', r.vehicle_license,
           'data_rota', r.data_rota, 'last_synced_at', r.last_synced_at,
           'rota_area_risco', r.rota_area_risco, 'area_risco_parcial', r.area_risco_parcial,
           'motivo_area_risco', r.motivo_area_risco, 'origem_area_risco', r.origem_area_risco,
           'dia_anterior', r.data_rota < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
    INTO v_rota
    FROM public.meli_rotas r LEFT JOIN public.bases b ON b.id = r.base_id
   WHERE r.id = p_rota_id;

  IF v_rota IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.ordem NULLS LAST, x.tracking_id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT p.tracking_id, p.shipment_id, p.stop_id, p.ordem,
           p.status, p.substatus, p.occurrence_code,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
           coalesce(c.descricao, p.occurrence_code, p.substatus, p.status) AS descricao_ocorrencia,
           p.pacote_area_risco, p.motivo_area_risco, p.origem_area_risco,
           coalesce(p.last_synced_at, p.updated_at) AS ultima_atualizacao_meli,
           e.recebido AS jm_recebido, e.recebido_em AS jm_recebido_em,
           e.triado AS jm_triado, e.triado_em AS jm_triado_em
      FROM public.meli_pacotes p
      LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = p.occurrence_code
      LEFT JOIN public.escalas e ON e.meli_pacote_id = p.id
     WHERE p.rota_id = p_rota_id
     LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('status','ok','rota',v_rota,'pacotes',v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) TO authenticated, service_role;