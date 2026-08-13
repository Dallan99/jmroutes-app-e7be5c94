import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MeliSyncBase = {
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  /** Timestamp da última sincronização bem-sucedida registrada pelo backend/worker. */
  ultimo_sucesso_em: string | null;
  ultima_tentativa_em: string | null;
  status: string | null;
  sessao_status: string | null;
  mensagem_segura: string | null;
  rotas_encontradas: number;
  pacotes_encontrados: number;
  erros: number;
  data_rota: string | null;
};

export type MeliSyncStatusResult = {
  status: "ok" | "erro";
  erro?: string;
  server_time?: string;
  bases?: MeliSyncBase[];
};

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Situação real da integração Meli por base — baseada exclusivamente nos
 * registros gravados pelo backend/worker, nunca no relógio do frontend.
 */
export const meliSyncStatusBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeliSyncStatusResult> => {
    const { data, error } = await (context.supabase as unknown as RpcClient).rpc("meli_sync_status_bases");
    if (error) return { status: "erro", erro: error.message };
    return data as MeliSyncStatusResult;
  });
