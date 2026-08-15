# Plano: Auditoria e Sincronização Devoluções v2 (Revisado)

Este plano detalha a implementação da nova rotina de sincronização de devoluções, cumprindo os 15 requisitos de segurança, integridade e auditoria rigorosa do schema real.

## 1. Auditoria Final e Diagnóstico
- **Schema Real:** Confirmado o uso de `meli_pacotes` (tracking_id, status, substatus, occurrence_code, rota_id, updated_at, last_synced_at) e `meli_rotas` (id, route_id, base_id, data_rota, finish_date).
- **Assinatura Atual:** O frontend chama `meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid)`.
- **Integridade:** Identificado que o horário real da ocorrência deve priorizar `occurrence_code` timestamp, seguido por `finish_date` da rota.

## 2. Nova Migration (v2 Segura)
Criar RPC `public.meli_devolucoes_sincronizar(p_base_id uuid, p_data_de date, p_data_ate date)`:
- **Segurança e Restrições:**
  - Exigir `auth.uid()`, rejeitar `p_base_id = NULL`.
  - Validar `has_base_access(auth.uid(), p_base_id)`.
  - `SET search_path = public`, `REVOKE ALL FROM PUBLIC, anon`.
- **Isolamento de Lote:**
  - Consultar exclusivamente a view `meli_rotas_ativas` (base_id, data_rota e ciclo ativo).
- **Classificação Estrita:**
  - **Aguardando Retorno:** Lista branca (buyer_rejected, buyer_absent, business_closed, unvisited_address, damaged, bad_address, missrouted, blocked_by_keyword).
  - **Investigação:** missing, lost, stolen.
  - **Transferido:** transferred.
  - **Revisão:** Códigos desconhecidos ou inconsistentes.
  - **Ignorar:** Pacotes em rota ou sem ocorrência de insucesso.
- **Horário e Prazo:**
  - Prioridade: Horário real > finish_date da rota > data da primeira detecção.
  - Prazo de 3 dias apenas para `aguardando_retorno`. Prazo nulo para demais categorias.
- **Idempotência e Concorrência:**
  - UPSERT atômico protegendo registros contra reexecuções.
  - Preservar `recebido_na_base`, `divergencia_delivered` e `encerrado`.
  - Criar eventos (`meli_devolucoes_eventos`) apenas em mudanças reais (status, ocorrência, rota, prazo).
- **Sumário JSONB:** Retornar analisados, criados, atualizados, sem_alteracao, investigação, transferidos, revisão, entregues_ignorados e erros.

## 3. Rotina Automática (Service Role)
- Criar `public.meli_devolucoes_sincronizar_auto(p_base_id uuid, p_data_rota date)`:
  - Restrita a `service_role`.
  - Chamada após promoção do lote ativo.
  - Registra origem como 'automática'.

## 4. Atualização Frontend
- **Server Function:** Atualizar `meliDevolucoesSincronizar` para a assinatura com `base_id` e datas.
- **Interface:** Exibir sumário detalhado e tratar bloqueios de acesso.

## 5. Validação no Sandbox (Pré-Implantação)
- Criar testes em `tests/characterization/sync-v2-full.test.ts` cobrindo:
  - Todas as classificações de ocorrências.
  - Prazo nulo vs 3 dias.
  - Concorrência de duas execuções simultâneas.
  - Isolamento de bases.
  - Reconciliação de pacotes que mudaram de status (ex: insucesso -> entregue).

## 6. Rollback e Implantação
- Manter a assinatura antiga (`p_data_de, p_data_ate, p_base_id`) como um wrapper temporário que valida segurança e delega à nova.
- Após estabilidade, revogar EXECUTE da assinatura antiga.
- SQL completo da versão anterior armazenado em `mem://reference/sync-v1-backup.sql`.

**Não aplicarei a migration em produção nem publicarei código antes da aprovação deste plano revisado e dos testes no sandbox.**
