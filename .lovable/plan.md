# Plano: Auditoria e Sincronização Devoluções v2

Este plano corrige falhas de segurança e integridade na sincronização de devoluções, garantindo isolamento por base e ciclo ativo.

## 1. Migration de Banco de Dados
Criar nova RPC `meli_devolucoes_sincronizar(p_base_id uuid)`:
- **Segurança**: Bloqueio de `p_base_id = NULL`, validação via `has_base_access`, `SECURITY DEFINER` com `search_path` fixo.
- **Isolamento**: Consulta apenas `meli_rotas_ativas` (lote concluído e ativo).
- **Classificação**: Mapeamento estrito de ocorrências (investigação, transferência, revisão).
- **Idempotência**: UPSERT que não sobrescreve recebimentos físicos e contabiliza mudanças reais.

## 2. Refatoração Frontend
- **Server Function**: Atualizar `meliDevolucoesSincronizar` para a nova assinatura.
- **Interface**: Adicionar exibição do sumário de sincronização (criados, atualizados, erros) na página de Devoluções.

## 3. Validação
- **Testes**: Executar `vitest` para validar lógica de classificação e concorrência.
- **Rollback**: Preservar assinatura antiga até confirmação de estabilidade.
