# Diagnóstico técnico — preparação para integração oficial Mercado Livre (OAuth client_credentials + Tracking Notifications)

Nenhum arquivo do projeto foi alterado. Nenhuma migration aplicada, nenhum acesso a banco de produção, nenhuma publicação.

## 1. Fatos confirmados no código

### 1.1 Mapa de rotas e módulos

Rotas públicas (`src/routes/`): `index.tsx`, `auth.tsx`, `reset-password.tsx`, `preview-relatorios.tsx`, `tv.tsx`, `tv.dashboard.tsx`, `tv.gerencial.tsx`, `tv.meli.tsx`, `mcp.ts`, `[.]lovable.oauth.consent.tsx`.

Rotas autenticadas (`src/routes/_authenticated/`): `recebimento`, `triagem`, `contagem`, `inventario`, `inventario-central`, `devolucoes`, `meli-devolucoes`, `meli-risco`, `dashboard`, `painel-operacional`, `gerencial`, `historico`, `auditoria`, `bases`, `usuarios`, `coletor`, `configuracoes`, `integracao-meli`, `transferencias`, `transferencias-lote`, `route.tsx` (gate).

Endpoints HTTP (`src/routes/api/`):
- `api/public/meli/ciclo.ts` — protocolo de lotes do worker (início/staging/finalização).
- `api/public/meli/importar-rota-bruta.ts` — ingestão de payload bruto.
- `api/public/meli/notificacoes.ts` — recepção de notificações.
- `api/meli/oauth/callback.ts` — callback do OAuth `authorization_code` atual.

Camada de domínio/servidor relevante em `src/lib/`: `meli.functions.ts`, `meli-sync.functions.ts`, `meli-sync-lotes.ts`, `meli-normalize.ts`, `meli-import-bruto.ts`, `meli-dashboard.functions.ts`, `meli-devolucoes.functions.ts`, `meli-devolucoes-domain.ts`, `meli-ranking.functions.ts`, `meli-risco.functions.ts`, `meli-status.ts`, `meli-pm.ts`, `meli-api.server.ts`, `meli-api-http.ts`, `meli-oauth.functions.ts`, `meli-oauth-crypto.server.ts`, `meli-oauth-support.ts`, e os operacionais `recebimento.functions.ts`, `recebimento-escala.server.ts`, `triagem.functions.ts`, `contagem-lock.functions.ts`, `historico.functions.ts`, `audit.functions.ts`.

### 1.2 Acoplamento Meli ↔ módulos operacionais (pontos exatos)

- `src/lib/meli.functions.ts:237` e `src/lib/meli-import-bruto.ts:69` — RPC `meli_publicar_rota_operacional`: única ponte que converte rota Meli em carga operacional (`escalas`).
- `src/lib/recebimento-escala.server.ts:59,63,76` — recebimento lê `escalas` filtrando `meli_pacote_id IS NOT NULL`.
- `src/lib/triagem.functions.ts:318,323` — triagem projeta `meli_pacote_id` junto com o estado físico.
- `src/lib/meli-ranking.functions.ts:89,129` — leitura direta de `meli_rotas` / `meli_pacotes` (somente leitura, analítico).
- `src/lib/meli-risco.functions.ts:80` — RPC `meli_rotas_area_risco`.
- `src/lib/meli-sync-lotes.ts` — regra de visibilidade da rota publicada; comentário no cabeçalho confirma que sync não escreve estado físico.

Conclusão: o acoplamento é estreito e passa por `meli_pacote_id` em `escalas` + a RPC de publicação. Nenhum caminho de sync escreve `recebido`, `triado` ou `devolvido`.

### 1.3 Schema atual de `meli_pacotes` / `meli_rotas`

`supabase/migrations/20260722162536_...sql:43-81` cria `meli_pacotes` com: `id`, `rota_id uuid NOT NULL REFERENCES meli_rotas(id) ON DELETE CASCADE`, `tracking_id text NOT NULL`, `shipment_id text`, dados de destinatário/endereço, `status`, `printed_label`, `ordem`, timestamps, `UNIQUE (rota_id, tracking_id)`. Índices em `rota_id`, `tracking_id` e (migration `20260730130146`) `shipment_id` parcial.

Lacunas confirmadas em `meli_pacotes`: **não existem** `tracking_number`, `facility`, `service_center_id`, `integration_source`. `facility` existe apenas em `meli_rotas`; `meli_service_center_id` existe apenas em `public.bases`.

### 1.4 Motorista e veículo

- `meli_rotas` tem `driver_name`, `driver_id`, `vehicle_license` como texto solto (`src/lib/meli-normalize.ts:34-36,292-294,414-435`, com normalização de placa para maiúsculas).
- Entidade canônica `public.motoristas` (`nome`, `cpf`, `cnh`, `placa`, `transportadora`, `base_id`) existe e é usada por `rotas.motorista_id`, mas **não há vínculo** entre `meli_rotas` e `motoristas`. Não existe tabela de veículos.

### 1.5 Fundação P0 já presente no repositório

- `src/lib/meli-integration/contracts.ts`, `tracking-events.ts`, `oauth-client-credentials.server.ts` (client_credentials com cache/dedupe por audience, server-only).
- SQL aditivo **não aplicado** em `supabase/propostas/20260826235641_meli_integration_p0_fundacao.sql` (colunas aditivas em `meli_pacotes`/`meli_rotas`, `integration_source` com CHECK, `motorista_id` FK opcional, tabela de eventos de tracking restrita a `service_role`).
- Testes em `tests/meli-integration/`.

### 1.6 Resultado de typecheck e testes (executados agora, sem edição)

