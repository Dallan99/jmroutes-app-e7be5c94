import { describe, expect, it } from "vitest";
import { dataOperacionalDeInstante, dataOperacionalHoje } from "../../src/lib/bases.functions";

describe("resumo das bases sincronizadas", () => {
  it("usa o dia operacional de Sao Paulo, inclusive na virada UTC", () => {
    expect(dataOperacionalHoje(new Date("2026-08-16T01:30:00Z"))).toBe("2026-08-15");
    expect(dataOperacionalHoje(new Date("2026-08-16T03:30:00Z"))).toBe("2026-08-16");
  });

  it("classifica o horario da sincronizacao no mesmo fuso operacional", () => {
    expect(dataOperacionalDeInstante("2026-08-16T01:30:00Z")).toBe("2026-08-15");
  });
});
