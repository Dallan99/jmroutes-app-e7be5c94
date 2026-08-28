-- Expedição independente do Recebimento.
-- As leituras usam a relação original da importação e nunca alteram escalas.triado.

CREATE TABLE public.expedicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  importacao_id uuid NOT NULL REFERENCES public.importacoes_escala(id),
  data_operacional date NOT NULL,
  rota text NOT NULL CHECK (btrim(rota) <> ''),
  status text NOT NULL DEFAULT 'em_conferencia'
    CHECK (status IN ('em_conferencia', 'concluida', 'concluida_com_ressalva')),
  quantidade_prevista integer NOT NULL CHECK (quantidade_prevista >= 0),
  quantidade_conferida integer NOT NULL DEFAULT 0 CHECK (quantidade_conferida >= 0),
  responsavel_expedicao_id uuid REFERENCES auth.users(id),
  motorista text,
  responsavel_meli_svc text,
  outro_responsavel text,
  observacao text,
  iniciada_por uuid NOT NULL REFERENCES auth.users(id),
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  concluida_por uuid REFERENCES auth.users(id),
  concluida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importacao_id, rota)
);

CREATE INDEX expedicoes_base_dia_idx
  ON public.expedicoes (base_id, data_operacional, status);

CREATE TABLE public.expedicao_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expedicao_id uuid NOT NULL REFERENCES public.expedicoes(id) ON DELETE CASCADE,
  escala_id uuid NOT NULL REFERENCES public.escalas(id),
  shipment text NOT NULL CHECK (btrim(shipment) <> ''),
  operador_id uuid NOT NULL REFERENCES auth.users(id),
  resultado text NOT NULL CHECK (resultado IN ('ok', 'duplicado', 'inexistente', 'outra_rota')),
  nao_localizado_no_recebimento boolean NOT NULL DEFAULT false,
  localizado_posteriormente_na_expedicao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expedicao_id, shipment)
);

CREATE INDEX expedicao_leituras_expedicao_created_idx
  ON public.expedicao_leituras (expedicao_id, created_at DESC);
CREATE INDEX expedicao_leituras_recuperadas_idx
  ON public.expedicao_leituras (expedicao_id)
  WHERE localizado_posteriormente_na_expedicao;

-- Estrutura do fechamento diário; PDF e envio serão acoplados sem recalcular o passado.
CREATE TABLE public.fechamentos_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'reconciliado', 'enviado', 'erro_envio')),
  faltantes_recebimento integer NOT NULL DEFAULT 0,
  recuperados_expedicao integer NOT NULL DEFAULT 0,
  faltantes_finais integer NOT NULL DEFAULT 0,
  shipment_ids_finais jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(shipment_ids_finais) = 'array'),
  pdf_path text,
  email_destinatario text,
  email_message_id text,
  enviado_por uuid REFERENCES auth.users(id),
  enviado_em timestamptz,
  evidencia_envio jsonb,
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional)
);

ALTER TABLE public.expedicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedicao_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamentos_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expedicoes_visiveis_por_base"
  ON public.expedicoes FOR SELECT TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id));
CREATE POLICY "expedicoes_criadas_por_base"
  ON public.expedicoes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND iniciada_por = (SELECT auth.uid())
  );
CREATE POLICY "expedicoes_atualizadas_por_base"
  ON public.expedicoes FOR UPDATE TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id))
  WITH CHECK (public.has_base_access((SELECT auth.uid()), base_id));

CREATE POLICY "expedicao_leituras_visiveis_por_base"
  ON public.expedicao_leituras FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expedicoes e
    WHERE e.id = expedicao_id
      AND public.has_base_access((SELECT auth.uid()), e.base_id)
  ));
CREATE POLICY "expedicao_leituras_criadas_por_base"
  ON public.expedicao_leituras FOR INSERT TO authenticated
  WITH CHECK (
    operador_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.expedicoes e
      WHERE e.id = expedicao_id
        AND public.has_base_access((SELECT auth.uid()), e.base_id)
    )
  );

CREATE POLICY "fechamentos_visiveis_por_base"
  ON public.fechamentos_operacionais FOR SELECT TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id));
CREATE POLICY "fechamentos_criados_por_base"
  ON public.fechamentos_operacionais FOR INSERT TO authenticated
  WITH CHECK (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND criado_por = (SELECT auth.uid())
  );
CREATE POLICY "fechamentos_atualizados_por_gestao"
  ON public.fechamentos_operacionais FOR UPDATE TO authenticated
  USING (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND (
      public.has_role((SELECT auth.uid()), 'admin')
      OR public.has_role((SELECT auth.uid()), 'gerente')
      OR public.has_role((SELECT auth.uid()), 'supervisor')
    )
  )
  WITH CHECK (public.has_base_access((SELECT auth.uid()), base_id));

-- Opt-in explícito para a Data API (mudança de plataforma Supabase de 2026).
GRANT SELECT, INSERT, UPDATE ON public.expedicoes TO authenticated;
GRANT SELECT, INSERT ON public.expedicao_leituras TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fechamentos_operacionais TO authenticated;
GRANT ALL ON public.expedicoes, public.expedicao_leituras,
  public.fechamentos_operacionais TO service_role;
