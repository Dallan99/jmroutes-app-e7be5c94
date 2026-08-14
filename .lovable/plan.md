# Sincronização Meli — staging isolado + promoção transacional (revisão 2)

Nada será aplicado no banco nesta etapa. Este documento é o desenho para autorização.

## 1. Constraints atuais das tabelas ativas

`public.meli_rotas`
- PK `id`; **UNIQUE (route_id)** — uma linha por rota, para todos os lotes;
- FK `base_id → bases(id)`; FK `origem_importacao → meli_importacoes(id) ON DELETE SET NULL`;
- CHECK `origem_area_risco`; índices por base/data, cluster, status, risco, driver, placa, last_synced_at.

`public.meli_pacotes`
- PK `id`; **UNIQUE (rota_id, tracking_id)**;
- FK `rota_id → meli_rotas(id) ON DELETE CASCADE`;
- CHECK `origem_area_risco`; índices por rota, tracking, shipment, status, ocorrência, risco.

Dependências externas que travam a ideia de versionar linha por lote nas tabelas ativas:
`escalas.meli_pacote_id → meli_pacotes(id)`, `meli_devolucoes.rota_id → meli_rotas(id)`,
`meli_rotas_payload.rota_id → meli_rotas(id)`. Manter várias versões da mesma rota em
`meli_rotas` exigiria remover `UNIQUE (route_id)` e reescrever essas FKs, o pipeline
operacional (Triagem/Recebimento/Devoluções) e a publicação em `escalas`.

**Decisão:** o versionamento fica no staging. As tabelas ativas continuam com uma linha por
rota/pacote e recebem o snapshot **apenas dentro da transação de promoção**. Durante toda a
construção do lote não há INSERT/UPDATE/DELETE em `meli_rotas`/`meli_pacotes`.
`sync_batch_id_pendente` deixa de existir no desenho.

## 2. Tabelas de staging (isoladas, versionadas por lote)

```sql
CREATE TABLE public.meli_sync_rotas_staging (
  sync_batch_id uuid NOT NULL
    REFERENCES public.meli_sync_ciclos(sync_batch_id) ON DELETE CASCADE,
  route_id text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_rota date,
  payload_normalizado jsonb NOT NULL,   -- rota já normalizada (sem stops)
  raw_payload jsonb NOT NULL,           -- payload bruto, para meli_rotas_payload
  total_pacotes integer NOT NULL DEFAULT 0,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, route_id)
);

CREATE TABLE public.meli_sync_pacotes_staging (
  sync_batch_id uuid NOT NULL,
  route_id text NOT NULL,
  tracking_id text NOT NULL,
  ordem integer,
  payload_normalizado jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, tracking_id),
  FOREIGN KEY (sync_batch_id, route_id)
    REFERENCES public.meli_sync_rotas_staging (sync_batch_id, route_id) ON DELETE CASCADE,
  FOREIGN KEY (sync_batch_id)
    REFERENCES public.meli_sync_ciclos (sync_batch_id) ON DELETE CASCADE
);
```

`meli_sync_ciclos` (ponteiro do lote): `sync_batch_id` PK, `base_id`, `data_operacional`,
`origem`, `estado` (`em_processamento|concluido|parcial|erro|abandonado`), `rotas_esperadas`,
`rotas_recebidas`, `pacotes_recebidos`, `ativo`, `mensagem`, `iniciado_em`, `finalizado_em`,
`created_at/updated_at`, `UNIQUE (base_id, data_operacional) WHERE ativo`.

`meli_rotas` recebe **apenas** `sync_batch_id uuid` (lote que publicou a linha) + índice.

Segurança das três tabelas: `GRANT SELECT` a `authenticated`, `GRANT ALL` a `service_role`,
`REVOKE ALL` de `anon` e `PUBLIC`, RLS ligada com política de leitura
`has_role(admin) OR has_base_access(auth.uid(), base_id)`. Escrita só pelas RPCs `SECURITY DEFINER`.

## 3. Fluxo transacional

```text
worker                          banco
──────                          ─────
ciclo_iniciar(uuid, base, data) → INSERT ciclo em_processamento
                                  (mesmo uuid com base/data/origem diferente = erro)
importar_rota(uuid, payload)    → valida ciclo em_processamento, base da rota = base do ciclo,
                                  data da rota = data operacional, has_base_access do usuário
                                → normaliza e grava SOMENTE no staging (upsert por chave composta)
                                → atualiza contadores do ciclo (rotas/pacotes distintos)
                                  (zero escrita em meli_rotas / meli_pacotes)
ciclo_finalizar(uuid, ...)      → pg_advisory_xact_lock(base, data)
                                  valida ciclo/base/data/rotas distintas/pacotes distintos
                                  rejeita estado parcial|erro (fica isolado no staging)
                                  ── única transação ──────────────────────────────
                                    upsert meli_rotas  (stamp sync_batch_id = uuid)
                                    upsert meli_pacotes + upsert meli_rotas_payload
                                    meli_publicar_rota_operacional por rota promovida
                                    ciclo anterior.ativo = false; ciclo atual.ativo = true
                                  ─────────────────────────────────────────────────
                                → só após o COMMIT o snapshot aparece nas consultas
```

Falha em qualquer ponto da promoção = `ROLLBACK`: ponteiro antigo intacto, snapshot antigo
intacto, staging preservado para diagnóstico.

## 4. RPCs (SQL completo na migration, escritas à mão)

Novas: `meli_sync_ciclo_iniciar`, `meli_sync_rota_staging` (importação vinculada ao ciclo),
`meli_sync_ciclo_finalizar`, `meli_sync_lotes_status`, `meli_sync_ciclo_abandonar`,
`meli_sync_staging_limpar(p_dias integer)`.

