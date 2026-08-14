import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/**
 * Meli Devoluções - Server Functions
 * Todas as operações visíveis na interface usam estes wrappers.
 * A nomenclatura interna (RPCs/Tabelas) mantém "romaneio" por restrição técnica,
 * mas as funções exportadas usam "Devolucao".
 */

export const meliDevolucoesCriarDevolucao = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as {
    base_id: string;
    tracking_id: string;
    observacao?: string;
  })
  .handler(async ({ data }) => {
    // RPC: meli_romaneio_abrir_com_primeiro_pacote
    const { data: res, error } = await supabase.rpc('meli_romaneio_abrir_com_primeiro_pacote', {
      p_base_id: data.base_id,
      p_tracking_id: data.tracking_id,
      p_observacao: (data.observacao ?? null) as any
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesBipar = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as {
    romaneio_id: string;
    base_id: string;
    tracking_id: string;
    observacao?: string;
  })
  .handler(async ({ data }) => {
    // RPC: meli_romaneio_bipar
    const { data: res, error } = await supabase.rpc('meli_romaneio_bipar', {
      p_romaneio_id: data.romaneio_id,
      p_base_id: data.base_id,
      p_tracking_id: data.tracking_id,
      p_observacao: (data.observacao ?? null) as any
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesListar = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as {
    base_id?: string;
    status?: 'em_andamento' | 'concluido' | 'cancelado';
    data_de?: string;
    data_ate?: string;
  })
  .handler(async ({ data }) => {
    // RPC: meli_romaneios_listar
    const { data: res, error } = await supabase.rpc('meli_romaneios_listar', {
      p_base_id: (data.base_id ?? null) as any,
      p_status: (data.status ?? null) as any,
      p_data_de: (data.data_de ?? null) as any,
      p_data_ate: (data.data_ate ?? null) as any
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesFinalizar = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { romaneio_id: string })
  .handler(async ({ data }) => {
    // RPC: meli_romaneio_finalizar
    const { data: res, error } = await supabase.rpc('meli_romaneio_finalizar', {
      p_romaneio_id: data.romaneio_id
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesCancelar = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { romaneio_id: string; justificativa: string })
  .handler(async ({ data }) => {
    // RPC: meli_romaneio_cancelar
    const { data: res, error } = await supabase.rpc('meli_romaneio_cancelar', {
      p_romaneio_id: data.romaneio_id,
      p_justificativa: data.justificativa
    });

    if (error) throw error;
    return res;
  });

export const meliDevolucoesDetalhar = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { romaneio_id: string })
  .handler(async ({ data }) => {
    // RPC: meli_romaneio_detalhar
    const { data: res, error } = await supabase.rpc('meli_romaneio_detalhar', {
      p_romaneio_id: data.romaneio_id
    });

    if (error) throw error;
    return res;
  });
