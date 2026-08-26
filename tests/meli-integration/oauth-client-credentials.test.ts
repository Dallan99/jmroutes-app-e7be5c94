import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MeliClientCredentialsError,
  limparClientCredentialsCache,
  obterClientCredentialsToken,
} from "@/lib/meli-integration/oauth-client-credentials.server";

const AUD_A = "https://api.mercadolibre.com/aud-a";
const AUD_B = "https://api.mercadolibre.com/aud-b";

function fakeFetch(tokens: string[], registro: { calls: any[] }) {
  let i = 0;
  return (async (url: any, init: any) => {
    registro.calls.push({ url, init });
    const access_token = tokens[Math.min(i, tokens.length - 1)];
    i += 1;
    return new Response(JSON.stringify({ access_token, expires_in: 21600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("oauth client_credentials (isolado, sem rede)", () => {
  beforeEach(() => {
    limparClientCredentialsCache();
    process.env["MELI_CLIENT_ID"] = "client-id-teste";
    process.env["MELI_CLIENT_SECRET"] = "client-secret-teste";
    process.env["MELI_TOKEN_URL"] = "https://exemplo.test/oauth/token";
  });

  afterEach(() => {
    limparClientCredentialsCache();
    delete process.env["MELI_TOKEN_URL"];
  });

  it("envia Basic + JSON com audience e grant_type", async () => {
    const registro = { calls: [] as any[] };
    await obterClientCredentialsToken(AUD_A, { fetchImpl: fakeFetch(["t1"], registro), now: () => 0 });

    expect(registro.calls).toHaveLength(1);
    const { url, init } = registro.calls[0];
    expect(url).toBe("https://exemplo.test/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from("client-id-teste:client-secret-teste").toString("base64")}`,
    );
    expect(JSON.parse(init.body)).toEqual({ audience: AUD_A, grant_type: "client_credentials" });
  });

  it("reutiliza o token em cache enquanto válido", async () => {
    const registro = { calls: [] as any[] };
    const deps = { fetchImpl: fakeFetch(["t1", "t2"], registro), now: () => 1_000 };
    const a = await obterClientCredentialsToken(AUD_A, deps);
    const b = await obterClientCredentialsToken(AUD_A, deps);
    expect(a.accessToken).toBe("t1");
    expect(b.accessToken).toBe("t1");
    expect(registro.calls).toHaveLength(1);
    expect(a.expiresAt).toBe(1_000 + 21600 * 1000);
  });

  it("renova preventivamente 5 minutos antes do vencimento", async () => {
    const registro = { calls: [] as any[] };
    const fetchImpl = fakeFetch(["t1", "t2"], registro);
    let agora = 0;
    const deps = { fetchImpl, now: () => agora };
    await obterClientCredentialsToken(AUD_A, deps);

    // 1s antes da janela de renovação: ainda reutiliza.
    agora = 21600 * 1000 - 5 * 60_000 - 1_000;
    expect((await obterClientCredentialsToken(AUD_A, deps)).accessToken).toBe("t1");
    expect(registro.calls).toHaveLength(1);

    // Dentro da janela preventiva: renova.
    agora = 21600 * 1000 - 5 * 60_000 + 1;
    expect((await obterClientCredentialsToken(AUD_A, deps)).accessToken).toBe("t2");
    expect(registro.calls).toHaveLength(2);
  });

  it("isola tokens por audience", async () => {
    const registro = { calls: [] as any[] };
    const deps = { fetchImpl: fakeFetch(["tA", "tB"], registro), now: () => 0 };
    const a = await obterClientCredentialsToken(AUD_A, deps);
    const b = await obterClientCredentialsToken(AUD_B, deps);
    expect(a.accessToken).toBe("tA");
    expect(b.accessToken).toBe("tB");
    expect(registro.calls).toHaveLength(2);
    expect(JSON.parse(registro.calls[1].init.body).audience).toBe(AUD_B);
  });

  it("deduplica requisições concorrentes da mesma audience", async () => {
    const registro = { calls: [] as any[] };
    const deps = { fetchImpl: fakeFetch(["t1", "t2"], registro), now: () => 0 };
    const [a, b, c] = await Promise.all([
      obterClientCredentialsToken(AUD_A, deps),
      obterClientCredentialsToken(AUD_A, deps),
      obterClientCredentialsToken(AUD_A, deps),
    ]);
    expect(registro.calls).toHaveLength(1);
    expect([a.accessToken, b.accessToken, c.accessToken]).toEqual(["t1", "t1", "t1"]);
  });

  it("erro controlado não vaza segredo, token nem corpo bruto", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: "invalid_client", secret_echo: "client-secret-teste", access_token: "vazado" }),
        { status: 401 },
      )) as unknown as typeof fetch;

    let capturado: unknown;
    try {
      await obterClientCredentialsToken(AUD_A, { fetchImpl, now: () => 0 });
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(MeliClientCredentialsError);
    const texto = `${(capturado as Error).message}${(capturado as Error).stack ?? ""}`;
    expect(texto).not.toContain("client-secret-teste");
    expect(texto).not.toContain("vazado");
    expect(texto).not.toContain("Basic ");
    expect((capturado as MeliClientCredentialsError).status).toBe(401);
  });

  it("exige credenciais e audience", async () => {
    delete process.env["MELI_CLIENT_SECRET"];
    await expect(
      obterClientCredentialsToken(AUD_A, { fetchImpl: fakeFetch(["x"], { calls: [] }) }),
    ).rejects.toBeInstanceOf(MeliClientCredentialsError);
    await expect(obterClientCredentialsToken("  ")).rejects.toBeInstanceOf(MeliClientCredentialsError);
  });
});
