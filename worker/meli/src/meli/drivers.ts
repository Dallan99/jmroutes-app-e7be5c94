import { executarComRetry, type MeliTransport, type Resultado } from "./list.js";

export const DRIVERS_URL =
  "https://envios.adminml.com/logistics/provider-management/api/drivers";

export type MotoristaCatalogo = {
  id: string;
  nome: string;
  status: "active" | "inactive" | "blocked" | "unknown";
  carrierId: string | null;
};

type PaginaMotoristas = {
  result?: unknown;
  pagination?: { cursor?: unknown; has_next?: unknown };
};

function statusSeguro(value: unknown): MotoristaCatalogo["status"] {
  return value === "active" || value === "inactive" || value === "blocked" ? value : "unknown";
}

export function extrairMotoristas(body: unknown): MotoristaCatalogo[] {
  const result = (body as PaginaMotoristas | null)?.result;
  if (!Array.isArray(result)) return [];
  const vistos = new Set<string>();
  const saida: MotoristaCatalogo[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj["id"] ?? "").trim();
    const nome = [obj["firstName"], obj["lastName"]]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .join(" ");
    if (!id || !nome || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({
      id,
      nome,
      status: statusSeguro(obj["status"]),
      carrierId: obj["carrierId"] == null ? null : String(obj["carrierId"]),
    });
  }
  return saida;
}

export async function listarTodosMotoristas(
  transport: MeliTransport,
  maxPaginas = 20,
): Promise<Resultado<MotoristaCatalogo[]>> {
  const catalogo = new Map<string, MotoristaCatalogo>();
  let cursor = "";
  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const qs = new URLSearchParams({
      status: "active,inactive,blocked",
      paginated: "true",
      fields: "blocking_reason,infraction,attributes,roles,pii_information",
    });
    if (cursor) qs.set("cursor", cursor);
    const resposta = await executarComRetry(() => transport.get(`${DRIVERS_URL}?${qs}`));
    if (!resposta.ok) return resposta;
    for (const motorista of extrairMotoristas(resposta.valor.body)) catalogo.set(motorista.id, motorista);
    const envelope = resposta.valor.body as PaginaMotoristas;
    const proximo = typeof envelope.pagination?.cursor === "string" ? envelope.pagination.cursor : "";
    if (envelope.pagination?.has_next !== true || !proximo || proximo === cursor) break;
    cursor = proximo;
  }
  return { ok: true, valor: [...catalogo.values()] };
}

