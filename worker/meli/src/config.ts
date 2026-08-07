// Configuração do worker. Fase B1: aceita SOMENTE a base piloto ESP16/SSP15/MLB.
export const WORKER_VERSAO = "0.1.0-b1";
export const STORAGE_STATE_AAD = "meli-storage-state:v1";

export const PILOTO = {
  BASE_CODE: "ESP16",
  SERVICE_CENTER_ID: "SSP15",
  SITE_ID: "MLB",
  NOME: "Guarujá",
} as const;

export const ADMINML = {
  HOST: "envios.adminml.com",
  LIST_URL: "https://envios.adminml.com/logistics/api/monitoring/get-routes-list",
  DETAIL_URL: "https://envios.adminml.com/logistics/api/monitoring-route/route-detail",
  PAGE_SIZE: 50,
  MAX_PAGINAS: 40,
  TIMEOUT_MS: 30_000,
  JITTER_MS: 500,
  CONCORRENCIA: 1,
} as const;

export type WorkerConfig = {
  baseCode: string;
  serviceCenterId: string;
  siteId: string;
  jmrBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  workerEmail: string;
  workerPassword: string;
  sessionKeyBase64: string;
  sessionFilePath: string;
  syncIntervalSeconds: number;
  /** DRY_RUN=true: consulta o AdminML, mas NÃO envia ao JMRoutes e NÃO grava telemetria. */
  dryRun: boolean;
};

export class ConfigError extends Error {}

function req(env: Record<string, string | undefined>, name: string): string {
  const v = (env[name] ?? "").trim();
  if (!v) throw new ConfigError(`Variável obrigatória ausente: ${name}`);
  return v;
}

/**
 * Lê e valida a configuração. Recusa qualquer base diferente do piloto.
 * Nunca registra senha/chave — apenas valida presença.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const baseCode = (env["BASE_CODE"] ?? "").trim().toUpperCase();
  const serviceCenterId = (env["SERVICE_CENTER_ID"] ?? "").trim().toUpperCase();
  const siteId = (env["SITE_ID"] ?? "").trim().toUpperCase();

  if (baseCode !== PILOTO.BASE_CODE) {
    throw new ConfigError(
      `Fase B1 restrita à base ${PILOTO.BASE_CODE}. BASE_CODE recebido: ${baseCode || "(vazio)"}`,
    );
  }
  if (serviceCenterId !== PILOTO.SERVICE_CENTER_ID) {
    throw new ConfigError(
      `Fase B1 restrita ao service center ${PILOTO.SERVICE_CENTER_ID}. Recebido: ${serviceCenterId || "(vazio)"}`,
    );
  }
  if (siteId !== PILOTO.SITE_ID) {
    throw new ConfigError(`Fase B1 restrita ao site ${PILOTO.SITE_ID}. Recebido: ${siteId || "(vazio)"}`);
  }

  const sessionKeyBase64 = req(env, "WORKER_SESSION_KEY");
  const keyBytes = Buffer.from(sessionKeyBase64, "base64");
  if (keyBytes.length !== 32) {
    throw new ConfigError("WORKER_SESSION_KEY deve ser 32 bytes em base64 (AES-256-GCM).");
  }

  const dryRun = (env["DRY_RUN"] ?? "").trim().toLowerCase() === "true";

  const intervalRaw = Number(env["SYNC_INTERVAL_SECONDS"] ?? 60);
  const syncIntervalSeconds =
    Number.isFinite(intervalRaw) && intervalRaw >= 15 ? Math.floor(intervalRaw) : 60;

  return {
    baseCode,
    serviceCenterId,
    siteId,
    jmrBaseUrl: req(env, "JMR_BASE_URL").replace(/\/+$/, ""),
    supabaseUrl: req(env, "SUPABASE_URL").replace(/\/+$/, ""),
    supabaseAnonKey: req(env, "SUPABASE_ANON_KEY"),
    // Em DRY_RUN não há chamada ao JMRoutes; credenciais do usuário técnico
    // deixam de ser obrigatórias justamente para permitir teste sem usuário criado.
    workerEmail: dryRun ? (env["WORKER_EMAIL"] ?? "").trim() : req(env, "WORKER_EMAIL"),
    workerPassword: dryRun ? (env["WORKER_PASSWORD"] ?? "").trim() : req(env, "WORKER_PASSWORD"),
    sessionKeyBase64,
    sessionFilePath: (env["SESSION_FILE_PATH"] ?? "/data/adminml-session.enc").trim(),
    syncIntervalSeconds,
    dryRun,
  };
}
