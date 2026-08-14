-- ROLLBACK SQL para Romaneio Meli v3

-- 1. DROP das RPCs pelas assinaturas completas
DROP FUNCTION IF EXISTS public.meli_romaneio_impressao(UUID);
DROP FUNCTION IF EXISTS public.meli_romaneio_reabrir(UUID, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_detalhar(UUID);
DROP FUNCTION IF EXISTS public.meli_romaneios_listar(UUID, DATE, DATE, public.meli_romaneio_status);
DROP FUNCTION IF EXISTS public.meli_romaneio_cancelar(UUID, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_finalizar(UUID);
DROP FUNCTION IF EXISTS public.meli_romaneio_bipar(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_abrir_com_primeiro_pacote(UUID, TEXT, TEXT);

-- 2. DROP da função interna (privilegiada)
DROP FUNCTION IF EXISTS public.internal_meli_devolucao_processar_bip(UUID, UUID, TEXT, TEXT, UUID);

-- 3. DROP das policies
DROP POLICY IF EXISTS "Romaneios visiveis por base ou admin" ON public.meli_devolucao_romaneios;

-- 4. DROP dos índices
DROP INDEX IF EXISTS public.idx_meli_devolucoes_romaneio_id;
DROP INDEX IF EXISTS public.idx_meli_romaneios_codigo;
DROP INDEX IF EXISTS public.idx_meli_romaneios_base_data_status;

-- 5. Remoção da coluna vinculada (Somente se for seguro/sem dados ou se desejar reverter a estrutura)
-- ATENÇÃO: Se houver dados reais, não execute o DROP da coluna abaixo sem backup.
-- ALTER TABLE public.meli_devolucoes DROP COLUMN IF EXISTS romaneio_id;

-- 6. DROP da tabela
DROP TABLE IF EXISTS public.meli_devolucao_romaneios;

-- 7. DROP do enum
-- Somente se não estiver sendo usado por outras tabelas
DROP TYPE IF EXISTS public.meli_romaneio_status;

-- NOTA: Após a existência de dados reais, o rollback deve focar em desativar a lógica 
-- e preservar a integridade dos registros para auditoria histórica.
