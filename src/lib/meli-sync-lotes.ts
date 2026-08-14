// ─────────────────────────────────────────────────────────────────────────────
// Regras ÚNICAS da publicação atômica da sincronização Meli.
//
// Espelha exatamente as funções SQL:
//   public.meli_sync_ciclo_iniciar(...)
//   public.meli_sync_rota_staging(...)
//   public.meli_sync_ciclo_finalizar(...)
//   public.meli_rotas_ativas (view, security_invoker = true)
//
// Princípios:
//   1. A ingestão do ciclo grava SOMENTE nas tabelas de staging
//      (meli_sync_rotas_staging / meli_sync_pacotes_staging).
//   2. meli_rotas / meli_pacotes não sofrem nenhuma escrita durante a construção.
//   3. O painel lê apenas o lote concluído e ativo (ponteiro em meli_sync_ciclos).
//   4. A promoção do snapshot acontece em uma única transação, sob advisory lock
//      por base + dia operacional.
//   5. Ciclo parcial/erro fica isolado no staging e nunca altera a visibilidade.
//   6. Reenviar a mesma finalização é idempotente.
//   7. Contagens sempre por identificadores DISTINTOS (route_id / tracking_id).
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCicloSync =
  | "em_processamento"
  | "concluido"
  | "parcial"
  | "erro"
  | "abandonado";

export type CicloSync = {
  sync_batch_id: string;
  base_codigo: string;
  data_operacional: string;
  origem: string;
  estado: EstadoCicloSync;
  ativo: boolean;
};

/** Linha do staging de rotas — chave composta (sync_batch_id, route_id). */
export type RotaStaging = {
  sync_batch_id: string;
  route_id: string;
  base_codigo: string;
  data_rota: string;
};

/** Linha do staging de pacotes — chave composta (sync_batch_id, tracking_id). */
export type PacoteStaging = {
  sync_batch_id: string;
  route_id: string;
  tracking_id: string;
};

/** Linha operacional publicada (meli_rotas). */
export type RotaOperacional = {
  route_id: string;
  base_codigo: string;
  data_rota: string;
  /** Lote que publicou esta linha; nulo = histórico anterior aos lotes. */
  sync_batch_id: string | null;
  /** Snapshot dos pacotes publicados (tracking_ids). */
  pacotes: string[];
};

export type EstadoBanco = {
  ciclos: CicloSync[];
  rotas_staging: RotaStaging[];
  pacotes_staging: PacoteStaging[];
  rotas: RotaOperacional[];
};

export function novoBanco(): EstadoBanco {
  return { ciclos: [], rotas_staging: [], pacotes_staging: [], rotas: [] };
}

// ── Ponteiro do lote ativo ───────────────────────────────────────────────────

/** Lote ativo de uma base/dia: o último ciclo concluído e marcado como ativo. */
export function loteAtivoDaBase(
  banco: EstadoBanco,
  base_codigo: string,
  data_operacional: string,
): string | null {
  const ativo = banco.ciclos.find(
    (c) =>
      c.base_codigo === base_codigo &&
      c.data_operacional === data_operacional &&
      c.ativo &&
      c.estado === "concluido",
  );
  return ativo ? ativo.sync_batch_id : null;
}

/** Existe ciclo em construção para a base/dia? (aviso "Sincronizando nova atualização") */
export function sincronizandoNovaAtualizacao(
  banco: EstadoBanco,
  base_codigo: string,
  data_operacional: string,
): boolean {
  return banco.ciclos.some(
    (c) =>
      c.base_codigo === base_codigo &&
      c.data_operacional === data_operacional &&
      c.estado === "em_processamento",
  );
}

/**
 * Visibilidade de uma rota publicada — mesma regra da view `meli_rotas_ativas`.
 * Rotas históricas (sem lote) continuam visíveis.
 */
export function rotaVisivelNoPainel(rota: RotaOperacional, banco: EstadoBanco): boolean {
  if (!rota.sync_batch_id) return true;
  return banco.ciclos.some(
    (c) => c.sync_batch_id === rota.sync_batch_id && c.ativo && c.estado === "concluido",
  );
}

