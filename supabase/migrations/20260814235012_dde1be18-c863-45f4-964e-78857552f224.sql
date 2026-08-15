-- Migration: Fix recebimentos_insert_security_v1
-- Descrição: Restringe a inserção na tabela recebimentos para garantir que o operador tenha acesso à base informada.

BEGIN;

-- 1. Remover a policy vulnerável anterior
DROP POLICY IF EXISTS "base access recebimentos insert" ON public.recebimentos;

-- 2. Criar a nova policy robusta com WITH CHECK
-- A função public.has_role(auth.uid(), 'admin'::public.app_role) é usada para validar permissões administrativas.
CREATE POLICY "recebimentos_insert_security_v1"
ON public.recebimentos
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL AND (
        public.has_role(auth.uid(), 'admin'::public.app_role) OR 
        public.has_role(auth.uid(), 'gerente'::public.app_role) OR
        public.has_base_access(auth.uid(), base_id)
    )
);

-- 3. Nota de auditoria interna
COMMENT ON POLICY "recebimentos_insert_security_v1" ON public.recebimentos IS 'Garante que inserções respeitem o isolamento de base e as permissões do operador.';

COMMIT;
