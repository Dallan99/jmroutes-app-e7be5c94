CREATE TABLE IF NOT EXISTS public.meli_motoristas_catalogo (
  meli_driver_id text PRIMARY KEY,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'adminml',
  service_center_id text,
  ultima_rota_em date,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_motoristas_catalogo_nome_check CHECK (length(btrim(nome)) > 0),
  CONSTRAINT meli_motoristas_catalogo_origem_check CHECK (origem IN ('adminml', 'rota_observada'))
);

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_nome_idx
  ON public.meli_motoristas_catalogo (nome);

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_ativos_idx
  ON public.meli_motoristas_catalogo (ativo)
  WHERE ativo = true;

ALTER TABLE public.meli_motoristas_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "motoristas_meli_select_authenticated" ON public.meli_motoristas_catalogo;
CREATE POLICY "motoristas_meli_select_authenticated"
  ON public.meli_motoristas_catalogo
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.meli_motoristas_catalogo FROM anon;
GRANT SELECT ON TABLE public.meli_motoristas_catalogo TO authenticated;
GRANT ALL ON TABLE public.meli_motoristas_catalogo TO service_role;

-- Compatibilidade inicial: cria o catálogo com os motoristas já observados nas
-- rotas. A sincronização do catálogo oficial do AdminML fará upsert nestas
-- mesmas chaves, mudando a origem para `adminml`, sem afetar os vínculos.
INSERT INTO public.meli_motoristas_catalogo (
  meli_driver_id,
  nome,
  origem,
  ultima_rota_em,
  sincronizado_em
)
SELECT DISTINCT ON (driver_id)
  btrim(driver_id),
  btrim(driver_name),
  'rota_observada',
  data_rota,
  now()
FROM public.meli_rotas
WHERE nullif(btrim(driver_id), '') IS NOT NULL
  AND nullif(btrim(driver_name), '') IS NOT NULL
ORDER BY driver_id, data_rota DESC NULLS LAST
ON CONFLICT (meli_driver_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  ultima_rota_em = GREATEST(
    public.meli_motoristas_catalogo.ultima_rota_em,
    EXCLUDED.ultima_rota_em
  ),
  updated_at = now();

COMMENT ON TABLE public.meli_motoristas_catalogo IS
  'Catálogo canônico de motoristas do Mercado Livre usado na atribuição de rotas e no app do motorista.';
