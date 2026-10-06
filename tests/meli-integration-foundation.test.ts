import { describe, expect, it, vi } from "vitest";
import {
  MeliCarrierOAuthClient,
  shouldRefreshMeliCarrierToken,
  type MeliCarrierCachedToken,
  type MeliCarrierTokenStore,
} from "../src/lib/meli-carrier-oauth.server";
import {
  MELI_INTERNAL_TRACKING_EVENTS,
  isMeliInternalTrackingEvent,
} from "../src/lib/meli-integration.types";

class MemoryTokenStore implements MeliCarrierTokenStore {
  token: MeliCarrierCachedToken | null = null;

  async get(audience: string) {
    return this.token?.audience === audience ? this.token : null;
  }

  async put(token: MeliCarrierCachedToken) {
    this.token = token;
  }
}

describe("fundação da integração oficial Meli", () => {
  it("mantém somente o catálogo interno aprovado de eventos", () => {
    expect(MELI_INTERNAL_TRACKING_EVENTS).toEqual([
      "RECEBIDO_BASE",
      "TRIADO",
      "CARREGADO",
      "SAIU_ENTREGA",
      "ENTREGUE",
      "INSUCESSO",
      "DEVOLUCAO",
    ]);
    expect(isMeliInternalTrackingEvent("ENTREGUE")).toBe(true);
    expect(isMeliInternalTrackingEvent("CODIGO_OFICIAL_INVENTADO")).toBe(false);
  });

  it("reutiliza token válido e renova preventivamente", () => {
    const now = Date.now();
    expect(shouldRefreshMeliCarrierToken(null, now)).toBe(true);
    expect(
      shouldRefreshMeliCarrierToken({
        audience: "tracking",
        accessToken: "token",
        expiresAt: new Date(now + 11 * 60_000).toISOString(),
      }, now),
    ).toBe(false);
    expect(
      shouldRefreshMeliCarrierToken({
        audience: "tracking",
        accessToken: "token",
        expiresAt: new Date(now + 9 * 60_000).toISOString(),
      }, now),
    ).toBe(true);
  });

  it("usa client_credentials com Basic Auth e cache por audience", async () => {
    const store = new MemoryTokenStore();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${Buffer.from("client:secret").toString("base64")}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        grant_type: "client_credentials",
        audience: "tracking",
      });
      return Response.json({ access_token: "novo-token", expires_in: 21600 });
    });

    const client = new MeliCarrierOAuthClient(
      { clientId: "client", clientSecret: "secret", tokenUrl: "https://oauth.example/token", fetchImpl },
      store,
    );

    expect(await client.getAccessToken("tracking")).toBe("novo-token");
    expect(await client.getAccessToken("tracking")).toBe("novo-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

