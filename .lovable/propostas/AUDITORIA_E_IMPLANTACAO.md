# Sincronização Meli — publicação atômica por lote

Entrega de CÓDIGO apenas. Nenhuma migration aplicada, nenhum dado operacional
alterado, nada publicado. Protocolo novo **desligado** por configuração.

## 1. Arquivos alterados / criados

Backend (TanStack server routes)
- `src/lib/meli-api-http.ts` **(novo)** — CORS, JSON, validação de UUID, Bearer e
  cliente Supabase agindo como o usuário (RLS aplicada; nunca service_role).
- `src/routes/api/public/meli/ciclo.ts` **(novo)** — `POST` com
  `acao = iniciar | finalizar | abandonar`. Só transporte + validação de forma;
  toda a regra fica nas RPCs. Sem as RPCs no banco responde `503`
  `protocolo_indisponivel`.
- `src/routes/api/public/meli/importar-rota-bruta.ts` — passa a aceitar
  `sync_batch_id` (opcional). Com o campo, a rota vai **somente** para o staging
  (`meli_sync_rota_staging`). Sem o campo, o fluxo legado segue byte a byte igual.
- `src/lib/meli-import-bruto.ts` — `enviarRotaParaStagingComClient()`.

Frontend
- `src/lib/meli-sync.functions.ts` — campos opcionais `sincronizando` / `lote_ativo`.
- `src/components/meli-sync-monitor.tsx` — componente `SeloSincronizando`.
- `src/components/dashboard-geral.tsx` — selo “Sincronizando nova atualização”.

Worker (`worker/meli`)
- `src/config.ts` — flag `SYNC_PROTOCOL_LOTES` (**default false**).
- `src/pipeline/ciclo-lote.ts` **(novo)** — iniciar/finalizar/abandonar ciclo.
- `src/pipeline/send.ts` — envia `sync_batch_id` quando houver; entende `503`.
- `src/pipeline/cycle.ts` — aceita `syncBatchId`; sinaliza `protocoloLotesIndisponivel`.
- `src/index.ts` — abre ciclo, envia ao staging, finaliza; fallback legado no `503`.
- `.env.example` — `SYNC_PROTOCOL_LOTES=false`.

Testes
- `tests/characterization/meli-sync-lotes.test.ts` **(novo)** — 21 casos.

SQL proposto (não aplicado)
- `.lovable/propostas/20260814150500_meli_sync_lotes_publicacao_atomica.sql`
  (migration definitiva consolidada, 1.380 linhas)
- `.lovable/propostas/meli_sync_lotes.sql` (Parte A, 544 linhas)
- `.lovable/propostas/meli_leitura_lote_ativo.sql` (Parte B, 826 linhas)
- `.lovable/propostas/DIFF_RPCS_LEITURA.diff`

## 2. Comandos e resultados das verificações

| O que | Comando exato | Resultado |
| --- | --- | --- |
| Typecheck do app | `cd /dev-server && tsgo --noEmit` | 0 erros |
| Testes do app | `cd /dev-server && bunx vitest run` | 121 testes / 13 arquivos — todos passando |
| Build do app | `cd /dev-server && bun run build` | ✔ build + nitro |
| Typecheck do worker | `cd /dev-server/worker/meli && npm run typecheck` (`tsc --noEmit`) | **0 erros** após `npm ci` |
| Testes do worker | `cd /dev-server/worker/meli && npx vitest run` | 21 testes / 3 arquivos — todos passando |
| Advisors Supabase | linter do projeto (somente leitura) | 33 WARN, 0 ERROR (baseline atual) |

### Esclarecimento da “regressão” do worker

- **Nenhum teste deixou de existir ou de executar.** `worker/meli/tests/` tem 3
  arquivos: `coleta.test.ts` (11), `crypto-logger.test.ts` (7), `dry-run.test.ts` (3)
  = **21 casos**, todos executados, nenhum `skip`/`todo`.
- `git log -- worker/meli/tests` mostra que o último commit a tocar em testes do
  worker é `f7393dd`/`9b82fcf` (07/08, `dry-run.test.ts`), **antes** desta entrega.
  O diff desta entrega (`git diff HEAD~5 HEAD -- worker/meli`) altera apenas
  `.env.example`, `config.ts`, `index.ts`, `pipeline/ciclo-lote.ts` (novo),
  `pipeline/cycle.ts`, `pipeline/send.ts` — nenhum arquivo de teste.
- Portanto o total de 24 do baseline não corresponde a casos existentes hoje no
  repositório; não há teste removido por esta entrega. Se o baseline de 24 vier de
  outra árvore (ZIP local), preciso do arquivo para comparar.
- Os 3 erros de TypeScript eram **ambientais**: `worker/meli/node_modules` não
  existia neste sandbox, então `playwright` (dependência declarada) não resolvia.
  Erros exatos:
  1. `src/pipeline/auth.ts(6,49): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.`
  2. `src/pipeline/auth.ts(73,37): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.`
  3. `src/session/login.ts(19,37): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.`
  Após `npm ci --ignore-scripts` em `worker/meli`, `npm run typecheck` fica limpo.
  Nenhum código do worker foi alterado para resolver isso.

## 3. Auditoria do SQL proposto

Conforme
- **Staging real e isolado**: `meli_sync_rotas_staging` (PK `sync_batch_id, route_id`)
  e `meli_sync_pacotes_staging` (PK `sync_batch_id, tracking_id`, FK composta
  `ON DELETE CASCADE`). Nada é escrito em `meli_rotas`/`meli_pacotes` durante a
  construção do lote.
- **RLS**: habilitada nas três tabelas novas; apenas `SELECT` para `authenticated`
  restrito por `has_role(admin)` ou `has_base_access`. Escrita só via RPCs
  `SECURITY DEFINER`.
