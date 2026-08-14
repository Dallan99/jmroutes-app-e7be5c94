-- ─────────────────────────────────────────────────────────────────────────────
-- Regra central: rotas PM da ESP16 ficam fora dos indicadores SOMENTE enquanto
-- estiverem "não iniciadas". PM em andamento ou finalizada entra na conta do dia.
-- Nenhuma alteração de dados, RLS ou ingestão.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Marcador PM no nome operacional da rota (cluster ou route_id)
CREATE OR REPLACE FUNCTION public.meli_rota_pm(p_nome text, p_route_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT upper(coalesce(p_nome, '') || ' ' || coalesce(p_route_id, ''))
         ~ '(^|[^A-Z0-9])PM[0-9]*([^A-Z0-9]|$)';
$$;

-- 2) Estado operacional real da rota (precedência: evidência dos pacotes > substatus > status)
CREATE OR REPLACE FUNCTION public.meli_rota_estado_operacional(p_rota_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_st text; v_sub text;
  v_total int := 0; v_term int := 0; v_andamento int := 0;
BEGIN
  SELECT lower(coalesce(r.route_status, '')), lower(coalesce(r.route_substatus, ''))
    INTO v_st, v_sub
    FROM public.meli_rotas r WHERE r.id = p_rota_id;
  IF NOT FOUND THEN RETURN 'nao_iniciada'; END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE s IN ('entregue','insucesso','cancelado'))::int,
         count(*) FILTER (WHERE s IN ('entregue','insucesso','em_rota'))::int
    INTO v_total, v_term, v_andamento
    FROM (
      SELECT public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS s
        FROM public.meli_pacotes p WHERE p.rota_id = p_rota_id
    ) x;

  -- finalizada: todos os pacotes em estado terminal ou status Meli de conclusão
  IF v_total > 0 AND v_term = v_total THEN RETURN 'finalizada'; END IF;
  IF v_st IN ('finished','finalized','closed','completed','done')
     AND v_sub NOT IN ('on_way_destination_facility','planned','pending') THEN
    RETURN 'finalizada';
  END IF;

  -- em andamento: evidência operacional nos pacotes
  IF v_andamento > 0 THEN RETURN 'em_andamento'; END IF;

  -- em andamento: substatus/status da rota indicando início real
  IF v_sub IN ('started','in_route','on_route','out_for_delivery','picked_up','delivering','in_progress') THEN
    RETURN 'em_andamento';
  END IF;
  IF v_st IN ('active','in_route','on_route','started','in_progress','close')
     AND v_sub NOT IN ('on_way_destination_facility','planned','pending','created','not_started') THEN
    RETURN 'em_andamento';
  END IF;

  RETURN 'nao_iniciada';
END;
$$;

-- 3) Regra única de exclusão dos indicadores
CREATE OR REPLACE FUNCTION public.meli_rota_pm_excluida(p_rota_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT b.codigo = 'ESP16'
            AND public.meli_rota_pm(r.cluster, r.route_id)
            AND public.meli_rota_estado_operacional(r.id) = 'nao_iniciada'
       FROM public.meli_rotas r
       LEFT JOIN public.bases b ON b.id = r.base_id
      WHERE r.id = p_rota_id),
  false);
$$;

