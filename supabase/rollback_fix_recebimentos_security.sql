-- Rollback: Fix recebimentos_insert_missing_base_check
BEGIN;

DROP POLICY IF EXISTS "recebimentos_insert_security_v1" ON public.recebimentos;

-- Restaura a policy anterior (vulnerável) para rollback de emergência se necessário
CREATE POLICY "base access recebimentos insert" ON public.recebimentos
FOR INSERT
TO authenticated
WITH CHECK (operador_id = auth.uid());

COMMIT;
