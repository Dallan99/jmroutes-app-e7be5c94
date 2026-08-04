CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(
  p_data date DEFAULT NULL::date,
  p_base_id uuid DEFAULT NULL::uuid,
  p_motorista text DEFAULT NULL::text,
  p_rota text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_transportadora text DEFAULT NULL::text,
  p_risco text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH perm AS (SELECT public.meli_pode_operar() AS ok),
dia AS (SELECT coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS v),
pac AS (
  SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
         b.nome AS base_nome, b.meli_service_center_id AS service_center,
         r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco,
         coalesce(p.motivo_area_risco, r.motivo_area_risco) AS motivo_area_risco,
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
         p.occurrence_code, p.substatus, p.status
    FROM public.meli_rotas r
    CROSS JOIN dia
    LEFT JOIN public.bases b ON b.id = r.base_id
    JOIN public.meli_pacotes p ON p.rota_id = r.id
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
     AND (p_status IS NULL
          OR public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = p_status)
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
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)
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
bases_agg AS (
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb) AS j
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
    'ultima_sincronizacao', (SELECT v FROM sync),
    'sincronizacao_por_base', (SELECT j FROM sync_bases)
  ) END;
$function$;
