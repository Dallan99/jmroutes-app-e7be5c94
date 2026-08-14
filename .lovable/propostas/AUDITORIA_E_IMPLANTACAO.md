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
- `src/lib/meli-import-bruto.ts` — `enviarRotaParaStagingComClient()` (normaliza e
  grava no staging; não toca tabelas ativas).

Frontend
- `src/lib/meli-sync.functions.ts` — campos opcionais `sincronizando` / `lote_ativo`.
- `src/components/meli-sync-monitor.tsx` — componente `SeloSincronizando`.
- `src/components/dashboard-geral.tsx` — selo “Sincronizando nova atualização”
  no card de cada base (números continuam sendo do último lote completo).

Worker (`worker/meli`)
- `src/config.ts` — flag `SYNC_PROTOCOL_LOTES` (**default false**) → `cfg.protocoloLotes`.
- `src/pipeline/ciclo-lote.ts` **(novo)** — iniciar/finalizar/abandonar ciclo,
  `dataOperacionalBrt()`, `estadoParaFinalizacao()`.
- `src/pipeline/send.ts` — envia `sync_batch_id` quando houver; entende `503`.
- `src/pipeline/cycle.ts` — aceita `syncBatchId`; sinaliza `protocoloLotesIndisponivel`.
- `src/index.ts` — com a flag ligada: inicia o ciclo, envia as rotas ao staging e
  finaliza. Se o backend recusar o protocolo, abandona o ciclo e **reexecuta no
  fluxo legado** no mesmo intervalo.
- `.env.example` — `SYNC_PROTOCOL_LOTES=false`.

Testes
- `tests/characterization/meli-sync-lotes.test.ts` **(novo)** — 21 casos.

SQL proposto (não aplicado)
- `.lovable/propostas/meli_sync_lotes.sql`
- `.lovable/propostas/meli_leitura_lote_ativo.sql`

## 2. Resultado das verificações

| Verificação | Resultado |
| --- | --- |
| `tsgo --noEmit` (app) | 0 erros |
| `vitest run` (app) | **121 testes / 13 arquivos — todos passando** |
| `vitest run` (worker/meli) | 21 testes / 3 arquivos — todos passando |
| `bun run build` | ✔ build + nitro gerados |
| `tsc` worker | 3 erros pré-existentes de tipos do `playwright` (dependência não instalada neste sandbox); nenhum relacionado a esta entrega |

Cobertura do novo teste: reenvio idempotente da mesma rota/pacotes; zero
alteração nas tabelas ativas antes da finalização; falha após várias rotas
preservando o snapshot anterior; concorrência de dois ciclos da mesma base/dia;
isolamento por base; visibilidade só do lote concluído e ativo (view); UUID
reutilizado com parâmetros divergentes; promoção transacional e idempotente;
contagem por identificadores distintos; abandono e limpeza de staging.

## 3. Auditoria do SQL proposto

Conforme
- **Staging real e isolado**: `meli_sync_rotas_staging` (PK `sync_batch_id, route_id`)
  e `meli_sync_pacotes_staging` (PK `sync_batch_id, tracking_id`, FK composta para
  o staging de rotas com `ON DELETE CASCADE`). Nenhum `INSERT/UPDATE/DELETE` em
  `meli_rotas`/`meli_pacotes` durante a construção.
- **RLS**: habilitada nas três tabelas novas; políticas apenas de `SELECT` para
  `authenticated`, restritas por `has_role(admin)` ou `has_base_access`. Escrita
  exclusivamente pelas RPCs `SECURITY DEFINER`.
- **ACLs**: `REVOKE ALL … FROM PUBLIC, anon` em todas as tabelas, na view e em
  todas as funções novas/recriadas; `GRANT` mínimo (`SELECT` para `authenticated`,
  `ALL` para `service_role`). `_meli_sync_marcar` fica sem `EXECUTE` para
  `authenticated` (uso interno).
- **SECURITY DEFINER + `search_path`**: todas as 16 funções declaram
  `SET search_path TO 'public'`; todas checam `auth.uid()`, `meli_pode_operar()` e
  `has_base_access` antes de qualquer escrita.
