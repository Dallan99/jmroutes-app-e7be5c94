// Priorização de rotas ativas e sincronização incremental.
// Não classifica status de negócio (isso é do JMRoutes / meli_status_normalizado);
// aqui é apenas heurística de ORDEM DE COLETA.
import type { RotaLista } from "./list";

const ATIVAS = ["in_route", "started", "in_progress", "on_route", "em_rota", "iniciada", "picking"];
const FINALIZADAS = ["finished", "finalizada", "closed", "completed", "delivered", "cancelled", "canceled"];

export function pesoRota(rota: RotaLista): number {
  const s = `${rota.status ?? ""} ${rota.substatus ?? ""}`.toLowerCase();
  if (ATIVAS.some((a) => s.includes(a))) return 0;
  if (FINALIZADAS.some((f) => s.includes(f))) return 2;
  return 1;
}

export type EstadoIncremental = {
  /** routeId -> assinatura da última sincronização bem-sucedida */
  ultimaAssinatura: Map<string, string>;
  /** routeId -> epoch ms da última coleta */
  ultimaColeta: Map<string, number>;
};

export function novoEstadoIncremental(): EstadoIncremental {
  return { ultimaAssinatura: new Map(), ultimaColeta: new Map() };
}

export function assinaturaLista(rota: RotaLista): string {
  return `${rota.status ?? ""}|${rota.substatus ?? ""}`;
}

export type FiltroOpts = {
  /** Rotas finalizadas só são recoletadas após este intervalo. */
  ttlFinalizadaMs?: number;
  agora?: number;
};

/**
 * Ordena por prioridade (ativas primeiro) e descarta rotas finalizadas
 * já coletadas cuja assinatura não mudou dentro do TTL.
 */
export function selecionarRotas(
  rotas: RotaLista[],
  estado: EstadoIncremental,
  opts: FiltroOpts = {},
): RotaLista[] {
  const ttl = opts.ttlFinalizadaMs ?? 30 * 60_000;
  const agora = opts.agora ?? Date.now();

  const filtradas = rotas.filter((r) => {
    const peso = pesoRota(r);
    if (peso < 2) return true;
    const coletadaEm = estado.ultimaColeta.get(r.routeId);
    if (coletadaEm === undefined) return true;
    const mudou = estado.ultimaAssinatura.get(r.routeId) !== assinaturaLista(r);
    if (mudou) return true;
    return agora - coletadaEm >= ttl;
  });

  return filtradas.sort((a, b) => pesoRota(a) - pesoRota(b) || a.routeId.localeCompare(b.routeId));
}

export function registrarColeta(estado: EstadoIncremental, rota: RotaLista, agora = Date.now()): void {
  estado.ultimaAssinatura.set(rota.routeId, assinaturaLista(rota));
  estado.ultimaColeta.set(rota.routeId, agora);
}
