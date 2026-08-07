# Roadmap registrado — não implementado nesta rodada

Registrado em 07/08/2026. Nada aqui foi implementado, publicado ou migrado.

## 1. Drill-down de status e insucessos no Dashboard (próxima evolução obrigatória)

Tornar clicáveis, na seção "Operação Meli em tempo real":

- Não iniciados
- Em rota
- Entregues
- Insucessos
- Cancelados

E cada motivo do gráfico "Motivos de insucesso" (ex.: "Não havia ninguém no endereço").

Ao clicar, abrir detalhamento por pedido com as colunas:

| Campo | Origem prevista |
| --- | --- |
| Base | `bases.codigo` via `meli_rotas.base_id` |
| shipment_id | `meli_pacotes.shipment_id` |
| tracking_id | `meli_pacotes.tracking_id` |
| Cluster / nome operacional da rota | `meli_rotas.cluster` (fallback: ID Meli) |
| route_id secundário | `meli_rotas.route_id` |
| Motorista | `meli_rotas.motorista` |
| Placa | `meli_rotas.placa` |
| Transportadora | `meli_rotas.transportadora` |
| Status / Substatus | `meli_pacotes.status` / `substatus` |
| occurrence_code | `meli_pacotes.occurrence_code` |
| Motivo | motivo normalizado do insucesso |
| Área de risco | `meli_pacotes.area_risco` / `meli_rotas.area_risco` |
| Horário da ocorrência | timestamp da ocorrência do pacote |
| Última sincronização | `meli_rotas.atualizado_em` / último `sync_batch_id` |

Regras:

- o drill-down respeita **todos** os filtros ativos do Dashboard (dia operacional,
  base, cluster, status, texto);
- caminho gerencial: **INDICADOR → BASE → ROTA → MOTORISTA → PEDIDO**;
- leitura apenas; nenhuma escrita, nenhuma alteração em `meli_dashboard_operacional`
  sem autorização explícita (pode exigir RPC de leitura nova, aditiva).

Motivo de não implementar agora: risco de regressão no Dashboard em produção de
homologação; depende de decisão sobre nova RPC de detalhe.

## 2. Diretriz geral — a BASE é a unidade gerencial

Toda evolução futura de Dashboard, Gerencial, Indicadores, Modo TV e Alertas deve
tratar a base como unidade principal:

- usuário single-base: vê somente a própria base;
- supervisor multibase: vê somente as bases autorizadas;
- gerente / diretor / admin: visão consolidada + cards por base + comparação +
  ranking + detalhe de cada base.

Sempre segmentado por base: rotas, pacotes, entregues, em rota, não iniciados,
insucessos, cancelados, % de entrega, % de insucesso, responsável e última
sincronização.

## 3. Problema principal que o worker resolve (não esquecer)

Hoje a coleta depende de um computador com Chrome aberto; quando a máquina desliga,
o AdminML deixa de alimentar o Supabase e o fim da operação fica sem acompanhamento.

Objetivo final: **AdminML → worker 24/7 → pipeline existente do JMRoutes → Supabase
→ Dashboard atualizado**, sem depender de computador humano ligado.

O worker permanece **desativado** (sem deploy, sem migration aplicada, sem usuário
técnico criado) até autorização.