Regras exigidas já incorporadas:
- `iniciar`: idempotente só para parâmetros equivalentes; base/data/origem divergentes com o
  mesmo UUID → `{status:'erro', erro:'uuid_reutilizado_divergente'}`; ciclo já encerrado não reabre.
- `staging`: exige `meli_pode_operar()` + `has_base_access(auth.uid(), base_do_ciclo)`, ciclo
  `em_processamento`, base da rota igual à base do ciclo, `data_rota` igual à `data_operacional`;
  grava com `INSERT ... ON CONFLICT (sync_batch_id, route_id / tracking_id) DO UPDATE`.
- `finalizar`: advisory lock por `base_id + data_operacional`; validações de base, data,
  `count(DISTINCT route_id)` e `count(DISTINCT tracking_id)` contra os valores declarados;
  `p_estado <> 'concluido'` → grava `parcial|erro`, não promove, não altera `ativo`;
  reexecução com ciclo já `concluido` → `{status:'ok', idempotente:true}` sem reescrever nada.
- `abandonar`/`limpar`: marcam `abandonado` e removem **apenas** linhas de staging de ciclos
  não promovidos com mais de N dias. Nunca tocam dados operacionais, nunca promovem.
- Todas: `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE` a `authenticated` e `service_role`.

## 5. Consultas operacionais (reescritas uma a uma, sem automação)

Sem `pg_get_functiondef`/`regexp_replace`. Cada RPC é recriada explicitamente com o corpo atual
revisado e a fonte de rotas trocada pela view do lote ativo:

```sql
CREATE VIEW public.meli_rotas_ativas WITH (security_invoker = true) AS
SELECT r.* FROM public.meli_rotas r
WHERE r.sync_batch_id IS NULL          -- histórico anterior ao lote (comportamento atual)
   OR EXISTS (SELECT 1 FROM public.meli_sync_ciclos c
              WHERE c.sync_batch_id = r.sync_batch_id AND c.ativo AND c.estado = 'concluido');
```

Com `security_invoker = true` a view aplica as políticas de `meli_rotas` no papel do chamador,
mantendo o RLS por base efetivo; privilégios explícitos: `GRANT SELECT` a `authenticated` e
`service_role`, `REVOKE ALL` de `anon`/`PUBLIC`.

RPCs recriadas: `meli_dashboard_operacional`, `meli_dashboard_pacotes_rota`, `meli_detalhar_rota`,
`meli_listar_rotas`, `meli_rotas_area_risco`, `meli_devolucoes_sincronizar`, `devolucao_lote_bipar`,
`meli_sync_status`, `meli_sync_status_bases`. Não mudam: `meli_importar_rota` (2 argumentos,
uso manual/histórico), `meli_publicar_rota_operacional`, `meli_rota_estado_operacional`,
`meli_rota_pm_excluida`, `meli_devolucoes_painel`, `meli_devolucao_receber`.

## 6. Worker e compatibilidade

| Arquivo | Mudança |
| --- | --- |
| `worker/meli/src/pipeline/cycle.ts` | O `batchId` já gerado por ciclo passa a abrir o ciclo antes da primeira rota e finalizar após a última, com totais de rotas/pacotes distintos. |
| `worker/meli/src/pipeline/send.ts` | Envia `sync_batch_id` no corpo e ganha `abrirCiclo()` / `finalizarCiclo()` chamando o novo endpoint. |
| `src/routes/api/public/meli/ciclo.ts` (novo) | `POST` com `acao: "iniciar" \| "finalizar" \| "abandonar"`, mesmo esquema de CORS/Bearer do endpoint atual. |
| `src/routes/api/public/meli/importar-rota-bruta.ts` | Aceita `sync_batch_id` opcional. **Com** lote → staging; **sem** lote → caminho atual, inalterado (extensão Chrome v0.3.1 e envio manual continuam funcionando). |
| `src/lib/meli-import-bruto.ts` | Repassa `sync_batch_id` e escolhe a RPC de staging quando presente. |
| `src/lib/meli-sync.functions.ts` | `meliSyncCicloIniciar`, `meliSyncCicloFinalizar`, `meliSyncLotesStatus`. |
| `src/components/dashboard-geral.tsx`, `src/routes/tv.meli.tsx` | Selo "Sincronizando nova atualização", mantendo os números do lote ativo. |
| `src/lib/meli-sync-lotes.ts` | Regras puras espelhando as RPCs (já criado, será ajustado para staging). |

## 7. Testes (`tests/characterization/meli-sync-lotes.test.ts`)

1. leitura do lote ativo enquanto outro ciclo regrava a mesma rota e os mesmos pacotes no staging;
2. zero alteração nas tabelas ativas antes da finalização;
3. falha após várias rotas preservando integralmente o snapshot anterior;
4. concorrência entre dois ciclos da mesma base/data (advisory lock: um promove, o outro não);
5. isolamento por base (ESP15–ESP18) e RLS por base;
6. view criada com `security_invoker = true` e sem privilégio para `anon` (asserção sobre o SQL);
7. UUID reutilizado com base/data/origem divergentes é rejeitado;
8. promoção transacional e idempotente (segunda finalização não altera nada);
9. contagem por identificadores distintos (`route_id`/`tracking_id` repetidos não inflam totais);
10. Dashboard, Bases, Modo TV, risco e devoluções lendo o mesmo lote ativo.

Depois: typecheck, suíte completa e build. A migration só é enviada para aprovação após seu aval.
