import type { WorkerConfig } from "../config.js";
import { mensagemSegura } from "../logger.js";
import type { MotoristaCatalogo } from "../meli/drivers.js";

const ENDPOINT = "/api/public/meli/importar-motoristas";

export async function enviarCatalogoMotoristas(
  cfg: Pick<WorkerConfig, "jmrBaseUrl">,
  token: string,
  motoristas: MotoristaCatalogo[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "ok"; total: number } | { status: "sem_sessao" | "erro"; motivo: string }> {
  try {
    const response = await fetchImpl(`${cfg.jmrBaseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ motoristas }),
    });
    if (response.status === 401) return { status: "sem_sessao", motivo: "nao_autenticado" };
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body["ok"] !== true) {
      return { status: "erro", motivo: mensagemSegura(String(body["codigo"] ?? `http_${response.status}`)) };
    }
    return { status: "ok", total: Number(body["total"] ?? motoristas.length) };
  } catch (error) {
    return { status: "erro", motivo: mensagemSegura(String((error as Error)?.message ?? error)) };
  }
}

