// Caracterização da publicação atômica da sincronização Meli.
// Espelha as RPCs meli_sync_ciclo_iniciar / meli_sync_rota_staging /
// meli_sync_ciclo_finalizar e a view meli_rotas_ativas.
import { describe, expect, it } from "vitest";
import {
  abandonarCiclo,
  contarPacotesDoLote,
  contarRotasDoLote,
  finalizarCiclo,
  gravarRotaNoStaging,
  iniciarCiclo,
  limparStaging,
  loteAtivoDaBase,
  novoBanco,
  pacotesDoPainel,
  rotasDoPainel,
  sincronizandoNovaAtualizacao,
  type EstadoBanco,
} from "../../src/lib/meli-sync-lotes";

const BASE = "ESP16";
const DIA = "2026-08-14";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

const BASES_OK = [BASE];

function abrir(banco: EstadoBanco, id: string, base = BASE, dia = DIA, origem = "worker") {
  const r = iniciarCiclo(banco, {
    sync_batch_id: id,
    base_codigo: base,
    data_operacional: dia,
    origem,
  });
  expect(r.resultado.status).toBe("ok");
  return r.banco;
}

function gravar(
  banco: EstadoBanco,
  id: string,
  route_id: string,
  trackings: string[],
  opts: { base?: string; data?: string; bases?: string[] } = {},
) {
  return gravarRotaNoStaging(banco, {
    sync_batch_id: id,
    route_id,
    base_codigo: opts.base ?? BASE,
    data_rota: opts.data ?? DIA,
    tracking_ids: trackings,
    bases_do_usuario: opts.bases ?? BASES_OK,
  });
}

/** Lote completo já publicado — snapshot anterior de referência. */
function comLoteAtivo(): EstadoBanco {
  let banco = abrir(novoBanco(), L1);
  banco = gravar(banco, L1, "R1", ["T1", "T2"]).banco;
  banco = gravar(banco, L1, "R2", ["T3"]).banco;
  const fim = finalizarCiclo(banco, {
    sync_batch_id: L1,
    base_codigo: BASE,
    data_operacional: DIA,
    rotas: 2,
    pacotes: 3,
    estado_worker: "concluido",
  });
  expect(fim.resultado.status).toBe("ok");
  return fim.banco;
}

describe("abertura do ciclo", () => {
  it("abre um ciclo em processamento, sem lote ativo ainda", () => {
    const banco = abrir(novoBanco(), L1);
    expect(loteAtivoDaBase(banco, BASE, DIA)).toBeNull();
    expect(sincronizandoNovaAtualizacao(banco, BASE, DIA)).toBe(true);
  });

  it("é idempotente para os mesmos parâmetros", () => {
    const banco = abrir(novoBanco(), L1);
    const r = iniciarCiclo(banco, {
      sync_batch_id: L1,
      base_codigo: BASE,
      data_operacional: DIA,
      origem: "worker",
    });
    expect(r.resultado).toEqual({ status: "ok", idempotente: true });
    expect(r.banco.ciclos).toHaveLength(1);
  });

  it("recusa o mesmo UUID com parâmetros divergentes", () => {
    const banco = abrir(novoBanco(), L1);
    for (const entrada of [
      { base_codigo: "ESP17", data_operacional: DIA, origem: "worker" },
      { base_codigo: BASE, data_operacional: "2026-08-15", origem: "worker" },
      { base_codigo: BASE, data_operacional: DIA, origem: "extensao" },
    ]) {
      const r = iniciarCiclo(banco, { sync_batch_id: L1, ...entrada });
      expect(r.resultado).toEqual({ status: "erro", erro: "uuid_reutilizado_divergente" });
    }
  });

  it("recusa reabrir ciclo já encerrado", () => {
    const banco = comLoteAtivo();
    const r = iniciarCiclo(banco, {
      sync_batch_id: L1,
      base_codigo: BASE,
      data_operacional: DIA,
      origem: "worker",
    });
    expect(r.resultado).toEqual({ status: "erro", erro: "ciclo_encerrado" });
  });
});

