import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve("supabase/migrations/20260815120000_corrigir_sincronizacao_meli_devolucoes.sql"),
  "utf8",
);

describe("migration corretiva de meli_devolucoes_sincronizar", () => {
  it("preserva assinatura, hardening e falha atomica", () => {
    expect(sql).toMatch(/meli_devolucoes_sincronizar\s*\(\s*p_data_de date[\s\S]*p_data_ate date[\s\S]*p_base_id uuid/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = pg_catalog, public/i);
    expect(sql).toMatch(/raise exception[\s\S]*42501/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function[\s\S]*to authenticated/i);
    expect(sql).not.toMatch(/exception\s+when\s+others/i);
  });

  it("usa substatus, aliases e catalogos sem os SQLs defeituosos", () => {
    expect(sql).toMatch(/coalesce\(nullif\(p\.occurrence_code, ''\), nullif\(p\.substatus, ''\)/i);
    expect(sql).not.toMatch(/status_normalizado\s*=\s*'failed'/i);
    expect(sql).toContain("WHEN 'unvisited' THEN 'unvisited_address'");
    expect(sql).toContain("WHEN 'blocked_kw' THEN 'blocked_by_keyword'");
    expect(sql).toContain("'missing','lost','stolen'");
    expect(sql).toContain("v_codigo = 'transferred'");
    expect(sql).not.toMatch(/hashtag\s*\(/i);
    expect(sql).not.toMatch(/count\s*\(\s*distinct[\s\S]*\bover\s*\(/i);
  });

  it("nao cria sucessos e reconcilia pendencia sem recebimento fisico", () => {
    expect(sql).toMatch(/status_normalizado in \('delivered', 'picked_up'\)/i);
    expect(sql).toMatch(/or codigo_bruto <> ''/i);
    expect(sql).toMatch(/v_atual\.estado = 'aguardando_retorno'/i);
    expect(sql).toMatch(/estado = 'encerrado'/i);
    expect(sql).toMatch(/'recebimento_fisico', false/i);
    expect(sql).not.toMatch(/set[\s\S]{0,160}recebido_em\s*=/i);
  });

  it("isola base, serializa chamadas e condiciona eventos a mudanca", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/order by ro\.base_id/i);
    expect(sql).toMatch(/v_atual\.base_id <> v_item\.base_id/i);
    expect(sql).toMatch(/where d\.id = v_atual\.id and d\.base_id = v_item\.base_id/i);
    expect(sql).toMatch(/is distinct from/i);
    expect(sql).toMatch(/if found then[\s\S]*insert into public\.meli_devolucoes_eventos/i);
  });

  it("mantem prazo apenas nas devolucoes aguardando retorno e nao inclui tracking nos detalhes", () => {
    expect(sql).toMatch(/where estado <> 'aguardando_retorno'/i);
    expect(sql).toMatch(/case when v_estado_novo = 'aguardando_retorno'[\s\S]*interval '3 days' else null end/i);
    const detalhes = [...sql.matchAll(/jsonb_build_object\(([^;]+)\)/g)].map((m) => m[1]);
    expect(detalhes.every((trecho) => !/tracking/i.test(trecho))).toBe(true);
  });

  it("mantem compatibilidade de retorno na propria migration unica", () => {
    expect(sql).toMatch(/'atualizadas', v_atualizadas, 'atualizados', v_atualizadas/i);
    expect(sql).not.toMatch(/pg_get_functiondef|execute\s+v_definicao/i);
  });
});
