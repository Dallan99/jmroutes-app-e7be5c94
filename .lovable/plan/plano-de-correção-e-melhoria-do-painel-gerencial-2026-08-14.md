# Plano de Correção e Melhoria do Painel Gerencial

O objetivo é fazer o Gerencial "funcionar" plenamente, corrigindo a exibição de dados e adicionando o campo de Motorista solicitado, seguindo o padrão já aplicado em outros painéis.

## Mudanças

### Backend (`src/lib/gerencial.functions.ts`)

1.  **Atualizar `RotaBaseRow`**: Adicionar campos `motorista` e `placa` (string | null).
2.  **Atualizar `rotasPorBase`**:
    *   Incluir `motorista` e `placa` no `select` da tabela `escalas`.
    *   No agrupamento por rota, capturar o motorista e placa (pegando o primeiro encontrado na escala daquela rota).
3.  **Refinar `resumoOperacionalPorBase`**: Garantir que os limites de `100.000` registros sejam eficientes e que o mapeamento de bases cubra todas as bases ativas.

### Frontend (`src/routes/_authenticated/gerencial.tsx`)

1.  **Tabela "Detalhe por rota"**:
    *   Adicionar coluna "Motorista" após a coluna "Rota".
    *   Exibir o nome do motorista e placa (se disponível).
2.  **Drill Down (Diálogo de Detalhes)**:
    *   Garantir que o motorista seja exibido consistentemente nas métricas de Devoluções e Transferências no modal de detalhes.

## Detalhes Técnicos

*   **Tipagem**: Atualização do `type RotaBaseRow` para incluir os novos campos.
*   **Performance**: O uso de `.limit(50000)` ou `.limit(100000)` em server functions é necessário para volumes grandes, mas requer atenção ao tempo de execução em ambientes edge.
*   **Fallback**: Exibir "—" ou "Não identificado" quando os dados de motorista estiverem ausentes.