describe("ingestão no staging", () => {
  it("grava rota e pacotes apenas no staging — zero alteração nas tabelas ativas", () => {
    const anterior = comLoteAtivo();
    const antes = JSON.stringify(anterior.rotas);

    let banco = abrir(anterior, L2);
    banco = gravar(banco, L2, "R1", ["T1", "T9"]).banco;
    banco = gravar(banco, L2, "R3", ["T7"]).banco;

    expect(JSON.stringify(banco.rotas)).toBe(antes);
    expect(contarRotasDoLote(banco, L2)).toBe(2);
    expect(contarPacotesDoLote(banco, L2)).toBe(3);
    // O painel continua exibindo exclusivamente o lote completo anterior.
    expect(loteAtivoDaBase(banco, BASE, DIA)).toBe(L1);
    expect(rotasDoPainel(banco).map((r) => r.route_id).sort()).toEqual(["R1", "R2"]);
    expect(pacotesDoPainel(banco).sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("reenviar a mesma rota é idempotente (mesma rota e mesmos pacotes)", () => {
    let banco = abrir(novoBanco(), L2);
    banco = gravar(banco, L2, "R1", ["T1", "T2"]).banco;
    const r = gravar(banco, L2, "R1", ["T1", "T2"]);
    expect(r.resultado).toEqual({ status: "ok", rotas_no_lote: 1, pacotes_no_lote: 2 });
    expect(r.banco.rotas_staging.filter((x) => x.sync_batch_id === L2)).toHaveLength(1);
  });

  it("conta por identificadores distintos, ignorando repetições", () => {
    let banco = abrir(novoBanco(), L2);
    banco = gravar(banco, L2, "R1", ["T1", "T1", "T2"]).banco;
    const r = gravar(banco, L2, "R2", ["T2", "T3"]);
    expect(r.resultado).toEqual({ status: "ok", rotas_no_lote: 2, pacotes_no_lote: 3 });
  });

  it("recusa ciclo desconhecido, encerrado, base divergente, data divergente e sem acesso", () => {
    const vazio = novoBanco();
    expect(gravar(vazio, L2, "R1", ["T1"]).resultado).toEqual({
      status: "erro",
      erro: "ciclo_desconhecido",
    });

    const publicado = comLoteAtivo();
    expect(gravar(publicado, L1, "R1", ["T1"]).resultado).toEqual({
      status: "erro",
      erro: "ciclo_nao_em_processamento",
    });

    const aberto = abrir(novoBanco(), L2);
    expect(gravar(aberto, L2, "R1", ["T1"], { base: "ESP17" }).resultado).toEqual({
      status: "erro",
      erro: "base_da_rota_divergente",
    });
    expect(gravar(aberto, L2, "R1", ["T1"], { data: "2026-08-15" }).resultado).toEqual({
      status: "erro",
      erro: "data_da_rota_divergente",
    });
    expect(gravar(aberto, L2, "R1", ["T1"], { bases: ["ESP18"] }).resultado).toEqual({
      status: "erro",
      erro: "sem_acesso_a_base",
    });
  });

  it("isola bases: cada ciclo só enxerga a sua base", () => {
    let banco = abrir(novoBanco(), L1, "ESP16");
    banco = abrir(banco, L2, "ESP17");
    banco = gravar(banco, L1, "R1", ["T1"], { bases: ["ESP16", "ESP17"] }).banco;
    banco = gravar(banco, L2, "R9", ["T9"], { base: "ESP17", bases: ["ESP16", "ESP17"] }).banco;
    expect(contarRotasDoLote(banco, L1)).toBe(1);
    expect(contarRotasDoLote(banco, L2)).toBe(1);
  });
});

describe("finalização e promoção", () => {
  it("promove o snapshot inteiro e troca o ponteiro em uma única transação", () => {
    const anterior = comLoteAtivo();
    let banco = abrir(anterior, L2);
    banco = gravar(banco, L2, "R1", ["T1", "T9"]).banco;
    banco = gravar(banco, L2, "R3", ["T7"]).banco;

    const fim = finalizarCiclo(banco, {
      sync_batch_id: L2,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: 2,
      pacotes: 3,
      estado_worker: "concluido",
    });

    expect(fim.resultado).toEqual({
      status: "ok",
      idempotente: false,
      lote_ativo: L2,
      rotas: 2,
      pacotes: 3,
    });
    expect(loteAtivoDaBase(fim.banco, BASE, DIA)).toBe(L2);
    expect(sincronizandoNovaAtualizacao(fim.banco, BASE, DIA)).toBe(false);
    // R2 pertence ao lote anterior e deixa de ser visível quando ele sai do ar.
    expect(rotasDoPainel(fim.banco).map((r) => r.route_id).sort()).toEqual(["R1", "R3"]);
    expect(pacotesDoPainel(fim.banco).sort()).toEqual(["T1", "T7", "T9"]);
  });

  it("é idempotente ao repetir a finalização", () => {
    const banco = comLoteAtivo();
    const r = finalizarCiclo(banco, {
      sync_batch_id: L1,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: 2,
      pacotes: 3,
      estado_worker: "concluido",
    });
    expect(r.resultado).toMatchObject({ status: "ok", idempotente: true, lote_ativo: L1 });
    expect(r.banco.rotas).toEqual(banco.rotas);
    expect(r.banco.ciclos).toEqual(banco.ciclos);
  });

  it("rejeita ciclo parcial/erro e preserva integralmente o snapshot anterior", () => {
    const anterior = comLoteAtivo();
    const rotasAntes = JSON.stringify(anterior.rotas);

    for (const estado of ["parcial", "erro"] as const) {
      let banco = abrir(anterior, L2);
      banco = gravar(banco, L2, "R1", ["T1"]).banco;
      const r = finalizarCiclo(banco, {
        sync_batch_id: L2,
        base_codigo: BASE,
        data_operacional: DIA,
        rotas: null,
        pacotes: null,
        estado_worker: estado,
      });
      expect(r.resultado).toMatchObject({ status: "ignorado", motivo: "ciclo_com_erro", lote_ativo: L1 });
      expect(JSON.stringify(r.banco.rotas)).toBe(rotasAntes);
      expect(loteAtivoDaBase(r.banco, BASE, DIA)).toBe(L1);
      // Staging do ciclo defeituoso é preservado para diagnóstico.
      expect(contarRotasDoLote(r.banco, L2)).toBe(1);
    }
  });

  it("falha depois de várias rotas mantém o snapshot anterior intacto", () => {
    const anterior = comLoteAtivo();
    let banco = abrir(anterior, L2);
    banco = gravar(banco, L2, "R1", ["T1"]).banco;
    banco = gravar(banco, L2, "R3", ["T7"]).banco;
    // Worker declarou 5 rotas, mas só 2 chegaram ao staging.
    const r = finalizarCiclo(banco, {
      sync_batch_id: L2,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: 5,
      pacotes: null,
      estado_worker: "concluido",
    });
    expect(r.resultado).toMatchObject({ status: "ignorado", motivo: "quantidade_rotas_divergente" });
    expect(rotasDoPainel(r.banco).map((x) => x.route_id).sort()).toEqual(["R1", "R2"]);
  });

  it("rejeita divergência de pacotes, ciclo sem rotas, base e data divergentes", () => {
    const base = comLoteAtivo();

    let b1 = gravar(abrir(base, L2), L2, "R1", ["T1"]).banco;
    expect(
      finalizarCiclo(b1, {
        sync_batch_id: L2,
        base_codigo: BASE,
        data_operacional: DIA,
        rotas: 1,
        pacotes: 4,
        estado_worker: "concluido",
      }).resultado,
    ).toMatchObject({ motivo: "quantidade_pacotes_divergente", estado: "parcial" });

    const vazioNoStaging = abrir(base, L2);
    expect(
      finalizarCiclo(vazioNoStaging, {
        sync_batch_id: L2,
        base_codigo: BASE,
        data_operacional: DIA,
        rotas: null,
        pacotes: null,
        estado_worker: "concluido",
      }).resultado,
    ).toMatchObject({ motivo: "sem_rotas_no_ciclo", estado: "parcial" });

    b1 = gravar(abrir(base, L2), L2, "R1", ["T1"]).banco;
    expect(
      finalizarCiclo(b1, {
        sync_batch_id: L2,
        base_codigo: "ESP17",
        data_operacional: DIA,
        rotas: null,
        pacotes: null,
        estado_worker: "concluido",
      }).resultado,
    ).toMatchObject({ motivo: "base_divergente", estado: "erro" });

    expect(
      finalizarCiclo(b1, {
        sync_batch_id: L2,
        base_codigo: BASE,
        data_operacional: "2026-08-15",
        rotas: null,
        pacotes: null,
        estado_worker: "concluido",
      }).resultado,
    ).toMatchObject({ motivo: "data_divergente", estado: "erro" });
  });

  it("ciclo desconhecido é ignorado sem tocar no lote ativo", () => {
    const banco = comLoteAtivo();
    const r = finalizarCiclo(banco, {
      sync_batch_id: L2,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: null,
      pacotes: null,
      estado_worker: "concluido",
    });
    expect(r.resultado).toMatchObject({ status: "ignorado", motivo: "ciclo_desconhecido", lote_ativo: L1 });
    expect(r.banco).toEqual(banco);
  });
});

describe("concorrência entre dois ciclos da mesma base/dia", () => {
  it("apenas o último finalizado fica ativo; o anterior é desativado", () => {
    let banco = abrir(novoBanco(), L1);
    banco = abrir(banco, L2);
    banco = gravar(banco, L1, "R1", ["T1"]).banco;
    banco = gravar(banco, L2, "R1", ["T1", "T2"]).banco;

    const primeiro = finalizarCiclo(banco, {
      sync_batch_id: L1,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: 1,
      pacotes: 1,
      estado_worker: "concluido",
    });
    expect(loteAtivoDaBase(primeiro.banco, BASE, DIA)).toBe(L1);

    const segundo = finalizarCiclo(primeiro.banco, {
      sync_batch_id: L2,
      base_codigo: BASE,
      data_operacional: DIA,
      rotas: 1,
      pacotes: 2,
      estado_worker: "concluido",
    });
    expect(loteAtivoDaBase(segundo.banco, BASE, DIA)).toBe(L2);
    expect(segundo.banco.ciclos.filter((c) => c.ativo)).toHaveLength(1);
    expect(pacotesDoPainel(segundo.banco).sort()).toEqual(["T1", "T2"]);
  });

  it("lotes de bases diferentes coexistem ativos", () => {
    let banco = abrir(novoBanco(), L1, "ESP16");
    banco = abrir(banco, L2, "ESP17");
    banco = gravar(banco, L1, "R1", ["T1"], { bases: ["ESP16", "ESP17"] }).banco;
    banco = gravar(banco, L2, "R9", ["T9"], { base: "ESP17", bases: ["ESP16", "ESP17"] }).banco;

    for (const [id, base] of [
      [L1, "ESP16"],
      [L2, "ESP17"],
    ] as const) {
      const r = finalizarCiclo(banco, {
        sync_batch_id: id,
        base_codigo: base,
        data_operacional: DIA,
        rotas: 1,
        pacotes: 1,
        estado_worker: "concluido",
      });
      banco = r.banco;
    }
    expect(loteAtivoDaBase(banco, "ESP16", DIA)).toBe(L1);
    expect(loteAtivoDaBase(banco, "ESP17", DIA)).toBe(L2);
    expect(rotasDoPainel(banco, "ESP16").map((r) => r.route_id)).toEqual(["R1"]);
    expect(rotasDoPainel(banco, "ESP17").map((r) => r.route_id)).toEqual(["R9"]);
  });
});

describe("abandono e limpeza", () => {
  it("abandonar encerra o ciclo sem promover e sem afetar o lote ativo", () => {
    const anterior = comLoteAtivo();
    let banco = gravar(abrir(anterior, L2), L2, "R1", ["T1"]).banco;
    banco = abandonarCiclo(banco, L2);
    expect(banco.ciclos.find((c) => c.sync_batch_id === L2)?.estado).toBe("abandonado");
    expect(loteAtivoDaBase(banco, BASE, DIA)).toBe(L1);
    expect(sincronizandoNovaAtualizacao(banco, BASE, DIA)).toBe(false);
  });

  it("limpar staging remove só ciclos não promovidos", () => {
    let banco = comLoteAtivo();
    banco = gravar(abrir(banco, L2), L2, "R1", ["T1"]).banco;
    banco = abandonarCiclo(banco, L2);
    const limpo = limparStaging(banco, [L1, L2]);
    expect(contarRotasDoLote(limpo, L2)).toBe(0);
    expect(contarRotasDoLote(limpo, L1)).toBe(2);
    expect(rotasDoPainel(limpo).map((r) => r.route_id).sort()).toEqual(["R1", "R2"]);
  });
});

describe("visibilidade (view meli_rotas_ativas com security_invoker)", () => {
  it("rotas históricas sem lote continuam visíveis", () => {
    const banco: EstadoBanco = {
      ...novoBanco(),
      rotas: [
        { route_id: "HIST", base_codigo: BASE, data_rota: DIA, sync_batch_id: null, pacotes: ["TH"] },
      ],
    };
    expect(rotasDoPainel(banco).map((r) => r.route_id)).toEqual(["HIST"]);
  });

  it("rotas de lote em construção nunca aparecem", () => {
    let banco = abrir(novoBanco(), L2);
    banco = gravar(banco, L2, "R1", ["T1"]).banco;
    expect(rotasDoPainel(banco)).toEqual([]);
    expect(pacotesDoPainel(banco)).toEqual([]);
  });
});
