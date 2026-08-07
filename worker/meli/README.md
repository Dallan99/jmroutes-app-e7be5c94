# Worker Meli 24/7 — Piloto (Fase B1)

Serviço externo que mantém a sincronização do AdminML mesmo com o computador
pessoal e a extensão desligados. **Fase B1 é apenas implementação técnica**:
sem deploy, sem publicação e sem migration aplicada.

- Base piloto: **ESP16 — Guarujá**
- Service Center: **SSP15**
- Site: **MLB**
- A extensão Chrome **v0.3.1 permanece como fallback** e não foi alterada.

## O que o worker faz (e o que ele NÃO faz)

Faz:

1. abre uma sessão AdminML previamente autenticada (storageState cifrado);
2. consulta a lista de rotas da ESP16/SSP15 (`get-routes-list`, paginado);
3. consulta o detalhe de cada rota (`monitoring-route/route-detail`);
4. envia o **payload bruto** para `POST /api/public/meli/importar-rota-bruta`;
5. registra a telemetria do ciclo via RPC dedicada.

Não faz (permanece 100% no JMRoutes, sem duplicação):

- normalização (`src/lib/meli-normalize.ts`);
- ingestão/upsert (`src/lib/meli-import-bruto.ts`, RPC `meli_importar_rota`);
- publicação operacional (RPC `meli_publicar_rota_operacional`);
- classificação de status (RPC `meli_status_normalizado`, `src/lib/meli-status.ts`);
- área de risco, Recebimento, Triagem, Dashboard (`meli_dashboard_operacional`).

## Estrutura

```text
worker/meli/
  src/index.ts              loop sem sobreposição (ciclo -> telemetria -> espera)
  src/config.ts             env + travas do piloto (recusa base != ESP16)
  src/logger.ts             logs JSON com redação obrigatória
  src/crypto.ts             AES-256-GCM (nonce 12 | ciphertext | tag 16)
  src/session/store.ts      leitura/escrita da sessão cifrada
  src/session/login.ts      login manual headful (operador digita MFA)
  src/meli/list.ts          lista paginada + retry/backoff/Retry-After
  src/meli/detail.ts        detalhe bruto da rota (sem transformar)
  src/meli/active-filter.ts prioridade de rotas ativas + incremental
  src/pipeline/auth.ts      transporte AdminML + sessão Supabase (Bearer)
  src/pipeline/send.ts      envio ao endpoint existente (origem: worker)
  src/pipeline/cycle.ts     um ciclo completo, concorrência 1
  src/state/breaker.ts      circuit breaker
  src/telemetry/report.ts   RPC meli_worker_registrar_execucao
  scripts/auth.ts           autenticação manual (uso local, com display)
```

O worker está **fora do build e do deploy do frontend**: não é referenciado por
`src/`, não entra no `tsconfig.json` do app, nem no `vitest.config.ts` da raiz.

## Variáveis

Ver `.env.example`. Obrigatórias: `JMR_BASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `WORKER_EMAIL`, `WORKER_PASSWORD`, `WORKER_SESSION_KEY`,
`SESSION_FILE_PATH`, `SYNC_INTERVAL_SECONDS`, `BASE_CODE=ESP16`,
`SERVICE_CENTER_ID=SSP15`, `SITE_ID=MLB`.

`service_role` **não** é usado em nenhuma etapa.

## Sessão AdminML

Autenticação manual: `npm run auth` abre o navegador visível; o operador faz
login e MFA. Ao detectar sessão válida, o `storageState` é cifrado em
AES-256-GCM (AAD `meli-storage-state:v1`) e gravado em volume (`/data`).
A sessão é decifrada somente em memória.

Nunca: senha salva, cookies logados, storageState enviado ao Supabase ou ao
frontend, sessão versionada no GitHub.

Sem sessão válida → status `aguardando_autenticacao`, sem crash loop e sem
chamadas em sequência. Em 401/403 → circuit breaker aberto, status
`sessao_expirada`, aguardando nova autenticação manual.

## Ciclo

`executar ciclo -> registrar telemetria -> aguardar 60s -> próximo ciclo`.
Não há `setInterval`; o intervalo só começa após o término do ciclo,
portanto não existe sobreposição. Concorrência de coleta: 1, com jitter.

## Sistema XPT existente

A empresa possui um sistema operacional próprio em
<https://xpt.jmtransportes.tech/>. Nenhuma credencial desse sistema foi
acessada e nenhum código dele foi copiado.

O worker é modular justamente para esse cenário: a coleta depende apenas da
interface `MeliTransport` (`src/meli/list.ts`). Se for identificado que o XPT
já possui coleta Meli server-side, basta:

- substituir a implementação Playwright (`transportDeRequestContext`) por um
  cliente do endpoint corporativo autorizado;
- manter `pipeline/send.ts`, `pipeline/cycle.ts`, telemetria, breaker e
  incremental sem alteração;
- manter integralmente o pipeline de ingestão/normalização do JMRoutes.

## Passos manuais do piloto (após autorização)

1. aplicar a migration de telemetria (`.lovable/fase-b1/migration_meli_worker_execucoes.sql`);
2. criar o usuário técnico dedicado com perfil autorizado a importar;
3. gerar `WORKER_SESSION_KEY` e guardá-la no cofre de secrets;
4. rodar `npm run auth` localmente e transferir o arquivo cifrado para o volume;
5. `docker build` e execução com volume `/data`;
6. acompanhar `meli_worker_execucoes` durante 4–6 horas.

## DRY_RUN (validação sem tocar o banco)

`DRY_RUN=true`:

- consulta o AdminML (lista + detalhe);
- **não** chama `POST /api/public/meli/importar-rota-bruta`;
- **não** grava telemetria e não altera nenhuma tabela;
- **não** persiste payload completo;
- **não** exige `WORKER_EMAIL`/`WORKER_PASSWORD` (usuário técnico ainda não existe);
- sem sessão AdminML cifrada disponível, **não tenta login automático**: apenas
  registra o motivo e aguarda o próximo intervalo;
- ao fim de cada ciclo registra apenas o resumo: `rotas_encontradas`,
  `rotas_ativas`, `rotas_consultadas`, `pacotes_encontrados`, `duracao_ms`, `erros`.

## Operação (piloto, ainda sem deploy)

- Startup: `npm run build && node dist/index.js` (imagem: `CMD ["node","dist/index.js"]`).
- Autenticação manual (headful, uma vez): `npm run auth`.
- Volume de sessão: `/data`, arquivo `SESSION_FILE_PATH=/data/adminml-session.enc`.
- Memória mínima recomendada: **512 MB** (1 GB confortável, Chromium headless, concorrência 1).
- Imagem base `mcr.microsoft.com/playwright:v1.49.1-jammy`: ~1,6–2,0 GB descompactada.
