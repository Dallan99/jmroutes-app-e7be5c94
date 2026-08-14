import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filtroSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  rota: z.string().trim().max(120).optional().nullable(),
  motorista: z.string().trim().max(120).optional().nullable(),
  transportadora: z.string().trim().max(120).optional().nullable(),
  risco: z.enum(["qualquer", "integral", "parcial"]).optional().nullable(),
  status: z
    .enum(["nao_iniciado", "em_rota", "entregue", "insucesso", "cancelado", "desconhecido"])
    .optional()
    .nullable(),
});

export type MeliRiscoFiltros = z.infer<typeof filtroSchema>;

export type MeliRiscoCards = {
  rotas: number;
  rotas_integrais: number;
  rotas_parciais: number;
  pacotes: number;
  entregue: number;
  pendente: number;
  insucesso: number;
  perc_conclusao: number;
  ultima_sincronizacao: string | null;
};

export type MeliRiscoRota = {
  rota_id: string;
  route_id: string;
  cluster: string | null;
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  driver_name: string | null;
  vehicle_license: string | null;
  carrier: string | null;
  data_rota: string | null;
  last_synced_at: string | null;
  rota_area_risco: boolean;
  area_risco_parcial: boolean;
  motivo_area_risco: string | null;
  codigo_area_risco: string | null;
  origem_area_risco: string | null;
  total: number;
  pacotes_risco: number;
  entregue_risco: number;
  pendente_risco: number;
  insucesso_risco: number;
  perc_conclusao: number;
};

export type SistemaRiscoRota = MeliRiscoRota;

export type MeliRiscoResult = {
  status: "ok" | "erro";
  erro?: string;
  data_operacional?: string;
  server_time?: string;
  cards?: MeliRiscoCards;
  rotas?: MeliRiscoRota[];
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const meliRotasAreaRisco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filtroSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliRiscoResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_rotas_area_risco",
      {
        p_data: data.data ?? null,
        p_base_id: data.base_id ?? null,
        p_rota: data.rota || null,
        p_motorista: data.motorista || null,
        p_transportadora: data.transportadora || null,
        p_risco: data.risco ?? null,
        p_status: data.status ?? null,
      },
    );
    if (error) return { status: "erro", erro: error.message };
    return res as MeliRiscoResult;
  });
