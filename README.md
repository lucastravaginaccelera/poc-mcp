# POC — Landing Page de Qualificação → GoHighLevel

Landing page com formulário wizard que qualifica o lead e grava no GHL como
**contato + oportunidade**, entrando no stage do pipeline conforme o score.

## Rodar

```bash
npm run setup   # idempotente: cria/reaproveita os custom fields no GHL
npm start       # http://localhost:4310
```

Sem dependências externas — só Node >= 20 (usa `fetch` e `--env-file` nativos).

## Como funciona

```
browser  ──POST /api/lead──▶  server.mjs
                               │  evaluate() recalcula o score
                               ├─▶ POST /contacts/upsert      (contato + custom fields + tags)
                               ├─▶ POST /opportunities/       (oportunidade no stage da faixa)
                               └─▶ POST /contacts/{id}/notes  (resumo legível)
```

**O score nunca vem do browser.** O front envia só os ids das opções escolhidas;
[qualification.mjs](qualification.mjs) recalcula tudo no servidor. `publicForm()`
serve o catálogo sem o campo `points`, então os pesos não vazam para o cliente.

## Qualificação

Modelo BANT, 4 perguntas × 25 pontos = **100 máx**.

| Pergunta | Opções (pontos) |
|---|---|
| Papel na decisão | Decisor final (25) · Participo (15) · Pesquisando (5) |
| Faturamento anual | 20M+ (25) · 10–20M (22) · 3–10M (18) · 1–3M (12) · <1M (5) |
| Prazo | Imediato (25) · 1–3 meses (15) · Sem prazo (5) |
| Orçamento | Aprovado (25) · Em aprovação (15) · Sem verba (5) |

Faixa → stage de entrada no pipeline:

| Score | Classificação | Stage | Deal estimado |
|---|---|---|---|
| ≥ 70 | Quente | `Quente - Prioridade` | por faixa de faturamento |
| 45–69 | Morno | `Morno - Qualificado` | idem |
| < 45 | Frio | `Frio - Nutricao` | idem |

## Recursos criados no GHL

Sub-account `zzslT0Y5q7j5uHid5HvQ`.

**Pipeline `LP Qualificacao MCP`** (`opLnOZ2Hu3F0vD03n09h`) — 7 stages:
Novo Lead · Frio - Nutricao · Morno - Qualificado · Quente - Prioridade ·
Reuniao Agendada · Ganho · Perdido.

**Custom fields** (contact):

| Campo | Tipo | Origem |
|---|---|---|
| `Faturamento anual atual` | SINGLE_OPTIONS | **já existia** — reaproveitado |
| `LP MCP - Score` | NUMERICAL | criado |
| `LP MCP - Classificacao` | TEXT | criado |
| `LP MCP - Autoridade` | TEXT | criado |
| `LP MCP - Prazo` | TEXT | criado |
| `LP MCP - Orcamento` | TEXT | criado |

> ⚠️ Os labels da pergunta `faturamento` em [qualification.mjs](qualification.mjs)
> batem **caractere a caractere** com as `picklistOptions` do campo reaproveitado,
> incluindo o travessão `–` (U+2013). Mudar o texto quebra a gravação silenciosamente
> — o GHL descarta a opção sem erro.

**Tags aplicadas:** `lp-mcp`, `qualificacao`, e `lead-quente` | `lead-morno` | `lead-frio`.

## Arquivos

| Arquivo | Papel |
|---|---|
| [qualification.mjs](qualification.mjs) | Perguntas, pesos, faixas, ids dos stages — fonte única |
| [ghl.mjs](ghl.mjs) | Client da API v2 do GHL |
| [setup-ghl.mjs](setup-ghl.mjs) | Cria/reaproveita custom fields → `ghl-config.json` |
| [server.mjs](server.mjs) | HTTP server, validação, orquestração |
| [public/index.html](public/index.html) | Landing page + wizard (vanilla, self-contained) |
| [DESIGN.md](DESIGN.md) | Design system `meta` via `npx getdesign@latest add meta` |

## Endpoints

| Método | Rota | Retorno |
|---|---|---|
| GET | `/` | landing page |
| GET | `/api/form` | catálogo de perguntas (sem pesos) |
| GET | `/api/health` | `{ok, pipelineId}` |
| POST | `/api/lead` | `{ok, score, classificacao, contactId, opportunityId}` |

## Notas de design

UI segue os tokens do [DESIGN.md](DESIGN.md) (`meta`): canvas branco, botão pill
preto `100px`, CTA cobalto `#0064e0`, card `32px`, radio selecionado
`2px solid #0143b5`, input `44px` com foco `2px #1876f2`.

A fonte **Optimistic VF** é proprietária da Meta e não é distribuída — a stack cai
para `SF Pro Display` / system sans. É a única divergência visual do design system.

## Segurança

- Credenciais em `.env`, fora do git via [.gitignore](.gitignore) — que também
  cobre `chave.txt` e `cloudfraont.txt`, que estavam em texto puro no repo.
- Rate limit em memória: 10 envios por IP / 10 min.
- Body limitado a 64 KB.
- O PIT nunca chega ao browser — todas as chamadas ao GHL saem do servidor.
