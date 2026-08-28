const encoder = new TextEncoder();
const decoder = new TextDecoder();

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomBase64Url(length = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(encoder.encode(value)))),
  );
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = process.env.MELI_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("MELI_TOKEN_ENCRYPTION_KEY não configurada.");
  const bytes = base64UrlToBytes(raw);
  if (bytes.length !== 32) throw new Error("MELI_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64url.");
  return crypto.subtle.importKey("raw", arrayBuffer(bytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(iv) },
    await encryptionKey(),
    arrayBuffer(encoder.encode(value)),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string): Promise<string> {
  const [version, ivRaw, cipherRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !cipherRaw) throw new Error("Segredo criptografado inválido.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(base64UrlToBytes(ivRaw)) },
    await encryptionKey(),
    arrayBuffer(base64UrlToBytes(cipherRaw)),
  );
  return decoder.decode(decrypted);
}
