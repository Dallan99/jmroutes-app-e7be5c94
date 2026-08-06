// AES-256-GCM para o storageState do AdminML.
// Formato do arquivo: nonce(12) || ciphertext || tag(16)
// AAD: "meli-storage-state:v1"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { STORAGE_STATE_AAD } from "./config";

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export class CryptoError extends Error {}

export function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new CryptoError("Chave inválida: AES-256-GCM exige 32 bytes.");
  return key;
}

export function generateKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

export function encryptJson(value: unknown, keyBase64: string): Buffer {
  const key = parseKey(keyBase64);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(STORAGE_STATE_AAD, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function decryptJson<T = unknown>(blob: Buffer, keyBase64: string): T {
  const key = parseKey(keyBase64);
  if (blob.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new CryptoError("Arquivo de sessão corrompido ou truncado.");
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(STORAGE_STATE_AAD, "utf8"));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CryptoError("Falha na autenticação AES-GCM (chave incorreta ou dado alterado).");
  }
  try {
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new CryptoError("Conteúdo decifrado não é JSON válido.");
  }
}
