// ─────────────────────────────────────────────────────────────────────────────
// Eventos internos de rastreio (P0 — apenas tipos e constantes).
//
// Nenhum dispatcher, nenhum fetch, nenhum side effect. Os eventos nascem com
// status de envio NAO_ENVIAR: nada é transmitido ao Meli nesta fase.
// ─────────────────────────────────────────────────────────────────────────────

export const TRACKING_EVENTOS_INTERNOS = [
  "RECEBIDO_BASE",
  "TRIADO",
  "CARREGADO",
  "SAIU_ENTREGA",
  "ENTREGUE",
  "INSUCESSO",
  "DEVOLUCAO",
] as const;

export type TrackingEventoInterno = (typeof TRACKING_EVENTOS_INTERNOS)[number];

export const TRACKING_STATUS_ENVIO = [
  "NAO_ENVIAR",
  "PENDENTE",
  "PROCESSANDO",
  "ENVIADO",
  "ERRO",
] as const;

export type TrackingStatusEnvio = (typeof TRACKING_STATUS_ENVIO)[number];

/** Status seguro com que todo evento nasce nesta fase. */
export const TRACKING_STATUS_ENVIO_PADRAO: TrackingStatusEnvio = "NAO_ENVIAR";

/** Registro interno de evento (espelha `public.meli_tracking_eventos`). */
export type TrackingEventoRegistro = {
  id?: string;
  shipmentId?: string | null;
  trackingNumber?: string | null;
  rotaId?: string | null;
  meliPacoteId?: string | null;
  tipoEvento: TrackingEventoInterno;
  eventDate: string;
  payload?: Record<string, unknown>;
  statusEnvio?: TrackingStatusEnvio;
  tentativas?: number;
  respostaMeli?: unknown;
  idempotencyKey?: string | null;
  createdAt?: string;
  sentAt?: string | null;
};

export function isTrackingEventoInterno(value: unknown): value is TrackingEventoInterno {
  return (
    typeof value === "string" &&
    (TRACKING_EVENTOS_INTERNOS as readonly string[]).includes(value)
  );
}

export function isTrackingStatusEnvio(value: unknown): value is TrackingStatusEnvio {
  return (
    typeof value === "string" && (TRACKING_STATUS_ENVIO as readonly string[]).includes(value)
  );
}
