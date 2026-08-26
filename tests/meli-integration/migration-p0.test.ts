import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20260826235641_meli_integration_p0_fundacao.sql",
  "utf8",
);

describe("migration P0 (estática)", () => {
  it("cria a outbox com status seguro NAO_ENVIAR por padrão", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.meli_tracking_eventos");
    expect(SQL).toContain("status_envio text NOT NULL DEFAULT 'NAO_ENVIAR'");
  });

  it("é aditiva e idempotente", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS");
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+public\./i);
    expect(SQL).not.toMatch(/\bRENAME\b/i);
    expect(SQL).not.toMatch(/CREATE\s+TRIGGER/i);
  });

  it("mantém a tabela server-only", () => {
    expect(SQL).toContain("ENABLE ROW LEVEL SECURITY");
    expect(SQL).toContain("REVOKE ALL ON public.meli_tracking_eventos FROM anon");
    expect(SQL).toContain("REVOKE ALL ON public.meli_tracking_eventos FROM authenticated");
    expect(SQL).toContain("GRANT ALL ON public.meli_tracking_eventos TO service_role");
    expect(SQL).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("não referencia tabelas operacionais protegidas", () => {
    for (const tabela of [
      "recebimentos",
      "volumes",
      "contagens",
      "audit_logs",
      "escalas",
      "user_roles",
      "profiles",
      "inventarios",
    ]) {
      expect(SQL).not.toContain(`public.${tabela}`);
    }
  });

  it("preserva tracking_id e vehicle_license (sem veiculo_id)", () => {
    expect(SQL).not.toMatch(/tracking_id\s*(DROP|RENAME)/i);
    expect(SQL).not.toContain("veiculo_id");
    expect(SQL).toContain("motorista_id uuid NULL");
    expect(SQL).toContain("REFERENCES public.motoristas(id) ON DELETE SET NULL");
  });
});
