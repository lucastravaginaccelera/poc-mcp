# Subir a LP para produção — Hostinger VPS

Guia para colocar a landing page online com domínio próprio e HTTPS.

> ⚠️ **`POST /api/vps/v1/virtual-machines` compra de verdade.** O endpoint chama-se
> `purchaseNewVirtualMachineV1` e debita o método de pagamento cadastrado na sua
> conta Hostinger. Não é um "criar recurso" reversível — é uma compra. Leia o passo 4
> inteiro antes de executar. **Eu não provisionei nada; a decisão de gastar é sua.**

## Resposta curta

Sim, dá para provisionar a máquina inteira via API. O fluxo é:

```
GET  /api/billing/v1/catalog          → achar o itemId do plano
GET  /api/vps/v1/data-centers         → escolher a região
GET  /api/vps/v1/templates            → escolher o SO (Ubuntu 24.04)
POST /api/vps/v1/post-install-scripts → script que prepara a máquina sozinha
POST /api/vps/v1/virtual-machines     → COMPRA + provisiona já configurada  💸
```

O `post-install script` é o pulo do gato: a máquina nasce com Node, Caddy, firewall
e o serviço prontos. Você só envia o código e sobe.

## Por que VPS (e não hospedagem compartilhada)

A LP é um servidor Node persistente (`node:http`), não PHP nem arquivos estáticos.
Hospedagem compartilhada da Hostinger não mantém processo Node rodando — precisa de
VPS. O plano KVM mais barato (~US$ 5/mês, 1 vCPU / 4 GB) sobra para este app.

**Alternativa:** você já tem um token da Cloudflare em `cloudfraont.txt`. Cloudflare
Workers rodaria isso de graça, mas exige portar o `node:http` para o runtime de
Workers e trocar o rate limit em memória por KV. Só vale se você for escalar para
muitos clientes. Para 1–5 LPs, VPS é mais simples e roda o código como está.

---

## Passo 0 — Pré-requisitos

- [ ] Conta Hostinger com método de pagamento cadastrado
- [ ] Domínio (ou subdomínio) que você controla — ex: `lp.accelera360.com.br`
- [ ] Chave SSH local (`ssh-keygen -t ed25519` se não tiver)
- [ ] O projeto funcionando local (`npm start` → http://localhost:4310)

## Passo 1 — Token da API

hPanel → **Dev Tools** → **API** → **Generate Token**. Dê um nome, escolha a
expiração, gere.

**O token não é exibido de novo após um refresh.** Salve na hora.

```bash
export HOSTINGER_TOKEN="seu-token-aqui"
export H_API="https://developers.hostinger.com"
export H_AUTH="Authorization: Bearer $HOSTINGER_TOKEN"
```

Teste:

```bash
curl -s "$H_API/api/vps/v1/virtual-machines" -H "$H_AUTH" | head -c 300
```

## Passo 2 — Descobrir os ids

Nada é hardcoded: catálogo, data center e template têm ids que mudam.

```bash
# Planos VPS disponíveis — anote o itemId do plano desejado
curl -s "$H_API/api/billing/v1/catalog" -H "$H_AUTH" \
  | python3 -m json.tool | grep -iA3 -E '"(name|id)".*vps'

# Data centers — escolha o mais perto do seu público (São Paulo, se houver)
curl -s "$H_API/api/vps/v1/data-centers" -H "$H_AUTH" | python3 -m json.tool

# Templates de SO — pegue o id do Ubuntu 24.04 LTS limpo (sem painel)
curl -s "$H_API/api/vps/v1/templates" -H "$H_AUTH" \
  | python3 -c "import sys,json;[print(t['id'], t['name']) for t in json.load(sys.stdin)['data']]"
```

Guarde: `ITEM_ID`, `DATACENTER_ID`, `TEMPLATE_ID`.

> Escolha um template **Ubuntu limpo**, não um com CyberPanel/Plesk. Painel de
> controle vai brigar com o Caddy pelas portas 80/443.

## Passo 3 — Post-install script

Prepara a máquina no primeiro boot. Salve como `provision.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy — HTTPS automático via Let's Encrypt
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy ufw

# Usuário sem privilégio para rodar o app
useradd --system --create-home --shell /usr/sbin/nologin lpapp
mkdir -p /opt/lp-qualificacao
chown lpapp:lpapp /opt/lp-qualificacao

# Serviço
cat > /etc/systemd/system/lp-qualificacao.service <<'UNIT'
[Unit]
Description=LP Qualificacao MCP
After=network.target

[Service]
Type=simple
User=lpapp
WorkingDirectory=/opt/lp-qualificacao
ExecStart=/usr/bin/node --env-file=/opt/lp-qualificacao/.env /opt/lp-qualificacao/server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable lp-qualificacao

# Firewall: só SSH e web. A porta 4310 NÃO fica exposta.
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

Registre na Hostinger:

```bash
curl -s -X POST "$H_API/api/vps/v1/post-install-scripts" \
  -H "$H_AUTH" -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({'name': 'lp-qualificacao-provision',
                  'content': open('provision.sh').read()}))
