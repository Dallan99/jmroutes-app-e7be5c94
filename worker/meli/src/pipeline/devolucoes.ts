import type { WorkerConfig } from "../config.js";
import { mensagemSegura } from "../logger.js";

export type DevolucoesSyncResultado =
  | { status: "ok"; resultado: Record<string, unknown> }
  | { status: "sem_sessao" }
  | { status: "erro"; motivo: string };

function dataBrt(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function janelaDevolucoes(agora = new Date(), dias = 7): { de: string; ate: string } {
  const inicio = new Date(agora.getTime() - Math.max(0, dias - 1) * 86_400_000);
  return { de: dataBrt(inicio), ate: dataBrt(agora) };
}

export async function sincronizarDevolucoes(
  cfg: Pick<WorkerConfig, "supabaseUrl" | "supabaseAnonKey" | "baseCode">,
  accessToken: string,
  opts: { fetchImpl?: typeof fetch; agora?: Date; dias?: number } = {},
): Promise<DevolucoesSyncResultado> {
  const f = opts.fetchImpl ?? fetch;
  const headers = { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${accessToken}` };
  try {
    const baseUrl = new URL(`${cfg.supabaseUrl}/rest/v1/bases`);
    baseUrl.searchParams.set("select", "id");
    baseUrl.searchParams.set("codigo", `eq.${cfg.baseCode}`);
    baseUrl.searchParams.set("limit", "1");
    const baseRes = await f(baseUrl, { headers });
    if (baseRes.status === 401) return { status: "sem_sessao" };
    if (!baseRes.ok) return { status: "erro", motivo: `base_http_${baseRes.status}` };
    const bases = (await baseRes.json()) as Array<{ id?: unknown }>;
    const baseId = typeof bases[0]?.id === "string" ? bases[0].id : null;
    if (!baseId) return { status: "erro", motivo: "base_nao_encontrada" };

    const janela = janelaDevolucoes(opts.agora, opts.dias ?? 7);
    const syncRes = await f(`${cfg.supabaseUrl}/rest/v1/rpc/meli_devolucoes_sincronizar`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_data_de: janela.de, p_data_ate: janela.ate, p_base_id: baseId }),
    });
    if (syncRes.status === 401) return { status: "sem_sessao" };
    if (!syncRes.ok) return { status: "erro", motivo: `sync_http_${syncRes.status}` };
    return { status: "ok", resultado: (await syncRes.json()) as Record<string, unknown> };
  } catch (err) {
    return { status: "erro", motivo: mensagemSegura(String((err as Error)?.message ?? err)) };
  }
}
