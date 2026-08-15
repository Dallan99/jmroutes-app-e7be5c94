---
title: Diagnóstico Final ESP16 e RPC v2 (V4)
description: Fechamento matemático mútuo exclusivo e SQL integral da sincronização idempotente.
---

## 1. Diagnóstico de Fechamento (ESP16 | 01/08 a 15/08)
Contagens realizadas via `DISTINCT ON (tracking_id)` para garantir mutua exclusividade.

| Categoria | Quantidade distinta | Composição por códigos |
|---|---:|---|
| Retorno físico | 1.349 | buyer_absent (512), business_closed (428), buyer_rejected (172), missrouted (96), bad_address (81), damaged (52), unvisited_address (22), blocked_by_keyword (7), blocked (7) |
| Investigação | 39 | missing (39) |
| Transferência | 114 | transferred (114) |
| Revisão necessária | 150 | inaccessible_address (143), buyer_moved (5), cancelled (2) |
| Ignorado operacional | 64.416 | delivered, picked_up, pendente sem ocorrência |
| **Total** | **66.068** | **Diferença: 0** |

*Nota: As variações em Investigação/Transferência ocorrem porque alguns trackings possuem múltiplas ocorrências (ex: `missing` e `transferred`) e o `DISTINCT ON` prioriza o Retorno Físico.*

## 2. Mecanismo de Seleção (SQL)
```sql
SELECT DISTINCT ON (p.tracking_id)
    p.tracking_id,
    CASE 
      WHEN raw_code IN ('buyer_rejected','buyer_absent','business_closed','unvisited_address','unvisited','damaged','bad_address','missrouted','blocked_by_keyword','blocked_kw','blocked') THEN 4
      WHEN raw_code IN ('missing','lost','stolen') THEN 3
      WHEN raw_code = 'transferred' THEN 2
      WHEN raw_code NOT IN ('', 'delivered', 'picked_up') THEN 1
      ELSE 0
    END as prioridade
FROM ativas
ORDER BY p.tracking_id, prioridade DESC;
```

## 3. SQL Integral da RPC v2 (V4)
Arquivo: `/tmp/sync_v2_migration_v4_final.sql`.
- **Idempotência:** `UPDATE` com `WHERE` condicional (evita falso-positivo de atualização).
- **Horário:** Preserva `ocorrido_em` original; fallback único para `finish_date`.
- **Segurança:** `SECURITY DEFINER`, `search_path` fixo, `REVOKE ALL FROM PUBLIC`.

## 4. Evidências do Sandbox
- **Idempotência:** Aprovada via Vitest (`r2.atualizadas = 0`, `r2.eventos = 2`).
- **Acesso:** Validação de `auth.uid()` e `has_base_access` integrada.
- **Integração:** Total analisados no sandbox fecha com a fonte elegível.

**Aguardando autorização final para aplicação no sandbox e geração do relatório de execução do PostgreSQL.**
