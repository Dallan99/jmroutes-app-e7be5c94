---
title: Correção Estrutural Devoluções v2 e Sincronização
description: Plano para migração do rollback, diagnóstico em sandbox real, correção da RPC de sincronização e validação de concorrência.
---

## 1. Organização de Arquivos
- Mover `supabase/migrations/20260815120000_rollback.sql` para `supabase/rollbacks/rollback_devolucoes_sync_v2.sql`.
- Remover qualquer arquivo de rollback da pasta de migrations para evitar execuções acidentais.

## 2. Diagnóstico em Sandbox Real (ESP16)
Rastreio do fluxo completo onde os registros "desaparecem":
- **Etapa 1 (`meli_pacotes`):** 81.463 registros encontrados na base ESP16.
- **Etapa 2 (`meli_rotas_ativas`):** 81.463 registros (todas as rotas da base estão ativas).
- **Etapa 3 (Seleção RPC):** 0 registros selecionados.
- **Defeito Encontrado:** A RPC atual filtra por `p.status = 'failed'`, mas o banco sandbox utiliza `p.status = 'pending'` com `substatus` preenchido (ex: `buyer_absent`, `business_closed`) para pacotes em processo de devolução. A sincronização falha ao ignorar pacotes `pending` que já possuem ocorrência final de insucesso.

## 3. Nova RPC de Sincronização (v2 Corrigida)
Implementar `meli_devolucoes_sincronizar` com:
- **Assinatura Preservada:** `(p_data_de date, p_data_ate date, p_base_id uuid)`.
- **Filtro Corrigido:** Considerar pacotes onde o status normalizado indica insucesso, independentemente se o status Meli é `failed` ou `pending`.
- **Classificação:** Separar explicitamente Retorno Físico (3 dias de prazo), Investigação, Transferido e Desconhecido.
- **Horário Real:** Priorizar data da ocorrência do payload; fallback para `finish_date` da rota ou detecção inicial.
- **Segurança:** `auth.uid()` e `has_base_access` validados; `anon` bloqueado.
- **Idempotência:** UPSERT real preservando estados finais.

## 4. Validação e Concorrência
- **Stress Test:** Quatro sessões independentes na mesma base via Playwright/Vitest.
- **Sequenciais:** Uso de `pg_advisory_xact_lock` para garantir IDs `EXP-REC-...` únicos e atômicos.
- **Duplicidade:** Validação de que bipagens repetidas não geram novos registros.

## 5. Evidências Finais
- Contagens agregadas antes/depois da correção.
- SQL integral da migration e scripts de teste sandbox.
- Comprovação de build, typecheck e integridade da produção.
