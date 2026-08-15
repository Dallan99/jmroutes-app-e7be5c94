import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Devoluções - Server Functions
 * Todas as operações visíveis na interface usam estes wrappers.
 * A nomenclatura interna (RPCs/Tabelas) mantém "romaneio" por restrição técnica,
 * mas as funções exportadas usam "Devolucao".
 *
 * IMPORTANTE: as RPCs só concedem EXECUTE para `authenticated`, portanto todas
 * as chamadas usam o cliente autenticado do middleware (context.supabase).
 */


export const meliDevolucoesCriarDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as {
    base_id: string;
    tracking_id: string;
    observacao?: string;
  })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneio_abrir_com_primeiro_pacote', {
      p_base_id: data.base_id,
      p_tracking_id: data.tracking_id,
      p_observacao: data.observacao ?? null,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesBipar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as {
    romaneio_id: string;
    base_id: string;
    tracking_id: string;
    observacao?: string;
  })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneio_bipar', {
      p_romaneio_id: data.romaneio_id,
      p_base_id: data.base_id,
      p_tracking_id: data.tracking_id,
      p_observacao: data.observacao ?? null,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesListar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as {
    base_id?: string | null;
    status?: 'em_andamento' | 'concluido' | 'cancelado' | null;
    data_de?: string | null;
    data_ate?: string | null;
  })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneios_listar', {
      p_base_id: data.base_id ?? null,
      p_status: data.status ?? null,
      p_data_de: data.data_de ?? null,
      p_data_ate: data.data_ate ?? null,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesFinalizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as { romaneio_id: string })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneio_finalizar', {
      p_romaneio_id: data.romaneio_id,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesCancelar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as { romaneio_id: string; justificativa: string })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneio_cancelar', {
      p_romaneio_id: data.romaneio_id,
      p_justificativa: data.justificativa,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesDetalhar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as { romaneio_id: string })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_romaneio_detalhar', {
      p_romaneio_id: data.romaneio_id,
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesSincronizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => d as { 
    data_de: string; 
    data_ate: string; 
    base_id: string; 
  })
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc('meli_devolucoes_sincronizar', {
      p_data_de: data.data_de,
      p_data_ate: data.data_ate,
      p_base_id: data.base_id,
    });

    if (error) throw error;
    return res as {
      status: string;
      analisados: number;
      criados: number;
      atualizados: number;
      sem_alteracao: number;
      aguardando?: number;
      investigacao?: number;
      transferidos?: number;
      revisao_necessaria?: number;
      erros: number;
      sincronizado_em: string;
    };
  });
