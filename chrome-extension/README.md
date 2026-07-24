# JM Routes Importador — Extensão Chrome (v0.1.0)

Primeira versão funcional. Importa **uma rota aberta** do Mercado Livre para o
JMRoutes reutilizando a lógica já existente (`meliImportarRotaBruta`).

## 1. Requisitos

- Google Chrome / Chromium recente (MV3).
- Usuário com sessão ativa em:
  - `https://envios.adminml.com/` (Mercado Livre)
  - `https://jmroutes.app/` (JMRoutes) com perfil **admin**, **gerente** ou **supervisor**.

## 2. Estrutura

```
chrome-extension/
  manifest.json
  popup.html / popup.css / popup.js
  background.js
  icons/icon16.png icon32.png icon48.png icon128.png
  README.md
```

## 3. Instalação (carregar sem compactação)

1. Abrir `chrome://extensions`.
2. Ativar **Modo do desenvolvedor**.
3. Clicar em **Carregar sem compactação**.
4. Selecionar a pasta `chrome-extension/`.
5. Fixar a extensão na barra do Chrome.

## 4. Como usar

1. Fazer login no Mercado Livre.
2. Fazer login no JMRoutes (`https://jmroutes.app`).
3. Abrir a rota no Meli:
   `https://envios.adminml.com/logistics/monitoring-distribution/detail/{routeId}?site=MLB`
4. Clicar no ícone da extensão.
5. Conferir o `routeId` detectado.
6. Clicar em **Importar rota aberta**.
7. Se houver divergência entre totais, clicar em **Confirmar e importar**.

## 5. Recarregar a extensão após alterações

Em `chrome://extensions`, clicar no botão de **reload** do card da extensão.

## 6. Logs

- **Popup:** clicar com o botão direito no ícone → *Inspecionar popup* → aba *Console*.
- **Service worker:** em `chrome://extensions`, no card, clicar em *Inspecionar visualizações → service worker*.
- **Página do Meli:** DevTools comum da aba onde a rota está aberta.

## 7. Como funciona a captura da rota

- A extensão lê a URL da aba ativa.
- Aceita apenas `envios.adminml.com/logistics/monitoring-distribution/detail/{routeId}`.
- Primeiro tenta localizar o payload já carregado na página e consultar as URLs reais vistas em `performance.getEntriesByType("resource")`.
- Se o Meli retornar 404 ou mudar o endpoint, usa um fallback pontual com `chrome.debugger` para observar o request real de rede durante um reload da aba e ler o JSON retornado pela própria página.
- Valida `payload.id` e `payload.stops`.
- O payload permanece apenas em memória durante a vida do popup.

## 8. Como funciona a autenticação com o JMRoutes

- A extensão **não usa** `service_role`, tokens fixos, senhas, refresh tokens ou leitura direta de cookies.
- Ao enviar a rota, ela pede ao Chrome para ler, na aba `jmroutes.app`, o valor do `localStorage["sb-<project-ref>-auth-token"]` (sessão Supabase do próprio usuário logado) via `chrome.scripting.executeScript`.
- Extrai apenas o `access_token` e o envia como `Authorization: Bearer <token>` para o endpoint público:
  `POST https://jmroutes.app/api/public/meli/importar-rota-bruta`
- Se nenhuma aba do JMRoutes estiver aberta, a extensão abre uma. Caso o usuário não esteja logado, mostra:
  *“Faça login no JMRoutes e tente novamente.”*
- O token nunca é persistido no `chrome.storage`, apenas mantido em memória durante a chamada.

## 9. Como funciona o envio ao JMRoutes

- Endpoint: `POST /api/public/meli/importar-rota-bruta` (server route do TanStack Start).
- O endpoint valida o Bearer token com a Supabase e chama o mesmo helper usado pela server function `meliImportarRotaBruta` (`src/lib/meli-import-bruto.ts`), que roda a RPC `meli_importar_rota` sob a identidade do usuário.
- CORS restrito às origens `chrome-extension://…`, `jmroutes.app`, `www.jmroutes.app`, `*.lovable.app` e `localhost`.

## 10. Limitações da versão 0.1.0

- Importa somente a rota **atualmente aberta** no navegador.
- Não sincroniza várias rotas nem faz agendamento.
- Não roda em segundo plano nem periodicamente.
- Não usa Playwright, não lê cookies e não captura lista de rotas.
- Ícones são placeholders — substituir por arte oficial futuramente.
- Em ambiente de homologação (`*.lovable.app`), ajustar `IMPORT_ENDPOINT` em `popup.js` conforme necessário.

## 11. Como empacotar futuramente

Para gerar `.zip` de distribuição:

```
cd chrome-extension
zip -r ../jm-routes-importador-0.1.0.zip .
```

Publicação na Chrome Web Store fica para versão futura.

## 12. Ambientes

- **Produção:** endpoints apontam para `https://jmroutes.app`.
- **Desenvolvimento/Homologação:** adicionar host permission adicional e ajustar `IMPORT_ENDPOINT` / `JMROUTES_ORIGIN` em `popup.js`. Não deixar `Access-Control-Allow-Origin` amplo em produção.