/**
 * Conjunto lido por TODAS as telas (Bases, Dashboard, Modo TV, Área de Risco e
 * Devoluções). Não existe leitura alternativa.
 */
export function rotasDoPainel(banco: EstadoBanco, base_codigo?: string): RotaOperacional[] {
  return banco.rotas.filter(
    (r) => rotaVisivelNoPainel(r, banco) && (!base_codigo || r.base_codigo === base_codigo),
  );
}

/** Pacotes visíveis do painel (derivados exclusivamente das rotas visíveis). */
export function pacotesDoPainel(banco: EstadoBanco, base_codigo?: string): string[] {
  return rotasDoPainel(banco, base_codigo).flatMap((r) => r.pacotes);
}

// ── Abertura do ciclo ────────────────────────────────────────────────────────

export type EntradaIniciar = {
  sync_batch_id: string;
  base_codigo: string;
  data_operacional: string;
  origem: string;
};

export type ResultadoIniciar =
  | { status: "ok"; idempotente: boolean }
  | { status: "erro"; erro: string };

/**
 * Idempotência SÓ para parâmetros equivalentes: o mesmo UUID com base, data ou
 * origem diferentes é recusado.
 */
export function iniciarCiclo(
  banco: EstadoBanco,
  entrada: EntradaIniciar,
): { resultado: ResultadoIniciar; banco: EstadoBanco } {
  const existente = banco.ciclos.find((c) => c.sync_batch_id === entrada.sync_batch_id);

  if (existente) {
    const equivalente =
      existente.base_codigo === entrada.base_codigo &&
      existente.data_operacional === entrada.data_operacional &&
      existente.origem === entrada.origem;
    if (!equivalente) {
      return { resultado: { status: "erro", erro: "uuid_reutilizado_divergente" }, banco };
    }
    if (existente.estado !== "em_processamento") {
      return { resultado: { status: "erro", erro: "ciclo_encerrado" }, banco };
    }
    return { resultado: { status: "ok", idempotente: true }, banco };
  }

  return {
    resultado: { status: "ok", idempotente: false },
    banco: {
      ...banco,
      ciclos: [
        ...banco.ciclos,
        {
          sync_batch_id: entrada.sync_batch_id,
          base_codigo: entrada.base_codigo,
          data_operacional: entrada.data_operacional,
          origem: entrada.origem,
          estado: "em_processamento",
          ativo: false,
        },
      ],
    },
  };
}

// ── Ingestão no staging ──────────────────────────────────────────────────────

export type EntradaStaging = {
  sync_batch_id: string;
  route_id: string;
  base_codigo: string;
  data_rota: string;
  tracking_ids: string[];
  /** Bases às quais o usuário tem acesso (RLS por base). */
  bases_do_usuario: string[];
};

export type ResultadoStaging =
  | { status: "ok"; rotas_no_lote: number; pacotes_no_lote: number }
  | { status: "erro"; erro: string };

/**
 * Grava a rota do ciclo apenas no staging. Nenhuma escrita nas tabelas ativas.
 */
