// Login MANUAL (headful) no AdminML. O operador digita usuário, senha e MFA.
// O worker nunca armazena senha: apenas o storageState resultante, cifrado.
import { ADMINML } from "../config";
import { logger } from "../logger";
import { salvarSessao, type StorageState } from "./store";

export type LoginOpts = {
  sessionFilePath: string;
  sessionKeyBase64: string;
  /** Tempo máximo aguardando o operador concluir login + MFA. */
  timeoutMs?: number;
};

/**
 * Abre um navegador visível, aguarda o operador autenticar manualmente e
 * grava o storageState cifrado. Requer ambiente com display (uso local).
 */
export async function autenticarManualmente(opts: LoginOpts): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  logger.info("Abrindo AdminML para autenticação manual (login e MFA pelo operador).", {
    host: ADMINML.HOST,
  });
  await page.goto(`https://${ADMINML.HOST}/logistics/monitoring`, { waitUntil: "domcontentloaded" });

  const limite = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let autenticado = false;
  while (Date.now() < limite) {
    const res = await context.request
      .get(`${ADMINML.DETAIL_URL}?routeId=0&siteId=MLB`, { timeout: 15_000 })
      .catch(() => null);
    const status = res?.status();
    if (status && status !== 401 && status !== 403) {
      autenticado = true;
      break;
    }
    await page.waitForTimeout(3000);
  }

  if (!autenticado) {
    await browser.close();
    throw new Error("Tempo esgotado: sessão AdminML não foi autenticada.");
  }

  const state = (await context.storageState()) as StorageState;
  await salvarSessao(opts.sessionFilePath, state, opts.sessionKeyBase64);
  await browser.close();
  logger.info("Sessão AdminML salva cifrada.", { arquivo: opts.sessionFilePath });
}
