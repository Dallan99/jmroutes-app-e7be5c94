# Publicação atômica da sincronização Meli (lote ativo por base)

Objetivo: o painel nunca mostra um ciclo em construção. Cada base tem um "lote completo" que continua alimentando todas as telas até o novo ciclo terminar e ser promovido de uma vez.

## Como vai funcionar

1. O worker abre um ciclo por base/dia (`sync_batch_id`), informando quantas rotas espera enviar.
2. Cada rota importada é marcada com esse `sync_batch_id` e fica **invisível** para as telas.
3. Enquanto isso, Bases, Dashboard, Modo TV, Área de Risco e Devoluções continuam lendo o último lote concluído (números completos anteriores).
4. Ao terminar, o worker finaliza o ciclo. Só então, em uma única transação, o novo lote passa a ser o ativo.
5. Ciclos com erro ou parciais ficam gravados para diagnóstico e **não** substituem o lote ativo. Nada do lote ativo é apagado antes da troca.
6. Repetir a finalização do mesmo `sync_batch_id` não muda nada (idempotente).
7. Durante a construção, as telas mostram o aviso "Sincronizando nova atualização" junto dos números completos anteriores.

## Migration nova (não edita nenhuma anterior)

Arquivo novo em `supabase/migrations/` com:

- Tabela `public.meli_sync_ciclos`: `sync_batch_id` (PK), `base_id`, `data_operacional`, `estado` (`em_processamento` | `concluido` | `erro` | `parcial`), `rotas_esperadas`, `rotas_recebidas`, `pacotes_recebidos`, `ativo`, `iniciado_em`, `finalizado_em`, `mensagem`, timestamps. Índice único parcial garantindo **um único lote ativo por base + data**.
- Coluna `sync_batch_id` em `public.meli_rotas` (nullable; rotas históricas ficam sem lote e continuam visíveis como hoje).
- Função `public.meli_base_lote_ativo(p_base_id uuid, p_data date)` retornando o lote ativo da base.
- Novas RPCs `SECURITY DEFINER`:
  - `meli_sync_ciclo_iniciar(base, data, sync_batch_id, rotas_esperadas)` — idempotente.
  - `meli_sync_ciclo_finalizar(sync_batch_id, base, data, rotas, pacotes, estado)` — valida base, data operacional, contagem de rotas e pacotes e estado do ciclo; só promove quando tudo confere; idempotente.
  - `meli_importar_rota(payload, arquivo_nome, sync_batch_id)` — nova sobrecarga aditiva; a assinatura antiga continua funcionando (lote nulo = comportamento atual).
- Ajuste das RPCs de leitura (`meli_dashboard_operacional`, `meli_sync_status_bases`, `meli_detalhar_rota`, `meli_dashboard_pacotes_rota`, `meli_listar_rotas`, `meli_rotas_area_risco`, `meli_devolucoes_painel`, `meli_devolucoes_sincronizar`) para considerar apenas rotas do lote ativo (ou sem lote, no caso do histórico).
- Segurança preservada: RLS por base mantida, `REVOKE ALL ... FROM PUBLIC, anon` em todas as funções novas/alteradas, `GRANT EXECUTE` apenas para `authenticated` e `service_role`, GRANTs de tabela apenas `SELECT` para `authenticated` e `ALL` para `service_role`. Nada de `service_role` no frontend.

## Arquivos de código

| Arquivo | Mudança |
| --- | --- |
| `src/lib/meli-sync-lotes.ts` (novo) | Regras puras: validação da finalização, escolha do lote ativo, estados do ciclo, idempotência. |
| `src/lib/meli-sync.functions.ts` | Server functions `meliSyncCicloIniciar` / `meliSyncCicloFinalizar` e status de ciclo em processamento por base. |
| `src/lib/meli-import-bruto.ts` | Repassa `sync_batch_id` opcional para a RPC de importação. |
| `src/lib/meli.functions.ts`, `src/routes/api/public/*` (endpoint da extensão) | Aceitam `sync_batch_id` no payload do worker/extensão. |
| `src/components/meli/*` (Dashboard/Bases), `src/routes/tv.meli.tsx` | Selo "Sincronizando nova atualização" sem trocar os números exibidos. |
| `extension/` (worker/extensão) | Gera um `sync_batch_id` por base/ciclo, abre o ciclo, envia as rotas e finaliza. |

Nada fora da integração Meli é alterado: triagem, recebimento, transferências, escalas e dados históricos ficam intactos.

## Testes (`tests/characterization/meli-sync-lotes.test.ts`)

- lote parcial invisível ao painel;
- troca atômica após finalização válida;
- falha no meio do ciclo preservando o lote anterior;
- idempotência da mesma finalização;
- isolamento entre bases (ESP15–ESP18);
- Dashboard, Bases, Modo TV, risco e devoluções lendo o mesmo lote ativo.

Depois: typecheck, suíte completa e build. A migration só é aplicada após sua autorização.
