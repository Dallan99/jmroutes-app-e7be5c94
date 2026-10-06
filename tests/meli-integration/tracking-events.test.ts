import { describe, expect, it } from "vitest";
import {
  TRACKING_EVENTOS_INTERNOS,
  TRACKING_STATUS_ENVIO,
  TRACKING_STATUS_ENVIO_PADRAO,
  isTrackingEventoInterno,
  isTrackingStatusEnvio,
} from "../../src/lib/meli-integration/tracking-events";

describe("eventos internos de rastreio", () => {
  it("mantém o conjunto fechado e exato dos 7 eventos", () => {
    expect([...TRACKING_EVENTOS_INTERNOS]).toEqual([
      "RECEBIDO_BASE",
      "TRIADO",
      "CARREGADO",
      "SAIU_ENTREGA",
      "ENTREGUE",
      "INSUCESSO",
      "DEVOLUCAO",
    ]);
  });

  it("rejeita eventos desconhecidos", () => {
    expect(isTrackingEventoInterno("TRIADO")).toBe(true);
    expect(isTrackingEventoInterno("ENVIADO")).toBe(false);
    expect(isTrackingEventoInterno(undefined)).toBe(false);
  });

  it("expõe os status de envio e o padrão seguro", () => {
    expect([...TRACKING_STATUS_ENVIO]).toEqual([
      "NAO_ENVIAR",
      "PENDENTE",
      "PROCESSANDO",
      "ENVIADO",
      "ERRO",
    ]);
    expect(TRACKING_STATUS_ENVIO_PADRAO).toBe("NAO_ENVIAR");
    expect(isTrackingStatusEnvio("ERRO")).toBe(true);
    expect(isTrackingStatusEnvio("QUALQUER")).toBe(false);
  });
});