- `bunx tsgo --noEmit`: **limpo**, zero erros.
- `bunx vitest run`: **161 testes passaram**, 30 arquivos ok, **3 arquivos falharam na importação** (nenhuma falha de assert):
  - `tests/meli-integration/tracking-events.test.ts:8` e `oauth-client-credentials.test.ts:6` usam alias `@/...`; `tsconfig.json` inclui apenas `src/**`, então `vite-tsconfig-paths` não resolve o alias dentro de `tests/`. Todos os testes existentes usam caminho relativo (`../../src/lib/...`).
  - `tests/meli-integration/migration-p0.test.ts:5` aponta para `supabase/migrations/20260826235641_...sql`, mas o arquivo está em `supabase/propostas/`.
- Build de produção não foi executado para não gerar artefatos.

## 2. Lacunas

1. Sem colunas `tracking_number` / `facility` / `service_center_id` / `integration_source` em `meli_pacotes`.
2. Sem tabela append-only de eventos internos de tracking.
3. Sem vínculo `meli_rotas.motorista_id` → `motoristas`; sem entidade de veículo.
4. OAuth atual é apenas `authorization_code` por usuário (`meli_api_conexoes`); não há credencial de aplicação nem persistência/observabilidade do token client_credentials.
5. Sem adapter que isole "fonte de dados" (AdminML vs API oficial) da regra operacional.
6. Os 3 arquivos de teste novos não rodam (imports quebrados).

## 3. Proposta (desenho, sem execução)

### 3.1 Tabela append-only de eventos internos

`public.meli_tracking_eventos`: `id uuid PK`, `shipment_id text`, `tracking_number text`, `event_type text` (vocabulário **interno**, sem códigos oficiais), `event_date timestamptz`, `payload jsonb`, `send_status text NOT NULL DEFAULT 'NAO_ENVIAR'`, `attempts int NOT NULL DEFAULT 0`, `response jsonb`, `created_at timestamptz DEFAULT now()`, `sent_at timestamptz`. Sem UPDATE/DELETE por roles de app; RLS habilitada e apenas `service_role` com acesso; índices em `(shipment_id)`, `(send_status, created_at)`. Nenhum trigger sobre tabelas operacionais nesta fase.

### 3.2 OAuth client_credentials server-side

`MELI_CLIENT_ID` / `MELI_CLIENT_SECRET` como secrets de projeto lidos **dentro do handler** (`process.env[...]`), nunca `VITE_`. Módulo `*.server.ts` com cache em memória por audience, reuso do token de ~6h, renovação preventiva ~5 min antes do vencimento, dedupe de chamadas concorrentes, erros opacos sem log de segredo. Já implementado em `src/lib/meli-integration/oauth-client-credentials.server.ts` — falta apenas validar via teste e ligar os secrets.

### 3.3 Camada de integração isolada

`src/lib/meli-integration/`: `contracts.ts` (modelo canônico), `adapters/adminml.ts` (payload atual → canônico, reutilizando `meli-normalize.ts`), `adapters/carrier-api.ts` (stub, sem chamadas reais), `tracking-events.ts` (vocabulário + `NAO_ENVIAR`), `outbox.server.ts` (gravação append-only). Regra: fluxos operacionais continuam falando só com `escalas`/RPCs atuais; a integração só escreve em `meli_*`.

## 4. Arquivos a alterar/criar (P0/P1)

Baixo risco (P0):
- corrigir imports em `tests/meli-integration/tracking-events.test.ts`, `oauth-client-credentials.test.ts` (relativo) e o caminho do SQL em `migration-p0.test.ts`;
- migration aditiva a partir de `supabase/propostas/20260826235641_...sql` (aplicada só com autorização explícita);
- `docs/integracao-meli-arquitetura.md` (atualizar com este diagnóstico).

P1 (após P0 aprovado):
- `src/lib/meli-integration/adapters/adminml.ts`, `adapters/carrier-api.ts`, `outbox.server.ts`;
- pontos de emissão de evento interno (chamando o outbox) em `recebimento.functions.ts`, `triagem.functions.ts`, `meli-devolucoes.functions.ts` — apenas append de evento, sem alterar decisão operacional;
- regeneração de `src/integrations/supabase/types.ts` após a migration.

Sem novas dependências npm.

## 5. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Sync/API oficial sobrescrever estado físico JM | manter invariante: integração nunca escreve `recebido`/`triado`/`devolvido`; teste de caracterização |
| `integration_source NOT NULL DEFAULT 'adminml'` travar upserts do worker | default cobre o worker atual; nenhum código precisa mudar |
| Emissão de evento derrubar bipagem | outbox best-effort, try/catch, falha nunca bloqueia o bip |
| Segredo vazar para o cliente | apenas `*.server.ts` + leitura dentro do handler; proibido `VITE_` |
| Divergência de types após migration | regenerar types só depois da migration aprovada |

## 6. Critérios de aceite

- `bunx tsgo --noEmit` limpo; `bunx vitest run` com 33/33 arquivos passando.
- Recebimento, triagem, contagem, devoluções, auditoria, histórico e bipagem inalterados (testes de caracterização atuais verdes).
- `send_status` de todo evento nasce `NAO_ENVIAR`; zero chamadas de rede à API oficial nesta fase.
- Worker/AdminML e OAuth `authorization_code` intocados.

## 7. Parada para autorização

Nada será alterado até você autorizar. Preciso saber: (a) aplico o P0 de correção dos 3 testes quebrados? (b) autoriza mover o SQL de `supabase/propostas/` para uma migration real e aplicá-la em homologação?
