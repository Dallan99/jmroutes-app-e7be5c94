-- ============================================================================
-- Sincronização Meli — staging isolado + promoção atômica por base/dia.
-- Nenhuma escrita nas tabelas ativas durante a construção do lote.
-- ============================================================================

-- 1) Ponteiro do lote -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meli_sync_ciclos (
  sync_batch_id uuid PRIMARY KEY,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  origem text NOT NULL DEFAULT 'worker',
  estado text NOT NULL DEFAULT 'em_processamento',
  rotas_esperadas integer,
  rotas_recebidas integer NOT NULL DEFAULT 0,
  pacotes_recebidos integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT false,
  mensagem text,
  iniciado_por uuid,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_sync_ciclos_estado_chk
    CHECK (estado IN ('em_processamento','concluido','parcial','erro','abandonado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS meli_sync_ciclos_ativo_uniq
  ON public.meli_sync_ciclos (base_id, data_operacional) WHERE ativo;
CREATE INDEX IF NOT EXISTS meli_sync_ciclos_base_data_idx
  ON public.meli_sync_ciclos (base_id, data_operacional, estado);

GRANT SELECT ON public.meli_sync_ciclos TO authenticated;
GRANT ALL ON public.meli_sync_ciclos TO service_role;
REVOKE ALL ON public.meli_sync_ciclos FROM anon;
REVOKE ALL ON public.meli_sync_ciclos FROM PUBLIC;
ALTER TABLE public.meli_sync_ciclos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meli_sync_ciclos_select" ON public.meli_sync_ciclos;
CREATE POLICY "meli_sync_ciclos_select" ON public.meli_sync_ciclos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), base_id));

-- 2) Staging isolado -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meli_sync_rotas_staging (
  sync_batch_id uuid NOT NULL
    REFERENCES public.meli_sync_ciclos(sync_batch_id) ON DELETE CASCADE,
  route_id text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_rota date,
  payload_normalizado jsonb NOT NULL,
  total_pacotes integer NOT NULL DEFAULT 0,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, route_id)
);

CREATE TABLE IF NOT EXISTS public.meli_sync_pacotes_staging (
  sync_batch_id uuid NOT NULL,
  route_id text NOT NULL,
  tracking_id text NOT NULL,
  ordem integer,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, tracking_id),
  FOREIGN KEY (sync_batch_id, route_id)
    REFERENCES public.meli_sync_rotas_staging (sync_batch_id, route_id) ON DELETE CASCADE
);

GRANT SELECT ON public.meli_sync_rotas_staging TO authenticated;
GRANT SELECT ON public.meli_sync_pacotes_staging TO authenticated;
GRANT ALL ON public.meli_sync_rotas_staging TO service_role;
GRANT ALL ON public.meli_sync_pacotes_staging TO service_role;
REVOKE ALL ON public.meli_sync_rotas_staging FROM anon;
REVOKE ALL ON public.meli_sync_pacotes_staging FROM anon;
REVOKE ALL ON public.meli_sync_rotas_staging FROM PUBLIC;
REVOKE ALL ON public.meli_sync_pacotes_staging FROM PUBLIC;

ALTER TABLE public.meli_sync_rotas_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_sync_pacotes_staging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meli_sync_rotas_staging_select" ON public.meli_sync_rotas_staging;
CREATE POLICY "meli_sync_rotas_staging_select" ON public.meli_sync_rotas_staging
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), base_id));
DROP POLICY IF EXISTS "meli_sync_pacotes_staging_select" ON public.meli_sync_pacotes_staging;
CREATE POLICY "meli_sync_pacotes_staging_select" ON public.meli_sync_pacotes_staging
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meli_sync_rotas_staging s
     WHERE s.sync_batch_id = meli_sync_pacotes_staging.sync_batch_id
       AND s.route_id = meli_sync_pacotes_staging.route_id
       AND (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), s.base_id))
  ));

-- 3) Marcação do lote publicado nas rotas ativas ---------------------------
ALTER TABLE public.meli_rotas ADD COLUMN IF NOT EXISTS sync_batch_id uuid;
CREATE INDEX IF NOT EXISTS meli_rotas_sync_batch_idx ON public.meli_rotas (sync_batch_id);

