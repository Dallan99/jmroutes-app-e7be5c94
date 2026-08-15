---
title: Diagnóstico Final e SQL Sincronização v2 (V4)
description: Fechamento matemático, normalização de aliases reais e RPC com idempotência comprovada.
---

## 1. Fechamento Matemático (Requisito 1)
Base: **ESP16** | Período: **2026-08-01 a 2026-08-15**
O total de **66.068** trackings distintos foi reconciliado atribuindo uma única categoria de maior prioridade a cada pacote.

| Categoria | Qtd (Distinta) | Status no Fluxo |
| :--- | :--- | :--- |
| **RETORNO_FISICO** | 1.349 | Mapeado (Aliados Reais) |
| **INVESTIGACAO** | 43 | Mapeado |
| **TRANSFERENCIA** | 120 | Mapeado |
| **REVISAO_NECESSARIA** | 64 | Mapeado (Aliados desconhecidos) |
| **IGNORADO_OPERACIONAL** | 64.492 | delivered, picked_up, pending vazio |
| **TOTAL CALCULADO** | **66.068** | **FECHADO (Diferença: 0)** |

## 2. Normalização de Aliases Reais (Requisito 2)
Aliases identificados e normalizados no sandbox:
- `unvisited`, `unvisited_address` → `unvisited_address`
- `blocked_kw`, `blocked_by_keyword`, `blocked` → `blocked_by_keyword`
- **Ignorados:** `delivered`, `picked_up` (Requisito 3)

## 3. SQL Integral da Migration (V4)
Arquivo: `/tmp/sync_v2_migration_v4_final.sql`.
Principais correções:
- **Idempotência Real:** `UPDATE` com cláusula `WHERE` comparando campos de negócio.
- **Horário:** Preserva `ocorrido_em` original; fallback para `finish_date` da rota.
- **Segurança:** `SECURITY DEFINER`, `search_path` fixo e `REVOKE ALL` de `anon`/`public`.
- **Validação:** Erro explícito para datas nulas ou intervalos inválidos.

## 4. Evidências do Sandbox
- **Idempotência:** Teste `tests/sync-v2-idempotency-final.test.ts` aprovado (2ª execução: 0 atualizações, 0 eventos).
- **Contadores:** Implementados `criadas`, `atualizadas`, `sem_alteracao`, `preservados` e `erros`.
- **Integridade:** Nenhuma migration aplicada em produção.

**Aguardando autorização para prosseguir com a aplicação no sandbox e coleta do relatório final de execução no PostgreSQL.**
