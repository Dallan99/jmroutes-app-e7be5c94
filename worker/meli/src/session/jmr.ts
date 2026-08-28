import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decryptJson, encryptJson } from "../crypto.js";

type SessaoPersistida = { refreshToken: string };

export async function carregarRefreshToken(path: string, key: string): Promise<string | null> {
  try {
    const data = decryptJson<SessaoPersistida>(await readFile(path), key);
    return typeof data?.refreshToken === "string" && data.refreshToken ? data.refreshToken : null;
  } catch {
    return null;
  }
}

export async function salvarRefreshToken(path: string, key: string, refreshToken: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encryptJson({ refreshToken }, key), { mode: 0o600 });
}

/** Serializa a rotação do refresh token entre os workers de cada base. */
export async function comTravaSessao<T>(path: string, executar: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const limite = Date.now() + 45_000;
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch {
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 60_000) await rm(lockPath, { recursive: true, force: true });
      if (Date.now() >= limite) throw new Error("tempo_esgotado_trava_sessao");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  try {
    return await executar();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
