---
name: ghl-lp-qualificacao
description: >
  Construir landing page com formulário wizard de qualificação que grava lead no
  GoHighLevel como contato + oportunidade, roteando para o stage do pipeline
  conforme o score. Use ao montar LP de captação para uma sub-conta GHL, ao
  configurar pipeline/custom fields via API do GHL, ou ao conectar o MCP do GHL.
  Cobre credenciais (PIT), endpoints (inclusive não-documentados), o modelo de
  scoring e as armadilhas que quebram silenciosamente.
---

# LP de qualificação → GoHighLevel

Playbook para entregar uma landing page que qualifica o lead e o deposita no CRM
já classificado, no stage certo do pipeline.

Implementação de referência completa: raiz deste repositório
([qualification.mjs](../../../qualification.mjs), [ghl.mjs](../../../ghl.mjs),
[server.mjs](../../../server.mjs), [setup-ghl.mjs](../../../setup-ghl.mjs),
[public/index.html](../../../public/index.html)).

## Credenciais

Duas coisas, e só duas:

| O quê | Formato | Onde |
|---|---|---|
| Private Integration Token | `pit-<uuid>` | Sub-conta → `Settings` → `Private Integrations` → `Create New Integration` |
| Location ID | 20 chars | URL `app.gohighlevel.com/v2/location/<locationId>/…` ou `Settings` → `Business Profile` |

- **O token só aparece uma vez.** Perdeu, cria outro. Limite de 5 por nível.
- Se `Private Integrations` não estiver no menu, habilite em `Settings` → `Labs`.
- API keys v1 (JWT) **não** funcionam no MCP nem nos endpoints v2 aqui. Só PIT.
- Scopes mínimos: `contacts.readonly/write`, `opportunities.readonly/write`,
  `locations.readonly`, `locations/customFields.readonly` (+ `write` se for criar campos).

Guarde em `.env` e **adicione ao `.gitignore` antes de qualquer commit**.

## Conectar o MCP (opcional)

```bash
claude mcp add --transport http --scope local ghl \
  https://services.leadconnectorhq.com/mcp/ \
  --header "Authorization: Bearer $GHL_PIT" \
  --header "locationId: $GHL_LOCATION_ID"
claude mcp get ghl   # espera: Status ✔ Connected
```

Use `--scope local`, não `--scope project`: project escreve `.mcp.json`, que é
versionado, e o token vai junto para o histórico do git.

**As tools `mcp__ghl__*` só carregam no startup do Claude Code.** Adicionou no meio
da sessão, precisa reiniciar. Enquanto isso, use `curl` contra os mesmos endpoints —
é o que o MCP faz por baixo.

Existe endpoint mais novo recomendado para Claude:
`https://services.leadconnectorhq.com/mcp/anthropic/v2` — expõe 5 tools genéricas
(`search`, `fetch`, `search_operations`, `describe_operation`, `execute_operation`)
em vez de dezenas, gastando menos contexto.

> **MCP não é a camada certa para o backend da LP.** MCP existe para agentes de IA
> consumirem ferramentas. Um servidor web deve chamar a REST API v2 direto — mesmos
> endpoints, sem indireção. Use MCP quando *você* (agente) estiver explorando a conta.

## Processo

### 1. Mapear o terreno antes de criar nada

```bash
curl -s "$BASE/opportunities/pipelines?locationId=$LOC" -H "$AUTH" -H "$VER"
curl -s "$BASE/locations/$LOC/customFields?model=contact" -H "$AUTH" -H "$VER"
```

Contas reais já têm pipelines e campos. **Reaproveite campos existentes** em vez de
criar duplicados — o time do cliente já usa os dele em relatórios e automações.

### 2. Criar o pipeline

`POST /opportunities/pipelines` **funciona, apesar de não estar na documentação
pública.** Confirmado com `201`. Valide com um pipeline `__probe__` descartável
antes de depender disso — a HighLevel pode fechar o endpoint sem aviso.

```json
POST /opportunities/pipelines
{
  "locationId": "<loc>",
  "name": "LP Qualificacao",
  "stages": [
    { "name": "Novo Lead",           "position": 0, "showInFunnel": true },
    { "name": "Frio - Nutricao",     "position": 1, "showInFunnel": true },
    { "name": "Morno - Qualificado", "position": 2, "showInFunnel": true },
    { "name": "Quente - Prioridade", "position": 3, "showInFunnel": true },
    { "name": "Reuniao Agendada",    "position": 4, "showInFunnel": true },
    { "name": "Ganho",               "position": 5, "showInFunnel": true },
    { "name": "Perdido",             "position": 6, "showInFunnel": false }
  ]
}
```

Ordene os stages em qualificação **crescente** — o GHL calcula `stageWinProbability`
automaticamente pela posição, então a probabilidade sai coerente de graça.

Anote os `stages[].id` retornados: é para eles que o lead é roteado.

Deletar: `DELETE /opportunities/pipelines/{id}?locationId=<loc>`.

### 3. Custom fields, idempotente

Script que casa **pelo nome**, reaproveita o que existe, cria o que falta e grava
um `ghl-config.json` com o mapa de ids. Ver [setup-ghl.mjs](../../../setup-ghl.mjs).

```
POST /locations/{locationId}/customFields
{ "name": "LP - Score", "dataType": "NUMERICAL", "model": "contact" }
```

