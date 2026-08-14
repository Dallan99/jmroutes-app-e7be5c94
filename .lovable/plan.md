# Plano de Redesenho: Romaneio de Devolução

O objetivo é transformar o atual módulo de Devoluções no "Romaneio Meli", com foco em conferência por bipagem, automação total de dados (motorista/rota/motivo) e geração de ID sequencial robusto.

## 1. Alterações Estruturais e Nomenclatura

- **Menu Lateral (`src/components/app-shell.tsx`)**: Renomear "Devoluções" para "Romaneio Meli".
- **Página de Devoluções (`src/routes/_authenticated/meli-devolucoes.tsx`)**:
  - Título: "Romaneio de Devolução".
  - Subtítulo: "Pacotes retornados pelo motorista à base — conferência e romaneio".
  - Novos Cards: Registros recentes, Romaneios abertos, Pendências vencidas, Divergências críticas.
  - Implementar o fluxo de "Bipar o primeiro pacote" para iniciar o romaneio.

## 2. Lógica de Negócio e Backend

- **Nova Migration (`recebimentos_romaneio_v2`)**:
  - Adicionar colunas ou tabela para suportar o status do romaneio (Em andamento/Concluído).
  - Garantir o sequencial `EXP-REC-AAAAMMDD-BASE-XXX`.
- **Server Functions (`src/lib/meli-devolucoes.functions.ts`)**:
  - Refatorar `gerarRecebimentoId` para seguir o novo padrão `EXP-REC-...`.
  - Refatorar `meliDevolucaoReceber` para:
    - Buscar automaticamente motorista/rota/motivo do Mercado Livre.
    - Impedir duplicidade entre romaneios abertos.
    - Classificar automaticamente com base nas 10 ocorrências Meli (damaged, bad_address, etc).
    - Gerar divergência crítica (Roxo) para pacotes `delivered`.

## 3. Interface de Conferência

- **Novo Componente de Bipagem**:
  - Campo de bipagem sempre em foco.
  - Feedback visual por cores: Verde (OK), Amarelo (Duplicado), Vermelho (Desconhecido), Roxo (Crítico/Delivered).
  - Botão de "Finalizar Romaneio" com trava de segurança.

## 4. Impressão e Relatórios

- Gerar layout de impressão em duas vias com campos para assinatura.
- Exportação CSV com todos os detalhes técnicos solicitados.

## Detalhes Técnicos

- **Sequencial**: Proteção via RPC Supabase com `FOR UPDATE` ou lógica de lock para evitar duplicidade em concorrência.
- **Identidade Visual**: Manter o tema dark, minimalista e Apple-like do JMRoutes.
- **Tecnologia**: TanStack Start v1, Tailwind v4, Lucide-react para ícones.

---
**Nota**: Antes de aplicar a migration, apresentarei o SQL para revisão.
