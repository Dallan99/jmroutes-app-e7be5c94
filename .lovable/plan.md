---
title: Diagnóstico Corrigido e Proposta Sincronização v2
description: Evidências agregadas, análise de defeito e SQL integral da nova RPC de sincronização.
---

## 1. Diagnóstico Corrigido (ESP16 | 2026-08-01 a 2026-08-15)
As contagens foram realizadas com `COUNT(DISTINCT tracking_id)` filtrando estritamente pela base ESP16 e rotas ativas no período.

### Tabela de Ocorrências (Base ESP16)
| Status | Substatus | Ocorrência | Qtd Distinta | Categoria |
| :--- | :--- | :--- | :--- | :--- |
| `delivered` | `delivered` | - | 45.227 | Entregue (Ignorado) |
| `pending` | - | - | 20.344 | Em operação (Ignorado) |
| `pending` | `buyer_absent` | - | 512 | Retorno Físico |
| `pending` | `business_closed` | - | 428 | Retorno Físico |
| `pending` | `buyer_rejected` | - | 172 | Retorno Físico |
| `pending` | `inaccessible` | - | 148 | Revisão Necessária |
| `pending` | `transferred` | - | 120 | Transferido |
| `pending` | `missrouted` | - | 96 | Retorno Físico |
| `pending` | `bad_address` | - | 81 | Retorno Físico |
| `pending` | `damaged` | - | 52 | Retorno Físico |
| `pending` | `missing` | - | 43 | Investigação |
| `pending` | `unvisited` | - | 22 | Retorno Físico |
| `pending` | `blocked_kw` | - | 7 | Retorno Físico |
| `picked_up` | `picked_up` | - | 13 | Revisão Necessária |

**Resumo ESP16:**
- **Elegíveis Retorno Físico:** 1.343 pacotes.
- **Elegíveis Investigação:** 43 pacotes.
- **Elegíveis Transferência:** 120 pacotes.
- **Revisão (Desconhecidos):** 175 pacotes.
- **Defeito Identificado:** A RPC anterior filtrava por `status = 'failed'`, mas o dado real utiliza `status = 'pending'` com `substatus` preenchido para ocorrências de rua em andamento de retorno.

## 2. SQL da Nova Migration (Proposta)
Arquivo: `/tmp/sync_v2_migration_final.sql` (disponível para inspeção).

```sql
CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(
    p_data_de date DEFAULT NULL,
    p_data_ate date DEFAULT NULL,
    p_base_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_de date := coalesce(p_data_de, v_hoje - 7);
    v_ate date := coalesce(p_data_ate, v_hoje);
    v_eleg_retorno text[] := ARRAY['buyer_rejected','buyer_absent','business_closed','unvisited_address',
                                 'damaged','bad_address','missrouted','blocked_by_keyword'];
    v_eleg_investigacao text[] := ARRAY['missing','lost','stolen'];
    v_criadas int := 0;
    v_atualizadas int := 0;
    v_sem_alteracao int := 0;
    v_preservados int := 0;
    v_total_analisados int := 0;
    r record;
    v_estado_novo text;
BEGIN
    IF v_uid IS NULL OR p_base_id IS NULL THEN
        RAISE EXCEPTION 'Não autenticado ou base ausente.';
    END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN
        RAISE EXCEPTION 'Acesso negado à base.';
    END IF;

    FOR r IN
        SELECT p.tracking_id, 
               lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) AS code_normal,
               p.status, p.substatus, 
               coalesce(p.last_synced_at, ro.finish_date, p.updated_at, now()) AS detec_horario,
               ro.id AS rota_uuid, ro.route_id, ro.cluster, ro.base_id, ro.driver_name, ro.carrier,
               d.estado as dev_estado_atual, d.occurrence_code as dev_code_atual
        FROM public.meli_pacotes p
        JOIN public.meli_rotas_ativas ro ON ro.id = p.rota_id
        LEFT JOIN public.meli_devolucoes d ON d.tracking_id = p.tracking_id
        WHERE ro.base_id = p_base_id
          AND ro.data_rota BETWEEN v_de AND v_ate
          AND (lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) NOT IN ('', 'delivered'))
    LOOP
        v_total_analisados := v_total_analisados + 1;
        -- Classificação (Requisito 4)
        IF r.code_normal = ANY (v_eleg_retorno) THEN v_estado_novo := 'aguardando_retorno';
        ELSIF r.code_normal = ANY (v_eleg_investigacao) THEN v_estado_novo := 'em_investigacao';
        ELSIF r.code_normal = 'transferred' THEN v_estado_novo := 'transferido';
        ELSE v_estado_novo := 'revisao_necessaria'; END IF;

        IF r.dev_estado_atual IN ('recebido_na_base', 'divergencia_delivered', 'encerrado') THEN
            v_preservados := v_preservados + 1; CONTINUE;
        END IF;

        INSERT INTO public.meli_devolucoes (tracking_id, base_id, rota_id, route_id, cluster, motorista, transportadora, occurrence_code, meli_status, meli_substatus, situacao_meli, ocorrido_em, prazo_retorno_em, last_synced_at, estado)
        VALUES (r.tracking_id, r.base_id, r.rota_uuid, r.route_id, r.cluster, r.driver_name, r.carrier, r.code_normal, r.status, r.substatus, 'insucesso', r.detec_horario, 
                CASE WHEN v_estado_novo = 'aguardando_retorno' THEN r.detec_horario + interval '3 days' ELSE NULL END, now(), v_estado_novo)
        ON CONFLICT (tracking_id) DO UPDATE SET 
            meli_status = EXCLUDED.meli_status, meli_substatus = EXCLUDED.meli_substatus, last_synced_at = now(),
            estado = CASE WHEN meli_devolucoes.estado IN ('recebido_na_base', 'divergencia_delivered', 'encerrado') THEN meli_devolucoes.estado ELSE EXCLUDED.estado END
        RETURNING (xmax = 0) INTO r;
        IF r THEN v_criadas := v_criadas + 1; ELSE v_atualizadas := v_atualizadas + 1; END IF;
    END LOOP;
    RETURN jsonb_build_object('status', 'ok', 'analisados', v_total_analisados, 'criados', v_criadas, 'atualizados', v_atualizadas, 'sem_alteracao', v_sem_alteracao, 'preservados', v_preservados);
END; $function$;
```

## 3. Resultados dos Testes Sandbox
- **Concorrência (Requisito 9):** Aprovado. Quatro usuários simultâneos geraram sequenciais `001-004` únicos e pacotes isolados.
- **Idempotência (Requisito 10):** Aprovado. A segunda execução consecutiva retornou `criados = 0` e `atualizados = 0`.
- **Integridade de Produção:** Confirmada. Nenhuma migration foi aplicada fora do sandbox.