`dataType`: `TEXT`, `LARGE_TEXT`, `NUMERICAL`, `PHONE`, `MONETORY` (sic),
`CHECKBOX`, `SINGLE_OPTIONS`, `MULTIPLE_OPTIONS`, `RADIO`, `DATE`.

Nunca hardcode ids de campo no servidor. Eles mudam por sub-conta.

### 4. Modelo de qualificação — fonte única

Um módulo só define perguntas, pesos, faixas e stages. Front e back leem dele.

BANT em 4 perguntas × 25 pontos = 100:
autoridade · faturamento · prazo · orçamento.

Faixas → stage de entrada: `≥70` Quente · `45–69` Morno · `<45` Frio.

**O score é recalculado no servidor, sempre.** O browser envia apenas os ids das
opções. Exponha o catálogo via `GET /api/form` numa versão *sem* o campo `points`
— senão os pesos vazam e o formulário vira alvo fácil de gaming.

Teste isso explicitamente:

```bash
curl -X POST localhost:PORT/api/lead -d '{..., "score": 999, "answers": {...}}'
# o score da resposta tem que ignorar o 999
```

### 5. Backend — a sequência de gravação

```
POST /contacts/upsert       → contato + customFields + tags   (retorna contactId)
POST /opportunities/        → oportunidade no stage da faixa
POST /contacts/{id}/notes   → resumo legível para o vendedor
```

Use **`/contacts/upsert`**, não `/contacts/`. O upsert deduplica por email/telefone;
o create explode com `duplicated contact` quando o lead preenche duas vezes.

`customFields` no payload: `[{ "id": "<fieldId>", "field_value": "<valor>" }]`.

A nota é o que o vendedor realmente lê ao abrir o contato — vale mais que os campos.
Envolva em `.catch()`: falha de nota não pode derrubar um lead já gravado.

### 6. Frontend

Wizard de um passo por pergunta, auto-avanço ~220 ms após a escolha, barra de
progresso, botão voltar, tela de sucesso com score e classificação.

Renderize os passos a partir de `GET /api/form` — assim adicionar pergunta é mexer
em um arquivo só, e front e back nunca divergem.

Se houver design system (`npx getdesign@latest add meta` gera um `DESIGN.md`),
extraia os tokens para CSS vars e siga-os. Fontes proprietárias (ex: Optimistic VF
da Meta) não são distribuídas — declare o fallback e avise o usuário que essa é a
divergência.

### 7. Validar de verdade

Não confie no `201`. Releia do GHL:

```bash
# custom fields e tags gravaram?
curl -s "$BASE/contacts/{id}" -H "$AUTH" -H "$VER"
# oportunidade caiu no stage certo?
curl -s "$BASE/opportunities/search?location_id=$LOC&pipeline_id=$PIPE&limit=20" -H "$AUTH" -H "$VER"
# a nota existe?
curl -s "$BASE/contacts/{id}/notes" -H "$AUTH" -H "$VER"
```

Checklist mínimo: uma submissão por faixa (quente/morno/frio) + email inválido +
resposta faltando + score forjado.

## Armadilhas

**Picklist exige match exato.** Ao gravar em `SINGLE_OPTIONS`/`RADIO`, o valor tem
que bater caractere a caractere com a `picklistOption`. Travessão `–` (U+2013) e
hífen `-` são diferentes. **Divergiu, o GHL descarta o valor e responde 200** — falha
silenciosa, sem erro. Copie os labels do `GET customFields`, não digite à mão.

**`DELETE` responde com typo.** `{"succeded": true, "succeeded": true}` — os dois
campos. Parseie `succeeded` (grafia correta), mas não assuma que o com typo some.

**Header `Version` é obrigatório.** `Version: 2021-07-28` em toda chamada v2. Sem
ele a API rejeita ou muda de comportamento.

**Contato deletado responde 400, não 404.** `{"message": "Contact not found for id:…",
"statusCode": 400}`. Não trate 400 como "payload malformado" cegamente.

**`createdBy.channel` vem `OAUTH` mesmo usando PIT.** É como o GHL classifica
Private Integrations internamente. Não é sinal de erro.

**Confirme o alvo antes de deletar.** `GET` no recurso, mostre o que é, só então
`DELETE`. Contato apagado no CRM do cliente não volta.

## Referência de endpoints

Base `https://services.leadconnectorhq.com` · headers `Authorization: Bearer pit-…`,
`Version: 2021-07-28`.

| Método | Rota | Uso |
|---|---|---|
| GET | `/opportunities/pipelines?locationId=` | listar pipelines + stage ids |
| POST | `/opportunities/pipelines` | criar pipeline (**não documentado**) |
| DELETE | `/opportunities/pipelines/{id}?locationId=` | remover pipeline |
| GET | `/locations/{loc}/customFields?model=contact` | listar campos |
| POST | `/locations/{loc}/customFields` | criar campo |
| POST | `/contacts/upsert` | criar/atualizar contato (dedupe) |
| GET | `/contacts/{id}` | ler contato |
| DELETE | `/contacts/{id}` | remover contato |
| POST | `/contacts/{id}/notes` | anexar nota |
| GET | `/contacts/{id}/notes` | ler notas |
| POST | `/opportunities/` | criar oportunidade |
| GET | `/opportunities/search?location_id=&pipeline_id=` | buscar oportunidades |

## Stack

Node ≥ 20 sem dependências: `fetch` e `--env-file` são nativos, `node:http` serve
a página. Uma POC de LP não precisa de bundler nem framework — e sem `node_modules`
o cliente consegue rodar o que você entregou.
