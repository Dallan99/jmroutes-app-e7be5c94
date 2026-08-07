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

  it("consulta o AdminML mas nunca chama o endpoint de ingestão", async () => {
    const cfg = loadConfig({ ...ENV_BASE, DRY_RUN: "true" });
    const chamadas: string[] = [];
    let fetchChamado = 0;

    const r = await executarCiclo({
      cfg,
      transport: transporte(chamadas),
      accessToken: "",
      breaker: new CircuitBreaker(),
      dormir: async () => undefined,
      fetchImpl: (async () => {
        fetchChamado += 1;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });

    expect(fetchChamado).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(r.resumo.rotas_encontradas).toBe(1);
    expect(r.resumo.rotas_consultadas).toBe(1);
    expect(r.resumo.pacotes_encontrados).toBe(3);
    expect(r.resumo.erros).toBe(0);
    expect(chamadas.some((u) => u.includes("route-detail"))).toBe(true);
  });

  it("conta pacotes do payload bruto sem transformá-lo", () => {
    expect(contarPacotesBrutos(ROTA_DETALHE as Record<string, unknown>)).toBe(3);
    expect(contarPacotesBrutos({} as Record<string, unknown>)).toBe(0);
  });
});
