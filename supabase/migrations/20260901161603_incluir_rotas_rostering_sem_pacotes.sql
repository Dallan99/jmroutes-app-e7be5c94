-- Rotas classificadas diretamente pelo Rostering podem não possuir pacotes no
-- monitor de entregas. O painel deve preservar essa evidência e exibi-las com
-- totais zerados, sem fabricar resultados de entrega.
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(
  p_data date DEFAULT NULL::date,
  p_base_id uuid DEFAULT NULL::uuid,
  p_rota text DEFAULT NULL::text,
  p_motorista text DEFAULT NULL::text,
  p_transportadora text DEFAULT NULL::text,
  p_risco text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text
)
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
           p.id AS pacote_id,
           coalesce(p.pacote_area_risco, false) AS pacote_area_risco,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_rotas r
      LEFT JOIN public.meli_pacotes p ON p.rota_id = r.id
      LEFT JOIN public.bases b ON b.id = r.base_id
     WHERE (r.rota_area_risco OR r.area_risco_parcial OR coalesce(p.pacote_area_risco, false))
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
    SELECT * FROM pac
     WHERE p_status IS NULL
        OR (pacote_id IS NOT NULL AND situacao = p_status)
  ), rotas AS (
    SELECT rota_id, route_id, cluster, base_id, base_codigo, base_nome,
           driver_name, vehicle_license, carrier, data_rota,
           max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           max(motivo_area_risco) AS motivo_area_risco,
           max(codigo_area_risco) AS codigo_area_risco,
           max(origem_area_risco) AS origem_area_risco,
           count(pacote_id)::int AS total,
           count(pacote_id) FILTER (WHERE pacote_area_risco OR rota_area_risco)::int AS pacotes_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'entregue')::int AS entregue_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao IN ('nao_iniciado','em_rota','desconhecido'))::int AS pendente_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'insucesso')::int AS insucesso_risco
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
