---
title: Correção Estrutural Devoluções v2 e Sincronização
description: Plano para migração do rollback, diagnóstico em sandbox real, correção da RPC de sincronização e validação de concorrência.
---

## 1. Organização de Arquivos
- Mover `supabase/migrations/20260815120000_rollback.sql` para `supabase/rollbacks/rollback_devolucoes_sync_v2.sql`.
- Remover qualquer arquivo de rollback da pasta de migrations para evitar execuções acidentais.

## 2. Diagnóstico em Sandbox Real (ESP16)
Realizar varredura no banco sandbox para extrair contagens agregadas (sem expor PII):
- Pacotes em `meli_rotas_ativas`.
- Classificação por status: entregues, em operação, retorno físico (lista branca), investigação, transferidos e desconhecidos.
- Mapeamento do fluxo: verificar se o pacote existe em `meli_pacotes` e se é corretamente filtrado pela lógica da RPC.

## 3. Nova RPC de Sincronização (v2 Corrigida)
Implementar `meli_devolucoes_sincronizar` com as seguintes garantias:
- **Segurança:** Validação de `auth.uid()` e `has_base_access`. Revogação de acesso `anon`.
- **Integridade:** 
  - Lista branca de códigos de retorno físico.
  - Fallback para `revisao_necessaria` em códigos desconhecidos.
  - Preservação de estados `recebido_na_base`, `divergencia_delivered` e `encerrado`.
  - `tracking_id` íntegro (nunca usar `EXP-REC-...`).
- **Idempotência:** Garantir que execuções repetidas sem mudanças retornem `sem_alteracao`.

## 4. Validação de Concorrência
- Implementar testes no sandbox simulando múltiplos usuários operando na mesma base.
- Garantir isolamento de sequenciais e pacotes via `pg_advisory_xact_lock` na criação de romaneios.

## 5. Evidências Finais
- Apresentar contagens agregadas antes/depois.
- SQL integral da nova migration.
- Resultado dos testes reais no sandbox e build local.
- Confirmação de que a produção permanece intocada.
