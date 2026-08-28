# Integração Meli — Arquitetura (P0)

## 1. Fronteira atual (como os dados chegam hoje)

```text
Worker AdminML (worker/meli, fora do escopo desta entrega)
  -> payload bruto (POST /api/public/meli/importar-rota-bruta, /api/public/meli/ciclo)
  -> normalização (src/lib/meli-normalize.ts, meli-import-bruto.ts)
  -> staging (meli_sync_rotas_staging / meli_sync_pacotes_staging)
  -> promoção transacional -> meli_rotas / meli_pacotes (+ meli_rotas_payload)
  -> publicação operacional -> escalas (meli_publicar_rota_operacional)
  -> fluxos físicos JM: recebimento -> triagem -> devolução/romaneio
```

Invariante preservada: a sincronização Meli **nunca** altera estados físicos JM
(recebimento, triagem, devolução). A rota é identificada por `routeId`.

## 2. Dois OAuth distintos

| Fluxo | Onde | Uso |
| --- | --- | --- |
| `authorization_code` + `refresh_token` | `src/lib/meli-api.server.ts`, `meli_api_conexoes`, `src/lib/meli-oauth.functions.ts` | Fluxo **atual e em produção**. Não foi tocado. |
| `client_credentials` | `src/lib/meli-integration/oauth-client-credentials.server.ts` | **Novo, isolado, sem consumidor.** Preparação para a API oficial de carrier. Requer `audience` por chamada, cache/dedupe por audience, `MELI_TOKEN_URL` configurável. |

## 3. Inbound vs outbound

- **Inbound (webhook)**: `meli_api_notificacoes` + `src/routes/api/public/meli/notificacoes.ts` — recebe notificações do Meli. Inalterado.
- **Outbound (outbox)**: `public.meli_tracking_eventos` — nova tabela que **registra** eventos internos para eventual envio futuro. Nenhum dispatcher existe; todo evento nasce com `status_envio = 'NAO_ENVIAR'`.

Eventos internos fechados (7): `RECEBIDO_BASE`, `TRIADO`, `CARREGADO`,
`SAIU_ENTREGA`, `ENTREGUE`, `INSUCESSO`, `DEVOLUCAO`.

## 4. Entregue no P0

- `src/lib/meli-integration/contracts.ts` — modelo canônico (`CanonicalMeliRoute`, `CanonicalMeliPackage`, `IntegrationSource`, contratos de adapter/source). Puro, sem imports operacionais.
- `src/lib/meli-integration/tracking-events.ts` — tipos/constantes dos eventos e status de envio. Sem side effects.
- `src/lib/meli-integration/oauth-client-credentials.server.ts` — cliente `client_credentials` server-only, desligado.
- `supabase/migrations/20260826235641_meli_integration_p0_fundacao.sql` — migration **aditiva versionada, não aplicada**.
- `tests/meli-integration/**` — testes unitários sem rede, incluindo verificação estática da migration.

### Migration (resumo)

- `meli_pacotes`: `tracking_number`, `facility`, `service_center_id`, `integration_source` (default `adminml`, CHECK idempotente). `tracking_id` e constraints atuais preservados.
- `meli_rotas`: `service_center_id`, `integration_source`, `motorista_id uuid NULL` com FK `motoristas(id) ON DELETE SET NULL`.
- `meli_tracking_eventos`: outbox com CHECKs de tipo de evento e status, `idempotency_key` única, CHECK exigindo `shipment_id` OU `tracking_number`, índices por `shipment_id`, `tracking_number`, `(status_envio, created_at)` e `rota_id`.
- RLS habilitada sem policies de cliente; `anon`/`authenticated` revogados; `service_role` com acesso total.
- Nenhum trigger conecta fluxos operacionais.

## 5. Motorista e veículo

- `motoristas` é uma entidade estruturada do JM.
- `meli_rotas` já traz `driver_id`, `driver_name` e `vehicle_license` vindos da fonte.
- `meli_rotas.motorista_id` é novo e **nullable**: correlação futura, sem backfill.
- Não existe entidade canônica de veículos; por isso **não** foi criado `veiculo_id`/FK. A placa (`vehicle_license`) segue como identificador.

## 6. P1 futuro (não implementado)

- Adapter `meli_carrier_api` implementando `MeliIntegrationAdapter`, atrás de feature flag por base/serviceCenter.
- Dispatcher da outbox (`NAO_ENVIAR` -> `PENDENTE` -> `PROCESSANDO` -> `ENVIADO`/`ERRO`) com retry e idempotência, também atrás de flag.
- Correlação automática de `motorista_id` e eventual entidade de veículos.

## 7. Declaração explícita

**Nenhum envio real ao Mercado Livre foi habilitado.** Não há chamadas de
Tracking Notifications, nenhum dispatcher, nenhum consumidor do cliente
`client_credentials`, e a migration não foi aplicada em produção.
