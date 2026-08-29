-- Vincula o catálogo Meli à Expedição e ao usuário que acessará o app móvel.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meli_driver_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_meli_driver_id_uidx
  ON public.profiles (meli_driver_id)
  WHERE meli_driver_id IS NOT NULL;

ALTER TABLE public.expedicoes
  ADD COLUMN IF NOT EXISTS motorista_meli_id text,
  ADD COLUMN IF NOT EXISTS motorista_usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expedicoes_motorista_usuario_status_idx
  ON public.expedicoes (motorista_usuario_id, status, data_operacional DESC)
  WHERE motorista_usuario_id IS NOT NULL;

-- As tabelas já possuem RLS. Os novos campos seguem as mesmas políticas e grants.
