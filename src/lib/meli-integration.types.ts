/**
 * Modelo canônico da integração Meli.
 *
 * O domínio operacional não deve depender do formato do AdminML nem do formato
 * da futura API oficial. Cada fonte traduz seu payload para estes contratos.
 */
export const MELI_INTEGRATION_SOURCES = ["adminml", "official_api"] as const;
export type MeliIntegrationSourceName = (typeof MELI_INTEGRATION_SOURCES)[number];

export type MeliDriverRef = {
  id: string | null;
  name: string | null;
};

export type MeliVehicleRef = {
  licensePlate: string | null;
};

export type MeliPackageCanonical = {
  shipmentId: string | null;
  trackingId: string | null;
  trackingNumber: string | null;
  routeId: string;
  facility: string | null;
  serviceCenterId: string | null;
  source: MeliIntegrationSourceName;
  rawPayload?: unknown;
};

export type MeliRouteCanonical = {
  routeId: string;
  facility: string | null;
  serviceCenterId: string | null;
  driver: MeliDriverRef;
  vehicle: MeliVehicleRef;
  packages: MeliPackageCanonical[];
  source: MeliIntegrationSourceName;
  rawPayload?: unknown;
};

/** Porta de entrada: AdminML e API oficial implementam o mesmo contrato. */
export interface MeliIntegrationSource {
  readonly name: MeliIntegrationSourceName;
  normalizeRoute(payload: unknown): MeliRouteCanonical;
}

export const MELI_INTERNAL_TRACKING_EVENTS = [
  "RECEBIDO_BASE",
  "TRIADO",
  "CARREGADO",
  "SAIU_ENTREGA",
  "ENTREGUE",
  "INSUCESSO",
  "DEVOLUCAO",
] as const;

export type MeliInternalTrackingEvent = (typeof MELI_INTERNAL_TRACKING_EVENTS)[number];

export function isMeliInternalTrackingEvent(value: unknown): value is MeliInternalTrackingEvent {
  return (
    typeof value === "string" &&
    (MELI_INTERNAL_TRACKING_EVENTS as readonly string[]).includes(value)
  );
}

