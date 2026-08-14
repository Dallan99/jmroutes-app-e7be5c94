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
    FROM public.meli_rotas_ativas r
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
    FROM public.meli_rotas_ativas r CROSS JOIN dia
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

CREATE OR REPLACE FUNCTION public.meli_dashboard_pacotes_rota(p_rota_id uuid, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    FROM public.meli_rotas_ativas r LEFT JOIN public.bases b ON b.id = r.base_id
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
$function$;

CREATE OR REPLACE FUNCTION public.meli_detalhar_rota(p_rota_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_rota jsonb;
  v_imp jsonb;
  v_total bigint := 0;
  v_pacotes jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT to_jsonb(r) INTO v_rota FROM public.meli_rotas_ativas r WHERE r.id = p_rota_id;
  IF v_rota IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  SELECT to_jsonb(i) INTO v_imp
  FROM public.meli_importacoes i
  WHERE i.id = (v_rota->>'origem_importacao')::uuid;

  WITH pag AS (
    SELECT p.id, p.rota_id, p.tracking_id, p.shipment_id, p.destinatario,
           p.endereco, p.bairro, p.cidade, p.uf, p.cep, p.status,
           p.printed_label, p.ordem, p.created_at, p.updated_at,
           count(*) OVER() AS total_full
    FROM public.meli_pacotes p
    WHERE p.rota_id = p_rota_id
    ORDER BY p.ordem NULLS LAST, p.tracking_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(pag) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_pacotes
  FROM pag;

  RETURN jsonb_build_object(
    'status','ok',
    'rota', v_rota,
    'importacao', v_imp,
    'pacotes', v_pacotes,
    'total_pacotes', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_listar_rotas(p_cluster text DEFAULT NULL::text, p_data_de date DEFAULT NULL::date, p_data_ate date DEFAULT NULL::date, p_busca text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  WITH filtered AS (
    SELECT r.id, r.route_id, r.cluster, r.carrier, r.facility, r.data_rota,
           r.total_pacotes, r.total_impressos, r.origem_importacao,
           r.created_at, r.updated_at,
           i.iniciado_em AS ultima_importacao_em,
           count(*) OVER() AS total_full
    FROM public.meli_rotas_ativas r
    LEFT JOIN public.meli_importacoes i ON i.id = r.origem_importacao
    WHERE (p_cluster IS NULL OR r.cluster = p_cluster)
      AND (p_data_de IS NULL OR r.data_rota >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_rota <= p_data_ate)
      AND (
        p_busca IS NULL
        OR r.route_id ILIKE '%'||p_busca||'%'
        OR coalesce(r.facility,'') ILIKE '%'||p_busca||'%'
      )
    ORDER BY r.data_rota DESC NULLS LAST, r.created_at DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(filtered) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_rows
  FROM filtered;

  RETURN jsonb_build_object(
    'status','ok',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rotas', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_latest timestamptz;
  v_imp    jsonb;
  v_erros  bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT max(last_synced_at) INTO v_latest FROM public.meli_rotas_ativas;

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
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_status_bases()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  WITH b AS (
    SELECT id, codigo, nome FROM public.bases WHERE ativa = true
  ),
  ult AS (
    SELECT r.base_id,
           max(r.last_synced_at) AS ultimo_sucesso_em,
           max(r.data_rota)      AS data_rota
    FROM public.meli_rotas_ativas r
    WHERE r.base_id IS NOT NULL
    GROUP BY r.base_id
  ),
  cnt AS (
    SELECT r.base_id,
           count(*)::int AS rotas,
           coalesce(sum(r.total_pacotes),0)::int AS pacotes
    FROM public.meli_rotas_ativas r
    JOIN ult u ON u.base_id = r.base_id AND r.data_rota = u.data_rota
    GROUP BY r.base_id
  ),
  exec AS (
    SELECT DISTINCT ON (e.base_id)
           e.base_id, e.status, e.sessao_status, e.mensagem_segura,
           e.iniciado_em, e.finalizado_em, e.rotas_encontradas, e.pacotes_enviados, e.erros
    FROM public.meli_worker_execucoes e
    ORDER BY e.base_id, e.iniciado_em DESC
  ),
  ciclo AS (
    SELECT c.base_id, bool_or(c.estado = 'em_processamento') AS sincronizando
    FROM public.meli_sync_ciclos c
    WHERE c.data_operacional >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1
    GROUP BY c.base_id
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'base_id',            b.id,
             'base_codigo',        b.codigo,
             'base_nome',          b.nome,
             'ultimo_sucesso_em',  u.ultimo_sucesso_em,
             'ultima_tentativa_em', greatest(coalesce(x.finalizado_em, x.iniciado_em), u.ultimo_sucesso_em),
             'status',             x.status,
             'sessao_status',      x.sessao_status,
             'mensagem_segura',    left(coalesce(x.mensagem_segura,''), 300),
             'rotas_encontradas',  coalesce(c.rotas, x.rotas_encontradas, 0),
             'pacotes_encontrados', coalesce(c.pacotes, x.pacotes_enviados, 0),
             'erros',              coalesce(x.erros, 0),
             'data_rota',          u.data_rota,
             'sincronizando',      coalesce(s.sincronizando, false)
           ) ORDER BY b.codigo
         )
    INTO v_out
  FROM b
  LEFT JOIN ult  u ON u.base_id = b.id
  LEFT JOIN cnt  c ON c.base_id = b.id
  LEFT JOIN exec x ON x.base_id = b.id
  LEFT JOIN ciclo s ON s.base_id = b.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'bases', coalesce(v_out, '[]'::jsonb)
  );
END;
$function$;

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
      FROM public.meli_rotas_ativas r
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

CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(p_data_de date DEFAULT NULL::date, p_data_ate date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 7);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_eleg text[] := ARRAY['buyer_rejected','buyer_absent','business_closed','unvisited_address',
                         'damaged','bad_address','missrouted','blocked_by_keyword'];
  v_criadas int := 0;
  v_atualizadas int := 0;
  v_revisao int := 0;
  r record;
  v_estado text;
  v_atual public.meli_devolucoes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  FOR r IN
    SELECT p.tracking_id,
           lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) AS codigo,
           p.status, p.substatus, p.occurrence_code,
           coalesce(p.last_synced_at, p.updated_at) AS ocorrido_em,
           p.last_synced_at,
           ro.id AS rota_id, ro.route_id, ro.cluster, ro.base_id,
           ro.driver_name, ro.carrier,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_pacotes p
      JOIN public.meli_rotas_ativas ro ON ro.id = p.rota_id
     WHERE ro.base_id IS NOT NULL
       AND public.has_base_access(v_uid, ro.base_id)
       AND (p_base_id IS NULL OR ro.base_id = p_base_id)
       AND ro.data_rota BETWEEN v_de AND v_ate
       AND public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = 'insucesso'
  LOOP
    IF r.codigo = ANY (v_eleg) THEN
      v_estado := 'aguardando_retorno';
    ELSIF r.codigo IN ('missing','lost','stolen') THEN
      v_estado := 'em_investigacao';
    ELSIF r.codigo = 'transferred' THEN
      v_estado := 'transferido';
    ELSE
      v_estado := 'revisao_necessaria';
      v_revisao := v_revisao + 1;
    END IF;

    SELECT * INTO v_atual FROM public.meli_devolucoes WHERE tracking_id = r.tracking_id;

    IF v_atual.id IS NULL THEN
      INSERT INTO public.meli_devolucoes (
        tracking_id, base_id, rota_id, route_id, cluster, motorista, transportadora,
        occurrence_code, meli_status, meli_substatus, situacao_meli,
        ocorrido_em, prazo_retorno_em, last_synced_at, estado
      ) VALUES (
        r.tracking_id, r.base_id, r.rota_id, r.route_id, r.cluster, r.driver_name, r.carrier,
        coalesce(nullif(r.codigo, ''), 'desconhecido'), r.status, r.substatus, r.situacao,
        r.ocorrido_em, r.ocorrido_em + interval '3 days', r.last_synced_at, v_estado
      );
      v_criadas := v_criadas + 1;

      INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_novo, detalhes, registrado_por)
      SELECT d.id, d.tracking_id, d.base_id, 'criada', d.estado,
             jsonb_build_object('occurrence_code', d.occurrence_code, 'origem', 'sincronizacao'), v_uid
        FROM public.meli_devolucoes d WHERE d.tracking_id = r.tracking_id;
    ELSE
      UPDATE public.meli_devolucoes d
         SET meli_status = r.status,
             meli_substatus = r.substatus,
             situacao_meli = r.situacao,
             last_synced_at = r.last_synced_at,
             rota_id = coalesce(r.rota_id, d.rota_id),
             route_id = coalesce(r.route_id, d.route_id),
             cluster = coalesce(r.cluster, d.cluster),
             motorista = coalesce(r.driver_name, d.motorista),
             transportadora = coalesce(r.carrier, d.transportadora),
             occurrence_code = CASE WHEN r.codigo <> '' THEN r.codigo ELSE d.occurrence_code END,
             ocorrido_em = CASE WHEN r.codigo <> '' AND r.codigo <> d.occurrence_code
                                THEN r.ocorrido_em ELSE d.ocorrido_em END,
             prazo_retorno_em = CASE WHEN r.codigo <> '' AND r.codigo <> d.occurrence_code
                                THEN r.ocorrido_em + interval '3 days' ELSE d.prazo_retorno_em END,
             estado = CASE
               WHEN d.estado IN ('recebido_na_base','divergencia_delivered','encerrado') THEN d.estado
               ELSE v_estado END
       WHERE d.id = v_atual.id
         AND (d.meli_status IS DISTINCT FROM r.status
              OR d.meli_substatus IS DISTINCT FROM r.substatus
              OR d.occurrence_code IS DISTINCT FROM nullif(r.codigo, '')
              OR d.last_synced_at IS DISTINCT FROM r.last_synced_at);

      IF FOUND THEN
        v_atualizadas := v_atualizadas + 1;
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
        VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'atualizacao_meli', v_atual.estado,
                (SELECT estado FROM public.meli_devolucoes WHERE id = v_atual.id),
                jsonb_build_object('occurrence_code', r.codigo, 'meli_status', r.status, 'meli_substatus', r.substatus), v_uid);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'criadas', v_criadas,
    'atualizadas', v_atualizadas, 'revisao_necessaria', v_revisao,
    'data_de', v_de, 'data_ate', v_ate, 'server_time', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.devolucao_lote_bipar(p_lote_id uuid, p_codigo text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT d.id, d.devolvido_em, d.lote_id INTO v_existente
    FROM public.devolucoes d
   WHERE upper(d.shipment_codigo) = v_cod AND d.base_id = v_lote.base_id AND d.cancelado = false
   ORDER BY d.devolvido_em DESC LIMIT 1;
  IF v_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicado','mensagem','Pacote ' || v_cod || ' já recebido nesta base.',
                              'devolvido_em', v_existente.devolvido_em);
  END IF;

  SELECT p.occurrence_code, p.status, p.substatus, r.base_id AS rota_base_id,
         r.route_id, r.driver_name
    INTO v_pac
    FROM public.meli_pacotes p
    JOIN public.meli_rotas_ativas r ON r.id = p.rota_id
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
$function$;

REVOKE ALL ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(date,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_bipar(uuid,text,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_detalhar_rota(uuid,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_listar_rotas(text,date,date,text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(date,uuid,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_bipar(uuid,text,text) TO authenticated, service_role;