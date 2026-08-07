// Coleta do DETALHE bruto da rota. O payload NÃO é transformado aqui:
// a normalização é responsabilidade do JMRoutes (src/lib/meli-normalize.ts).
import { ADMINML } from "../config.js";
import { executarComRetry, sleep, type MeliTransport, type Resultado } from "./list.js";

export type RotaBruta = Record<string, unknown>;

export function urlDetalhe(routeId: string, siteId: string): string {
  return `${ADMINML.DETAIL_URL}?routeId=${encodeURIComponent(routeId)}&siteId=${encodeURIComponent(siteId)}`;
}

export async function obterDetalheRota(
  transport: MeliTransport,
  routeId: string,
  siteId: string,
  dormir: (ms: number) => Promise<void> = sleep,
): Promise<Resultado<RotaBruta>> {
  const res = await executarComRetry(() => transport.get(urlDetalhe(routeId, siteId)), { dormir });
  if (!res.ok) return res;

  const body = res.valor.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Array.isArray((body as Record<string, unknown>)["stops"]) ||
    String((body as Record<string, unknown>)["id"] ?? "") !== String(routeId)
  ) {
    return { ok: false, motivo: "payload_shape" };
  }
  return { ok: true, valor: body as RotaBruta };
}
