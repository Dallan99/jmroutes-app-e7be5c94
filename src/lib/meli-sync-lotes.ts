// ─────────────────────────────────────────────────────────────────────────────
// Regras ÚNICAS de publicação atômica da sincronização Meli (lote por base).
//
// Espelha exatamente as funções SQL:
//   public.meli_sync_ciclo_iniciar(...)
//   public.meli_sync_ciclo_finalizar(...)
//   public.meli_rotas_ativas (view)
//
// Princípios:
//   1. Rotas gravadas por um ciclo em processamento NÃO aparecem no painel.
//   2. O último lote concluído (ativo) continua alimentando Bases, Dashboard,
//      Modo TV, Área de Risco e Devoluções.
//   3. A troca do lote ativo acontece só na finalização válida, de uma vez.
//   4. Ciclo com erro/parcial nunca substitui o lote ativo (fica p/ diagnóstico).
//   5. Reenviar a mesma finalização é idempotente.
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCicloSync = "em_processamento" | "concluido" | "parcial" | "erro";

export type CicloSync = {
  sync_batch_id: string;
  base_codigo: string;
  data_operacional: string;
  estado: EstadoCicloSync;
  ativo: boolean;
};

export type RotaLote = {
  route_id: string;
  base_codigo: string;
  data_operacional: string;
  /** Lote dono da rota (último lote concluído que a publicou). */
  sync_batch_id: string | null;
  /** Lote em construção que já regravou a rota, mas ainda não publicou. */
  sync_batch_id_pendente?: string | null;
};

/** Lote ativo de uma base/dia: o último ciclo concluído e marcado como ativo. */
export function loteAtivoDaBase(
  ciclos: CicloSync[],
  base_codigo: string,
  data_operacional: string,
): string | null {
  const ativo = ciclos.find(
    (c) =>
      c.base_codigo === base_codigo &&
      c.data_operacional === data_operacional &&
      c.ativo &&
      c.estado === "concluido",
  );
  return ativo ? ativo.sync_batch_id : null;
}

/** Existe ciclo em construção para a base/dia? (usado no aviso da interface) */
export function sincronizandoNovaAtualizacao(
  ciclos: CicloSync[],
  base_codigo: string,
  data_operacional: string,
): boolean {
  return ciclos.some(
    (c) =>
      c.base_codigo === base_codigo &&
      c.data_operacional === data_operacional &&
      c.estado === "em_processamento",
  );
}

/**
 * Visibilidade de uma rota no painel — mesma regra da view `meli_rotas_ativas`.
 * Rotas históricas (sem lote e sem ciclo pendente) continuam visíveis.
 */
export function rotaVisivelNoPainel(rota: RotaLote, ciclos: CicloSync[]): boolean {
  // Rota nova, gravada por um ciclo em construção: invisível até a publicação.
  if (!rota.sync_batch_id) return !rota.sync_batch_id_pendente;
  return ciclos.some(
    (c) => c.sync_batch_id === rota.sync_batch_id && c.ativo && c.estado === "concluido",
  );
}

/** Conjunto visível pelo painel (Bases, Dashboard, TV, risco, devoluções). */
export function rotasDoPainel(rotas: RotaLote[], ciclos: CicloSync[]): RotaLote[] {
  return rotas.filter((r) => rotaVisivelNoPainel(r, ciclos));
}

export type ResultadoFinalizacao =
  | { status: "ok"; idempotente: boolean; lote_ativo: string }
  | { status: "ignorado"; motivo: string; estado: EstadoCicloSync; lote_ativo: string | null };

export type EntradaFinalizacao = {
  sync_batch_id: string;
  base_codigo: string;
  data_operacional: string;
  /** Rotas/pacotes que o worker declara ter enviado. */
  rotas: number | null;
  pacotes: number | null;
  /** Estado declarado pelo worker para o ciclo. */
  estado_worker: EstadoCicloSync;
};

/**
 * Validação da finalização: base, data operacional, quantidade de rotas,
 * quantidade de pacotes e estado do ciclo. Só um ciclo íntegro troca o lote.
 */
export function finalizarCiclo(
  entrada: EntradaFinalizacao,
  contexto: {
    ciclos: CicloSync[];
    /** Rotas realmente gravadas por este ciclo (pendentes de publicação). */
    rotas_gravadas: number;
    /** Pacotes realmente gravados por este ciclo. */
    pacotes_gravados: number;
  },
): { resultado: ResultadoFinalizacao; ciclos: CicloSync[] } {
  const { ciclos } = contexto;
  const alvo = ciclos.find((c) => c.sync_batch_id === entrada.sync_batch_id);
  const ativoAtual = loteAtivoDaBase(ciclos, entrada.base_codigo, entrada.data_operacional);

  if (!alvo) {
    return {
      resultado: { status: "ignorado", motivo: "ciclo_desconhecido", estado: "erro", lote_ativo: ativoAtual },
      ciclos,
    };
  }

  // Idempotência: repetir a mesma finalização não muda nada.
  if (alvo.estado === "concluido") {
    return {
      resultado: { status: "ok", idempotente: true, lote_ativo: alvo.sync_batch_id },
      ciclos,
    };
  }

  const ignorar = (motivo: string, estado: EstadoCicloSync) => {
    const novos = ciclos.map((c) =>
      c.sync_batch_id === entrada.sync_batch_id ? { ...c, estado, ativo: false } : c,
    );
    return {
      resultado: { status: "ignorado" as const, motivo, estado, lote_ativo: ativoAtual },
      ciclos: novos,
    };
  };

  if (alvo.base_codigo !== entrada.base_codigo) return ignorar("base_divergente", "erro");
  if (alvo.data_operacional !== entrada.data_operacional) return ignorar("data_divergente", "erro");
  if (entrada.estado_worker !== "concluido") return ignorar("ciclo_com_erro", entrada.estado_worker);
  if (contexto.rotas_gravadas <= 0) return ignorar("sem_rotas_no_ciclo", "parcial");
  if (entrada.rotas !== null && entrada.rotas !== contexto.rotas_gravadas) {
    return ignorar("quantidade_rotas_divergente", "parcial");
  }
  if (entrada.pacotes !== null && entrada.pacotes !== contexto.pacotes_gravados) {
    return ignorar("quantidade_pacotes_divergente", "parcial");
  }

  // Troca atômica: desativa o lote anterior e ativa o novo em um único passo.
  const novos = ciclos.map((c) => {
    if (c.sync_batch_id === entrada.sync_batch_id) {
      return { ...c, estado: "concluido" as EstadoCicloSync, ativo: true };
    }
    if (c.base_codigo === entrada.base_codigo && c.data_operacional === entrada.data_operacional) {
      return { ...c, ativo: false };
    }
    return c;
  });

  return {
    resultado: { status: "ok", idempotente: false, lote_ativo: entrada.sync_batch_id },
    ciclos: novos,
  };
}

/**
 * Efeito da publicação sobre as rotas: as rotas gravadas pelo ciclo passam a
 * pertencer ao novo lote; as rotas do lote anterior não publicadas de novo
 * saem do painel. Nada é apagado.
 */
export function publicarRotas(rotas: RotaLote[], sync_batch_id: string): RotaLote[] {
  return rotas.map((r) =>
    r.sync_batch_id_pendente === sync_batch_id
      ? { ...r, sync_batch_id, sync_batch_id_pendente: null }
      : r,
  );
}
