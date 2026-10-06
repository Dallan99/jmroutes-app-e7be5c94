ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usuario text;

CREATE UNIQUE INDEX IF NOT EXISTS motoristas_auth_user_id_uidx ON public.motoristas (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS motoristas_usuario_lower_uidx ON public.motoristas (lower(usuario)) WHERE usuario IS NOT NULL;

COMMENT ON COLUMN public.motoristas.auth_user_id IS 'Usuário de autenticação exclusivo do aplicativo do motorista.';
COMMENT ON COLUMN public.motoristas.usuario IS 'Nome de usuário utilizado pelo motorista para entrar no aplicativo.';