REVOKE ALL ON FUNCTION public.meli_rota_pm(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_pm(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_pm(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_rota_estado_operacional(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_estado_operacional(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_estado_operacional(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_rota_pm_excluida(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_pm_excluida(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_pm_excluida(uuid) TO authenticated, service_role;

-- 4) Dashboard operacional: exclui PM não iniciadas e devolve a lista separada
CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(p_data date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid, p_motorista text DEFAULT NULL::text, p_rota text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_transportadora text DEFAULT NULL::text, p_risco text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH perm AS (SELECT public.meli_pode_operar() AS ok),
dia AS (SELECT coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS v),
rotas_dia AS (
  SELECT r.id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo, b.nome AS base_nome,
         b.meli_service_center_id AS service_center, r.driver_name, r.vehicle_license, r.carrier,
         r.data_rota, r.last_synced_at, r.rota_area_risco, r.area_risco_parcial,
         r.motivo_area_risco, public.meli_rota_pm_excluida(r.id) AS pm_excluida
    FROM public.meli_rotas r
    CROSS JOIN dia
    LEFT JOIN public.bases b ON b.id = r.base_id
   WHERE (SELECT ok FROM perm)
     AND r.data_rota = dia.v
     AND (p_base_id IS NULL OR r.base_id = p_base_id)
     AND (p_motorista IS NULL OR r.driver_name ILIKE '%'||p_motorista||'%')
     AND (p_rota IS NULL OR r.route_id ILIKE '%'||p_rota||'%' OR coalesce(r.cluster,'') ILIKE '%'||p_rota||'%')
     AND (p_transportadora IS NULL OR r.carrier ILIKE '%'||p_transportadora||'%')
     AND (p_risco IS NULL
          OR (p_risco = 'qualquer' AND (r.rota_area_risco OR r.area_risco_parcial))
          OR (p_risco = 'integral' AND r.rota_area_risco)
          OR (p_risco = 'parcial'  AND r.area_risco_parcial))
),
pac AS (
  SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, r.base_codigo, r.base_nome,
         r.service_center, r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco,
         coalesce(p.motivo_area_risco, r.motivo_area_risco) AS motivo_area_risco,
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
         p.occurrence_code, p.substatus, p.status
    FROM rotas_dia r
    JOIN public.meli_pacotes p ON p.rota_id = r.id
   WHERE NOT r.pm_excluida
     AND (p_status IS NULL
          OR public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = p_status)
),
pm AS (
  SELECT r.id AS rota_id, r.route_id,
         coalesce(nullif(btrim(r.cluster),''), r.route_id) AS nome_operacional,
         r.cluster, r.base_id, r.base_codigo, r.base_nome, r.driver_name, r.vehicle_license,
         r.data_rota, r.last_synced_at,
         (SELECT count(*)::int FROM public.meli_pacotes p WHERE p.rota_id = r.id) AS total
    FROM rotas_dia r
   WHERE r.pm_excluida
),
pm_json AS (
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome_operacional), '[]'::jsonb) AS j,
         count(*)::int AS rotas, coalesce(sum(total), 0)::int AS pacotes
    FROM pm x
),
cards AS (
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
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial),
    'pm_nao_iniciadas', (SELECT rotas FROM pm_json),
    'pm_pacotes_fora',  (SELECT pacotes FROM pm_json)
  ) AS j FROM pac
),
motivos AS (
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'total')::int DESC), '[]'::jsonb) AS j
  FROM (
    SELECT jsonb_build_object(
             'codigo', s.k,
             'descricao', coalesce(c.descricao, s.k),
             'cadastrado', c.codigo IS NOT NULL,
             'total', s.t
           ) AS x
    FROM (
      SELECT coalesce(nullif(occurrence_code,''), nullif(substatus,''), nullif(status,''), 'sem_codigo') AS k,
             count(*)::int AS t
        FROM pac WHERE situacao = 'insucesso' GROUP BY 1
    ) s
    LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = s.k
  ) y
),
rotas AS (
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.insucesso DESC, r.perc_entrega ASC, r.em_rota DESC, r.pacotes_risco DESC), '[]'::jsonb) AS j
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
      FROM pac
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome, service_center,
              driver_name, vehicle_license, carrier, data_rota
  ) r
),
pm_por_base AS (
  SELECT base_id, base_codigo, count(*)::int AS rotas, coalesce(sum(total),0)::int AS pacotes
    FROM pm GROUP BY 1,2
),
bases_agg AS (
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb) AS j
  FROM (
    SELECT s.base_id, s.base_codigo, s.base_nome, s.service_center, s.rotas, s.rotas_risco,
           s.rotas_risco_integral, s.rotas_risco_parcial, s.total, s.pacotes_risco,
           s.entregue, s.em_rota, s.insucesso, s.perc_entrega,
           coalesce(pb.rotas, 0) AS pm_nao_iniciadas,
           coalesce(pb.pacotes, 0) AS pm_pacotes_fora
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
          FROM pac
         GROUP BY base_id, base_codigo, base_nome, service_center
      ) s
      LEFT JOIN pm_por_base pb
        ON coalesce(pb.base_id::text, pb.base_codigo, '') = coalesce(s.base_id::text, s.base_codigo, '')
  ) b
),
risco AS (
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
  ) AS j FROM pac
),
sync AS (
  SELECT max(r.last_synced_at) AS v
    FROM public.meli_rotas r CROSS JOIN dia
   WHERE (SELECT ok FROM perm) AND r.data_rota = dia.v
),
sync_bases AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', base_id, 'base_codigo', base_codigo,
           'last_synced_at', ls) ORDER BY ls NULLS FIRST), '[]'::jsonb) AS j
  FROM (SELECT base_id, base_codigo, max(last_synced_at) AS ls FROM pac GROUP BY 1,2) s
)
SELECT CASE WHEN NOT (SELECT ok FROM perm)
  THEN jsonb_build_object('status','erro','erro','sem_permissao')
  ELSE jsonb_build_object(
    'status','ok',
    'data_operacional', (SELECT v FROM dia),
    'server_time', now(),
    'cards', (SELECT j FROM cards),
    'motivos_insucesso', (SELECT j FROM motivos),
    'rotas', (SELECT j FROM rotas),
    'bases', (SELECT j FROM bases_agg),
    'area_risco', (SELECT j FROM risco),
    'pm_programadas', (SELECT j FROM pm_json),
    'ultima_sincronizacao', (SELECT v FROM sync),
    'sincronizacao_por_base', (SELECT j FROM sync_bases)
  ) END;
