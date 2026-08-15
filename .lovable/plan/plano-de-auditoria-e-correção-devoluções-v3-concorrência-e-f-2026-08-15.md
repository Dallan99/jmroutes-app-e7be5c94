# Plano de Auditoria e Correção: Devoluções v3 (Concorrência e Fluxo de Interface)

## Diagnóstico do Problema Atual
A interface atual solicita o primeiro pacote mas não abre o campo de entrada para o usuário, causando um bloqueio operacional. Além disso, existe o risco de concorrência onde múltiplos operadores na mesma base podem gerar o mesmo código sequencial se o bloqueio transacional não for rigoroso ou se o estado local for compartilhado indevidamente.

## Objetivos
1.  **Interface Reativa**: O clique em "Iniciar devolução" deve abrir imediatamente o campo de captura do primeiro pacote.
2.  **Atomicidade**: A criação da devolução e o registro do primeiro pacote devem ocorrer em uma única transação no servidor.
3.  **Concorrência Real**: Uso de `pg_advisory_xact_lock` no banco para garantir sequenciais únicos por base/dia, mesmo com múltiplos operadores simultâneos.
4.  **Isolamento por Sessão**: O estado local (`localStorage`) deve ser chaveado por `user_id` e `base_id`.
5.  **Segurança e Rebranding**: Remover termos "Meli" e "Romaneio" da interface e validar ACLs (bloqueio de `anon`).

## Ações Técnicas

### 1. Banco de Dados (RPCs)
As RPCs em `20260814230736_romaneio_devolucao_meli_v3.sql` já utilizam `pg_advisory_xact_lock`. Vou verificar se as permissões `REVOKE ALL FROM PUBLIC/anon` estão aplicadas e se a função `meli_romaneio_abrir_com_primeiro_pacote` atende a todos os requisitos de isolamento.

### 2. Frontend (`meli-devolucoes.tsx`)
- Alterar o estado inicial para não criar nada no banco até o primeiro bipe válido.
- Implementar o formulário de "Primeiro Pacote" com foco automático.
- Chavear `localStorage`: `active_devolucao_uuid:{user_id}:{base_id}`.
- Refatorar labels: "Romaneio Meli" -> "Devoluções".

### 3. Testes de Concorrência
Criar um teste que simula 4 operadores simultâneos chamando a RPC de abertura na mesma base para validar a geração de sequenciais `001`, `002`, `003`, `004`.

## Mapa de Fluxo de Interface (Corrigido)
1. `[Estado: Inicial]` -> Botão "Iniciar devolução".
2. `[Clique]` -> `[Estado: Captura Primeiro]` (Formulário visível, Foco no input).
3. `[Bipe Primeiro]` -> Chamada `meliDevolucoesCriarDevolucao`.
4. `[Sucesso]` -> `[Estado: Conferência]` (Exibe lista, Input focado para próximos).
5. `[Erro]` -> Permanece em `[Estado: Captura Primeiro]` com mensagem de erro.

## Arquivos a serem modificados
- `src/routes/_authenticated/meli-devolucoes.tsx` (UI e Lógica de Estado)
- `src/lib/meli-devolucoes.functions.ts` (Nomenclatura e Middleware)
- `tests/characterization/concorrencia-v3.test.ts` (Novo teste de stress)

---
*Aguardando autorização para iniciar as modificações conforme o plano acima.*
