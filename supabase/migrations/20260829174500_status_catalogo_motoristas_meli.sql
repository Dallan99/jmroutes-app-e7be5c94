ALTER TABLE public.meli_motoristas_catalogo
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS carrier_id text;

ALTER TABLE public.meli_motoristas_catalogo
  DROP CONSTRAINT IF EXISTS meli_motoristas_catalogo_status_check;
ALTER TABLE public.meli_motoristas_catalogo
  ADD CONSTRAINT meli_motoristas_catalogo_status_check
  CHECK (status IN ('active', 'inactive', 'blocked', 'unknown'));

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_status_idx
  ON public.meli_motoristas_catalogo (status);

