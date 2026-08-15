// ─────────────────────────────────────────────────────────────────────────────
// Regras puras do Controle de Devoluções Meli.
//
// Regra central: todo pacote com ocorrência de rua que impeça a entrega deve
// retornar fisicamente à base de origem em até 3 dias corridos após a
// ocorrência. Este módulo espelha exatamente a classificação aplicada no banco
// (meli_devolucoes_sincronizar / meli_devolucoes_painel) e é a única fonte de
// verdade usada pela interface. Nenhum componente deve reclassificar sozinho.
// ─────────────────────────────────────────────────────────────────────────────

/** Ocorrências de rua que obrigam retorno físico à base de origem. */
export const OCORRENCIAS_RETORNO_OBRIGATORIO = [
  "buyer_rejected",
  "buyer_absent",
  "business_closed",
  "unvisited_address",
  "damaged",
  "bad_address",
  "missrouted",
  "blocked_by_keyword",
] as const;

/** Extravio: abre investigação; não é retorno físico pendente. */
export const OCORRENCIAS_INVESTIGACAO = ["missing", "lost", "stolen"] as const;

/** Transferência: acompanha destino; não é devolução para a base de origem. */
export const OCORRENCIAS_TRANSFERENCIA = ["transferred"] as const;

export const ALIASES_OCORRENCIA: Readonly<Record<string, string>> = {
  unvisited: "unvisited_address",
  blocked: "blocked_by_keyword",
  blocked_kw: "blocked_by_keyword",
};

export function normalizarOcorrencia(codigo?: string | null): string {
  const normalizado = (codigo ?? "").trim().toLowerCase();
  return ALIASES_OCORRENCIA[normalizado] ?? normalizado;
}

export type TratamentoOcorrencia =
  | "retorno_obrigatorio"
  | "investigacao"
  | "transferencia"
  | "revisao_necessaria";

export function classificarOcorrencia(codigo?: string | null): TratamentoOcorrencia {
  const c = normalizarOcorrencia(codigo);
  if ((OCORRENCIAS_RETORNO_OBRIGATORIO as readonly string[]).includes(c)) {
    return "retorno_obrigatorio";
  }
  if ((OCORRENCIAS_INVESTIGACAO as readonly string[]).includes(c)) return "investigacao";
  if ((OCORRENCIAS_TRANSFERENCIA as readonly string[]).includes(c)) return "transferencia";
  // Ocorrência desconhecida nunca é descartada.
  return "revisao_necessaria";
}

export const PRAZO_RETORNO_DIAS = 3;

/** prazo_retorno_em = ocorrência + 3 dias corridos. */
export function calcularPrazoRetorno(ocorridoEm: string | Date): Date {
  const base = typeof ocorridoEm === "string" ? new Date(ocorridoEm) : ocorridoEm;
  return new Date(base.getTime() + PRAZO_RETORNO_DIAS * 24 * 3600 * 1000);
}

export type EstadoDevolucao =
  | "aguardando_retorno"
  | "proximo_do_prazo"
  | "atrasado"
  | "recebido_na_base"
  | "em_investigacao"
  | "transferido"
  | "divergencia_delivered"
  | "revisao_necessaria"
  | "encerrado";

export const LABEL_ESTADO: Record<EstadoDevolucao, string> = {
  aguardando_retorno: "Aguardando retorno",
  proximo_do_prazo: "Próximo do prazo",
  atrasado: "Atrasado",
  recebido_na_base: "Recebido na base",
  em_investigacao: "Extravio em investigação",
  transferido: "Transferido",
  divergencia_delivered: "Recebido, porém Meli entregue",
  revisao_necessaria: "Revisão necessária",
  encerrado: "Encerrado",
};

export type FaixaVisual = "verde" | "amarelo" | "vermelho" | "critico" | "neutro";

/**
 * Faixas visuais obrigatórias:
 * - verde: recebido dentro do prazo;
 * - amarelo: falta até 1 dia;
 * - vermelho: prazo vencido;
 * - crítico (roxo/vermelho): recebido fisicamente, porém Meli delivered.
 */