- **View**: `meli_rotas_ativas` criada com `WITH (security_invoker = true)` — a RLS
  do chamador continua valendo.
- **FKs e índices**: `meli_sync_ciclos.base_id → bases(id)`; índice único parcial
  `(base_id, data_operacional) WHERE ativo` garante um único lote ativo por
  base/dia; índice `(base_id, data_operacional, estado)`; `meli_rotas.sync_batch_id`
  indexado.
- **Atomicidade**: `meli_sync_ciclo_finalizar` roda sob
  `pg_advisory_xact_lock(hashtext(base||dia))`; valida tudo **antes** de promover;
  qualquer falha usa `RAISE EXCEPTION`, o que desfaz a transação inteira e mantiver
  o lote anterior ativo. Reexecução é idempotente.

Ajuste feito nesta rodada
- **Reconciliação dos pacotes removidos** (lacuna encontrada na auditoria): o
  upsert de promoção não removia pacote que o Meli deixou de listar. Adicionado à
  promoção, na mesma transação: pacotes ausentes do snapshot são apagados, e
  antes disso o vínculo `escalas.meli_pacote_id` é desfeito **somente** quando a
  escala não está recebida nem triada. Pacote com vínculo operacional nunca é
  apagado.

Observações registradas (sem bloqueio)
- A promoção reaproveita `meli_importar_rota` intencionalmente: ela é chamada
  apenas na finalização, dentro da transação da RPC e depois de todas as
  validações. Nenhuma sessão externa vê estado intermediário, e o ponteiro do
  lote ativo só muda no commit.
- `meli_sync_staging_limpar` remove apenas staging de ciclos não promovidos.
- `meli_sync_status_bases()` já expõe `sincronizando`, que alimenta o selo.

## 4. Plano de implantação (ordem obrigatória)

1. Publicar este código (protocolo desligado). A extensão Chrome e o worker
   continuam no fluxo legado — nada muda em produção.
2. Aplicar `meli_sync_lotes.sql` (infra + RPCs de ciclo).
3. Aplicar `meli_leitura_lote_ativo.sql` (as 9 RPCs de leitura passando a ler a
   view do lote ativo).
4. Conferir: linter Supabase, `meli_sync_lotes_status()` e o Dashboard exibindo os
   mesmos números de antes.
5. Ligar `SYNC_PROTOCOL_LOTES=true` **apenas na base piloto ESP16** e reiniciar o
   worker; acompanhar um ciclo completo (selo aparece durante a construção e os
   números só mudam ao final).
6. Só então avaliar as demais bases.

## 5. Plano de rollback

- **Etapa 5** — `SYNC_PROTOCOL_LOTES=false` + restart do worker. Volta
  instantaneamente ao fluxo legado; nada a desfazer no banco.
- **Etapa 3** — reaplicar as definições originais das 9 RPCs (capturadas via
  `pg_get_functiondef` e preservadas no cabeçalho de `meli_leitura_lote_ativo.sql`),
  que voltam a ler `meli_rotas` direto.
- **Etapa 2** — `DROP VIEW public.meli_rotas_ativas;` e `DROP` das funções e das
  três tabelas novas. `meli_rotas.sync_batch_id` pode ficar (aditiva e ignorada).
- **Etapa 1** — reverter o deploy do código. Os campos novos são opcionais, então
  o fluxo legado nunca depende deles.

## 6. Confirmação

O protocolo novo fica **desligado** até a migration ser aplicada:

- `SYNC_PROTOCOL_LOTES` ausente ou diferente de `true` ⇒ `cfg.protocoloLotes = false`
  ⇒ o worker nunca chama `/api/public/meli/ciclo` e nunca envia `sync_batch_id`.
- Sem `sync_batch_id`, `/api/public/meli/importar-rota-bruta` executa exatamente o
  caminho atual.
- Mesmo com a flag ligada por engano antes da migration, o backend responde `503`
  `protocolo_indisponivel`, o worker abandona o ciclo e reprocessa no fluxo legado.
- O selo “Sincronizando nova atualização” só aparece quando
  `meli_sync_status_bases()` retornar `sincronizando = true`, o que exige a migration.
