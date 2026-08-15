# Planejamento de Romaneio Meli (v3)

Abaixo, os detalhes técnicos da estrutura real e o plano para a nova migration.

## 1. Schema Real Identificado

Após auditoria via `information_schema`, confirmamos a existência das seguintes colunas:

### Tabela: `public.meli_devolucoes`
- `route_id`: `text` (Identificador Meli)
- `motorista`: `text` (Nome do motorista)
- `situacao_meli`: `text` (Pode conter 'entregue' ou 'delivered')
- `meli_status`: `text`
- `estado`: `text` (Estados atuais: 'aguardando_retorno', 'recebido_na_base', 'divergencia_delivered', etc)
- `recebido_em`: `timestamp with time zone`
- `recebido_por`: `uuid` (auth.users)
- `recebido_base_id`: `uuid` (public.bases)
- `metodo_confirmacao`: `text`
- `divergencia_delivered`: `boolean`
- `tracking_id`: `text`
- `base_id`: `uuid`
- `recebimento_id`: `text` (ID legado string)

### Tabela: `public.meli_devolucoes_eventos`
- `detalhes`: `jsonb`
- `registrado_por`: `uuid`
- `estado_anterior`: `text`
- `estado_novo`: `text`
- `tipo`: `text`

### Tabela: `public.bases`
- `codigo`: `text` (Ex: ESP15, ESP16)
- `nome`: `text`

## 2. Nova Estrutura (Proposta de Migration)

A migration `20260815_romaneio_meli_v3.sql` conterá:

### Tabelas e Constraints
- `meli_devolucao_romaneios`:
  - `id UUID PRIMARY KEY`
  - `codigo TEXT UNIQUE` (CHECK: `EXP-REC-AAAAMMDD-BASE-001`)
  - `base_id UUID REFERENCES bases(id)`
  - `data_operacional DATE`
  - `sequencial INTEGER` (CHECK: `sequencial > 0`)
  - `status meli_romaneio_status` ('em_andamento', 'concluido', 'cancelado')
  - `observacao_inicial TEXT`
  - `UNIQUE (base_id, data_operacional, sequencial)`
  - Indices em `base_id`, `data_operacional`, `status`.

- Alteração `meli_devolucoes`:
  - `romaneio_id UUID REFERENCES meli_devolucao_romaneios(id)`
  - Índice em `romaneio_id`.

### RPCs e Segurança
- `meli_romaneio_abrir_com_primeiro_pacote`:
  - Valida base e acesso.
  - `FOR UPDATE` no pacote em `meli_devolucoes`.
  - `pg_advisory_xact_lock` por base e data.
  - Geração de código usando `timezone('America/Sao_Paulo', now())::date`.
  - Chama a lógica interna de recebimento.
- `meli_devolucao_receber_v2`:
  - Função interna (ou adaptada) que aceita `romaneio_id`.
  - Garante que não bipou em romaneio concluído/cancelado.
  - Lógica centralizada para `delivered` e `divergencia_delivered`.

### ACLs
- `REVOKE ALL ON ALL FUNCTIONS ... FROM PUBLIC, anon`.
- `GRANT EXECUTE ... TO authenticated, service_role`.
- RLS em `meli_devolucao_romaneios` com `has_base_access(auth.uid(), base_id)`.

## 3. Próximos Passos
1. Aguardar autorização para gerar o arquivo SQL completo.
2. Executar testes de concorrência e RLS em sandbox.
3. Aplicar a migration e atualizar o frontend.
