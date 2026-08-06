#!/usr/bin/env tsx
// Autenticação manual no AdminML (headful). Execute LOCALMENTE, com display.
// Uso: WORKER_SESSION_KEY=<base64-32bytes> SESSION_FILE_PATH=./data/adminml-session.enc npm run auth
import { autenticarManualmente } from "../src/session/login";
import { generateKeyBase64, parseKey } from "../src/crypto";
import { logger } from "../src/logger";

async function main() {
  const key = (process.env["WORKER_SESSION_KEY"] ?? "").trim();
  if (!key) {
    logger.error(
      "WORKER_SESSION_KEY ausente. Gere uma chave AES-256 (base64) e guarde-a no cofre de secrets:",
    );
    console.log(generateKeyBase64());
    process.exit(1);
  }
  parseKey(key);
  const path = (process.env["SESSION_FILE_PATH"] ?? "./data/adminml-session.enc").trim();
  await autenticarManualmente({ sessionFilePath: path, sessionKeyBase64: key });
}

main().catch((err) => {
  logger.error("Falha na autenticação manual.", { erro: String(err?.message ?? err) });
  process.exit(1);
});
