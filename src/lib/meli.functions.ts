import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizarPayloadMeli } from "@/lib/meli-normalize";

const importarSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  arquivo_nome: z.string().trim().max(255).optional(),
});

const importarBrutoSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  arquivo_nome: z.string().trim().max(255).optional(),
  confirmar_divergencia: z.boolean().optional(),
});


const listarSchema = z.object({
  cluster: z.string().trim().min(1).max(120).optional(),
  data_de: z.string().trim().min(1).max(20).optional(),
  data_ate: z.string().trim().min(1).max(20).optional(),
  busca: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

const detalharSchema = z.object({
  rota_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export type MeliImportResult = {
  status: "ok" | "erro";
  erro?: string;
  sqlstate?: string;
  importacao_id?: string;
  rota_id?: string;
  route_id?: string;
  pacotes_recebidos?: number;
  pacotes_unicos?: number;
  pacotes_inseridos?: number;
  pacotes_atualizados?: number;
  pacotes_inalterados?: number;
  pacotes_invalidos?: number;
  pacotes_duplicados_no_payload?: number;
  pacotes_com_ordem_invalida?: number;
};

export type MeliRotaResumo = {
  id: string;
  route_id: string;
  cluster: string | null;
  carrier: string | null;
  facility: string | null;
  data_rota: string | null;
  total_pacotes: number;
  total_impressos: number;
  origem_importacao: string | null;
  created_at: string;
  updated_at: string;
  ultima_importacao_em: string | null;
};

export type MeliListarResult = {
  status: "ok" | "erro";
  erro?: string;
  total?: number;
  limit?: number;
  offset?: number;
  rotas?: MeliRotaResumo[];
};

export type MeliPacote = {
  id: string;
  rota_id: string;
  tracking_id: string;
  shipment_id: string | null;
  destinatario: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  status: string | null;
  printed_label: string | null;
  ordem: number | null;
  created_at: string;
  updated_at: string;
};

export type MeliDetalheResult = {
  status: "ok" | "erro";
  erro?: string;
  rota?: MeliRotaResumo;
  importacao?: { id: string; status: string; iniciado_em: string | null; finalizado_em: string | null; total_pacotes: number | null; total_erros: number | null; arquivo_nome: string | null } | null;
  pacotes?: MeliPacote[];
  total_pacotes?: number;
  limit?: number;
  offset?: number;
};

export const meliImportarRota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importarSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliImportResult> => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("meli_importar_rota", {
      p_payload: data.payload as never,
      p_arquivo_nome: data.arquivo_nome,
    });
    if (error) {
      return { status: "erro", erro: error.message };
    }
    return res as MeliImportResult;
  });

export const meliListarRotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listarSchema.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<MeliListarResult> => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("meli_listar_rotas", {
      p_cluster: data.cluster,
      p_data_de: data.data_de,
      p_data_ate: data.data_ate,
      p_busca: data.busca,
      p_limit: data.limit ?? 50,
      p_offset: data.offset ?? 0,
    });
    if (error) return { status: "erro", erro: error.message };
    return res as MeliListarResult;
  });

export const meliDetalharRota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => detalharSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliDetalheResult> => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("meli_detalhar_rota", {
      p_rota_id: data.rota_id,
      p_limit: data.limit ?? 100,
      p_offset: data.offset ?? 0,
    });
    if (error) return { status: "erro", erro: error.message };
    return res as MeliDetalheResult;
  });

export type MeliImportBrutoResult = MeliImportResult & {
  resumo?: {
    route_id: string;
    cluster: string | null;
    facility: string | null;
    total_paradas: number;
    total_extraidos: number;
    total_informado: number | null;
    diferenca: number | null;
    descartados_sem_tracking: number;
    duplicados_removidos: number;
  };
  alerta_divergencia?: boolean;
};

/**
 * Recebe o JSON bruto do endpoint route-detail do Mercado Livre
 * (com id/stops/orders/transportUnits/relatedEntity/receiverInfo),
 * transforma para o formato aceito por meli_importar_rota e importa.
 *
 * Autorização: requer sessão autenticada. A RPC subjacente
 * (meli_importar_rota) valida perfil admin/gerente/supervisor via
 * meli_pode_operar() e retorna sem_permissao caso contrário.
 * Não usa service_role.
 */
export const meliImportarRotaBruta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importarBrutoSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliImportBrutoResult> => {
    const { supabase } = context;
    const bruto = data.payload;

    if (bruto.id === undefined || bruto.id === null || bruto.id === "") {
      return { status: "erro", erro: "payload sem 'id' de rota do Meli." };
    }
    if (!Array.isArray(bruto.stops)) {
      return { status: "erro", erro: "payload sem 'stops' (esperado array)." };
    }

    const { payload: normalizado, resumo } = normalizarPayloadMeli(bruto);

    if (!normalizado.route_id) {
      return { status: "erro", erro: "route_id vazio após normalização." };
    }
    if (normalizado.pacotes.length === 0) {
      return {
        status: "erro",
        erro: "nenhum pacote válido extraído do payload.",
        resumo,
      };
    }
    if (
      resumo.diferenca !== null &&
      resumo.diferenca !== 0 &&
      data.confirmar_divergencia !== true
    ) {
      return {
        status: "erro",
        erro: `divergencia_totais: extraidos=${resumo.total_extraidos} informado=${resumo.total_informado} diferenca=${resumo.diferenca}`,
        resumo,
        alerta_divergencia: true,
      };
    }

    const { data: res, error } = await supabase.rpc("meli_importar_rota", {
      p_payload: normalizado as never,
      p_arquivo_nome: data.arquivo_nome,
    });
    if (error) {
      return { status: "erro", erro: error.message, resumo };
    }
    return { ...(res as MeliImportResult), resumo };
  });

