# Plano de Auditoria e Correção: Devoluções v3

Este plano visa corrigir a falha de sincronização (tela zerada) e implementar as regras operacionais de retorno físico de pacotes.

## Diagnóstico Técnico
1. **Causa da Tela Zerada**: A sincronização atual filtra rotas por `data_rota` entre `v_de` e `v_ate`. Se a data operacional não for informada corretamente pelo frontend, ou se o lote ativo for mais antigo que 7 dias, nada é importado.
2. **Classificação de Insucesso**: A RPC `meli_devolucoes_sincronizar` utiliza uma lista fixa `v_eleg`. Precisamos expandir essa lista e incluir o substatus/código de ocorrência conforme a nova regra.
3. **Eventos**: Eventos administrativos estavam falhando por falta de `tracking_id` (já mitigado na migration anterior, mas requer revisão).

## Ações Propostas

### 1. Banco de Dados (Nova Migration)
- Atualizar `public.meli_devolucoes_sincronizar` para:
    - Incluir todos os novos códigos de insucesso terminal.
    - Implementar a lógica de "Aguardando Retorno" vs "Em Investigação" (missing/lost).
    - Tratar `transferred` como estado específico.
    - Melhorar a captura da `base_id` a partir da rota do pacote.
    - Retornar contagens detalhadas (criados, atualizados, ignorados, etc.).
- Garantir idempotência completa usando `ON CONFLICT (tracking_id)`.

### 2. Frontend (Interface e Integração)
- **Sincronização**: Substituir o botão de "Sincronizar" por uma chamada à nova RPC que retorna o resumo operacional detalhado.
- **Resumo Operacional**: Exibir modal com os números da sincronização após o processamento.
- **Filtros e Cards**: Atualizar os cards para refletir as novas categorias (Divergência, Investigação, Atrasado).
- **Auto-foco**: Garantir que ao clicar em "Novo" o campo de bipagem receba foco imediato.

### 3. Segurança e Auditoria
- Confirmar `REVOKE` em `anon` para a RPC de sincronização.
- Validar `has_base_access` em todas as consultas do painel.

### 4. Testes de Regressão
- Criar `tests/characterization/devolucoes-flow-v3.test.ts` cobrindo:
    - Importação de `buyer_absent` (3 dias de prazo).
    - Pacote `missing` em investigação.
    - Divergência de `delivered` bipado fisicamente.
    - Não duplicidade em múltiplas sincronizações.

## Critérios de Aceite
- Sincronização retornando pacotes reais existentes no banco.
- Interface exibindo o resumo detalhado da sincronização.
- Fim da dependência de identificadores `REC...` legados.
- Testes 100% verdes.

Não publicar nem aplicar migrations antes da revisão final.
