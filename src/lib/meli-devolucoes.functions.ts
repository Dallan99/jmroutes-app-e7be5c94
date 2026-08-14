import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const painelSchema = z.object({
  data_de: dia.optional().nullable(),
  data_ate: dia.optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  estado: z.string().trim().max(40).optional().nullable(),
  occurrence_code: z.string().trim().max(60).optional().nullable(),
  busca: z.string().trim().max(120).optional().nullable(),
});

export type MeliDevolucaoLinha = {
  id: string;
  tracking_id: string;
  base_id: string;
  base_codigo: string | null;
  base_nome: string | null;
  route_id: string | null;
  cluster: string | null;
  motorista: string | null;
  transportadora: string | null;
  occurrence_code: string;
  meli_status: string | null;
  meli_substatus: string | null;
  situacao_meli: string | null;
  ocorrido_em: string;
  prazo_retorno_em: string;
  last_synced_at: string | null;
  estado: string;
  estado_visual: string;
  dias_corridos: number;
  recebido_em: string | null;
  recebido_base_id: string | null;
  recebimento_id: string | null;
  metodo_confirmacao: string | null;
  observacao_recebimento: string | null;
  divergencia_delivered: boolean;
};


export type MeliDevolucoesCards = {
  total: number;
  aguardando_retorno: number;
  proximo_do_prazo: number;
  atrasado: number;
  recebido_na_base: number;
  em_investigacao: number;
  transferido: number;
  divergencia_delivered: number;
  revisao_necessaria: number;
  perc_sla: number;
  envelhecimento: { d0_1: number; d2: number; d3: number; d4_mais: number };
};

export type MeliDevolucoesPainelResult = {
  status: "ok" | "erro";
  erro?: string;
  data_de?: string;
  data_ate?: string;
  server_time?: string;
  cards?: MeliDevolucoesCards;
  linhas?: MeliDevolucaoLinha[];
};

export const meliDevolucoesPainel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => painelSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliDevolucoesPainelResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_devolucoes_painel",
      {
        p_data_de: data.data_de ?? null,
        p_data_ate: data.data_ate ?? null,
        p_base_id: data.base_id ?? null,
        p_estado: data.estado || null,
        p_occurrence: data.occurrence_code || null,
        p_busca: data.busca || null,
      },
    );
    if (error) return { status: "erro", erro: error.message };
    return res as MeliDevolucoesPainelResult;
  });

const sincronizarSchema = z.object({
  data_de: dia.optional().nullable(),
  data_ate: dia.optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
});

export type MeliDevolucoesSyncResult = {
  status: "ok" | "erro";
  erro?: string;
  criadas?: number;
  atualizadas?: number;
  revisao_necessaria?: number;
  data_de?: string;
  data_ate?: string;
  server_time?: string;
};

export const meliDevolucoesSincronizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sincronizarSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliDevolucoesSyncResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_devolucoes_sincronizar",
      {
        p_data_de: data.data_de ?? null,
        p_data_ate: data.data_ate ?? null,
        p_base_id: data.base_id ?? null,
      },
    );
    if (error) return { status: "erro", erro: error.message };
    return res as MeliDevolucoesSyncResult;
  });

const receberSchema = z.object({
  tracking: z.string().trim().min(3).max(120),
  base_id: z.string().uuid(),
  metodo: z.enum(["scanner", "digitado"]).optional(),
  observacao: z.string().trim().max(500).optional().nullable(),
  recebimento_id: z.string().trim().max(50).optional().nullable(),
});

export type MeliDevolucaoReceberResult = {
  status: "ok" | "erro" | "duplicado";
  codigo?: string;
  mensagem?: string;
  base_esperada?: string | null;
  divergencia_delivered?: boolean;
  no_prazo?: boolean;
  devolucao?: MeliDevolucaoLinha;
};

