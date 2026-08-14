# Plano de Implementação: Recebimento Automático em Devoluções

Este plano descreve a remoção do termo "Meli" da interface de devoluções e a implementação da geração automática de IDs de recebimento sequenciais (`REC + DATA + SEQ`) para permitir múltiplos operadores simultâneos e melhor organização de armazenamento.

## Alterações de Interface

- Renomear todos os títulos e metadados de "Devoluções Meli" para apenas "Devoluções".
- Adicionar botão "Gerar Recebimento" na interface de Devoluções.
- Exibir o ID de recebimento atual gerado para o operador.

## Alterações Técnicas

### 1. Banco de Dados (Supabase)
- Criar migração para adicionar a coluna `recebimento_id` na tabela `meli_devolucoes`.
- Criar a função `public.gerar_sequencia_recebimento(p_base_id uuid, p_data date)` para garantir unicidade e sequencialidade (001, 002...) via transação/lock.
- Atualizar a RPC `meli_devolucao_receber` para aceitar e gravar o `recebimento_id`.

### 2. Backend (Server Functions)
- Modificar `meli-devolucoes.functions.ts` para incluir a função `gerarRecebimentoId`.
- Atualizar `receberSchema` e a chamada da RPC.

### 3. Frontend (React)
- Atualizar `meli-devolucoes.tsx`:
    - Adicionar estado para o ID de recebimento atual.
    - Implementar a lógica do botão "Gerar Recebimento".
    - Garantir que o ID gerado seja enviado em cada bipagem de retorno.

## Segurança e Concorrência
- O ID será gerado no servidor usando lógica SQL para evitar duplicidade entre operadores na mesma base.
- O formato será `RECYYYYMMDDNNN` (ex: `REC20260814001`).

## Critérios de Aceite
- O termo "Meli" não deve ser visível na tela de Devoluções.
- Ao clicar em "Gerar Recebimento", um novo ID sequencial deve ser atribuído à sessão do operador.
- Cada bipagem bem-sucedida deve vincular o ID de recebimento ao pacote no banco de dados.
