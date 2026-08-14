import { describe, expect, it } from "vitest";
import {
  codigoLoteDevolucao,
  motivoDoMeli,
  nomeLoteDevolucao,
  podeBipar,
  proximaSequenciaLote,
} from "../../src/lib/devolucao-lotes-domain";

const BASE_A = "11111111-1111-1111-1111-111111111111";
const BASE_B = "22222222-2222-2222-2222-222222222222";

describe("nome automático do lote", () => {
  it("gera EXP - REC DD/MM/AAAA BASE - NNN", () => {
    expect(nomeLoteDevolucao("2026-08-13", "ESP16", 1)).toBe("EXP - REC 13/08/2026 ESP16 - 001");
    expect(nomeLoteDevolucao("2026-08-13", "ESP16", 2)).toBe("EXP - REC 13/08/2026 ESP16 - 002");
    expect(nomeLoteDevolucao("2026-08-13", "ESP16", 3)).toBe("EXP - REC 13/08/2026 ESP16 - 003");
  });

  it("gera código técnico sem barras nem espaços", () => {
    const cod = codigoLoteDevolucao("2026-08-13", "ESP16", 7);
    expect(cod).toBe("EXPREC20260813ESP16007");
    expect(cod).not.toMatch(/[/\s]/);
  });
});

describe("sequência por base e data", () => {
  const existentes = [
    { base_id: BASE_A, data_operacional: "2026-08-13", sequencia: 1 },
    { base_id: BASE_A, data_operacional: "2026-08-13", sequencia: 2 },
    { base_id: BASE_B, data_operacional: "2026-08-13", sequencia: 1 },
    { base_id: BASE_A, data_operacional: "2026-08-12", sequencia: 9 },
  ];

  it("001, 002 e 003 na mesma base/data", () => {
    expect(proximaSequenciaLote([], BASE_A, "2026-08-13")).toBe(1);
    expect(proximaSequenciaLote(existentes.slice(0, 1), BASE_A, "2026-08-13")).toBe(2);
    expect(proximaSequenciaLote(existentes, BASE_A, "2026-08-13")).toBe(3);
  });

  it("uma base não interfere na outra nem outro dia", () => {
    expect(proximaSequenciaLote(existentes, BASE_B, "2026-08-13")).toBe(2);
    expect(proximaSequenciaLote(existentes, BASE_A, "2026-08-14")).toBe(1);
  });

  it("duas criações simultâneas nunca produzem o mesmo número (serialização por lock)", async () => {
    // Simula o pg_advisory_xact_lock do RPC: geração serializada por base+data.
    const lotes: { base_id: string; data_operacional: string; sequencia: number }[] = [];
    let lock: Promise<void> = Promise.resolve();
    const criar = () => {
      const anterior = lock;
      let liberar!: () => void;
      lock = new Promise<void>((r) => (liberar = r));
      return anterior.then(() => {
        const seq = proximaSequenciaLote(lotes, BASE_A, "2026-08-13");
        lotes.push({ base_id: BASE_A, data_operacional: "2026-08-13", sequencia: seq });
        liberar();
        return seq;
      });
    };
    const [a, b] = await Promise.all([criar(), criar()]);
    expect(new Set([a, b]).size).toBe(2);
    expect([a, b].sort()).toEqual([1, 2]);
  });
});

describe("motivo automático do Meli", () => {
  it("herda a ocorrência registrada pelo motorista", () => {
    expect(motivoDoMeli("buyer_absent")).toMatchObject({
      motivo: "cliente_ausente",
      descricao: "Cliente ausente",
      tratamento: "retorno_obrigatorio",
    });
    expect(motivoDoMeli("buyer_rejected").descricao).toBe("Recusado pelo cliente");
    expect(motivoDoMeli("business_closed").descricao).toBe("Comércio fechado");
    expect(motivoDoMeli("unvisited_address").descricao).toBe("Endereço não visitado");
    expect(motivoDoMeli("damaged").descricao).toBe("Pacote avariado");
    expect(motivoDoMeli("bad_address").descricao).toBe("Endereço incorreto/incompleto");
    expect(motivoDoMeli("missrouted").descricao).toBe("Fora da região");
    expect(motivoDoMeli("blocked_by_keyword").descricao).toBe("Bloqueio operacional");
  });

  it("mantém tratamentos especiais de extravio e transferência", () => {
    for (const c of ["missing", "lost", "stolen"]) {
      expect(motivoDoMeli(c).tratamento).toBe("investigacao");
    }
    expect(motivoDoMeli("transferred").tratamento).toBe("transferencia");
  });

  it("código desconhecido e ausência de ocorrência vão para revisão", () => {
    expect(motivoDoMeli("codigo_novo_meli").tratamento).toBe("revisao_necessaria");
    expect(motivoDoMeli(null).tratamento).toBe("revisao_necessaria");
    expect(motivoDoMeli("").descricao).toContain("sem ocorrência Meli");
  });

  it("não existe caminho de escolha manual: o motivo é função da ocorrência", () => {
    // O operador não envia motivo; a mesma ocorrência sempre produz o mesmo motivo.
    expect(motivoDoMeli("buyer_absent").motivo).toBe(motivoDoMeli("BUYER_ABSENT").motivo);
  });
});

describe("estado do lote", () => {
  it("só aceita bipagem em lote aberto", () => {
    expect(podeBipar({ estado: "aberta" })).toBe(true);
    expect(podeBipar({ estado: "finalizada" })).toBe(false);
    expect(podeBipar(null)).toBe(false);
  });
});
