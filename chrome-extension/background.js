// Service worker mínimo. Não armazena payload, não executa em segundo plano
// e não faz importação automática. Existe apenas para satisfazer o MV3 e
// permitir futuras extensões.
self.addEventListener("install", () => {
  self.skipWaiting?.();
});
self.addEventListener("activate", () => {
  self.clients?.claim?.();
});
