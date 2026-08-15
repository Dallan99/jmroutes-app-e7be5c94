import { describe, expect, it } from "vitest";
import { janelaDevolucoes, sincronizarDevolucoes } from "../src/pipeline/devolucoes";

const CFG = { supabaseUrl: "https://exemplo.supabase.co", supabaseAnonKey: "anon", baseCode: "ESP15" };

describe("sincronização automática de Devoluções", () => {
  it("calcula uma janela inclusiva de sete dias em horário de São Paulo", () => {
    expect(janelaDevolucoes(new Date("2026-08-15T15:00:00Z"))).toEqual({ de: "2026-08-09", ate: "2026-08-15" });
  });

  it("resolve a base e chama a RPC sem enviar tracking IDs", async () => {
    const chamadas: Array<{ url: string; body?: string }> = [];
    const resultado = await sincronizarDevolucoes(CFG, "token", {
      agora: new Date("2026-08-15T15:00:00Z"),
      fetchImpl: (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        chamadas.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        if (url.includes("/rest/v1/bases")) return new Response(JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111" }]), { status: 200 });
        return new Response(JSON.stringify({ criadas: 2, atualizadas: 1 }), { status: 200 });
      }) as typeof fetch,
    });
    expect(resultado.status).toBe("ok");
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]?.url).toContain("codigo=eq.ESP15");
    expect(JSON.parse(chamadas[1]?.body ?? "{}")).toEqual({ p_data_de: "2026-08-09", p_data_ate: "2026-08-15", p_base_id: "11111111-1111-4111-8111-111111111111" });
    expect(chamadas.map((c) => `${c.url}${c.body ?? ""}`).join(" ")).not.toMatch(/tracking/i);
  });

  it("não chama a RPC quando a base não está visível", async () => {
    let chamadas = 0;
    const resultado = await sincronizarDevolucoes(CFG, "token", { fetchImpl: (async () => { chamadas += 1; return new Response("[]", { status: 200 }); }) as typeof fetch });
    expect(resultado).toEqual({ status: "erro", motivo: "base_nao_encontrada" });
    expect(chamadas).toBe(1);
  });

  it("propaga sessão expirada", async () => {
    const resultado = await sincronizarDevolucoes(CFG, "token", { fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch });
    expect(resultado).toEqual({ status: "sem_sessao" });
  });
});
