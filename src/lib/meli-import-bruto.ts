// Helper compartilhado para importar payload bruto do Meli.
// Usado tanto pela server function `meliImportarRotaBruta` quanto pela rota
// HTTP pública consumida pela extensão Chrome. Não usa service_role.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarPayloadMeli } from "@/lib/meli-normalize";
import type { MeliImportBrutoResult, MeliImportResult } from "@/lib/meli.functions";

export async function importarRotaBrutaComClient(
  supabase: SupabaseClient<never>,
  bruto: Record<string, unknown>,
  opts: { arquivo_nome?: string; confirmar_divergencia?: boolean } = {},
): Promise<MeliImportBrutoResult> {
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
    opts.confirmar_divergencia !== true
  ) {
    return {
      status: "erro",
      erro: `divergencia_totais: extraidos=${resumo.total_extraidos} informado=${resumo.total_informado} diferenca=${resumo.diferenca}`,
      resumo,
      alerta_divergencia: true,
    };
  }

  const { data: res, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("meli_importar_rota", {
    p_payload: normalizado,
    p_arquivo_nome: opts.arquivo_nome,
  });
  if (error) {
    return { status: "erro", erro: error.message, resumo };
  }
  return { ...(res as MeliImportResult), resumo };
}
