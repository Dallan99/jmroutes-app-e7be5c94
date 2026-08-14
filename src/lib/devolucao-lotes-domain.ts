// ─────────────────────────────────────────────────────────────────────────────
// Regras puras dos LOTES de devolução (Devolução de Insucessos).
//
// Espelha exatamente o que o banco aplica em:
//   devolucao_motivo_do_meli / devolucao_lote_criar / devolucao_lote_bipar
// O operador NUNCA escolhe motivo: o motivo vem da ocorrência real registrada
// pelo motorista no Meli. Este módulo é a única fonte de verdade da interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { MotivoDevolucao } from "@/lib/devolucoes.functions";

export type TratamentoDevolucao =
  | "retorno_obrigatorio"
  | "investigacao"
  | "transferencia"
  | "revisao_necessaria";

export type MotivoMeli = {
  motivo: MotivoDevolucao;
  descricao: string;
  tratamento: TratamentoDevolucao;
};

const MAPA: Record<string, MotivoMeli> = {
  buyer_absent: {
    motivo: "cliente_ausente",
    descricao: "Cliente ausente",
    tratamento: "retorno_obrigatorio",
  },
  buyer_rejected: {
    motivo: "recusado",
    descricao: "Recusado pelo cliente",
    tratamento: "retorno_obrigatorio",
  },
  business_closed: {
    motivo: "comercio_fechado",
    descricao: "Comércio fechado",
    tratamento: "retorno_obrigatorio",
  },
  unvisited_address: {
    motivo: "endereco_nao_localizado",
    descricao: "Endereço não visitado",
    tratamento: "retorno_obrigatorio",
  },
  damaged: { motivo: "avaria", descricao: "Pacote avariado", tratamento: "retorno_obrigatorio" },
  bad_address: {
    motivo: "endereco_nao_localizado",
    descricao: "Endereço incorreto/incompleto",
    tratamento: "retorno_obrigatorio",
  },
  missrouted: { motivo: "outros", descricao: "Fora da região", tratamento: "retorno_obrigatorio" },
  blocked_by_keyword: {
    motivo: "zona_de_risco",
    descricao: "Bloqueio operacional",
    tratamento: "retorno_obrigatorio",
  },
  missing: { motivo: "outros", descricao: "Extravio em investigação", tratamento: "investigacao" },
  lost: { motivo: "outros", descricao: "Extravio em investigação", tratamento: "investigacao" },
  stolen: {
    motivo: "outros",
    descricao: "Extravio em investigação (roubo)",
    tratamento: "investigacao",
  },
  transferred: { motivo: "outros", descricao: "Transferido", tratamento: "transferencia" },
};

const REVISAO: MotivoMeli = {
  motivo: "outros",
  descricao: "Revisão necessária — ocorrência não reconhecida",
  tratamento: "revisao_necessaria",
};

/** Motivo automático a partir da ocorrência real do Meli. Nunca inventa motivo. */
export function motivoDoMeli(occurrenceCode?: string | null): MotivoMeli {
  const c = (occurrenceCode ?? "").trim().toLowerCase();
  if (!c) {
    return {
      motivo: "outros",
      descricao: "Pacote sem ocorrência Meli elegível — revisão necessária",
      tratamento: "revisao_necessaria",
    };
  }
  return MAPA[c] ?? REVISAO;
}

export const LABEL_TRATAMENTO: Record<TratamentoDevolucao, string> = {
  retorno_obrigatorio: "Retorno à base",
  investigacao: "Em investigação",
  transferencia: "Transferido",
  revisao_necessaria: "Revisão necessária",
};

export const CLASSE_TRATAMENTO: Record<TratamentoDevolucao, string> = {
  retorno_obrigatorio: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  investigacao: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  transferencia: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  revisao_necessaria: "bg-purple-600/20 text-purple-500 border-purple-600/40",
};

/** Nome de exibição do lote: `EXP - REC DD/MM/AAAA BASE - NNN`. */
export function nomeLoteDevolucao(
  dataOperacional: string,
  baseCodigo: string,
  sequencia: number,
): string {
  const [a, m, d] = dataOperacional.split("-");
  return `EXP - REC ${d}/${m}/${a} ${baseCodigo} - ${String(sequencia).padStart(3, "0")}`;
}

/** Código técnico (sem barras/espaços) do lote. */
export function codigoLoteDevolucao(
  dataOperacional: string,
  baseCodigo: string,
  sequencia: number,
): string {
  return `EXPREC${dataOperacional.replace(/-/g, "")}${baseCodigo}${String(sequencia).padStart(3, "0")}`;
}

/** Próxima sequência por base + data (independente entre bases). */
export function proximaSequenciaLote(
  existentes: { base_id: string; data_operacional: string; sequencia: number }[],
  baseId: string,
  dataOperacional: string,
): number {
  const seqs = existentes
    .filter((l) => l.base_id === baseId && l.data_operacional === dataOperacional)
    .map((l) => l.sequencia);
  return (seqs.length ? Math.max(...seqs) : 0) + 1;
}

/** Bipagem só é permitida em lote aberto. */
export function podeBipar(lote?: { estado: string } | null): boolean {
  return !!lote && lote.estado === "aberta";
}
