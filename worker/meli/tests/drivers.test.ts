import { describe, expect, it } from "vitest";
import { extrairMotoristas, listarTodosMotoristas } from "../src/meli/drivers.js";

describe("catálogo de motoristas Meli", () => {
  it("mantém somente id, nome, status e carrier, descartando CPF", () => {
    const resultado = extrairMotoristas({
      result: [{
        id: 123,
        firstName: "Maria",
        lastName: "Silva",
        status: "active",
        carrierId: 456,
        identificationValue: "00000000000",
      }],
    });
    expect(resultado).toEqual([{ id: "123", nome: "Maria Silva", status: "active", carrierId: "456" }]);
    expect(JSON.stringify(resultado)).not.toContain("00000000000");
  });

  it("percorre os cursores até a última página", async () => {
    const urls: string[] = [];
    const transport = {
      post: async () => { throw new Error("não usado"); },
      get: async (url: string) => {
        urls.push(url);
        const segunda = url.includes("cursor=abc");
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          ok: true,
          body: segunda
            ? { result: [{ id: 2, firstName: "B", lastName: "Dois", status: "inactive" }], pagination: { has_next: false } }
            : { result: [{ id: 1, firstName: "A", lastName: "Um", status: "active" }], pagination: { has_next: true, cursor: "abc" } },
        };
      },
    };
    const resultado = await listarTodosMotoristas(transport);
    expect(resultado.ok && resultado.valor).toHaveLength(2);
    expect(urls).toHaveLength(2);
  });
});
