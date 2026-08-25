import { describe, expect, it } from "vitest";
import { periodoSemanaMeli } from "../src/lib/meli-ranking.functions";

describe("periodoSemanaMeli", () => {
  it("calcula domingo a sábado para uma data no meio da semana", () => {
    expect(periodoSemanaMeli("2026-08-24")).toEqual({
      inicio: "2026-08-23",
      fim: "2026-08-29",
    });
  });

  it("mantém a semana correta na virada do mês e do ano", () => {
    expect(periodoSemanaMeli("2027-01-01")).toEqual({
      inicio: "2026-12-27",
      fim: "2027-01-02",
    });
  });
});
