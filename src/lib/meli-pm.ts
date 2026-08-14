// ─────────────────────────────────────────────────────────────────────────────
// Regra ÚNICA das rotas PM (ESP16) nos indicadores.
// Espelha exatamente as funções SQL:
//   public.meli_rota_pm(nome, route_id)
//   public.meli_rota_estado_operacional(rota_id)
//   public.meli_rota_pm_excluida(rota_id)
//
// Precedência obrigatória: o estado real da operação tem prioridade sobre o
// marcador _PM.
//   _PM + não iniciada  → fora dos indicadores de hoje (programada p/ amanhã)
//   _PM + em andamento  → entra na conta de hoje
//   _PM + finalizada    → entra na conta de hoje
// Nenhuma tela deve reimplementar essa regra.
// ─────────────────────────────────────────────────────────────────────────────

import type { SituacaoMeli } from "./meli-status";

export type EstadoOperacionalRota = "nao_iniciada" | "em_andamento" | "finalizada";

/** Base piloto onde a regra PM se aplica. */
export const BASE_REGRA_PM = "ESP16";

const SUB_NAO_INICIADA = new Set([
  "on_way_destination_facility",
  "planned",
  "pending",
  "created",
  "not_started",
]);
const SUB_ANDAMENTO = new Set([
  "started",
  "in_route",
  "on_route",
  "out_for_delivery",
  "picked_up",
  "delivering",
  "in_progress",
]);
const STATUS_ANDAMENTO = new Set(["active", "in_route", "on_route", "started", "in_progress", "close"]);
const STATUS_FINALIZADO = new Set(["finished", "finalized", "closed", "completed", "done"]);

/** Marcador PM no nome operacional (cluster) ou no route_id. */
export function rotaEhPM(nome?: string | null, routeId?: string | null): boolean {
  const alvo = `${nome ?? ""} ${routeId ?? ""}`.toUpperCase();
  return /(^|[^A-Z0-9])PM[0-9]*([^A-Z0-9]|$)/.test(alvo);
}

/**
 * Estado operacional real da rota. Evidência dos pacotes tem precedência sobre
 * substatus, que tem precedência sobre status.
 */
export function estadoOperacionalRota(input: {
  route_status?: string | null;
  route_substatus?: string | null;
  situacoes?: SituacaoMeli[];
  /** Alternativa agregada aos `situacoes` (usada pelos dashboards). */
  total?: number;
  entregue?: number;
  em_rota?: number;
  insucesso?: number;
  cancelado?: number;
}): EstadoOperacionalRota {
  const st = (input.route_status ?? "").trim().toLowerCase();
  const sub = (input.route_substatus ?? "").trim().toLowerCase();

  let total = input.total ?? 0;
  let entregue = input.entregue ?? 0;
  let emRota = input.em_rota ?? 0;
  let insucesso = input.insucesso ?? 0;
  let cancelado = input.cancelado ?? 0;
  if (input.situacoes) {
    total = input.situacoes.length;
    entregue = input.situacoes.filter((s) => s === "entregue").length;
    emRota = input.situacoes.filter((s) => s === "em_rota").length;
    insucesso = input.situacoes.filter((s) => s === "insucesso").length;
    cancelado = input.situacoes.filter((s) => s === "cancelado").length;
  }

  const terminais = entregue + insucesso + cancelado;
  if (total > 0 && terminais === total) return "finalizada";
  if (STATUS_FINALIZADO.has(st) && !SUB_NAO_INICIADA.has(sub)) return "finalizada";

  if (entregue > 0 || emRota > 0 || insucesso > 0) return "em_andamento";
  if (SUB_ANDAMENTO.has(sub)) return "em_andamento";
  if (STATUS_ANDAMENTO.has(st) && !SUB_NAO_INICIADA.has(sub)) return "em_andamento";

  return "nao_iniciada";
}

/**
 * Regra central de exclusão dos indicadores do dia.
 * Só exclui PM da ESP16 enquanto NÃO iniciada.
 */
export function pmExcluidaDosIndicadores(input: {
  base_codigo?: string | null;
  cluster?: string | null;
  route_id?: string | null;
  estado?: EstadoOperacionalRota;
  route_status?: string | null;
  route_substatus?: string | null;
  situacoes?: SituacaoMeli[];
  total?: number;
  entregue?: number;
  em_rota?: number;
  insucesso?: number;
  cancelado?: number;
}): boolean {
  const base = (input.base_codigo ?? "").trim().toUpperCase();
  if (base !== BASE_REGRA_PM) return false;
  if (!rotaEhPM(input.cluster, input.route_id)) return false;
  const estado = input.estado ?? estadoOperacionalRota(input);
  return estado === "nao_iniciada";
}

/** Texto único do aviso exibido nos cartões de base. */
export function avisoPmProgramadas(rotas: number, pacotes: number): string | null {
  if (rotas <= 0) return null;
  return `${rotas} rota${rotas === 1 ? "" : "s"} PM não iniciada${rotas === 1 ? "" : "s"} · ${pacotes.toLocaleString(
    "pt-BR",
  )} pacote${pacotes === 1 ? "" : "s"} fora dos indicadores de hoje`;
}