export function gravarRotaNoStaging(
  banco: EstadoBanco,
  entrada: EntradaStaging,
): { resultado: ResultadoStaging; banco: EstadoBanco } {
  const ciclo = banco.ciclos.find((c) => c.sync_batch_id === entrada.sync_batch_id);
  if (!ciclo) return { resultado: { status: "erro", erro: "ciclo_desconhecido" }, banco };
  if (ciclo.estado !== "em_processamento") {
    return { resultado: { status: "erro", erro: "ciclo_nao_em_processamento" }, banco };
  }
  if (!entrada.bases_do_usuario.includes(ciclo.base_codigo)) {
    return { resultado: { status: "erro", erro: "sem_acesso_a_base" }, banco };
  }
  if (ciclo.base_codigo !== entrada.base_codigo) {
    return { resultado: { status: "erro", erro: "base_da_rota_divergente" }, banco };
  }
  if (ciclo.data_operacional !== entrada.data_rota) {
    return { resultado: { status: "erro", erro: "data_da_rota_divergente" }, banco };
  }

  // Upsert por chave composta.
  const rotas_staging = [
    ...banco.rotas_staging.filter(
      (r) => !(r.sync_batch_id === entrada.sync_batch_id && r.route_id === entrada.route_id),
    ),
    {
      sync_batch_id: entrada.sync_batch_id,
      route_id: entrada.route_id,
      base_codigo: entrada.base_codigo,
      data_rota: entrada.data_rota,
    },
  ];

  const trackings = [...new Set(entrada.tracking_ids)];
  const pacotes_staging = [
    ...banco.pacotes_staging.filter(
      (p) => !(p.sync_batch_id === entrada.sync_batch_id && trackings.includes(p.tracking_id)),
    ),
    ...trackings.map((tracking_id) => ({
      sync_batch_id: entrada.sync_batch_id,
      route_id: entrada.route_id,
      tracking_id,
    })),
  ];

  const proximo = { ...banco, rotas_staging, pacotes_staging };
  return {
    resultado: {
      status: "ok",
      rotas_no_lote: contarRotasDoLote(proximo, entrada.sync_batch_id),
      pacotes_no_lote: contarPacotesDoLote(proximo, entrada.sync_batch_id),
    },
    banco: proximo,
  };
}

/** Rotas distintas gravadas pelo lote. */
export function contarRotasDoLote(banco: EstadoBanco, sync_batch_id: string): number {
  return new Set(
    banco.rotas_staging.filter((r) => r.sync_batch_id === sync_batch_id).map((r) => r.route_id),
  ).size;
}

/** Pacotes distintos gravados pelo lote. */
export function contarPacotesDoLote(banco: EstadoBanco, sync_batch_id: string): number {
  return new Set(
    banco.pacotes_staging
      .filter((p) => p.sync_batch_id === sync_batch_id)
      .map((p) => p.tracking_id),
  ).size;
}

// ── Finalização e promoção ───────────────────────────────────────────────────

export type EntradaFinalizacao = {
  sync_batch_id: string;
  base_codigo: string;
  data_operacional: string;
  /** Totais declarados pelo worker (nulo = não validar). */
  rotas: number | null;
  pacotes: number | null;
  /** Estado declarado pelo worker para o ciclo. */
  estado_worker: EstadoCicloSync;
};

export type ResultadoFinalizacao =
  | { status: "ok"; idempotente: boolean; lote_ativo: string; rotas: number; pacotes: number }
  | { status: "ignorado"; motivo: string; estado: EstadoCicloSync; lote_ativo: string | null };

/**
 * Finalização sob advisory lock por base/dia: valida, promove o snapshot inteiro
 * e move o ponteiro do lote ativo em uma única transação.
 */
