import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string) => readFileSync(resolve(process.cwd(), arquivo), "utf8");
const funcoes = ler("src/lib/expedicao.functions.ts");
const pagina = ler("src/routes/_authenticated/expedicao.tsx");
const menu = ler("src/components/app-shell.tsx");
const migracao = ler("supabase/migrations/20260827180610_expedicao_independente.sql");

describe("Expedição independente", () => {
  it("é acessível nos menus operacional e coletor", () => {
    expect(menu.match(/title: "Expedição", to: "\/expedicao"/g)).toHaveLength(2);
    expect(pagina).toContain('createFileRoute("/_authenticated/expedicao")');
  });

  it("valida o shipment na importação original e não altera a marca do Recebimento", () => {
    expect(funcoes).toContain('.from("escalas")');
    expect(funcoes).toContain('.eq("importacao_id", expedicao.importacao_id)');
    expect(funcoes).not.toMatch(/from\("escalas"\)[\s\S]{0,300}\.update\(/);
  });

  it("preserva e sinaliza a recuperação da divergência original", () => {
    expect(funcoes).toContain("shipment_ids_nao_localizados");
    expect(funcoes).toContain("localizado_posteriormente_na_expedicao: recuperado");
    expect(funcoes).toContain('acao: recuperado ? "expedicao.shipment_recuperado"');
  });

  it("cria RLS por base e grants explícitos para a Data API", () => {
    expect(migracao).toContain("ALTER TABLE public.expedicoes ENABLE ROW LEVEL SECURITY");
    expect(migracao).toContain("public.has_base_access((SELECT auth.uid()), base_id)");
    expect(migracao).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.expedicoes TO authenticated",
    );
  });

  it("inclui campos do futuro romaneio e evidência do fechamento diário", () => {
    expect(migracao).toContain("responsavel_expedicao_id");
    expect(migracao).toContain("responsavel_meli_svc");
    expect(migracao).toContain("outro_responsavel");
    expect(migracao).toContain("evidencia_envio jsonb");
    expect(funcoes).toContain("reconciliarFechamentoOperacional");
    expect(funcoes).toContain("shipmentIdsFinais");
    expect(funcoes).toContain('existente?.status === "enviado"');
  });
});
