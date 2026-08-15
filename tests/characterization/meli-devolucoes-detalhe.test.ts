import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const tela = readFileSync("src/routes/_authenticated/meli-devolucoes.tsx", "utf8");
const funcoes = readFileSync("src/lib/meli-devolucoes.functions.ts", "utf8");

describe("detalhe de Devoluções", () => {
  it("busca o histórico real quando um ID é selecionado", () => {
    expect(tela).toContain("meliDevolucoesHistorico");
    expect(tela).toContain("devolucao_id: detalhe!.id");
    expect(funcoes).toContain(".from('meli_devolucoes_eventos')");
    expect(funcoes).toContain(".eq('devolucao_id', data.devolucao_id)");
  });

  it("normaliza respostas inesperadas antes de renderizar a lista", () => {
    expect(tela).toContain("Array.isArray(historicoQuery.data)");
    expect(tela).toContain("eventosHistorico.map");
    expect(tela).not.toContain("(historicoQuery.data ?? []).map");
  });
});
