// Protocolo de lotes (publicação atômica) — cliente HTTP do endpoint
// /api/public/meli/ciclo.
//
// Compatibilidade: enquanto PROTOCOLO_LOTES estiver desligado (default) nada
// aqui é chamado. Se estiver ligado mas o backend responder
// "protocolo_indisponivel" (migration ainda não aplicada), o worker cai
// automaticamente no fluxo legado sem interromper a integração.
import { logger, mensagemSegura } from "../logger.js";
import type { WorkerConfig } from "../config.js";

export const CICLO_PATH = "/api/public/meli/ciclo";

export type CicloAcao = "iniciar" | "finalizar" | "abandonar";

export type CicloRespostaStatus = "ok" | "indisponivel" | "erro";

export type CicloResposta = {
  status: CicloRespostaStatus;
  motivo?: string;
  resultado?: Record<string, unknown>;
};

export type CicloOpts = {
  accessToken: string;
  fetchImpl?: typeof fetch;
};

export function urlCiclo(cfg: Pick<WorkerConfig, "jmrBaseUrl">): string {
  return `${cfg.jmrBaseUrl}${CICLO_PATH}`;
}

/** Data operacional no fuso da operação (America/Sao_Paulo), formato AAAA-MM-DD. */
export function dataOperacionalBrt(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

async function chamar(
  cfg: Pick<WorkerConfig, "jmrBaseUrl">,
  body: Record<string, unknown>,
  opts: CicloOpts,
): Promise<CicloResposta> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(urlCiclo(cfg), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: "erro", motivo: mensagemSegura(String((err as Error)?.message ?? err)) };
  }

  if (res.status === 503) return { status: "indisponivel", motivo: "protocolo_indisponivel" };
  if (res.status === 401) return { status: "erro", motivo: "sem_sessao" };

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    return { status: "erro", motivo: `resposta_invalida_http_${res.status}` };
  }

  if (payload["codigo"] === "protocolo_indisponivel") {
    return { status: "indisponivel", motivo: "protocolo_indisponivel" };
  }
  if (payload["ok"] === true) {
    return { status: "ok", resultado: (payload["resultado"] as Record<string, unknown>) ?? {} };
  }
  return {
    status: "erro",
    motivo: mensagemSegura(String(payload["codigo"] ?? payload["mensagem"] ?? `http_${res.status}`)),
  };
}

export async function iniciarCicloRemoto(
  cfg: Pick<WorkerConfig, "jmrBaseUrl" | "baseCode">,
  params: { syncBatchId: string; dataOperacional: string },
  opts: CicloOpts,
): Promise<CicloResposta> {
  const r = await chamar(
    cfg,
    {
      acao: "iniciar",
      sync_batch_id: params.syncBatchId,
      base_codigo: cfg.baseCode,
      data_operacional: params.dataOperacional,
      origem: "worker",
    },
    opts,
  );
  if (r.status === "indisponivel") {
    logger.warn("Protocolo de lotes indisponível no backend; usando fluxo legado.");
  } else if (r.status === "erro") {
    logger.warn("Falha ao iniciar ciclo de lote; usando fluxo legado.", { motivo: r.motivo });
  }
  return r;
}

export async function finalizarCicloRemoto(
  cfg: Pick<WorkerConfig, "jmrBaseUrl" | "baseCode">,
  params: {
    syncBatchId: string;
    dataOperacional: string;
    rotas: number;
    pacotes: number | null;
    estado: "concluido" | "parcial" | "erro";
    mensagem?: string | null;
  },
  opts: CicloOpts,
): Promise<CicloResposta> {
  const r = await chamar(
    cfg,
    {
      acao: "finalizar",
      sync_batch_id: params.syncBatchId,
      base_codigo: cfg.baseCode,
      data_operacional: params.dataOperacional,
      rotas: params.rotas,
      pacotes: params.pacotes,
      estado: params.estado,
      mensagem: params.mensagem ?? null,
    },
    opts,
  );
  if (r.status === "ok") {
    logger.info("Ciclo de lote finalizado.", {
      estado: params.estado,
      rotas: params.rotas,
      resultado_status: r.resultado?.["status"],
      lote_ativo: r.resultado?.["lote_ativo"] ?? null,
    });
  } else {
    logger.warn("Falha ao finalizar ciclo de lote.", { motivo: r.motivo });
  }
  return r;
}

export async function abandonarCicloRemoto(
  cfg: Pick<WorkerConfig, "jmrBaseUrl" | "baseCode">,
  params: { syncBatchId: string; mensagem?: string | null },
  opts: CicloOpts,
): Promise<CicloResposta> {
  return chamar(
    cfg,
    {
      acao: "abandonar",
      sync_batch_id: params.syncBatchId,
      mensagem: params.mensagem ?? null,
    },
    opts,
  );
}

/**
 * Estado declarado ao finalizar, derivado do status do ciclo do worker.
 * Só "sucesso" sem erros promove o lote.
 */
export function estadoParaFinalizacao(
  statusCiclo: string,
  erros: number,
): "concluido" | "parcial" | "erro" {
  if (statusCiclo === "sucesso" && erros === 0) return "concluido";
  if (statusCiclo === "sucesso_parcial") return "parcial";
  if (statusCiclo === "sucesso") return "parcial";
  return "erro";
}