export const meliDevolucaoReceber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => receberSchema.parse(d))
  .handler(async ({ data, context }): Promise<MeliDevolucaoReceberResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_devolucao_receber",
      {
        p_tracking: data.tracking,
        p_base_id: data.base_id,
        p_metodo: data.metodo ?? "scanner",
        p_observacao: data.observacao ?? null,
        p_recebimento_id: data.recebimento_id ?? null,
      },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as MeliDevolucaoReceberResult;
  });

const gerarRecSchema = z.object({
  base_id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const gerarRecebimentoId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => gerarRecSchema.parse(d))
  .handler(async ({ data, context }): Promise<string> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "gerar_sequencia_recebimento",
      {
        p_base_id: data.base_id,
        p_data: data.data,
      },
    );
    if (error) throw new Error(error.message);
    return res as string;
  });



const romaneioAbrirSchema = z.object({
  base_id: z.string().uuid(),
  tracking_id: z.string().trim().min(3),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export const meliRomaneioAbrirComPrimeiroPacote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => romaneioAbrirSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_romaneio_abrir_com_primeiro_pacote",
      {
        p_base_id: data.base_id,
        p_tracking_id: data.tracking_id,
        p_observacao: data.observacao || null,
      },
    );
    if (error) throw new Error(error.message);
    return res as {
      status: string;
      romaneio_id: string;
      codigo_romaneio: string;
      tracking_id: string;
      divergencia_delivered: boolean;
    };
  });

const romaneioBiparSchema = z.object({
  romaneio_id: z.string().uuid(),
  base_id: z.string().uuid(),
  tracking_id: z.string().trim().min(3),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export const meliRomaneioBipar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => romaneioBiparSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_romaneio_bipar",
      {
        p_romaneio_id: data.romaneio_id,
        p_base_id: data.base_id,
        p_tracking_id: data.tracking_id,
        p_observacao: data.observacao || null,
      },
    );
    if (error) throw new Error(error.message);
    return res as {
      status: "ok" | "duplicado" | "erro";
      tracking_id?: string;
      divergencia_delivered?: boolean;
      mensagem?: string;
      codigo?: string;
    };
  });

const romaneioListarSchema = z.object({
  base_id: z.string().uuid().optional().nullable(),
  data_de: dia.optional().nullable(),
  data_ate: dia.optional().nullable(),
  status: z.enum(["em_andamento", "concluido", "cancelado"]).optional().nullable(),
});

export type MeliRomaneioLinha = {
  id: string;
  codigo: string;
  base_id: string;
  base_codigo: string;
  data_operacional: string;
  sequencial: number;
  status: "em_andamento" | "concluido" | "cancelado";
  route_id: string | null;
  motorista: string | null;
  aberto_em: string;
  aberto_por_nome: string;
  total_pacotes: number;
  concluido_em: string | null;
};

export const meliRomaneioListar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => romaneioListarSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_romaneios_listar",
      {
        p_base_id: data.base_id || null,
        p_data_de: data.data_de || null,
        p_data_ate: data.data_ate || null,
        p_status: data.status || null,
      },
    );
    if (error) throw new Error(error.message);
    return rows as MeliRomaneioLinha[];
  });

export const meliRomaneioFinalizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ romaneio_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_romaneio_finalizar",
      { p_romaneio_id: data.romaneio_id },
    );
    if (error) throw new Error(error.message);
    return res as { status: string; mensagem?: string };
  });

const historicoSchema = z.object({ devolucao_id: z.string().uuid() });

export type MeliDevolucaoEvento = {
  id: string;
  tipo: string;
  estado_anterior: string | null;
  estado_novo: string | null;
  detalhes: Json | null;
  created_at: string;
};

export const meliDevolucaoHistorico = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => historicoSchema.parse(d))
  .handler(async ({ data, context }): Promise<MeliDevolucaoEvento[]> => {
    const { data: rows, error } = await context.supabase
      .from("meli_devolucoes_eventos")
      .select("id, tipo, estado_anterior, estado_novo, detalhes, created_at")
      .eq("devolucao_id", data.devolucao_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as MeliDevolucaoEvento[];
  });

