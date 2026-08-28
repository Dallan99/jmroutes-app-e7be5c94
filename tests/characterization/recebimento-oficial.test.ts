import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resumirRotasTriagem } from "../../src/lib/triagem-domain";

const appShell = readFileSync(resolve(process.cwd(), "src/components/app-shell.tsx"), "utf8");
const pagina = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/triagem.tsx"),
  "utf8",
);
const funcoes = readFileSync(resolve(process.cwd(), "src/lib/triagem.functions.ts"), "utf8");

describe("Triagem como Recebimento oficial", () => {
  it("mantém uma única entrada de Recebimento no menu e reaproveita a rota de Triagem", () => {
    const menuOperacional = appShell.slice(
      appShell.indexOf("const NAV_OPERACIONAL"),
      appShell.indexOf("const NAV_GESTAO"),
    );

    expect(menuOperacional.match(/title: "Recebimento"/g)).toHaveLength(1);
    expect(menuOperacional).toContain('{ title: "Recebimento", to: "/triagem"');
    expect(menuOperacional).not.toContain('to: "/recebimento"');
  });

  it("usa a nomenclatura operacional de Recebimento sem renomear contratos internos", () => {
    expect(pagina).toContain('title: "Recebimento — JM Transportes"');
    expect(pagina).toContain("Recebimento de Volumes");
    expect(pagina).toContain('label="Volumes recebidos"');
    expect(pagina).toContain('createFileRoute("/_authenticated/triagem")');
  });

  it("considera automaticamente fechada a rota cujo recebido iguala o previsto", () => {
    const [rota] = resumirRotasTriagem([
      { shipment: "1001", planejada: "R1", otimizada: null, triado: true },
      { shipment: "1002", planejada: "R1", otimizada: null, triado: true },
    ]);

    expect(rota).toMatchObject({ previstos: 2, triados: 2, pendentes: 0, status: "fechada" });
  });

  it("congela os shipment IDs faltantes sem atribuir LOST", () => {
    expect(funcoes).toContain("shipment_ids_nao_localizados: shipmentIdsNaoLocalizados");
    expect(funcoes).toContain('tipo_divergencia: "nao_localizado_no_recebimento"');
    expect(funcoes).not.toMatch(/status:\s*["']LOST["']/i);
  });
});
