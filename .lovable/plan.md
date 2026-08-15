# Plano: Sincronização de Devoluções v2 (Segura e Auditada)

Este plano detalha a implementação da nova rotina de sincronização de devoluções, cumprindo os 12 requisitos de segurança, integridade e auditoria de schema real.

## 1. Auditoria e Diagnóstico (Concluído)
- **Tabelas Reais:** Confirmado uso de `meli_pacotes`, `meli_rotas` e `meli_rotas_ativas`.
- **ACLs:** Confirmado que `anon` não possui acesso; `authenticated` e `service_role` são as únicas com EXECUTE.
- **Tipos:** Confirmado uso de `timestamptz` para datas e `text` para status/ocorrências.

## 2. Nova Migration (v2 Corrigida)
Criar `supabase/migrations/20260815011000_sync_devolucoes_v2_segura.sql`:
- **Assinatura:** `public.meli_devolucoes_sincronizar(p_base_id uuid)`.
- **Segurança:** 
  - Exigir `p_base_id` não nulo.
  - Validar `has_base_access(auth.uid(), p_base_id)`.
  - Revogar `PUBLIC` e `anon`.
- **Lógica de Negócio:**
  - Filtrar exclusivamente pelo lote `ativo = true` na base via `meli_rotas_ativas`.
  - Classificação estrita: `aguardando_retorno` (lista branca), `em_investigacao` (lost/missing), `transferido` (transferred), `revisao_necessaria` (outros).
  - UPSERT real: Preservar pacotes já recebidos ou encerrados.
  - Contabilização detalhada: retornar JSON com contagens de `analisados`, `criados`, `atualizados`, `sem_alteracao`, `ignorados`, `erros`, etc.

## 3. Atualização do Frontend
- Refatorar `src/lib/meli-devolucoes.functions.ts` para a nova assinatura (removendo parâmetros de data).
- Atualizar a interface em `src/routes/_authenticated/meli-devolucoes.tsx` para exibir o sumário detalhado da sincronização.

## 4. Validação e Testes
- **Testes de Integração:** Criar `tests/sync-devolucoes-v2.test.ts` simulando diferentes cenários de classificação e concorrência.
- **Isolamento:** Validar que um usuário da Base A não pode sincronizar dados da Base B.
- **Idempotência:** Garantir que múltiplas execuções não dupliquem eventos ou alterem prazos já definidos.

## 5. Rollback
- Definição da RPC original salva em `mem://features/sync-devolucoes-v2-auditoria`.
- Procedimento: Restaurar a assinatura original (`p_data_de`, `p_data_ate`) e reverter frontend.

**Não aplicarei a migration nem alterarei código operacional antes de sua aprovação.**
