// Envio do payload BRUTO ao endpoint já existente do JMRoutes.
// Nenhuma normalização, classificação de status, área de risco, upsert,
// publicação operacional, Recebimento ou Triagem é replicada aqui.
import { logger, mensagemSegura } from "../logger.js";
import type { WorkerConfig } from "../config.js";

export const ENDPOINT_PATH = "/api/public/meli/importar-rota-bruta";

export type EnvioResultado =
  | { status: "ok"; pacotes: number; routeId: string | null }
  | { status: "sem_sessao" }
  | { status: "rate_limit" }
  | { status: "erro"; mensagem: string };

export type EnvioOpts = {
  accessToken: string;
  confirmarDivergencia?: boolean;
  fetchImpl?: typeof fetch;
};

export function urlEndpoint(cfg: Pick<WorkerConfig, "jmrBaseUrl">): string {
  return `${cfg.jmrBaseUrl}${ENDPOINT_PATH}`;
}

export async function enviarRotaBruta(
  cfg: Pick<WorkerConfig, "jmrBaseUrl">,
  payload: Record<string, unknown>,
  opts: EnvioOpts,
): Promise<EnvioResultado> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(urlEndpoint(cfg), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({
        payload,
        origem: "worker",
        confirmar_divergencia: opts.confirmarDivergencia === true,
      }),
    });
  } catch (err) {
    return { status: "erro", mensagem: mensagemSegura(String((err as Error)?.message ?? err)) };
  }

  if (res.status === 401) return { status: "sem_sessao" };
  if (res.status === 429) return { status: "rate_limit" };

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { status: "erro", mensagem: `resposta_invalida_http_${res.status}` };
  }

  if (body["ok"] === true) {
    const inseridos = Number(body["inseridos"] ?? 0);
    const atualizados = Number(body["atualizados"] ?? 0);
    return {
      status: "ok",
      pacotes: inseridos + atualizados,
      routeId: typeof body["route_id"] === "string" ? body["route_id"] : null,
    };
  }

  if (body["requer_confirmacao"] === true) {
    logger.warn("Divergência de totais informada pelo JMRoutes.", {
      route_id: body["route_id"],
      diferenca: body["diferenca"],
    });
    return { status: "erro", mensagem: "divergencia_totais" };
  }

  return {
    status: "erro",
    mensagem: mensagemSegura(String(body["codigo"] ?? body["mensagem"] ?? `http_${res.status}`)),
  };
}
