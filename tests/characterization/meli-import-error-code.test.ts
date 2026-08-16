import { describe, expect, it } from "vitest";
import { codigoSeguroErroImportacao } from "../../src/lib/meli-import-bruto";

describe("diagnóstico seguro da importação Meli", () => {
  it.each([
    ["payload sem 'id' de rota do Meli.", "payload_sem_id_rota"],
    ["payload sem 'stops' (esperado array).", "payload_sem_stops"],
    ["route_id vazio após normalização.", "route_id_vazio"],
    ["nenhum pacote válido extraído do payload.", "nenhum_pacote_valido"],
    ["duplicate key value violates unique constraint", "conflito_unicidade"],
    ["new row violates check constraint", "restricao_dados"],
  ])("classifica %s", (erro, codigo) => {
    expect(codigoSeguroErroImportacao(erro)).toBe(codigo);
  });

  it("não devolve conteúdo desconhecido que possa conter identificadores", () => {
    expect(codigoSeguroErroImportacao("falha no tracking 123456789012")).toBe("erro_importacao");
  });
});
