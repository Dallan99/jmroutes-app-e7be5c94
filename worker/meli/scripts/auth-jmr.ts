#!/usr/bin/env tsx
import { chromium } from "playwright";
import { loadConfig } from "../src/config.js";
import { salvarRefreshToken } from "../src/session/jmr.js";

async function main() {
  const cfg = loadConfig();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${cfg.jmrBaseUrl}/login`, { waitUntil: "domcontentloaded" });
  console.log("Entre normalmente no JMRoutes pelo navegador. Aguardando a sessao...");

  const limite = Date.now() + 10 * 60_000;
  let refreshToken: string | null = null;
  while (Date.now() < limite && !refreshToken) {
    refreshToken = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const raw = localStorage.getItem(localStorage.key(i) ?? "");
        if (!raw) continue;
        try {
          const value = JSON.parse(raw) as Record<string, unknown>;
          const token = value["refresh_token"] ?? (value["currentSession"] as Record<string, unknown> | undefined)?.["refresh_token"];
          if (typeof token === "string" && token) return token;
        } catch { /* chave sem JSON */ }
      }
      return null;
    }).catch(() => null);
    if (!refreshToken) await page.waitForTimeout(2000);
  }

  if (!refreshToken) {
    await browser.close();
    throw new Error("Tempo esgotado sem localizar uma sessao do JMRoutes.");
  }
  await salvarRefreshToken(cfg.jmrSessionFilePath, cfg.sessionKeyBase64, refreshToken);
  await browser.close();
  console.log("Sessao do JMRoutes salva de forma criptografada.");
}

main().catch((err) => {
  console.error(String((err as Error)?.message ?? err));
  process.exit(1);
});
