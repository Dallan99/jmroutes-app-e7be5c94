# FASE 3 — Diagnóstico de viabilidade: integração Meli server-side (sem extensão)

Status: **diagnóstico** — nada da integração server-side foi implementado.
A extensão v0.3.1 permanece intacta como fallback.

---

## 1. Erro do Dashboard — CORRIGIDO

- **Função com problema:** `public.meli_dashboard_operacional`
- **Causa:** declarada `STABLE` (não-volátil) mas executava DDL:

```sql
CREATE TEMP TABLE IF NOT EXISTS _dash_pac ( ... ) ON COMMIT DROP;
DELETE FROM _dash_pac;
INSERT INTO _dash_pac SELECT ...
```

  Postgres rejeita DDL em função não-volátil → `CREATE TABLE is not allowed in a non-volatile function`.
- **Migration criada:** reescrita da função como `LANGUAGE sql STABLE SECURITY DEFINER`,
  usando CTEs (`perm`, `dia`, `pac`, `cards`, `motivos`, `rotas`, `bases_agg`, `risco`,
  `sync`, `sync_bases`). Zero DDL, somente leitura de `meli_rotas`, `meli_pacotes`,
  `bases` e `meli_ocorrencia_codigos`.
- **Verificação:** `pg_proc` confirma `LANGUAGE sql`, `provolatile = 's'`, sem `CREATE TEMP`.
- **Contrato preservado:** mesmas chaves de retorno, mesmos filtros (data, base,
  motorista, rota, status, transportadora, risco). O filtro `p_status` deixou de ser
  um `DELETE` em tabela temporária e passou a ser predicado no `WHERE`.
- Nenhum zero mascarado: sem permissão continua retornando `{"status":"erro","erro":"sem_permissao"}`.

Nenhuma tabela, policy, GRANT ou RLS foi alterada.

---

## 2. Diagnóstico da API oficial do Mercado Livre

### Endpoints oficiais existentes
| Superfície | Escopo real |
|---|---|
| `api.mercadolibre.com/shipments/{id}` (+ `x-format-new: true`) | dados do envio do **vendedor**: status, substatus, destino, tracking |
| `api.mercadolibre.com/shipments/{id}/history`, `/costs`, `/items` | histórico e detalhes por envio |
| `developers.mercadoenvios.com` (programa **Mercado Envios / Carrier**) | integração de transportadora: tracking events (collection / transfer / delivery), confirmação de eventos, ocorrências |
| `GET /MLB/routes/{RouteID}/facilities/{FacilityID}/fiscal-info` | dados fiscais dos shipments de uma rota Line Haul (Middle Mile), requer autorização específica |
| Webhooks/notifications (`shipments`, `orders`) | notificação de mudança de estado |

### Disponível oficialmente
- shipment_id, tracking/identificador do envio;
- status e substatus do envio;
- histórico de eventos e ocorrências de entrega (via API de carrier);
- facility/route_id no contexto Line Haul (`fiscal-info`), com autorização;
- datas dos eventos.

### **Não** disponível oficialmente (hoje só existe no AdminML)
- `cluster` / nome operacional da rota (ESP15…ESP18 → SSPxx);
- listagem de **rotas do dia por service center** com o mesmo recorte da tela `monitoring-route`;
- motorista (nome/ID) e placa atribuídos à rota;
- contadores agregados da rota (`delivered`, `notDelivered`, `pending`, `stops`);
- `occurrence_code` no formato usado no painel;
- flag e motivo de **área de risco**;
- ordenação/sequência de paradas da rota.

Ou seja: o endpoint `monitoring-route/route-detail` do AdminML **não é público** e não
possui equivalente 1:1 na API oficial.

### Requisitos e limites
- **Cadastro/aprovação obrigatórios:** as APIs de rota/facility são liberadas caso a caso
  para parceiros habilitados como transportadora/carrier — não basta criar um app OAuth.
- **Scopes:** `offline_access` (refresh token) + `read`/`write`; acessos logísticos são
  concedidos por habilitação da conta, não por scope autoatendido.
- **Rate limit:** ~1.500 req/min por app (referência pública) e limites por endpoint;
  varredura pacote-a-pacote de 4 bases não cabe em ciclo de 1 minuto sem cache incremental.
- **Aprovação do Mercado Livre:** sim, necessária para os endpoints de rota/facility.

---

## 3. Respostas do item 12

1. **A API oficial fornece tudo?** Não. Cobre pacote/shipment; **não** cobre cluster,
   motorista, placa, contadores da rota e área de risco.
2. **Endpoints usados** (se autorizados): `/shipments/{id}` + `x-format-new`,
   `/shipments/{id}/history`, tracking de carrier (Mercado Envios) e
   `/MLB/routes/{RouteID}/facilities/{FacilityID}/fiscal-info`.
3. **Dados do AdminML sem equivalente oficial:** cluster/nome operacional, lista de rotas
   do dia por service center, motorista, placa, contadores da rota, occurrence_code do
   painel, área de risco, sequência de paradas.
4. **Cadastro/aprovação como transportadora?** Sim, indispensável para o recorte por rota/facility.
5. **Frequência suportada:** 1 ciclo/minuto é viável **apenas** com sincronização
   incremental (rotas ativas + pacotes alterados). Ciclo de 30s não é recomendado.
6. **Infraestrutura:** `pg_cron` + `pg_net` chamando uma rota server-side
   `/api/public/hooks/meli-sync` no próprio JMRoutes (sem servidor novo).
7. **Custos adicionais:** nenhum de infraestrutura no caminho OAuth; o caminho Playwright
   exigiria host de navegador dedicado (custo recorrente).
8. **Riscos remanescentes:** dependência de aprovação do Meli; perda de cluster/área de
   risco/motorista se apenas a API oficial for usada; mudança de contrato interno do
   AdminML no caminho alternativo; bloqueio de conta no caminho de automação.
9. **Recomendação:** **modelo híbrido**.
   - Implementar OAuth oficial server-side + ciclo `pg_cron` de 1 min para
     **status/substatus/ocorrências de pacotes** (dado oficial, estável, sem navegador).
   - Manter a extensão v0.3.1 como origem única de **cluster, motorista, placa,
     contadores e área de risco** enquanto o Meli não liberar esses campos.
   - Playwright server-side **não recomendado** neste momento (risco de bloqueio,
     MFA/captcha, custo e necessidade de decisão formal de segurança).

---

## 4. O que fica pronto para a autorização

Escopo já desenhado e **não aplicado**, aguardando liberação:
- migration `meli_conexoes` + `meli_sync_execucoes` (com GRANTs e RLS admin-only);
- criptografia de tokens em repouso, nunca expostos ao navegador;
- tela administrativa "Integração Mercado Livre" (conectar / revogar / sincronizar agora);
- rota `/api/public/hooks/meli-sync` com lock anti-sobreposição e backoff;
- normalização e upsert compartilhados entre `server | extensao | manual`
  (`route_id` e `tracking_id` como identidades, preservando recebimento, triagem,
  bipagens, operador e timestamps físicos);
- contadores por base na tela Bases (rotas únicas por `route_id`).

**Aguardando autorização para implementar os itens 3 a 9.**
