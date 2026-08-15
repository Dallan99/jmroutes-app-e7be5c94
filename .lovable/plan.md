# Plano de Homologação — Sincronização de Devoluções V2 (V5 Corrigida)

Preparação da RPC integral `meli_devolucoes_sincronizar` com foco em reconciliação de pacotes entregues, segurança transacional e isolamento por base.

## Diagnóstico e Auditoria (ESP16 | 01/08 a 15/08)
Confirmado o fechamento matemático de **66.068** trackings distintos.

### Matriz Mutuamente Exclusiva
- **Única Ocorrência:** 64.886
- **Múltiplas Iguais:** 348
- **Múltiplas Conflitantes:** 834 (Redirecionados para revisão quando o timestamp for ambíguo)
- **Total:** 66.068 (Diferença: 0)

### Limitação Técnica Detectada
O schema `meli_pacotes` guarda apenas o **estado atual**. Não existe histórico cronológico (`occurred_at`) por linha. A V5 processa o estado atual e preserva o horário da primeira detecção do insucesso.

## Alterações Técnicas (SQL V5)

### 1. Reconciliação de Entregues (Requisito 2)
- Pacotes `delivered` no Meli que já possuem Devolução aberta serão automaticamente reconciliados para o estado `encerrado`.
- Registra evento de reconciliação.
- Não cria novas Devoluções para pacotes que já chegam como entregues.

### 2. Segurança e Transacionalidade (Requisito 3, 4)
- **Lock Consultivo:** `pg_try_advisory_xact_lock` impede sincronizações simultâneas para a mesma base/período.
- **Erro Atômico:** Removido `EXCEPTION WHEN OTHERS`. Qualquer falha estrutural interrompe toda a transação.
- **Privacidade:** IDs de rastreamento removidos dos logs e `RAISE NOTICE`.

### 3. Gestão de Prazos e Estados (Requisito 5, 10)
- `aguardando_retorno` → Prazo de 3 dias.
- Outros estados → Prazo nulo.
- Ao mudar de estado, o prazo antigo é limpo.
- Estados finais (`recebido_na_base`, `divergencia_delivered`, `encerrado`) são estritamente preservados.

### 4. Eventos e Idempotência (Requisito 8)
- Eventos de atualização registram estado e código anterior/novo.
- Não gera eventos se não houver mudança real.

## Verificação e Próximos Passos
1. Validar SQL V5 no sandbox (Aguardando autorização).
2. Executar teste de concorrência real (4 sessões).
3. Confirmar que a segunda execução produz `criados = 0` e `atualizados = 0`.

**Produção permanece intocada.**
