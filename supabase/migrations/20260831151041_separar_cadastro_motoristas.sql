ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS meli_driver_id text;

ALTER TABLE public.motoristas
  DROP CONSTRAINT IF EXISTS motoristas_placa_formato_check;
ALTER TABLE public.motoristas
  ADD CONSTRAINT motoristas_placa_formato_check
  CHECK (placa IS NULL OR placa ~ '^[A-Z0-9]{7}$');

CREATE UNIQUE INDEX IF NOT EXISTS motoristas_meli_driver_id_uidx
  ON public.motoristas (meli_driver_id)
  WHERE meli_driver_id IS NOT NULL;

COMMENT ON COLUMN public.motoristas.meli_driver_id IS
  'Identidade do catálogo Meli vinculada ao cadastro operacional do motorista.';

CREATE OR REPLACE FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.motorista_id := (
    SELECT m.id
    FROM public.motoristas m
    WHERE m.meli_driver_id = NEW.driver_id
      AND m.ativo = true
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
  TO service_role;

DROP TRIGGER IF EXISTS trg_vincular_motorista_cadastrado_na_rota_meli ON public.meli_rotas;
CREATE TRIGGER trg_vincular_motorista_cadastrado_na_rota_meli
BEFORE INSERT OR UPDATE OF driver_id ON public.meli_rotas
FOR EACH ROW
EXECUTE FUNCTION public.vincular_motorista_cadastrado_na_rota_meli();

UPDATE public.meli_rotas r
SET motorista_id = m.id
FROM public.motoristas m
WHERE m.ativo = true
  AND m.meli_driver_id IS NOT NULL
  AND r.driver_id = m.meli_driver_id
  AND r.motorista_id IS DISTINCT FROM m.id;
