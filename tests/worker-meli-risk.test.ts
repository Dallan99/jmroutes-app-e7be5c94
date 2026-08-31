import { describe, expect, it } from "vitest";
import { normalizarRiscoRostering, semanaAtual } from "../worker/meli/src/meli/risk";

describe("risco do Rostering", () => {
  it("normaliza atribuições com e sem alto risco", () => {
    const linhas = normalizarRiscoRostering({
      status: 200,
      data: [
        {
          startDate: "2026-08-31T10:00:00Z",
          facility: "SSP56",
          carrierName: "JM TRANSPORTES",
          assignments: [
            { ID: 10, planning_route: { metadata: { original_route_name: "431065713", region: "Sul", is_risky: true } } },
            { ID: 11, planning_route: { metadata: { original_route_name: "431065714", region: "Norte", is_risky: "false" } } },
          ],
        },
      ],
    });
    expect(linhas).toEqual([
      { data: "2026-08-31", facility: "SSP56", cluster: "431065713", transportadora: "JM TRANSPORTES", altoRisco: true, regiao: "Sul", idServico: "10" },
      { data: "2026-08-31", facility: "SSP56", cluster: "431065714", transportadora: "JM TRANSPORTES", altoRisco: false, regiao: "Norte", idServico: "11" },
    ]);
  });

  it("calcula a semana de segunda a domingo", () => {
    expect(semanaAtual(new Date("2026-09-02T12:00:00Z"))).toEqual({ inicio: "2026-08-31", fim: "2026-09-06" });
  });
});
