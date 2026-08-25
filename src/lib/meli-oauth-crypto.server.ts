const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBase64Url(length = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = process.env.MELI_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("MELI_TOKEN_ENCRYPTION_KEY não configurada.");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const decoded = base64UrlToBytes(raw.trim());
    bytes = decoded.length === 32
      ? decoded
      : new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));
  } catch {
    // Alguns gerenciadores de secrets normalizam caracteres de base64url.
    // Nesse caso, derivamos uma chave AES-256 estável a partir do segredo.
    bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));
  }
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(value));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string): Promise<string> {
  const [version, ivRaw, cipherRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !cipherRaw) throw new Error("Segredo criptografado inválido.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivRaw) },
    await encryptionKey(),
    base64UrlToBytes(cipherRaw),
  );
  return decoder.decode(decrypted);
}