")"
```

Anote o `id` retornado → `SCRIPT_ID`.

## Passo 4 — Comprar e provisionar 💸

**Este comando gasta dinheiro.** Confira `ITEM_ID` antes — um id errado compra o
plano errado, e cancelamento é suporte, não API.

```bash
curl -s -X POST "$H_API/api/vps/v1/virtual-machines" \
  -H "$H_AUTH" -H "Content-Type: application/json" \
  -d '{
    "item_id": "'"$ITEM_ID"'",
    "setup": {
      "template_id":           '"$TEMPLATE_ID"',
      "data_center_id":        '"$DATACENTER_ID"',
      "post_install_script_id": '"$SCRIPT_ID"',
      "hostname": "lp-accelera360",
      "enable_backups": true,
      "public_key": {
        "name": "lucas-macbook",
        "key": "'"$(cat ~/.ssh/id_ed25519.pub)"'"
      }
    }
  }'
```

Campos do `setup` (do SDK oficial): `template_id`, `data_center_id`,
`post_install_script_id`, `password`, `hostname`, `install_monarx`,
`enable_backups` (default `true`), `ns1`, `ns2`, `public_key`.

Omita `password` e mande `public_key` — login por chave é melhor que por senha, e
a senha gerada não aparece na resposta mesmo.

Acompanhe até ficar `running` e pegue o IP:

```bash
curl -s "$H_API/api/vps/v1/virtual-machines" -H "$H_AUTH" \
  | python3 -c "import sys,json;[print(v['id'], v['state'], v.get('ipv4')) for v in json.load(sys.stdin)['data']]"
```

> **Prefere não arriscar via API?** Compre o VPS pelo hPanel na mão e use a API só
> daí em diante. O resto do guia funciona igual — você só pula este passo.

## Passo 5 — DNS

Aponte o domínio para o IP do VPS. Registro **A**, host `lp`, valor `<IP>`, TTL 300.

Se o DNS estiver na Cloudflare (você tem token em `cloudfraont.txt`):

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"A","name":"lp","content":"<IP_DO_VPS>","ttl":300,"proxied":false}'
```

**Deixe `proxied: false` no primeiro deploy.** Com o proxy laranja ligado, o Caddy
não consegue completar o desafio HTTP do Let's Encrypt. Ligue depois que o
certificado emitir, se quiser.

Espere propagar: `dig +short lp.accelera360.com.br` tem que devolver o IP.

## Passo 6 — Ajustar o app para produção

Uma mudança obrigatória em [server.mjs](server.mjs) — hoje o servidor escuta em
todas as interfaces:

```js
server.listen(PORT, () => {          // ← antes
server.listen(PORT, '127.0.0.1', () => {   // ← depois
```

Sem isso a porta 4310 fica acessível direto pelo IP, contornando o Caddy e o HTTPS.
O firewall do passo 3 já bloqueia, mas defesa em profundidade custa uma linha.

## Passo 7 — Enviar o código

```bash
rsync -av --exclude node_modules --exclude .git --exclude .env \
  ./ root@<IP_DO_VPS>:/opt/lp-qualificacao/
```

O `.env` vai separado, com permissão restrita — **nunca** no rsync geral nem no git:

```bash
scp .env root@<IP>:/opt/lp-qualificacao/.env
ssh root@<IP> 'chown lpapp:lpapp /opt/lp-qualificacao/.env && chmod 600 /opt/lp-qualificacao/.env'
```

No servidor, gere o `ghl-config.json` e suba o serviço:

```bash
ssh root@<IP>
cd /opt/lp-qualificacao
sudo -u lpapp node --env-file=.env setup-ghl.mjs   # idempotente, reaproveita o que existe
chown -R lpapp:lpapp /opt/lp-qualificacao
systemctl start lp-qualificacao
systemctl status lp-qualificacao --no-pager
```

