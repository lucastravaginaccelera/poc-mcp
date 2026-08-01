/**
 * Backend da landing page de qualificacao.
 *
 *   GET  /            -> landing page
 *   GET  /api/form    -> catalogo de perguntas (sem os pesos)
 *   POST /api/lead    -> qualifica, cria contato + oportunidade no GHL
 *   GET  /api/health  -> ping
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ghl } from './ghl.mjs';
import { evaluate, publicForm, MAX_SCORE } from './qualification.mjs';

const PORT = Number(process.env.PORT ?? 4310);
const config = JSON.parse(await readFile(new URL('./ghl-config.json', import.meta.url), 'utf8'));
const PAGE = new URL('./public/index.html', import.meta.url);

const send = (res, status, payload, type = 'application/json; charset=utf-8') => {
  const body = type.startsWith('application/json') ? JSON.stringify(payload) : payload;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) reject(new Error('Payload grande demais'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });

/** Rate limit simples em memoria: 10 envios por IP a cada 10 min. */
const hits = new Map();
const rateLimited = (ip) => {
  const now = Date.now();
  const window = 10 * 60_000;
  const list = (hits.get(ip) ?? []).filter((t) => now - t < window);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
};

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

const splitName = (fullName) => {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || '-' };
};

async function handleLead(req, res) {
  const ip = req.socket.remoteAddress ?? 'desconhecido';
  if (rateLimited(ip)) return send(res, 429, { error: 'Muitas tentativas. Tente de novo em alguns minutos.' });

  const payload = await readJson(req);
  const { nome, email, telefone, empresa, answers } = payload ?? {};

  if (typeof nome !== 'string' || nome.trim().length < 2) {
    return send(res, 400, { error: 'Informe seu nome completo.' });
  }
  if (!isEmail(email)) {
    return send(res, 400, { error: 'Informe um e-mail valido.' });
  }
  if (typeof telefone !== 'string' || telefone.replace(/\D/g, '').length < 10) {
    return send(res, 400, { error: 'Informe um telefone valido com DDD.' });
  }

  // O score e recalculado aqui a partir dos ids — o browser nunca envia pontos.
  let result;
  try {
    result = evaluate(answers);
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
  const { score, band, picked, deal } = result;
  const byQuestion = Object.fromEntries(picked.map((p) => [p.questionId, p.answer]));
  const { firstName, lastName } = splitName(nome);

  const contactPayload = {
    firstName,
    lastName,
    email: email.trim().toLowerCase(),
    phone: telefone.trim(),
    source: 'LP Qualificacao MCP',
    tags: ['lp-mcp', 'qualificacao', band.tag],
    customFields: [
      { id: config.fields.score, field_value: String(score) },
      { id: config.fields.classificacao, field_value: band.label },
      { id: config.fields.autoridade, field_value: byQuestion.autoridade },
      { id: config.fields.prazo, field_value: byQuestion.prazo },
      { id: config.fields.orcamento, field_value: byQuestion.orcamento },
      { id: config.fields.faturamento, field_value: byQuestion.faturamento },
    ],
  };
  if (empresa && String(empresa).trim()) contactPayload.companyName = String(empresa).trim();

  const upserted = await ghl.upsertContact(contactPayload);
  const contactId = upserted?.contact?.id;
  if (!contactId) throw new Error(`Upsert nao retornou contactId: ${JSON.stringify(upserted).slice(0, 300)}`);

  const opportunity = await ghl.createOpportunity({
    pipelineId: config.pipelineId,
    pipelineStageId: band.stage,
    name: `${nome.trim()} — ${band.label} (${score}/${MAX_SCORE})`,
    status: 'open',
    contactId,
    monetaryValue: deal,
  });

  // Nota legivel para quem abrir o contato no CRM.
  const linhas = picked.map((p) => `• ${p.question}\n   ${p.answer} (+${p.points})`).join('\n');
  await ghl
    .addNote(contactId, `Qualificacao da LP — ${band.label} · ${score}/${MAX_SCORE} pontos\n\n${linhas}\n\nEmpresa: ${empresa || 'nao informada'}\nDeal estimado: R$ ${deal.toLocaleString('pt-BR')}`)
    .catch((err) => console.warn(`  ! nota nao gravada: ${err.message}`));

  const opportunityId = opportunity?.opportunity?.id ?? opportunity?.id ?? null;
  console.log(`[lead] ${nome} <${email}> score=${score} banda=${band.label} contact=${contactId} opp=${opportunityId}`);

  return send(res, 201, {
    ok: true,
    score,
    maxScore: MAX_SCORE,
    classificacao: band.label,
    banda: band.id,
    contactId,
    opportunityId,
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/form') {
      return send(res, 200, publicForm());
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, pipelineId: config.pipelineId });
    }
    if (req.method === 'POST' && url.pathname === '/api/lead') {
      return await handleLead(req, res);
    }
    return send(res, 404, { error: 'Nao encontrado' });
  } catch (err) {
    console.error(`[erro] ${req.method} ${url.pathname}: ${err.message}`);
    return send(res, err.status && err.status < 500 ? 400 : 500, {
      error: 'Nao consegui registrar seu contato. Tente novamente.',
      detail: err.message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`\n  LP Qualificacao MCP rodando em http://localhost:${PORT}`);
  console.log(`  pipeline: ${config.pipelineId}\n`);
});
