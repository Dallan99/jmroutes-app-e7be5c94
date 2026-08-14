import { describe, expect, it } from "vitest";
import { normalizarPayloadMeli } from "@/lib/meli-normalize";

function payloadBase(extra: Record<string, unknown> = {}) {
  return {
    id: "rota-teste",
    serviceCenterId: "SSP15",
    initDate: 1_786_665_600,
    driver: { isDriverRisky: false },
    counters: { totalShipments: 1 },
    stops: [{
      id: "parada-1",
      orders: [{
        transportUnits: [{
          status: "pending",
          relatedEntity: { id: "pacote-1", receiverInfo: {} },
        }],
      }],
    }],
    ...extra,
  };
}

describe("normalizaÃ§Ã£o de Ã¡rea de risco Meli", () => {
  it("classifica driver.isDriverRisky=true como risco integral da rota", () => {
    const { payload, resumo } = normalizarPayloadMeli(payloadBase({
      driver: { isDriverRisky: true },
    }));

    expect(payload.rota_area_risco).toBe(true);
    expect(payload.area_risco_parcial).toBe(false);
    expect(payload.codigo_area_risco).toBe("true");
    expect(payload.origem_area_risco).toBe("rota");
    expect(resumo.campos_risco_detectados).toContain("rota.isDriverRisky");
  });

  it("nÃ£o classifica driver.isDriverRisky=false como risco", () => {
    const { payload } = normalizarPayloadMeli(payloadBase());
    expect(payload.rota_area_risco).toBe(false);
    expect(payload.area_risco_parcial).toBe(false);
  });

  it("nÃ£o transforma blocked_by_keyword isolado em Ã¡rea de risco", () => {
    const bruto = payloadBase();
    const stop = bruto.stops[0]!;
    stop.orders[0]!.transportUnits[0]!.relatedEntity = {
      id: "pacote-1",
      receiverInfo: {},
      occurrenceCode: "blocked_by_keyword",
    } as never;

    const { payload } = normalizarPayloadMeli(bruto);
    expect(payload.rota_area_risco).toBe(false);
    expect(payload.area_risco_parcial).toBe(false);
    expect(payload.pacotes[0]?.area_risco).toBe(false);
  });
});