$function$;

-- 5) Área de risco: aplica a mesma regra central
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(p_data date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid, p_rota text DEFAULT NULL::text, p_motorista text DEFAULT NULL::text, p_transportadora text DEFAULT NULL::text, p_risco text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH pac AS (
    SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
           b.nome AS base_nome, r.driver_name, r.vehicle_license, r.carrier,
           r.data_rota, r.last_synced_at,
           r.rota_area_risco, r.area_risco_parcial,
           coalesce(r.motivo_area_risco, '') AS motivo_area_risco,
           coalesce(r.codigo_area_risco, '') AS codigo_area_risco,
           coalesce(r.origem_area_risco, '') AS origem_area_risco,
           p.pacote_area_risco,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_rotas r
      JOIN public.meli_pacotes p ON p.rota_id = r.id
      LEFT JOIN public.bases b ON b.id = r.base_id
     WHERE (r.rota_area_risco OR r.area_risco_parcial OR p.pacote_area_risco)
       AND (r.base_id IS NOT NULL AND public.has_base_access(v_uid, r.base_id))
       AND (p_base_id IS NULL OR r.base_id = p_base_id)
       AND (r.data_rota = v_data)
       AND NOT public.meli_rota_pm_excluida(r.id)
       AND (p_rota IS NULL OR r.route_id ILIKE '%' || p_rota || '%' OR coalesce(r.cluster, '') ILIKE '%' || p_rota || '%')
       AND (p_motorista IS NULL OR coalesce(r.driver_name, '') ILIKE '%' || p_motorista || '%')
       AND (p_transportadora IS NULL OR coalesce(r.carrier, '') ILIKE '%' || p_transportadora || '%')
       AND (p_risco IS NULL OR p_risco = 'qualquer'
            OR (p_risco = 'integral' AND r.rota_area_risco)
            OR (p_risco = 'parcial' AND r.area_risco_parcial AND NOT r.rota_area_risco))
  ), pac_f AS (
    SELECT * FROM pac WHERE p_status IS NULL OR situacao = p_status
  ), rotas AS (
    SELECT rota_id, route_id, cluster, base_id, base_codigo, base_nome,
           driver_name, vehicle_license, carrier, data_rota,
           max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           max(motivo_area_risco) AS motivo_area_risco,
           max(codigo_area_risco) AS codigo_area_risco,
           max(origem_area_risco) AS origem_area_risco,
           count(*)::int AS total,
           count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco)::int AS pacotes_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'entregue')::int AS entregue_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao IN ('nao_iniciado','em_rota','desconhecido'))::int AS pendente_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'insucesso')::int AS insucesso_risco
      FROM pac_f
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome,
              driver_name, vehicle_license, carrier, data_rota
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_operacional', v_data,
    'server_time', now(),
    'cards', (
      SELECT jsonb_build_object(
        'rotas', coalesce(count(*), 0),
        'rotas_integrais', coalesce(count(*) FILTER (WHERE rota_area_risco), 0),
        'rotas_parciais', coalesce(count(*) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco), 0),
        'pacotes', coalesce(sum(pacotes_risco), 0),
        'entregue', coalesce(sum(entregue_risco), 0),
        'pendente', coalesce(sum(pendente_risco), 0),
        'insucesso', coalesce(sum(insucesso_risco), 0),
        'perc_conclusao', CASE WHEN coalesce(sum(pacotes_risco), 0) > 0
          THEN round(100.0 * sum(entregue_risco) / sum(pacotes_risco), 1) ELSE 0 END,
        'ultima_sincronizacao', max(last_synced_at)
      ) FROM rotas
    ),
    'rotas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rota_id', rota_id,
        'route_id', route_id,
        'cluster', cluster,
        'base_id', base_id,
        'base_codigo', base_codigo,
        'base_nome', base_nome,
        'driver_name', driver_name,
        'vehicle_license', vehicle_license,
        'carrier', carrier,
        'data_rota', data_rota,
        'last_synced_at', last_synced_at,
        'rota_area_risco', rota_area_risco,
        'area_risco_parcial', area_risco_parcial,
        'motivo_area_risco', nullif(motivo_area_risco, ''),
        'codigo_area_risco', nullif(codigo_area_risco, ''),
        'origem_area_risco', nullif(origem_area_risco, ''),
        'total', total,
        'pacotes_risco', pacotes_risco,
        'entregue_risco', entregue_risco,
        'pendente_risco', pendente_risco,
        'insucesso_risco', insucesso_risco,
        'perc_conclusao', CASE WHEN pacotes_risco > 0
          THEN round(100.0 * entregue_risco / pacotes_risco, 1) ELSE 0 END
      ) ORDER BY pacotes_risco DESC, route_id)
      FROM rotas
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;
