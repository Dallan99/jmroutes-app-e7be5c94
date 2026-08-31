import type { WorkerConfig } from "../config.js";
import { mensagemSegura } from "../logger.js";
import type { LinhaRiscoRostering } from "../meli/risk.js";

const ENDPOINT = "/api/public/meli/importar-risco";

export async function enviarRiscoRostering(
  cfg: Pick<WorkerConfig, "jmrBaseUrl">,
  token: string,
  linhas: LinhaRiscoRostering[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "ok"; encontradas: number } | { status: "sem_sessao" | "erro"; motivo: string }> {
  try {
    const response = await fetchImpl(`${cfg.jmrBaseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ linhas }),
    });
    if (response.status === 401) return { status: "sem_sessao", motivo: "nao_autenticado" };
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body["ok"] !== true) {
      return { status: "erro", motivo: mensagemSegura(String(body["codigo"] ?? `http_${response.status}`)) };
    }
    return { status: "ok", encontradas: Number(body["encontradas"] ?? 0) };
  } catch (error) {
    return { status: "erro", motivo: mensagemSegura(String((error as Error)?.message ?? error)) };
  }
}
