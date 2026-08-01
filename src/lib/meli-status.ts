// ─────────────────────────────────────────────────────────────────────────────
// Normalização central dos status logísticos do Mercado Livre.
// Espelha exatamente a função SQL public.meli_status_normalizado(status, substatus,
// occurrence_code). Nenhum componente React deve classificar status por conta própria.
//
// IMPORTANTE: status Meli (logístico), status físico JM (recebimento) e status de
// Triagem JM são dimensões independentes. Esta função trata APENAS do Meli.
// ─────────────────────────────────────────────────────────────────────────────

export type SituacaoMeli =
  | "nao_iniciado"
  | "em_rota"
  | "entregue"
  | "insucesso"
  | "cancelado"
  | "desconhecido";

const ENTREGUE = new Set(["delivered", "entregue", "delivered_to_buyer"]);
const CANCELADO = new Set(["cancelled", "canceled", "cancelado"]);
const NAO_INICIADO = new Set([
  "pending",
  "planned",
  "ready_to_deliver",
  "to_be_delivered",
  "not_started",
  "created",
]);
const EM_ROTA = new Set([
  "picked_up",
  "in_route",
  "out_for_delivery",
  "active",
  "on_route",
  "shipped",
  "in_transit",
]);
const INSUCESSO = new Set([
  "buyer_absent",
  "buyer_rejected",
  "buyer_moved",
  "business_closed",
  "bad_address",
  "unvisited_address",
  "inaccessible_address",
  "missrouted",
  "missing",
  "damaged",
  "blocked",
  "blocked_by_keyword",
  "risk_area",
  "dangerous_area",
  "return_to_station",
  "not_delivered",
  "refused",
  "lost",
  "stolen",
  "vehicle_issue",
]);

/**
 * Ordem de precedência obrigatória: occurrence_code → substatus → status.
 */
export function normalizarSituacaoMeli(
  status?: string | null,
  substatus?: string | null,
  occurrenceCode?: string | null,
): SituacaoMeli {
  const oc = (occurrenceCode ?? "").trim().toLowerCase();
  const sub = (substatus ?? "").trim().toLowerCase();
  const st = (status ?? "").trim().toLowerCase();
  const chave = oc || sub || st;
  if (!chave) return "desconhecido";
  if (ENTREGUE.has(chave)) return "entregue";
  if (CANCELADO.has(chave)) return "cancelado";
  if (NAO_INICIADO.has(chave)) return "nao_iniciado";
  if (EM_ROTA.has(chave)) return "em_rota";
  if (INSUCESSO.has(chave)) return "insucesso";
  return "desconhecido";
}

export const LABEL_SITUACAO: Record<SituacaoMeli, string> = {
  nao_iniciado: "Não iniciado",
  em_rota: "Em rota",
  entregue: "Entregue",
  insucesso: "Insucesso",
  cancelado: "Cancelado",
  desconhecido: "Desconhecido",
};

/** Tradução dos motivos de insucesso conhecidos (fallback: código original). */
export const LABEL_MOTIVO: Record<string, string> = {
  buyer_absent: "Destinatário ausente",
  business_closed: "Comércio fechado",
  bad_address: "Endereço incorreto",
  buyer_rejected: "Recusado pelo destinatário",
  buyer_moved: "Destinatário mudou-se",
  risk_area: "Área de risco",
  dangerous_area: "Área de risco",
  blocked_by_keyword: "Bloqueado (área de risco / restrição)",
  blocked: "Bloqueado",
  damaged: "Pacote danificado",
  missing: "Extraviado",
  lost: "Extraviado",
  stolen: "Roubo/furto",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  vehicle_issue: "Veículo com problema",
  inaccessible_address: "Sem acesso ao endereço",
  unvisited_address: "Endereço não visitado",
  missrouted: "Roteirizado incorretamente",
  return_to_station: "Retornado à base",
  sem_codigo: "Outros insucessos",
};

export function descreverMotivo(codigo?: string | null, descricaoCadastrada?: string | null): string {
  const c = (codigo ?? "").trim();
  if (descricaoCadastrada && descricaoCadastrada.trim() && descricaoCadastrada !== c) {
    return descricaoCadastrada;
  }
  if (!c) return LABEL_MOTIVO["sem_codigo"]!;
  return LABEL_MOTIVO[c.toLowerCase()] ?? c;
}

/**
 * Nome operacional da rota. Regra obrigatória:
 * 1) cluster; 2) outro nome operacional normalizado; 3) route_id como último fallback.
 * O route_id permanece a chave técnica — nunca é substituído, apenas complementado.
 */
export function nomeOperacionalRota(input: {
  cluster?: string | null;
  nome_operacional?: string | null;
  nro_rota?: string | null;
  otimizada?: string | null;
  planejada?: string | null;
  route_id?: string | null;
}): string {
  const cands = [
    input.cluster,
    input.nome_operacional,
    input.nro_rota,
    input.otimizada,
    input.planejada,
  ];
  const routeId = (input.route_id ?? "").trim();
  for (const c of cands) {
    const v = (c ?? "").trim();
    // Um nome puramente numérico é route_id disfarçado, não nome operacional.
    if (v && v !== routeId && !/^\d+$/.test(v)) return v;
  }
  return routeId || "—";
}

/** true quando o texto exibido já é o próprio route_id (evita repetir na UI). */
export function nomeEhRouteId(nome: string, routeId?: string | null): boolean {
  return !!routeId && nome.trim() === routeId.trim();
}
