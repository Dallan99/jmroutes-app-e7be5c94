---
name: Romaneio Meli v3 Rollback
description: SQL script for rolling back the Romaneio Meli v3 migration
type: constraint
---

-- 1. DROP RPCs (External)
DROP FUNCTION IF EXISTS public.meli_romaneio_detalhar(UUID);
DROP FUNCTION IF EXISTS public.meli_romaneios_listar(UUID, DATE, DATE, public.meli_romaneio_status);
DROP FUNCTION IF EXISTS public.meli_romaneio_cancelar(UUID, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_finalizar(UUID);
DROP FUNCTION IF EXISTS public.meli_romaneio_bipar(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_abrir_com_primeiro_pacote(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_reabrir(UUID, TEXT);
DROP FUNCTION IF EXISTS public.meli_romaneio_impressao(UUID);

-- 2. DROP Internal Function
DROP FUNCTION IF EXISTS public.internal_meli_devolucao_processar_bip(UUID, UUID, TEXT, TEXT, UUID);

-- 3. DROP Policies and Table
DROP POLICY IF EXISTS "Romaneios visiveis por base ou admin" ON public.meli_devolucao_romaneios;
DROP TABLE IF EXISTS public.meli_devolucao_romaneios CASCADE;

-- 4. Clean up meli_devolucoes (Keep the column if preferred in production, but remove metadata link for full reset)
-- Only run if there's no data or if specifically requested to hard reset.
-- ALTER TABLE public.meli_devolucoes DROP COLUMN IF EXISTS romaneio_id;

-- 5. DROP ENUM (Only if not used elsewhere)
-- DROP TYPE IF EXISTS public.meli_romaneio_status;
