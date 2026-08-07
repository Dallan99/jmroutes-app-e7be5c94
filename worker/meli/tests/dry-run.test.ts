import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { contarPacotesBrutos, executarCiclo } from "../src/pipeline/cycle";
import { CircuitBreaker } from "../src/state/breaker";
import type { MeliResposta, MeliTransport } from "../src/meli/list";

const ENV_BASE = {
  BASE_CODE: "ESP16",
  SERVICE_CENTER_ID: "SSP15",
  SITE_ID: "MLB",
  JMR_BASE_URL: "https://exemplo.invalid",
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  WORKER_SESSION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SYNC_INTERVAL_SECONDS: "60",
};

function resp(body: unknown, status = 200): MeliResposta {
  return { status, headers: {}, body, ok: status >= 200 && status < 300 && body !== null };
}

const ROTA_DETALHE = {
  id: "9001",
  stops: [
    { shipments: [{ id: "a" }, { id: "b" }] },
    { shipments: [{ id: "c" }] },
    { shipments: [] },
  ],
};

function transporte(chamadas: string[]): MeliTransport {
  return {
    async post(url) {
      chamadas.push(url);
      return resp({
        results: [{ routeId: "9001", status: "in_route" }],
        paging: { total: 1, offset: 0, limit: 50 },
      });
    },
    async get(url) {
      chamadas.push(url);
      return resp(ROTA_DETALHE);
    },
  };
}

describe("DRY_RUN", () => {
  it("não exige credenciais do usuário técnico quando ativo", () => {
    expect(() => loadConfig({ ...ENV_BASE })).toThrow(/WORKER_EMAIL/);
    const cfg = loadConfig({ ...ENV_BASE, DRY_RUN: "true" });
    expect(cfg.dryRun).toBe(true);
  });

  it("consulta o AdminML (lista + detalhe) mas nunca chama a ingestão do JMRoutes", async () => {
    const cfg = loadConfig({ ...ENV_BASE, DRY_RUN: "true" });
    const chamadas: string[] = [];
    // Todo fetch é registrado por URL para distinguir AdminML de JMRoutes/Supabase.
    const urlsFetch: string[] = [];

    const r = await executarCiclo({
      cfg,
      transport: transporte(chamadas),
      accessToken: "",
      breaker: new CircuitBreaker(),
      dormir: async () => undefined,
      fetchImpl: (async (input: unknown) => {
        urlsFetch.push(String(input));
        return new Response("{}");
      }) as unknown as typeof fetch,
    });

    // AdminML: lista paginada e detalhe são permitidos.
    expect(chamadas.some((u) => u.includes("get-routes-list"))).toBe(true);
    expect(chamadas.some((u) => u.includes("route-detail"))).toBe(true);

    // JMRoutes: ingestão e telemetria/Supabase ZERO.
    expect(urlsFetch.filter((u) => u.includes("/api/public/meli/importar-rota-bruta"))).toEqual([]);
    expect(urlsFetch.filter((u) => u.includes("supabase.co"))).toEqual([]);
    expect(urlsFetch).toEqual([]);

    expect(r.dryRun).toBe(true);
    expect(r.resumo.rotas_encontradas).toBe(1);
    expect(r.resumo.rotas_ativas).toBe(1);
    expect(r.resumo.rotas_consultadas).toBe(1);
    expect(r.resumo.pacotes_encontrados).toBe(3);
    expect(r.resumo.erros).toBe(0);
    // Nada foi enviado: contadores de ingestão permanecem zerados.
    expect(r.execucao.rotas_processadas).toBe(0);
    expect(r.execucao.pacotes_enviados).toBe(0);
  });

  it("conta pacotes do payload bruto sem transformá-lo", () => {
    expect(contarPacotesBrutos(ROTA_DETALHE as Record<string, unknown>)).toBe(3);
    expect(contarPacotesBrutos({} as Record<string, unknown>)).toBe(0);
  });
});
