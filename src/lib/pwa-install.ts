export interface PwaInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installPrompt: PwaInstallPromptEvent | null = null;
let initialized = false;
const listeners = new Set<(prompt: PwaInstallPromptEvent | null) => void>();

function notify() {
  listeners.forEach((listener) => listener(installPrompt));
}

/**
 * Captura a oferta nativa assim que o site abre. O navegador costuma disparar
 * esse evento antes de o usuário navegar até /coletor.
 */
export function initializePwaInstallCapture() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as PwaInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    notify();
  });
}

export function getPwaInstallPrompt() {
  return installPrompt;
}

export function clearPwaInstallPrompt() {
  installPrompt = null;
  notify();
}

export function subscribePwaInstallPrompt(listener: (prompt: PwaInstallPromptEvent | null) => void) {
  listeners.add(listener);
  listener(installPrompt);
  return () => {
    listeners.delete(listener);
  };
}
