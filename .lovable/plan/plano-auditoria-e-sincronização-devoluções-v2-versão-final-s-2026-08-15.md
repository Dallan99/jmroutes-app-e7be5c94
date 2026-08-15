# Plano: Auditoria e Sincronização Devoluções v2 (Versão Final Sandbox)

Este plano detalha a implementação e validação da nova rotina de sincronização, cumprindo rigorosamente os 15 requisitos de segurança e integridade.

## 1. Auditoria e Horário da Ocorrência
- **Diagnóstico:** Confirmado que não há horário real de ocorrência por pacote.
- **Lógica de Fallback:**
  1. Usar `finish_date` da rota se finalizada.
  2. Gravar `detectado_em = now()` apenas na primeira detecção.
  3. Registrar `fonte_ocorrido_em` (`finish_date_rota` ou `primeira_deteccao`).
  4. Nunca usar `updated_at` ou `last_synced_at` como ocorrência.

## 2. Assinatura Compatível e Segurança
- **Assinatura:** `public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid)`.
- **Segurança:**
  - Exigir `auth.uid()`, rejeitar `p_base_id = NULL`.
  - Validar `has_base_access(auth.uid(), p_base_id)`.
  - `SET search_path = public`, `REVOKE ALL FROM PUBLIC, anon`.
- **Rotina Automática:** `meli_devolucoes_sincronizar_auto(p_base_id uuid, p_data_rota date)` restrita a `service_role`.

## 3. Lote Ativo e Filtros
- Consulta exclusiva a `meli_rotas_ativas`.
- Filtro explícito: `ro.base_id = p_base_id AND ro.data_rota BETWEEN p_data_de AND p_data_ate`.

## 4. Classificação e Prazos
- **Lista Branca (Aguardando Retorno - 3 dias):** buyer_rejected, buyer_absent, business_closed, unvisited_address, damaged, bad_address, missrouted, blocked_by_keyword.
- **Prazo Nulo (NULL):** Investigação (missing, lost, stolen), Transferido (transferred), Revisão Necessária (desconhecidos).
- **Ignorar:** Pacotes em rota normal ou entregues (delivered).

## 5. Idempotência, Reconciliação e Eventos
- **UPSERT Atômico:** Protege contra concorrência e duplicidade.
- **Preservação:** Não reabre ou altera `recebido_na_base`, `divergencia_delivered` ou `encerrado`.
- **Reconciliação:** Atualiza status/ocorrência de pendências ativas se o dado externo mudar.
- **Eventos:** Registra mudanças de status, ocorrência, estado ou rota. `tracking_id` obrigatório.

## 6. Resultado da RPC (JSONB Summary)
- Retorna: analisados, criados, atualizados, sem_alteracao, aguardando, investigação, transferidos, revisão, em_operacao, entregues_ignorados, preservados, erros e timestamps de execução.

## 7. Frontend e Rollback
- **Frontend:** Atualizar Server Function para enviar `base_id` e range de datas. Exibir sumário detalhado.
- **Rollback:** Definição da assinatura antiga preservada em `mem://reference/sync-v1-backup.sql`. Substituição via `CREATE OR REPLACE`.

## 8. Validação no Sandbox (Obrigatório antes de Produção)
- **Testes no Sandbox local:**
  - Validar assinatura compatível com frontend.
  - Testar classificação integral e prazos (3 dias vs nulo).
  - Simular concorrência (duas execuções simultâneas).
  - Validar isolamento de base e negação de acesso.
  - Provar fallback de horário e persistência da detecção.

**Não autorizo aplicação em produção nem publicação. Somente implementação e testes no sandbox.**
