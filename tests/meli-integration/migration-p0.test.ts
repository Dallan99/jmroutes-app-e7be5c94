import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/propostas/20260826235641_meli_integration_p0_fundacao.sql",
  "utf8",
);

/** SQL sem comentários de linha (--) nem de bloco, para asserções semânticas. */
const SQL_SEM_COMENTARIOS = SQL.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

describe("migration P0 (estática)", () => {
  it("cria a outbox com status seguro NAO_ENVIAR por padrão", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.meli_tracking_eventos");
    expect(SQL).toContain("status_envio text NOT NULL DEFAULT 'NAO_ENVIAR'");
  });

  it("é aditiva e idempotente", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS");
    // Asserções semânticas: comentários descritivos não contam como comandos.
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/\bUPDATE\s+public\./i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/\bRENAME\b/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/CREATE\s+TRIGGER/i);
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
    // Semântico: nenhuma coluna/constraint/FK de veiculo_id é criada.
    // Comentários (ex.: "sem veiculo_id") são ignorados de propósito.
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/ADD\s+COLUMN[^;]*\bveiculo_id\b/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/FOREIGN\s+KEY[^;]*\bveiculo_id\b/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/\bveiculo_id\b[^;]*REFERENCES/i);
    expect(SQL_SEM_COMENTARIOS).not.toMatch(/REFERENCES[^;]*\bveiculos?\b/i);
    expect(SQL).toContain("motorista_id uuid NULL");
    expect(SQL).toContain("REFERENCES public.motoristas(id) ON DELETE SET NULL");
  });
});
