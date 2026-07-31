ALTER TABLE public.escalas ADD COLUMN IF NOT EXISTS meli_pacote_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS escalas_importacao_meli_pacote_uidx
  ON public.escalas (importacao_id, meli_pacote_id)
  WHERE meli_pacote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.meli_publicar_rota_operacional(
  p_rota_id uuid,
  p_data_operacional date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rota          public.meli_rotas;
  v_base_id       uuid;
  v_dia           date;
  v_importacao_id uuid;
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

  v_dia := COALESCE(p_data_operacional, v_rota.data_rota, (now() AT TIME ZONE 'America/Sao_Paulo')::date);

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

  -- Atualiza apenas dados descritivos de linhas já existentes.
  -- Nunca toca em triado/recebido/devolvido nem em seus metadados.
  WITH upd AS (
    UPDATE public.escalas e
       SET otimizada     = v_rota.route_id,
           planejada     = COALESCE(e.planejada, v_rota.route_id),
           cidade        = COALESCE(p.cidade, e.cidade),
           bairro        = COALESCE(p.bairro, e.bairro),
           cep           = COALESCE(p.cep, e.cep),
           rua           = COALESCE(p.endereco, e.rua),
           driver        = COALESCE(v_rota.driver_name, e.driver),
           placa         = COALESCE(v_rota.vehicle_license, e.placa),
           facility_id   = COALESCE(v_rota.facility, e.facility_id),
           transportadora= COALESCE(v_rota.carrier, e.transportadora),
           ordem         = COALESCE(p.ordem, e.ordem)
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND e.importacao_id = v_importacao_id
       AND (e.meli_pacote_id = p.id OR e.shipment = p.tracking_id)
    RETURNING e.id
  )
  SELECT count(*) INTO v_atualizados FROM upd;

  -- Vincula linhas casadas por shipment que ainda não tinham o vínculo.
  UPDATE public.escalas e
     SET meli_pacote_id = p.id
    FROM public.meli_pacotes p
   WHERE p.rota_id = v_rota.id
     AND e.importacao_id = v_importacao_id
     AND e.meli_pacote_id IS NULL
     AND e.shipment = p.tracking_id;

  -- Insere os pacotes que ainda não existem como carga esperada.
  WITH ins AS (
    INSERT INTO public.escalas (
      base_id, data_referencia, importacao_id, meli_pacote_id,
      shipment, planejada, otimizada, nro_rota,
      cidade, bairro, cep, rua, ordem,
      driver, placa, facility_id, transportadora,
      importado_por, triado, recebido, devolvido
    )
    SELECT v_base_id, v_dia, v_importacao_id, p.id,
           p.tracking_id, v_rota.route_id, v_rota.route_id, v_rota.route_id,
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
$$;

REVOKE ALL ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) TO service_role;