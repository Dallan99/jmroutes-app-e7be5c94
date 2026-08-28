// Helper compartilhado para importar payload bruto do Meli.
// Usado tanto pela server function `meliImportarRotaBruta` quanto pela rota
// HTTP pública consumida pela extensão Chrome. Não usa service_role.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarPayloadMeli } from "@/lib/meli-normalize";
import type { MeliImportBrutoResult, MeliImportResult } from "@/lib/meli.functions";

/** Código estável e não sensível para diagnóstico do worker. */
export function codigoSeguroErroImportacao(erro: string | null | undefined): string {
  const msg = (erro ?? "").toLowerCase();
  if (msg.includes("payload sem 'id'")) return "payload_sem_id_rota";
  if (msg.includes("payload sem 'stops'")) return "payload_sem_stops";
  if (msg.includes("route_id vazio")) return "route_id_vazio";
  if (msg.includes("nenhum pacote válido") || msg.includes("nenhum pacote vÃ¡lido")) {
    return "nenhum_pacote_valido";
  }
  if (msg.includes("sem_permissao") || msg.includes("permission")) return "sem_permissao";
  if (msg.includes("statement timeout") || msg.includes("timeout")) return "timeout_importacao";
  if (msg.includes("duplicate key") || msg.includes("unique constraint")) return "conflito_unicidade";
  if (msg.includes("violates check constraint")) return "restricao_dados";
  return "erro_importacao";
}

export async function importarRotaBrutaComClient(
  supabase: SupabaseClient<never>,
  bruto: Record<string, unknown>,
  opts: {
    arquivo_nome?: string;
    confirmar_divergencia?: boolean;
    aceitar_divergencia_automatica?: boolean;
  } = {},
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
  const temDivergencia = resumo.diferenca !== null && resumo.diferenca !== 0;
  if (
    temDivergencia &&
    opts.confirmar_divergencia !== true &&
    opts.aceitar_divergencia_automatica !== true
  ) {
    return {
      status: "erro",
      erro: `divergencia_totais: extraidos=${resumo.total_extraidos} informado=${resumo.total_informado} diferenca=${resumo.diferenca}`,
      resumo,
      alerta_divergencia: true,
    };
  }

  const rpc = (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const { data: res, error } = await rpc.call(supabase, "meli_importar_rota", {
    p_payload: normalizado,
    p_arquivo_nome: opts.arquivo_nome,
  });
  if (error) {
    return { status: "erro", erro: error.message, resumo };
  }

  const importado = res as MeliImportResult;

  // Fase 2 — publica a rota como carga esperada do dia na base correta.
  // Falha aqui não invalida a importação: o payload já está persistido.
  let publicacao: MeliImportBrutoResult["publicacao"];
  if (importado.status === "ok" && importado.rota_id) {
    const { data: pub, error: pubErro } = await rpc.call(
      supabase,
      "meli_publicar_rota_operacional",
      { p_rota_id: importado.rota_id, p_data_operacional: null },
    );
    publicacao = pubErro
      ? { status: "erro", erro: pubErro.message }
      : (pub as NonNullable<MeliImportBrutoResult["publicacao"]>);
  }

  return { ...importado, resumo, publicacao, alerta_divergencia: temDivergencia };
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocolo de lotes (staging isolado). Enquanto a migration não estiver
// aplicada, este caminho NUNCA é acionado: só é usado quando o chamador envia
// explicitamente um sync_batch_id.
// ─────────────────────────────────────────────────────────────────────────────
export type StagingResultado =
  | {
      status: "ok";
      route_id: string;
      rotas_no_lote: number;
      pacotes_no_lote: number;
      resumo: ReturnType<typeof normalizarPayloadMeli>["resumo"];
    }
  | { status: "erro"; erro: string; resumo?: ReturnType<typeof normalizarPayloadMeli>["resumo"] };

/**
 * Normaliza o payload bruto e grava SOMENTE no staging do ciclo
 * (`meli_sync_rota_staging`). Nenhuma escrita nas tabelas ativas.
 */
export async function enviarRotaParaStagingComClient(
  supabase: SupabaseClient<never>,
  sync_batch_id: string,
  bruto: Record<string, unknown>,
): Promise<StagingResultado> {
  if (bruto.id === undefined || bruto.id === null || bruto.id === "") {
    return { status: "erro", erro: "payload sem 'id' de rota do Meli." };
  }
  if (!Array.isArray(bruto.stops)) {
    return { status: "erro", erro: "payload sem 'stops' (esperado array)." };
  }

  const { payload: normalizado, resumo } = normalizarPayloadMeli(bruto);
  if (!normalizado.route_id) {
    return { status: "erro", erro: "route_id vazio após normalização.", resumo };
  }
  if (normalizado.pacotes.length === 0) {
    return { status: "erro", erro: "nenhum pacote válido extraído do payload.", resumo };
  }

  const rpc = (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const { data, error } = await rpc.call(supabase, "meli_sync_rota_staging", {
    p_sync_batch_id: sync_batch_id,
    p_payload: normalizado,
  });
  if (error) return { status: "erro", erro: error.message, resumo };

  const res = (data ?? {}) as {
    status?: string;
    erro?: string;
    route_id?: string;
    rotas_no_lote?: number;
    pacotes_no_lote?: number;
  };
  if (res.status !== "ok") {
    return { status: "erro", erro: res.erro ?? "falha_no_staging", resumo };
  }
  return {
    status: "ok",
    route_id: res.route_id ?? normalizado.route_id,
    rotas_no_lote: res.rotas_no_lote ?? 0,
    pacotes_no_lote: res.pacotes_no_lote ?? 0,
    resumo,
  };
}
