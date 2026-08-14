import { describe, expect, it } from "vitest";
import {
  calcularPrazoRetorno,
  classificarOcorrencia,
  classificarRiscoRota,
  diasCorridos,
  faixaEnvelhecimento,
  faixaVisual,
  validarRecebimento,
} from "@/lib/meli-devolucoes-domain";

describe("classificarOcorrencia", () => {
  it("trata ocorrências de rua como retorno obrigatório", () => {
    for (const c of [
      "buyer_rejected",
      "buyer_absent",
      "business_closed",
      "unvisited_address",
      "damaged",
      "bad_address",
      "missrouted",
      "blocked_by_keyword",
    ]) {
      expect(classificarOcorrencia(c)).toBe("retorno_obrigatorio");
    }
  });

  it("separa extravio, transferência e desconhecidos", () => {
    expect(classificarOcorrencia("lost")).toBe("investigacao");
    expect(classificarOcorrencia("transferred")).toBe("transferencia");
    expect(classificarOcorrencia("codigo_novo_meli")).toBe("revisao_necessaria");
    expect(classificarOcorrencia(null)).toBe("revisao_necessaria");
  });
});

describe("prazo de 3 dias corridos", () => {
  it("soma exatamente 3 dias à ocorrência", () => {
    const prazo = calcularPrazoRetorno("2026-01-10T08:00:00Z");
    expect(prazo.toISOString()).toBe("2026-01-13T08:00:00.000Z");
  });

  it("conta dias corridos até o recebimento ou até agora", () => {
    expect(diasCorridos("2026-01-10T08:00:00Z", "2026-01-12T09:00:00Z")).toBe(2);
    expect(
      diasCorridos("2026-01-10T08:00:00Z", null, new Date("2026-01-15T08:00:00Z")),
    ).toBe(5);
  });
});

describe("faixaVisual", () => {
  const prazo = "2026-01-13T08:00:00Z";

  it("verde quando recebido dentro do prazo", () => {
    expect(
      faixaVisual({
        estado: "recebido_na_base",
        prazo_retorno_em: prazo,
        recebido_em: "2026-01-12T10:00:00Z",
      }),
    ).toBe("verde");
  });

  it("vermelho quando recebido após o prazo", () => {
    expect(
      faixaVisual({
        estado: "recebido_na_base",
        prazo_retorno_em: prazo,
        recebido_em: "2026-01-14T10:00:00Z",
      }),
    ).toBe("vermelho");
  });

  it("amarelo quando falta até 1 dia", () => {
    expect(
      faixaVisual({
        estado: "aguardando_retorno",
        prazo_retorno_em: prazo,
        agora: new Date("2026-01-12T20:00:00Z"),
      }),
    ).toBe("amarelo");
  });

  it("vermelho quando o prazo venceu sem retorno", () => {
    expect(
      faixaVisual({
        estado: "aguardando_retorno",
        prazo_retorno_em: prazo,
        agora: new Date("2026-01-14T08:00:00Z"),
      }),
    ).toBe("vermelho");
  });

  it("crítico quando recebido fisicamente e Meli diz entregue", () => {
    expect(
      faixaVisual({
        estado: "recebido_na_base",
        prazo_retorno_em: prazo,
        recebido_em: "2026-01-11T08:00:00Z",
        divergencia_delivered: true,
      }),
    ).toBe("critico");
  });
});

describe("faixaEnvelhecimento", () => {
  it("agrupa 0-1, 2, 3 e mais de 3 dias", () => {
    expect(faixaEnvelhecimento(0)).toBe("d0_1");
    expect(faixaEnvelhecimento(1)).toBe("d0_1");
    expect(faixaEnvelhecimento(2)).toBe("d2");
    expect(faixaEnvelhecimento(3)).toBe("d3");
    expect(faixaEnvelhecimento(9)).toBe("d4_mais");
  });
});

describe("validarRecebimento", () => {
  const base = "11111111-1111-1111-1111-111111111111";

  it("exige base e código", () => {
    expect(validarRecebimento({ codigo: "X1", baseSelecionadaId: null })).toBe("sem_base");
    expect(validarRecebimento({ codigo: "   ", baseSelecionadaId: base })).toBe("sem_codigo");
  });

  it("bloqueia duplicidade e base divergente", () => {
    expect(
      validarRecebimento({ codigo: "X1", baseSelecionadaId: base, jaRecebido: true }),
    ).toBe("duplicado");
    expect(
      validarRecebimento({
        codigo: "X1",
        baseSelecionadaId: base,
        baseEsperadaId: "22222222-2222-2222-2222-222222222222",
      }),
    ).toBe("base_divergente");
  });

  it("exige observação quando o Meli diz entregue", () => {
    expect(
      validarRecebimento({ codigo: "X1", baseSelecionadaId: base, situacaoMeli: "entregue" }),
    ).toBe("observacao_obrigatoria");
    expect(
      validarRecebimento({
        codigo: "X1",
        baseSelecionadaId: base,
        situacaoMeli: "entregue",
        observacao: "embalagem violada",
      }),
    ).toBeNull();
  });
});

describe("classificarRiscoRota", () => {
  it("usa apenas indicadores reais do Meli", () => {
    expect(classificarRiscoRota({ rota_area_risco: true })).toBe("integral");
    expect(classificarRiscoRota({ area_risco_parcial: true })).toBe("parcial");
    expect(classificarRiscoRota({ pacotes_risco: 3 })).toBe("parcial");
    // Insucesso isolado NÃO é área de risco.
    expect(classificarRiscoRota({ insucesso_risco: 10 })).toBe("sem_risco");
  });
});