-- 4) Fonte única de leitura do painel --------------------------------------
DROP VIEW IF EXISTS public.meli_rotas_ativas;
CREATE VIEW public.meli_rotas_ativas WITH (security_invoker = true) AS
SELECT r.* FROM public.meli_rotas r
WHERE r.sync_batch_id IS NULL
   OR EXISTS (
     SELECT 1 FROM public.meli_sync_ciclos c
      WHERE c.sync_batch_id = r.sync_batch_id
        AND c.ativo AND c.estado = 'concluido'
   );

GRANT SELECT ON public.meli_rotas_ativas TO authenticated;
GRANT SELECT ON public.meli_rotas_ativas TO service_role;
REVOKE ALL ON public.meli_rotas_ativas FROM anon;
REVOKE ALL ON public.meli_rotas_ativas FROM PUBLIC;

-- 5) RPCs do ciclo ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_iniciar(
  p_sync_batch_id uuid,
  p_base_codigo text,
  p_data_operacional date DEFAULT NULL,
  p_origem text DEFAULT 'worker',
  p_rotas_esperadas integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_base_id uuid;
  v_data date := coalesce(p_data_operacional, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_origem text := coalesce(nullif(btrim(p_origem), ''), 'worker');
  v_atual public.meli_sync_ciclos;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  IF p_sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','sync_batch_id_obrigatorio');
  END IF;

  SELECT id INTO v_base_id FROM public.bases WHERE upper(codigo) = upper(btrim(p_base_codigo));
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_encontrada');
  END IF;
  IF NOT public.has_base_access(v_uid, v_base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;

  SELECT * INTO v_atual FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_atual.sync_batch_id IS NOT NULL THEN
    IF v_atual.base_id <> v_base_id
       OR v_atual.data_operacional <> v_data
       OR v_atual.origem <> v_origem THEN
      RETURN jsonb_build_object('status','erro','erro','uuid_reutilizado_divergente');
    END IF;
    IF v_atual.estado <> 'em_processamento' THEN
      RETURN jsonb_build_object('status','erro','erro','ciclo_encerrado','estado',v_atual.estado);
    END IF;
    RETURN jsonb_build_object('status','ok','idempotente',true,
      'sync_batch_id',p_sync_batch_id,'base_id',v_base_id,'data_operacional',v_data);
  END IF;

  INSERT INTO public.meli_sync_ciclos (
    sync_batch_id, base_id, data_operacional, origem, estado, rotas_esperadas, iniciado_por
  ) VALUES (
    p_sync_batch_id, v_base_id, v_data, v_origem, 'em_processamento', p_rotas_esperadas, v_uid
  );

  RETURN jsonb_build_object('status','ok','idempotente',false,
    'sync_batch_id',p_sync_batch_id,'base_id',v_base_id,'data_operacional',v_data);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_rota_staging(
  p_sync_batch_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ciclo public.meli_sync_ciclos;
  v_route_id text;
  v_facility text;
  v_base_id uuid;
  v_data_rota date;
  v_pacotes jsonb;
  v_rotas int;
  v_pac int;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT * INTO v_ciclo FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_ciclo.sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','ciclo_desconhecido');
  END IF;
  IF v_ciclo.estado <> 'em_processamento' THEN
    RETURN jsonb_build_object('status','erro','erro','ciclo_nao_em_processamento','estado',v_ciclo.estado);
  END IF;
  IF NOT public.has_base_access(v_uid, v_ciclo.base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  v_facility := nullif(btrim(coalesce(
    p_payload->>'facility', p_payload->>'serviceCenterId',
    p_payload->>'service_center_id', p_payload->>'service_center')), '');
  IF v_facility IS NOT NULL THEN
    SELECT id INTO v_base_id FROM public.bases WHERE meli_service_center_id = v_facility LIMIT 1;
  END IF;
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_da_rota_indeterminada');
  END IF;
  IF v_base_id <> v_ciclo.base_id THEN
    RETURN jsonb_build_object('status','erro','erro','base_da_rota_divergente');
  END IF;

  v_data_rota := nullif(btrim(coalesce(p_payload->>'data_rota', p_payload->>'route_date')), '')::date;
  IF v_data_rota IS NOT NULL AND v_data_rota <> v_ciclo.data_operacional THEN
    RETURN jsonb_build_object('status','erro','erro','data_da_rota_divergente');
  END IF;

  v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages', '[]'::jsonb);
  IF jsonb_typeof(v_pacotes) <> 'array' THEN
    RETURN jsonb_build_object('status','erro','erro','pacotes_deve_ser_array');
  END IF;

  INSERT INTO public.meli_sync_rotas_staging (
    sync_batch_id, route_id, base_id, data_rota, payload_normalizado, total_pacotes, recebido_em
  ) VALUES (
    p_sync_batch_id, v_route_id, v_base_id, coalesce(v_data_rota, v_ciclo.data_operacional),
    p_payload, jsonb_array_length(v_pacotes), now()
  )
  ON CONFLICT (sync_batch_id, route_id) DO UPDATE
    SET base_id = EXCLUDED.base_id,
        data_rota = EXCLUDED.data_rota,
        payload_normalizado = EXCLUDED.payload_normalizado,
        total_pacotes = EXCLUDED.total_pacotes,
        recebido_em = now();

  DELETE FROM public.meli_sync_pacotes_staging
   WHERE sync_batch_id = p_sync_batch_id AND route_id = v_route_id;

  INSERT INTO public.meli_sync_pacotes_staging (sync_batch_id, route_id, tracking_id, ordem)
  SELECT p_sync_batch_id, v_route_id, t.tracking_id, min(t.ordem)
    FROM (
      SELECT nullif(btrim(coalesce(x->>'tracking_id', x->>'trackingId')), '') AS tracking_id,
             public._meli_safe_int(coalesce(x->>'ordem', x->>'order')) AS ordem
        FROM jsonb_array_elements(v_pacotes) x
    ) t
   WHERE t.tracking_id IS NOT NULL
   GROUP BY t.tracking_id
  ON CONFLICT (sync_batch_id, tracking_id) DO UPDATE
    SET route_id = EXCLUDED.route_id, ordem = EXCLUDED.ordem, recebido_em = now();

  SELECT count(DISTINCT route_id)::int INTO v_rotas
    FROM public.meli_sync_rotas_staging WHERE sync_batch_id = p_sync_batch_id;
  SELECT count(DISTINCT tracking_id)::int INTO v_pac
    FROM public.meli_sync_pacotes_staging WHERE sync_batch_id = p_sync_batch_id;

  UPDATE public.meli_sync_ciclos
     SET rotas_recebidas = v_rotas, pacotes_recebidos = v_pac, updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id;

  RETURN jsonb_build_object('status','ok','route_id',v_route_id,
    'rotas_no_lote',v_rotas,'pacotes_no_lote',v_pac);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_finalizar(
  p_sync_batch_id uuid,
  p_base_codigo text,
  p_data_operacional date DEFAULT NULL,
  p_rotas integer DEFAULT NULL,
  p_pacotes integer DEFAULT NULL,
  p_estado text DEFAULT 'concluido',
  p_mensagem text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ciclo public.meli_sync_ciclos;
  v_base_id uuid;
  v_data date := coalesce(p_data_operacional, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_estado_worker text := coalesce(nullif(btrim(p_estado), ''), 'concluido');
  v_rotas int;
  v_pacotes int;
  r record;
  v_imp jsonb;
  v_rota_id uuid;
  v_promovidas int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT id INTO v_base_id FROM public.bases WHERE upper(codigo) = upper(btrim(p_base_codigo));
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_encontrada');
  END IF;
  IF NOT public.has_base_access(v_uid, v_base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;

  -- Serializa finalizações da mesma base/dia até o fim da transação.
  PERFORM pg_advisory_xact_lock(hashtext('meli_sync_' || v_base_id::text || '_' || v_data::text));

  SELECT * INTO v_ciclo FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_ciclo.sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','ignorado','motivo','ciclo_desconhecido');
  END IF;

  -- Idempotente: repetir a mesma finalização não altera nada.
  IF v_ciclo.estado = 'concluido' THEN
    RETURN jsonb_build_object('status','ok','idempotente',true,
      'lote_ativo',v_ciclo.sync_batch_id,
      'rotas',v_ciclo.rotas_recebidas,'pacotes',v_ciclo.pacotes_recebidos);
  END IF;

  SELECT count(DISTINCT route_id)::int INTO v_rotas
    FROM public.meli_sync_rotas_staging WHERE sync_batch_id = p_sync_batch_id;
  SELECT count(DISTINCT tracking_id)::int INTO v_pacotes
    FROM public.meli_sync_pacotes_staging WHERE sync_batch_id = p_sync_batch_id;

  -- Validações: qualquer falha marca o ciclo e NÃO promove nada.
  IF v_ciclo.estado <> 'em_processamento' THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, v_ciclo.estado, 'ciclo_encerrado', p_mensagem);
  END IF;
  IF v_ciclo.base_id <> v_base_id THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'erro', 'base_divergente', p_mensagem);
  END IF;
  IF v_ciclo.data_operacional <> v_data THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'erro', 'data_divergente', p_mensagem);
  END IF;
  IF v_estado_worker <> 'concluido' THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id,
      CASE WHEN v_estado_worker = 'parcial' THEN 'parcial' ELSE 'erro' END,
      'ciclo_com_erro', p_mensagem);
  END IF;
  IF v_rotas <= 0 THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'sem_rotas_no_ciclo', p_mensagem);
  END IF;
  IF p_rotas IS NOT NULL AND p_rotas <> v_rotas THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'quantidade_rotas_divergente', p_mensagem);
  END IF;
  IF p_pacotes IS NOT NULL AND p_pacotes <> v_pacotes THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'quantidade_pacotes_divergente', p_mensagem);
  END IF;

  -- ── Promoção do snapshot completo, em uma única transação ───────────────
  FOR r IN
    SELECT route_id, payload_normalizado, data_rota
      FROM public.meli_sync_rotas_staging
     WHERE sync_batch_id = p_sync_batch_id
     ORDER BY route_id
  LOOP
    v_imp := public.meli_importar_rota(r.payload_normalizado, 'sync:' || p_sync_batch_id::text);
    IF coalesce(v_imp->>'status','') <> 'ok' THEN
      RAISE EXCEPTION 'falha_na_promocao_%: %', r.route_id, coalesce(v_imp->>'erro','desconhecido');
    END IF;
    v_rota_id := nullif(v_imp->>'rota_id','')::uuid;
    IF v_rota_id IS NOT NULL THEN
      UPDATE public.meli_rotas SET sync_batch_id = p_sync_batch_id WHERE id = v_rota_id;

      -- Reconciliação dos pacotes REMOVIDOS pelo Meli (presentes no lote
      -- anterior e ausentes no snapshot atual). Executa dentro da mesma
      -- transação de promoção. Nunca apaga pacote com vínculo operacional
      -- (recebido/triado na escala): esse fica marcado como fora do snapshot.
      UPDATE public.escalas e
         SET meli_pacote_id = NULL
       WHERE e.meli_pacote_id IN (
               SELECT p.id FROM public.meli_pacotes p
                WHERE p.rota_id = v_rota_id
                  AND NOT EXISTS (
                    SELECT 1 FROM public.meli_sync_pacotes_staging s
                     WHERE s.sync_batch_id = p_sync_batch_id
                       AND s.route_id = r.route_id
                       AND s.tracking_id = p.tracking_id)
             )
         AND e.recebido = false
         AND e.triado = false;

      DELETE FROM public.meli_pacotes p
       WHERE p.rota_id = v_rota_id
         AND NOT EXISTS (
           SELECT 1 FROM public.meli_sync_pacotes_staging s
            WHERE s.sync_batch_id = p_sync_batch_id
              AND s.route_id = r.route_id
              AND s.tracking_id = p.tracking_id)
         AND NOT EXISTS (
           SELECT 1 FROM public.escalas e WHERE e.meli_pacote_id = p.id);

      PERFORM public.meli_publicar_rota_operacional(v_rota_id, r.data_rota);
    END IF;
    v_promovidas := v_promovidas + 1;
  END LOOP;

  UPDATE public.meli_sync_ciclos
     SET ativo = false, updated_at = now()
   WHERE base_id = v_base_id AND data_operacional = v_data AND ativo
     AND sync_batch_id <> p_sync_batch_id;

  UPDATE public.meli_sync_ciclos
     SET estado = 'concluido', ativo = true, rotas_recebidas = v_rotas,
         pacotes_recebidos = v_pacotes, mensagem = nullif(btrim(coalesce(p_mensagem,'')),''),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id;

  RETURN jsonb_build_object('status','ok','idempotente',false,
    'lote_ativo',p_sync_batch_id,'rotas',v_rotas,'pacotes',v_pacotes,
    'rotas_promovidas',v_promovidas);
END;
$function$;

CREATE OR REPLACE FUNCTION public._meli_sync_marcar(
  p_sync_batch_id uuid, p_estado text, p_motivo text, p_mensagem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lote uuid;
BEGIN
  UPDATE public.meli_sync_ciclos
     SET estado = p_estado, ativo = false,
         mensagem = left(coalesce(nullif(btrim(coalesce(p_mensagem,'')),''), p_motivo), 300),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id
     AND estado = 'em_processamento';

  SELECT c.sync_batch_id INTO v_lote
    FROM public.meli_sync_ciclos c
    JOIN public.meli_sync_ciclos alvo ON alvo.sync_batch_id = p_sync_batch_id
   WHERE c.base_id = alvo.base_id AND c.data_operacional = alvo.data_operacional
     AND c.ativo AND c.estado = 'concluido';

  RETURN jsonb_build_object('status','ignorado','motivo',p_motivo,
    'estado',p_estado,'lote_ativo',v_lote);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_abandonar(p_sync_batch_id uuid, p_mensagem text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  UPDATE public.meli_sync_ciclos
     SET estado = 'abandonado', ativo = false,
         mensagem = left(coalesce(p_mensagem,'abandonado'),300),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id AND estado = 'em_processamento';
  RETURN jsonb_build_object('status','ok','sync_batch_id',p_sync_batch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_staging_limpar(p_dias integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_dias int := GREATEST(coalesce(p_dias,3),1); v_rem int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  WITH alvo AS (
    SELECT sync_batch_id FROM public.meli_sync_ciclos
     WHERE estado <> 'concluido' AND iniciado_em < now() - make_interval(days => v_dias)
  ), del AS (
    DELETE FROM public.meli_sync_rotas_staging s
     USING alvo a WHERE a.sync_batch_id = s.sync_batch_id
     RETURNING 1
  )
  SELECT count(*)::int INTO v_rem FROM del;
  RETURN jsonb_build_object('status','ok','rotas_staging_removidas',v_rem);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_lotes_status(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', b.id,
           'base_codigo', b.codigo,
           'data_operacional', v_data,
           'lote_ativo', a.sync_batch_id,
           'lote_ativo_em', a.finalizado_em,
           'rotas_publicadas', coalesce(a.rotas_recebidas, 0),
           'pacotes_publicados', coalesce(a.pacotes_recebidos, 0),
           'sincronizando', p.sync_batch_id IS NOT NULL,
           'sincronizando_desde', p.iniciado_em,
           'rotas_em_construcao', coalesce(p.rotas_recebidas, 0),
           'ultimo_estado', coalesce(u.estado, a.estado)
         ) ORDER BY b.codigo), '[]'::jsonb)
    INTO v_out
  FROM public.bases b
  LEFT JOIN public.meli_sync_ciclos a
    ON a.base_id = b.id AND a.data_operacional = v_data AND a.ativo AND a.estado = 'concluido'
  LEFT JOIN LATERAL (
    SELECT c.* FROM public.meli_sync_ciclos c
     WHERE c.base_id = b.id AND c.data_operacional = v_data AND c.estado = 'em_processamento'
     ORDER BY c.iniciado_em DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT c.estado FROM public.meli_sync_ciclos c
     WHERE c.base_id = b.id AND c.data_operacional = v_data
     ORDER BY c.iniciado_em DESC LIMIT 1
  ) u ON true
  WHERE b.ativa AND (public.has_role(v_uid,'admin') OR public.has_base_access(v_uid, b.id));

  RETURN jsonb_build_object('status','ok','server_time',now(),
    'data_operacional',v_data,'bases',v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_sync_ciclo_iniciar(uuid,text,date,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_rota_staging(uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_ciclo_finalizar(uuid,text,date,integer,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._meli_sync_marcar(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meli_sync_ciclo_abandonar(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_staging_limpar(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_lotes_status(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_iniciar(uuid,text,date,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_rota_staging(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_finalizar(uuid,text,date,integer,integer,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._meli_sync_marcar(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_abandonar(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_staging_limpar(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_lotes_status(date) TO authenticated, service_role;
