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
    FROM public.meli_rotas r
    WHERE r.base_id IS NOT NULL
    GROUP BY r.base_id
  ),
  cnt AS (
    SELECT r.base_id,
           count(*)::int AS rotas,
           coalesce(sum(r.total_pacotes),0)::int AS pacotes
    FROM public.meli_rotas r
    JOIN ult u ON u.base_id = r.base_id AND r.data_rota = u.data_rota
    GROUP BY r.base_id
  ),
  exec AS (
    SELECT DISTINCT ON (e.base_id)
           e.base_id, e.status, e.sessao_status, e.mensagem_segura,
           e.iniciado_em, e.finalizado_em, e.rotas_encontradas, e.pacotes_enviados, e.erros
    FROM public.meli_worker_execucoes e
    ORDER BY e.base_id, e.iniciado_em DESC
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
             'data_rota',          u.data_rota
           ) ORDER BY b.codigo
         )
    INTO v_out
  FROM b
  LEFT JOIN ult  u ON u.base_id = b.id
  LEFT JOIN cnt  c ON c.base_id = b.id
  LEFT JOIN exec x ON x.base_id = b.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'bases', coalesce(v_out, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO service_role;