- **ACLs**: `REVOKE ALL … FROM anon, PUBLIC` nas tabelas, na view e em todas as
  funções novas/recriadas; `GRANT` mínimo. `_meli_sync_marcar` sem `EXECUTE` para
  `authenticated`.
- **`search_path`**: todas as funções com `SET search_path`; todas validam
  `auth.uid()`, `meli_pode_operar()` e `has_base_access` antes de escrever.
- **View**: `meli_rotas_ativas` com `WITH (security_invoker = true)` — a RLS do
  chamador continua valendo.
- **Índices/FKs**: `meli_sync_ciclos.base_id → bases(id)`; único parcial
  `(base_id, data_operacional) WHERE ativo`; `(base_id, data_operacional, estado)`;
  `meli_rotas(sync_batch_id)`.
- **Atomicidade**: `meli_sync_ciclo_finalizar` sob
  `pg_advisory_xact_lock(hashtext(base||dia))`, valida antes de promover e usa
  `RAISE EXCEPTION` em qualquer falha (rollback total, lote anterior intacto).

Ajuste desta rodada
- **Reconciliação dos pacotes removidos**: na promoção, pacotes ausentes do
  snapshot são apagados; antes disso o vínculo `escalas.meli_pacote_id` é desfeito
  **somente** quando a escala não está recebida nem triada, e o `DELETE` exige
  `NOT EXISTS` de escala vinculada. Pacote recebido/triado nunca é apagado.

## 4. Advisors de segurança

Baseline atual (antes da migration): **33 WARN, 0 ERROR** —
32× `0029_authenticated_security_definer_function_executable` (padrão do projeto:
toda regra de negócio vive em RPC `SECURITY DEFINER` chamada por usuário logado) e
1× `Leaked Password Protection Disabled` (configuração de Auth, fora do escopo).
Depois da migration a expectativa é o mesmo perfil, com o WARN 0029 somando as
funções novas; **nenhum ERROR novo** — em especial nada de “Security Definer View”,
porque a view usa `security_invoker = true`, e nada de “RLS Disabled in Public”,
porque as três tabelas novas têm RLS habilitada. Reexecutar os advisors no passo 4
do plano de implantação.

## 5. Plano de implantação (ordem obrigatória)

1. Publicar este código (protocolo desligado) — nada muda em produção.
2. Aplicar a Parte A (staging + view + RPCs de ciclo).
3. Aplicar a Parte B (9 RPCs de leitura via lote ativo).
4. Conferir advisors, `meli_sync_lotes_status()` e os números do Dashboard.
5. Ligar `SYNC_PROTOCOL_LOTES=true` só na ESP16 e acompanhar um ciclo completo.
6. Só então avaliar as demais bases.

## 6. Plano de rollback

- **Etapa 5** — `SYNC_PROTOCOL_LOTES=false` + restart do worker. Volta ao fluxo
  legado na hora; nada a desfazer no banco.
- **Etapa 3** — reaplicar as 9 definições originais (capturadas com
  `pg_get_functiondef`), que voltam a ler `meli_rotas` direto.
- **Etapa 2** — `DROP VIEW public.meli_rotas_ativas;` + `DROP` das funções e das 3
  tabelas novas. `meli_rotas.sync_batch_id` pode ficar (aditiva e ignorada).
- **Etapa 1** — reverter o deploy. Todos os campos novos são opcionais.

Nenhuma etapa do rollback apaga dado operacional de `meli_rotas`, `meli_pacotes`,
`escalas`, `devolucoes` ou `devolucao_lotes`.

## 7. Compatibilidade — cenários

**Migration aplicada, código antigo ainda em produção.** O worker/extensão antigos
nunca enviam `sync_batch_id`, então as rotas continuam entrando por
`meli_importar_rota` com `sync_batch_id = NULL`. A view inclui explicitamente
`sync_batch_id IS NULL`, logo tudo permanece visível e os números do painel não
mudam. O frontend antigo simplesmente ignora os campos `sincronizando`/`lote_ativo`
do JSON (não há selo, sem erro).

**Endpoint novo retorna erro diferente de `503 protocolo_indisponivel`.** Não há
fallback silencioso — o ciclo falha de forma segura:
- `iniciar` com erro ⇒ `syncBatchId` fica nulo ⇒ o ciclo roda inteiro no fluxo
  legado, como hoje.
- `401` durante o ciclo ⇒ `sem_sessao`: o worker descarta a sessão JMRoutes,
  renova no próximo ciclo; o staging fica isolado e o lote ativo intacto.
- `429` ⇒ `rate_limit`: espera 60s e conta erro.
- qualquer outro erro/JSON inválido ⇒ conta erro; `estadoParaFinalizacao()` fecha o
  ciclo como `parcial`/`erro`, a RPC **rejeita a promoção**, o staging permanece
  isolado e o ponteiro do lote ativo não muda. Nada aparece no painel.
- `503`/`codigo = protocolo_indisponivel` (único caso de fallback) ⇒ abandona o
  ciclo e reexecuta no fluxo legado no mesmo intervalo.

## 8. Confirmação de que o protocolo está desligado

- `SYNC_PROTOCOL_LOTES` ausente ou ≠ `true` ⇒ o worker nunca chama
  `/api/public/meli/ciclo` e nunca envia `sync_batch_id`.
- Sem `sync_batch_id`, `/api/public/meli/importar-rota-bruta` executa exatamente o
  caminho atual.
- Ligada por engano antes da migration ⇒ `503` ⇒ abandono + fluxo legado.
- O selo só aparece quando `meli_sync_status_bases()` devolver
  `sincronizando = true`, o que exige a migration.
