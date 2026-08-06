// Logger com redação obrigatória. Nunca imprime payloads completos,
// cookies, tokens, senhas ou storageState.
export type Nivel = "info" | "warn" | "error";

const CHAVES_SENSIVEIS = [
  "password",
  "senha",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "storagestate",
  "storage_state",
  "session",
  "apikey",
  "api_key",
  "secret",
  "key",
  "bearer",
  "payload",
  "stops",
  "orders",
];

const PADROES = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /eyJ[A-Za-z0-9._\-]{20,}/g,
  /sb_(?:publishable|secret)_[A-Za-z0-9._\-]+/g,
];

export function redactString(s: string): string {
  let out = s;
  for (const p of PADROES) out = out.replace(p, "[REDACTED]");
  return out;
}

export function redact(value: unknown, profundidade = 0): unknown {
  if (profundidade > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.length > 10
      ? [`[array:${value.length}]`]
      : value.map((v) => redact(v, profundidade + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CHAVES_SENSIVEIS.includes(k.toLowerCase())) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = redact(v, profundidade + 1);
    }
    return out;
  }
  return "[UNSERIALIZABLE]";
}

export function formatLog(nivel: Nivel, msg: string, meta?: Record<string, unknown>): string {
  const linha: Record<string, unknown> = {
    ts: new Date().toISOString(),
    nivel,
    msg: redactString(msg),
  };
  if (meta) linha["meta"] = redact(meta);
  return JSON.stringify(linha);
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.log(formatLog("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(formatLog("warn", msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    console.error(formatLog("error", msg, meta));
  },
};

/** Mensagem segura para telemetria: curta, redigida e sem payload. */
export function mensagemSegura(msg: string, max = 240): string {
  return redactString(String(msg)).slice(0, max);
}
