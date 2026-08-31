ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS placa text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_placa_formato_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_placa_formato_check
  CHECK (placa IS NULL OR placa ~ '^[A-Z0-9]{7}$');

-- O vínculo único com o Meli já é garantido pelo índice
-- profiles_meli_driver_id_uidx criado junto do módulo de Expedição.

COMMENT ON COLUMN public.profiles.placa IS
  'Placa operacional informada no cadastro interno do motorista, sem pontuação.';