export function faixaVisual(input: {
  estado: EstadoDevolucao | string;
  prazo_retorno_em: string | Date | null;
  recebido_em?: string | Date | null;
  divergencia_delivered?: boolean;
  agora?: Date;
}): FaixaVisual {
  const agora = input.agora ?? new Date();
  const prazo = input.prazo_retorno_em == null
    ? null
    :
    typeof input.prazo_retorno_em === "string"
      ? new Date(input.prazo_retorno_em)
      : input.prazo_retorno_em;

  if (input.divergencia_delivered || input.estado === "divergencia_delivered") return "critico";

  if (input.recebido_em) {
    if (!prazo) return "neutro";
    const rec = typeof input.recebido_em === "string" ? new Date(input.recebido_em) : input.recebido_em;
    return rec.getTime() <= prazo.getTime() ? "verde" : "vermelho";
  }

  if (input.estado === "em_investigacao" || input.estado === "transferido") return "neutro";
  if (input.estado === "revisao_necessaria") return "amarelo";
  if (input.estado === "encerrado") return "neutro";

  if (!prazo) return "neutro";

  if (prazo.getTime() < agora.getTime()) return "vermelho";
  if (prazo.getTime() - agora.getTime() <= 24 * 3600 * 1000) return "amarelo";
  return "verde";
}

export const CLASSE_FAIXA: Record<FaixaVisual, string> = {
  verde: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  amarelo: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  vermelho: "bg-destructive/15 text-destructive border-destructive/30",
  critico: "bg-purple-600/20 text-purple-500 border-purple-600/40",
  neutro: "bg-muted text-muted-foreground border-border",
};

/** Envelhecimento em dias corridos desde a ocorrência (0–1, 2, 3, mais de 3). */
export type FaixaEnvelhecimento = "d0_1" | "d2" | "d3" | "d4_mais";

export function faixaEnvelhecimento(dias: number): FaixaEnvelhecimento {
  if (dias <= 1) return "d0_1";
  if (dias === 2) return "d2";
  if (dias === 3) return "d3";
  return "d4_mais";
}

export function diasCorridos(
  ocorridoEm: string | Date,
  referencia: string | Date | null | undefined,
  agora: Date = new Date(),
): number {
  const inicio = typeof ocorridoEm === "string" ? new Date(ocorridoEm) : ocorridoEm;
  const fim = referencia
    ? typeof referencia === "string"
      ? new Date(referencia)
      : referencia
    : agora;
  return Math.max(0, Math.floor((fim.getTime() - inicio.getTime()) / (24 * 3600 * 1000)));
}

/**
 * Validação do recebimento físico no cliente (o banco revalida sempre).
 * Nunca marca recebido só porque o status do Meli mudou.
 */
export type MotivoBloqueioRecebimento =
  | null
  | "sem_base"
  | "sem_codigo"
  | "duplicado"
  | "base_divergente"
  | "observacao_obrigatoria";

export function validarRecebimento(input: {
  codigo: string;
  baseSelecionadaId: string | null;
  baseEsperadaId?: string | null;
  jaRecebido?: boolean;
  situacaoMeli?: string | null;
  observacao?: string | null;
}): MotivoBloqueioRecebimento {
  if (!input.baseSelecionadaId) return "sem_base";
  if (!input.codigo.trim()) return "sem_codigo";
  if (input.jaRecebido) return "duplicado";
  if (input.baseEsperadaId && input.baseEsperadaId !== input.baseSelecionadaId) {
    return "base_divergente";
  }
  if (input.situacaoMeli === "entregue" && !(input.observacao ?? "").trim()) {
    return "observacao_obrigatoria";
  }
  return null;
}

/** Classificação de área de risco: apenas indicadores reais do payload Meli. */
export type RiscoRota = "integral" | "parcial" | "sem_risco";

export function classificarRiscoRota(input: {
  rota_area_risco?: boolean | null;
  area_risco_parcial?: boolean | null;
  pacotes_risco?: number | null;
  insucesso_risco?: number | null;
}): RiscoRota {
  if (input.rota_area_risco) return "integral";
  if (input.area_risco_parcial || (input.pacotes_risco ?? 0) > 0) return "parcial";
  // Insucesso, isoladamente, NUNCA classifica área de risco.
  return "sem_risco";
}
