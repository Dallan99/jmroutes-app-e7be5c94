-- ══════════════════════════════════════════════════════════════════════════
-- Módulo 1: visão de rotas em área de risco (somente leitura, dados reais)
-- Módulo 2: controle de devoluções Meli (retorno físico à base em 3 dias)
-- ══════════════════════════════════════════════════════════════════════════

-- ─────────────── PARTE 1: rotas em área de risco ───────────────
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(
  p_data date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_rota text DEFAULT NULL,
  p_motorista text DEFAULT NULL,
  p_transportadora text DEFAULT NULL,
  p_risco text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      ) ORDER BY rota_area_risco DESC, pacotes_risco DESC)
      FROM rotas
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_rotas_area_risco(date, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(date, uuid, text, text, text, text, text) TO authenticated, service_role;

-- ─────────────── PARTE 2: devoluções Meli ───────────────
CREATE TABLE IF NOT EXISTS public.meli_devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  rota_id uuid REFERENCES public.meli_rotas(id) ON DELETE SET NULL,
  route_id text,
  cluster text,
  motorista text,
  transportadora text,
  occurrence_code text NOT NULL,
  meli_status text,
  meli_substatus text,
  situacao_meli text,
  ocorrido_em timestamptz NOT NULL,
  prazo_retorno_em timestamptz NOT NULL,
  last_synced_at timestamptz,
  estado text NOT NULL DEFAULT 'aguardando_retorno'
    CHECK (estado IN ('aguardando_retorno','recebido_na_base','em_investigacao',
                      'transferido','divergencia_delivered','revisao_necessaria','encerrado')),
  recebido_em timestamptz,
  recebido_por uuid REFERENCES auth.users(id),
  recebido_base_id uuid REFERENCES public.bases(id),
  metodo_confirmacao text,
  observacao_recebimento text,
  divergencia_delivered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_devolucoes_tracking_unico UNIQUE (tracking_id)
);

CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_tracking ON public.meli_devolucoes (tracking_id);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_base ON public.meli_devolucoes (base_id);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_occurrence ON public.meli_devolucoes (occurrence_code);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_estado ON public.meli_devolucoes (estado);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_prazo ON public.meli_devolucoes (prazo_retorno_em);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_ocorrido ON public.meli_devolucoes (ocorrido_em);

GRANT SELECT ON public.meli_devolucoes TO authenticated;
GRANT ALL ON public.meli_devolucoes TO service_role;
ALTER TABLE public.meli_devolucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Devolucoes Meli visiveis por base permitida" ON public.meli_devolucoes;
CREATE POLICY "Devolucoes Meli visiveis por base permitida"
  ON public.meli_devolucoes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE TABLE IF NOT EXISTS public.meli_devolucoes_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucao_id uuid REFERENCES public.meli_devolucoes(id) ON DELETE CASCADE,
  tracking_id text NOT NULL,
  base_id uuid REFERENCES public.bases(id),
  tipo text NOT NULL,
  estado_anterior text,
  estado_novo text,
  detalhes jsonb,
  registrado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meli_dev_eventos_dev ON public.meli_devolucoes_eventos (devolucao_id);
CREATE INDEX IF NOT EXISTS idx_meli_dev_eventos_tracking ON public.meli_devolucoes_eventos (tracking_id);

GRANT SELECT ON public.meli_devolucoes_eventos TO authenticated;
GRANT ALL ON public.meli_devolucoes_eventos TO service_role;
ALTER TABLE public.meli_devolucoes_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Historico devolucoes Meli por base permitida" ON public.meli_devolucoes_eventos;
CREATE POLICY "Historico devolucoes Meli por base permitida"
  ON public.meli_devolucoes_eventos FOR SELECT TO authenticated
  USING (base_id IS NOT NULL AND public.has_base_access(auth.uid(), base_id));

DROP TRIGGER IF EXISTS trg_meli_devolucoes_updated_at ON public.meli_devolucoes;
CREATE TRIGGER trg_meli_devolucoes_updated_at
  BEFORE UPDATE ON public.meli_devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Sincroniza devoluções a partir das ocorrências de rua já importadas.
CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      JOIN public.meli_rotas ro ON ro.id = p.rota_id
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
      -- Nunca sobrescreve estados finais/físicos; apenas atualiza dados do Meli.
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
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid) TO authenticated, service_role;

-- Painel de devoluções (cards + linhas), respeitando bases permitidas.
CREATE OR REPLACE FUNCTION public.meli_devolucoes_painel(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_occurrence text DEFAULT NULL,
  p_busca text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 30);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH base AS (
    SELECT d.*, b.codigo AS base_codigo, b.nome AS base_nome,
           (d.prazo_retorno_em - now()) AS restante,
           greatest(0, floor(extract(epoch FROM (coalesce(d.recebido_em, now()) - d.ocorrido_em)) / 86400))::int AS dias_corridos,
           CASE
             WHEN d.estado = 'divergencia_delivered' THEN 'divergencia_delivered'
             WHEN d.estado = 'recebido_na_base' THEN 'recebido_na_base'
             WHEN d.estado IN ('em_investigacao','transferido','revisao_necessaria','encerrado') THEN d.estado
             WHEN d.prazo_retorno_em < now() THEN 'atrasado'
             WHEN d.prazo_retorno_em < now() + interval '1 day' THEN 'proximo_do_prazo'
             ELSE 'aguardando_retorno'
           END AS estado_visual
      FROM public.meli_devolucoes d
      LEFT JOIN public.bases b ON b.id = d.base_id
     WHERE public.has_base_access(v_uid, d.base_id)
       AND d.ocorrido_em >= (v_de::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND d.ocorrido_em < ((v_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND (p_base_id IS NULL OR d.base_id = p_base_id)
       AND (p_occurrence IS NULL OR d.occurrence_code = p_occurrence)
       AND (p_busca IS NULL OR d.tracking_id ILIKE '%' || p_busca || '%'
            OR coalesce(d.route_id, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.cluster, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.motorista, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.transportadora, '') ILIKE '%' || p_busca || '%')
  ), filtrado AS (
    SELECT * FROM base WHERE p_estado IS NULL OR estado_visual = p_estado
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_de', v_de,
    'data_ate', v_ate,
    'server_time', now(),
    'cards', (SELECT jsonb_build_object(
        'total', count(*),
        'aguardando_retorno', count(*) FILTER (WHERE estado_visual = 'aguardando_retorno'),
        'proximo_do_prazo', count(*) FILTER (WHERE estado_visual = 'proximo_do_prazo'),
        'atrasado', count(*) FILTER (WHERE estado_visual = 'atrasado'),
        'recebido_na_base', count(*) FILTER (WHERE estado_visual = 'recebido_na_base'),
        'em_investigacao', count(*) FILTER (WHERE estado_visual = 'em_investigacao'),
        'transferido', count(*) FILTER (WHERE estado_visual = 'transferido'),
        'divergencia_delivered', count(*) FILTER (WHERE estado_visual = 'divergencia_delivered'),
        'revisao_necessaria', count(*) FILTER (WHERE estado_visual = 'revisao_necessaria'),
        'perc_sla', CASE WHEN count(*) FILTER (WHERE recebido_em IS NOT NULL) > 0
          THEN round(100.0 * count(*) FILTER (WHERE recebido_em IS NOT NULL AND recebido_em <= prazo_retorno_em)
               / count(*) FILTER (WHERE recebido_em IS NOT NULL), 1) ELSE 0 END,
        'envelhecimento', jsonb_build_object(
          'd0_1', count(*) FILTER (WHERE dias_corridos <= 1),
          'd2', count(*) FILTER (WHERE dias_corridos = 2),
          'd3', count(*) FILTER (WHERE dias_corridos = 3),
          'd4_mais', count(*) FILTER (WHERE dias_corridos > 3)
        )
      ) FROM base),
    'linhas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'tracking_id', tracking_id, 'base_id', base_id,
        'base_codigo', base_codigo, 'base_nome', base_nome,
        'route_id', route_id, 'cluster', cluster, 'motorista', motorista,
        'transportadora', transportadora, 'occurrence_code', occurrence_code,
        'meli_status', meli_status, 'meli_substatus', meli_substatus,
        'situacao_meli', situacao_meli, 'ocorrido_em', ocorrido_em,
        'prazo_retorno_em', prazo_retorno_em, 'last_synced_at', last_synced_at,
        'estado', estado, 'estado_visual', estado_visual, 'dias_corridos', dias_corridos,
        'recebido_em', recebido_em, 'recebido_base_id', recebido_base_id,
        'metodo_confirmacao', metodo_confirmacao,
        'observacao_recebimento', observacao_recebimento,
        'divergencia_delivered', divergencia_delivered
      ) ORDER BY prazo_retorno_em ASC) FROM filtrado), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucoes_painel(date, date, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_painel(date, date, uuid, text, text, text) TO authenticated, service_role;

-- Recebimento físico na base.
CREATE OR REPLACE FUNCTION public.meli_devolucao_receber(
  p_tracking text,
  p_base_id uuid,
  p_metodo text DEFAULT 'scanner',
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tracking text := upper(btrim(coalesce(p_tracking, '')));
  v_d public.meli_devolucoes;
  v_delivered boolean;
  v_estado_novo text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_autenticado', 'mensagem', 'Não autenticado.');
  END IF;
  IF v_tracking = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'invalido', 'mensagem', 'Informe o código de rastreio.');
  END IF;
  IF p_base_id IS NULL OR NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base', 'mensagem', 'Sem acesso à base informada.');
  END IF;

  SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = v_tracking;

  IF v_d.id IS NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_tracking, p_base_id, 'recebimento_sem_devolucao',
            jsonb_build_object('metodo', p_metodo), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrada',
      'mensagem', 'Nenhuma devolução Meli pendente para este rastreio.');
  END IF;

  IF NOT public.has_base_access(v_uid, v_d.base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base',
      'mensagem', 'Sem acesso à base de origem deste pacote.');
  END IF;

  IF v_d.recebido_em IS NOT NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_duplicado', v_d.estado, v_d.estado,
            jsonb_build_object('metodo', p_metodo, 'recebido_em_original', v_d.recebido_em), v_uid);
    RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado',
      'mensagem', 'Este pacote já foi recebido na base.',
      'devolucao', to_jsonb(v_d));
  END IF;

  IF v_d.base_id <> p_base_id THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_base_divergente', v_d.estado,
            jsonb_build_object('base_informada', p_base_id, 'base_esperada', v_d.base_id), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente',
      'mensagem', 'Base receptora diferente da base de origem esperada.',
      'base_esperada', (SELECT codigo FROM public.bases WHERE id = v_d.base_id));
  END IF;

  v_delivered := coalesce(v_d.situacao_meli, '') = 'entregue';

  IF v_delivered AND coalesce(btrim(coalesce(p_observacao, '')), '') = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria',
      'mensagem', 'Pacote consta como entregue no Meli. Observação do operador é obrigatória.');
  END IF;

  v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

  UPDATE public.meli_devolucoes
     SET estado = v_estado_novo,
         recebido_em = now(),
         recebido_por = v_uid,
         recebido_base_id = p_base_id,
         metodo_confirmacao = coalesce(nullif(btrim(p_metodo), ''), 'scanner'),
         observacao_recebimento = nullif(btrim(coalesce(p_observacao, '')), ''),
         divergencia_delivered = v_delivered
   WHERE id = v_d.id;

  INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
  VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_fisico', v_d.estado, v_estado_novo,
          jsonb_build_object('metodo', p_metodo, 'observacao', nullif(btrim(coalesce(p_observacao, '')), ''),
                             'situacao_meli', v_d.situacao_meli), v_uid);

  RETURN jsonb_build_object('status', 'ok', 'codigo', v_estado_novo,
    'divergencia_delivered', v_delivered,
    'no_prazo', now() <= v_d.prazo_retorno_em,
    'mensagem', CASE WHEN v_delivered
      THEN 'ALERTA CRÍTICO: pacote recebido fisicamente, porém consta ENTREGUE no Meli. Encaminhe para prevenção de perdas.'
      ELSE 'Retorno registrado na base.' END,
    'devolucao', (SELECT to_jsonb(d) FROM public.meli_devolucoes d WHERE d.id = v_d.id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text) TO authenticated, service_role;