## Passo 8 — HTTPS com Caddy

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
lp.accelera360.com.br {
    reverse_proxy 127.0.0.1:4310
    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
EOF

systemctl reload caddy
journalctl -u caddy -n 30 --no-pager   # confirme a emissão do certificado
```

O Caddy emite e renova o certificado Let's Encrypt sozinho. Nada de certbot.

## Passo 9 — Validar em produção

```bash
curl -s https://lp.accelera360.com.br/api/health          # {"ok":true,...}
curl -sI https://lp.accelera360.com.br | head -1          # HTTP/2 200
curl -s http://lp.accelera360.com.br -o /dev/null -w '%{http_code}\n'   # 308 → redireciona pra HTTPS
```

Depois **envie um lead de verdade pelo formulário** e confirme no GHL que caiu
contato + oportunidade no stage certo. Testar só o `/api/health` não prova nada:
o token do GHL pode estar errado no `.env` do servidor e a página continua abrindo.

---

## Antes de mandar para clientes

| Item | Situação | Ação |
|---|---|---|
| HTTPS | Caddy resolve | passo 8 |
| Bind em localhost | **precisa mudar** | passo 6 |
| Segredos fora do git | `.gitignore` já cobre | conferir com `git status` |
| Rate limit | 10/IP/10min, em memória | ok para 1 instância; se escalar, mover pra Redis |
| Backups | `enable_backups: true` | semanal, já ligado |
| **LGPD** | **pendente** | você coleta nome, e-mail e telefone — precisa de aviso de privacidade e consentimento explícito no formulário |
| Monitoramento | pendente | `GET /api/vps/v1/virtual-machines/{id}/metrics` ou um uptime check no `/api/health` |

O item de LGPD não é burocracia: são dados pessoais de terceiros indo para um CRM.
Um checkbox de consentimento com link para a política, gravado junto com o lead,
resolve o essencial.

## Manutenção

```bash
# Atualizar o código
rsync -av --exclude node_modules --exclude .git --exclude .env ./ root@<IP>:/opt/lp-qualificacao/
ssh root@<IP> 'systemctl restart lp-qualificacao'

# Logs (inclui a linha [lead] de cada envio)
ssh root@<IP> 'journalctl -u lp-qualificacao -f'

# Reiniciar / parar a máquina
curl -s -X POST "$H_API/api/vps/v1/virtual-machines/$VM_ID/restart" -H "$H_AUTH"
curl -s -X POST "$H_API/api/vps/v1/virtual-machines/$VM_ID/stop"    -H "$H_AUTH"
```

## Bônus — MCP da Hostinger

Existe MCP oficial com 276 tools (62 só de VPS). Dá para gerenciar a infra
conversando, sem decorar endpoint:

```bash
npm install -g hostinger-api-mcp
claude mcp add --scope local hostinger hostinger-api-mcp \
  --env HOSTINGER_API_TOKEN=$HOSTINGER_TOKEN
```

Mesma regra do MCP do GHL: as tools só carregam depois de reiniciar o Claude Code.
E o mesmo cuidado com o `POST /virtual-machines` — via MCP ele continua gastando
dinheiro de verdade.

## Referência

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/billing/v1/catalog` | planos e `itemId` |
| GET | `/api/vps/v1/data-centers` | regiões |
| GET | `/api/vps/v1/templates` | imagens de SO |
| POST | `/api/vps/v1/post-install-scripts` | registrar script de provisionamento |
| POST | `/api/vps/v1/virtual-machines` | **compra + provisiona** 💸 |
| GET | `/api/vps/v1/virtual-machines` | listar VMs, estado e IP |
| GET | `/api/vps/v1/virtual-machines/{id}` | detalhes |
| POST | `/api/vps/v1/virtual-machines/{id}/restart` | reiniciar |
| GET | `/api/vps/v1/virtual-machines/{id}/metrics` | CPU, RAM, disco |
| PUT | `/api/vps/v1/virtual-machines/{id}/hostname` | trocar hostname |

Base: `https://developers.hostinger.com` · header `Authorization: Bearer <token>`.
A API está em beta — endpoints podem mudar.

Fontes: [Hostinger API Reference](https://developers.hostinger.com/) ·
[api-php-sdk](https://github.com/hostinger/api-php-sdk) ·
[api-mcp-server](https://github.com/hostinger/api-mcp-server) ·
[Gerar token](https://www.hostinger.com/support/10840865-what-is-hostinger-api/)