export function finalizarCiclo(
  banco: EstadoBanco,
  entrada: EntradaFinalizacao,
): { resultado: ResultadoFinalizacao; banco: EstadoBanco } {
  const alvo = banco.ciclos.find((c) => c.sync_batch_id === entrada.sync_batch_id);
  const ativoAtual = loteAtivoDaBase(banco, entrada.base_codigo, entrada.data_operacional);

  if (!alvo) {
    return {
      resultado: { status: "ignorado", motivo: "ciclo_desconhecido", estado: "erro", lote_ativo: ativoAtual },
      banco,
    };
  }

  // Idempotência: repetir a mesma finalização não altera nada.
  if (alvo.estado === "concluido") {
    return {
      resultado: {
        status: "ok",
        idempotente: true,
        lote_ativo: alvo.sync_batch_id,
        rotas: contarRotasDoLote(banco, alvo.sync_batch_id),
        pacotes: contarPacotesDoLote(banco, alvo.sync_batch_id),
      },
      banco,
    };
  }

  const rotasGravadas = contarRotasDoLote(banco, entrada.sync_batch_id);
  const pacotesGravados = contarPacotesDoLote(banco, entrada.sync_batch_id);

  const ignorar = (motivo: string, estado: EstadoCicloSync) => ({
    resultado: {
      status: "ignorado" as const,
      motivo,
      estado,
      lote_ativo: ativoAtual,
    },
    // Ciclo defeituoso é apenas marcado: staging preservado, ponteiro intocado.
    banco: {
      ...banco,
      ciclos: banco.ciclos.map((c) =>
        c.sync_batch_id === entrada.sync_batch_id ? { ...c, estado, ativo: false } : c,
      ),
    },
  });

  if (alvo.estado !== "em_processamento") return ignorar("ciclo_encerrado", alvo.estado);
  if (alvo.base_codigo !== entrada.base_codigo) return ignorar("base_divergente", "erro");
  if (alvo.data_operacional !== entrada.data_operacional) return ignorar("data_divergente", "erro");
  if (entrada.estado_worker !== "concluido") {
    return ignorar(
      "ciclo_com_erro",
      entrada.estado_worker === "parcial" ? "parcial" : "erro",
    );
  }
  if (rotasGravadas <= 0) return ignorar("sem_rotas_no_ciclo", "parcial");
  if (entrada.rotas !== null && entrada.rotas !== rotasGravadas) {
    return ignorar("quantidade_rotas_divergente", "parcial");
  }
  if (entrada.pacotes !== null && entrada.pacotes !== pacotesGravados) {
    return ignorar("quantidade_pacotes_divergente", "parcial");
  }

  // ── Transação única: promoção + troca do ponteiro ─────────────────────────
  const promovidas = banco.rotas_staging.filter((r) => r.sync_batch_id === entrada.sync_batch_id);
  const rotas = [...banco.rotas];
  for (const r of promovidas) {
    const pacotes = [
      ...new Set(
        banco.pacotes_staging
          .filter((p) => p.sync_batch_id === entrada.sync_batch_id && p.route_id === r.route_id)
          .map((p) => p.tracking_id),
      ),
    ];
    const idx = rotas.findIndex((x) => x.route_id === r.route_id);
    const linha: RotaOperacional = {
      route_id: r.route_id,
      base_codigo: r.base_codigo,
      data_rota: r.data_rota,
      sync_batch_id: entrada.sync_batch_id,
      pacotes,
    };
    if (idx >= 0) rotas[idx] = linha;
    else rotas.push(linha);
  }

  const ciclos = banco.ciclos.map((c) => {
    if (c.sync_batch_id === entrada.sync_batch_id) {
      return { ...c, estado: "concluido" as EstadoCicloSync, ativo: true };
    }
    if (c.base_codigo === entrada.base_codigo && c.data_operacional === entrada.data_operacional) {
      return { ...c, ativo: false };
    }
    return c;
  });

  return {
    resultado: {
      status: "ok",
      idempotente: false,
      lote_ativo: entrada.sync_batch_id,
      rotas: rotasGravadas,
      pacotes: pacotesGravados,
    },
    banco: { ...banco, ciclos, rotas },
  };
}

/** Ciclos abandonados: marcados, staging preservado, nunca promovidos. */
export function abandonarCiclo(banco: EstadoBanco, sync_batch_id: string): EstadoBanco {
  return {
    ...banco,
    ciclos: banco.ciclos.map((c) =>
      c.sync_batch_id === sync_batch_id && c.estado === "em_processamento"
        ? { ...c, estado: "abandonado", ativo: false }
        : c,
    ),
  };
}

/** Limpeza de staging: só ciclos não promovidos. Dados operacionais intactos. */
export function limparStaging(banco: EstadoBanco, sync_batch_ids: string[]): EstadoBanco {
  const alvos = sync_batch_ids.filter((id) => {
    const c = banco.ciclos.find((x) => x.sync_batch_id === id);
    return c !== undefined && c.estado !== "concluido";
  });
  return {
    ...banco,
    rotas_staging: banco.rotas_staging.filter((r) => !alvos.includes(r.sync_batch_id)),
    pacotes_staging: banco.pacotes_staging.filter((p) => !alvos.includes(p.sync_batch_id)),
  };
}
