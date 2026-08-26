// ─────────────────────────────────────────────────────────────────────────────
// Contratos canônicos da integração Meli (P0 — fundação estrutural).
//
// Este módulo é PURO: sem imports de módulos operacionais, sem rede, sem
// side effects. Ele descreve o formato canônico de rota/pacote independente
// da fonte (AdminML scraping, API oficial de carrier ou lançamento manual),
// de modo que futuros adapters possam convergir para o mesmo modelo sem
// alterar os fluxos JM existentes (recebimento, triagem, contagem etc.).
// ─────────────────────────────────────────────────────────────────────────────

/** Origem do dado que produziu a rota/pacote canônico. */
export type IntegrationSource = "adminml" | "meli_carrier_api" | "manual";

export const INTEGRATION_SOURCES = ["adminml", "meli_carrier_api", "manual"] as const;

/** Motorista canônico. `internalDriverId` referencia `motoristas.id` quando conhecido. */
export type CanonicalMeliDriver = {
  externalId?: string | null;
  name?: string | null;
  internalDriverId?: string | null;
};

/**
 * Veículo canônico. Não existe entidade `veiculos` consolidada no JM, portanto
 * `internalVehicleId` permanece opcional e a placa segue como identificador.
 */
export type CanonicalMeliVehicle = {
  licensePlate?: string | null;
  internalVehicleId?: string | null;
};

/** Pacote canônico, independente da fonte. */
export type CanonicalMeliPackage = {
  /** Identificador do shipment no Meli (quando disponível). */
  shipmentId?: string | null;
  /** Identificador de rastreio usado hoje pelo JM (`meli_pacotes.tracking_id`). */
  trackingId?: string | null;
  /** Número de rastreio oficial do Meli, quando distinto do `trackingId`. */
  trackingNumber?: string | null;
  routeId?: string | null;
  facility?: string | null;
  serviceCenterId?: string | null;

  // Campos operacionais opcionais (apenas leitura/normalização; nunca decidem estado JM).
  status?: string | null;
  substatus?: string | null;
  occurrenceCode?: string | null;
  stopId?: string | null;
  ordem?: number | null;
  destinatario?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;

  integrationSource?: IntegrationSource;
};

/** Rota canônica, independente da fonte. */
export type CanonicalMeliRoute = {
  routeId: string;
  facility?: string | null;
  serviceCenterId?: string | null;
  driver?: CanonicalMeliDriver | null;
  vehicle?: CanonicalMeliVehicle | null;

  /** Data operacional da rota (YYYY-MM-DD) conforme a fonte. */
  dataRota?: string | null;
  status?: string | null;
  substatus?: string | null;
  initDate?: string | null;
  finishDate?: string | null;

  integrationSource?: IntegrationSource;
  packages: CanonicalMeliPackage[];
};

/** Resultado de uma normalização, com erros não fatais preservados. */
export type CanonicalNormalizationResult = {
  routes: CanonicalMeliRoute[];
  warnings: string[];
};

/**
 * Adapter: converte um payload bruto de uma fonte específica no modelo canônico.
 * Deve ser puro e nunca escrever no banco.
 */
export type MeliIntegrationAdapter<TRaw = unknown> = {
  readonly source: IntegrationSource;
  normalize(raw: TRaw): CanonicalNormalizationResult;
};

/**
 * Source: capacidade de obter payloads brutos de uma fonte.
 * Implementações vivem em módulos `*.server.ts`; este contrato não impõe
 * transporte nem credenciais.
 */
export type MeliIntegrationSource<TRaw = unknown> = {
  readonly source: IntegrationSource;
  fetchRoutes(params: {
    serviceCenterId?: string | null;
    facility?: string | null;
    date?: string | null;
  }): Promise<TRaw>;
};
