# JM Routes Importador — Extensão Chrome (v0.2.0)

Importa **a rota aberta** no Mercado Livre e agora sincroniza **todas as rotas ativas da base**
(com opção de repetir automaticamente a cada 30 s).

## 1. Requisitos

- Chrome/Chromium recente (MV3).
- Sessão ativa em:
  - `https://envios.adminml.com/`
  - `https://jmroutes.app/` (perfil admin/gerente/supervisor).

## 2. Instalação (desenvolvedor)

1. `chrome://extensions` → **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione a pasta `chrome-extension/`.
3. Fixe a extensão.

## 3. Uso — Rota aberta

Igual à v0.1. Abra a rota, clique no ícone → **Importar rota aberta**.

## 4. Uso — Sincronizar base

1. Abra a página `https://envios.adminml.com/logistics/monitoring-distribution` com os filtros da base desejada.
2. Deixe uma aba do JMRoutes autenticada.
3. Clique no ícone da extensão.
4. Em **Sincronizar base**:
   - **Sincronizar todas as rotas**: executa um único ciclo.
   - **Atualização contínua a cada 30 segundos**: ativa o loop; o service worker continua rodando mesmo com o popup fechado.
   - **Concorrência**: 2 / 4 (padrão) / 6.
   - **Cancelar sincronização**: interrompe o ciclo atual.

O popup mostra: base detectada, rotas encontradas/ativas/processadas, sucesso, divergências, erros,
pacotes inseridos/atualizados/inalterados, última sincronização, próximo ciclo em X segundos e lista
de rotas com problema.

## 5. Como funciona

- **Lista**: a extensão inspeciona `performance.getEntriesByType("resource")` na aba do Meli
  e reutiliza a URL real de `get-routes-list` (preservando base/service center, filtros, datas, status).
  Paginação detectada automaticamente entre `page`, `offset` e `from`, respeitando `size`/`limit`,
  `totalDocuments`, `hasNext`, `last`. Limites: 20 páginas, 500 rotas, deduplicação por `routeId` numérico,
  interrupção quando a próxima página repete os mesmos IDs.
- **Rotas ativas**: `finishDate === 0` **e** `executedFinishDate === 0`; em caso de dúvida, inclui.
- **Detalhe**: `GET .../monitoring-route/route-detail?routeId=…&siteId=MLB` executado no contexto da aba do Meli (sessão do usuário; sem cookies/tokens manuais).
- **Envio**: `POST https://jmroutes.app/api/public/meli/importar-rota-bruta` com `Authorization: Bearer <access_token>` da sessão Supabase do próprio usuário logado em `jmroutes.app` (nunca persistido).
- **Concorrência**: fila com 4 workers padrão + 250 ms entre itens.
- **Loop 30 s**: `chrome.alarms` reagendado ao final de cada ciclo → nunca sobrepõe. Se o ciclo demorar > 30 s, o próximo só começa depois que o anterior terminar.
- **Backoff**: >30% de erros no ciclo pausa o modo contínuo. Sessão Meli/JMRoutes expirada também pausa.
- **Divergência**: nunca confirmada automaticamente — a rota entra em "problemas".

## 6. Segurança

- Sem `service_role`, sem token fixo, sem `cookies` permission, sem leitura direta de cookies.
- `chrome.storage.local` guarda apenas: `continuous`, `concurrency`, `ultimaSync`. Nunca payload, token, nomes, endereços ou sessão.
- Logs sem dados pessoais.

## 7. Recarregar após alterações

`chrome://extensions` → clique no ícone de reload do card.

## 8. Empacotar

```
cd chrome-extension
zip -r ../jm-routes-importador-0.2.0.zip .
```

## 9. Limitações v0.2.0

- Sincroniza a base **atualmente aberta** no Meli (uma aba por vez).
- Não implementa Playwright.
- Se a URL real da lista ainda não estiver em `performance`, o popup pede para recarregar a página do Meli.
- Divergência exige tratamento manual pelo módulo Integração Meli do JMRoutes.
