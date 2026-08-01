/**
 * Fonte unica de verdade da qualificacao.
 *
 * O front renderiza o wizard a partir daqui (via GET /api/form) e o back
 * recalcula o score a partir daqui tambem. O score NUNCA vem do browser --
 * o cliente manda apenas os ids das opcoes escolhidas.
 */

/** Stages do pipeline "LP Qualificacao MCP" (opLnOZ2Hu3F0vD03n09h). */
export const STAGES = {
  novo: '7015a4ed-7eed-471d-8510-f84402da46f9',
  frio: 'eab83b3b-c547-47f6-aed9-ab0766cf541e',
  morno: 'acfe6f07-714b-4154-9573-1b9b722fa73e',
  quente: 'fef720e8-229d-43ae-b23c-c0f9c3418edb',
  reuniao: '49fba7fa-185a-4a9c-93e0-1f35d581cd2c',
  ganho: '6d795e27-9a51-4498-90de-21e297a0a15b',
  perdido: 'd441a85c-7f80-4a09-ae34-6f7f7ace3414',
};

/**
 * As perguntas do wizard. `points` alimenta o score (0-100).
 *
 * ATENCAO: os labels de `faturamento` sao identicos, caractere a caractere, as
 * picklistOptions do custom field "Faturamento anual atual" que ja existe na
 * sub-conta (id 2BP7DvQfnqnKlPzjOqH1). Inclui o travessao "–" (U+2013). Se
 * mudar aqui, o valor deixa de casar com o field e o GHL descarta a opcao.
 */
export const QUESTIONS = [
  {
    id: 'autoridade',
    label: 'Qual e o seu papel na decisao?',
    hint: 'Precisamos saber com quem estamos falando.',
    options: [
      { id: 'decisor', label: 'Sou o decisor final', points: 25 },
      { id: 'influencia', label: 'Participo da decisao junto com o time', points: 15 },
      { id: 'pesquisa', label: 'Estou apenas pesquisando', points: 5 },
    ],
  },
  {
    id: 'faturamento',
    label: 'Qual o faturamento atual da empresa?',
    hint: 'Usamos isso para dimensionar a proposta.',
    options: [
      { id: 'ate1m', label: 'Menos de R$ 1M por ano', points: 5, deal: 5000 },
      { id: 'de1a3m', label: 'R$ 1M – R$ 3M por ano', points: 12, deal: 15000 },
      { id: 'de3a10m', label: 'R$ 3M – R$ 10M por ano', points: 18, deal: 30000 },
      { id: 'de10a20m', label: 'R$ 10M – R$ 20M por ano', points: 22, deal: 60000 },
      { id: 'acima20m', label: 'R$ 20M por ano ou mais', points: 25, deal: 120000 },
    ],
  },
  {
    id: 'prazo',
    label: 'Quando pretende implementar?',
    hint: 'Urgencia muda a prioridade do atendimento.',
    options: [
      { id: 'imediato', label: 'Imediatamente (ate 30 dias)', points: 25 },
      { id: 'trimestre', label: 'Nos proximos 1 a 3 meses', points: 15 },
      { id: 'semprazo', label: 'Ainda sem prazo definido', points: 5 },
    ],
  },
  {
    id: 'orcamento',
    label: 'Como esta o orcamento para este projeto?',
    hint: 'Sem julgamento — so para nao perder o seu tempo.',
    options: [
      { id: 'aprovado', label: 'Verba ja aprovada', points: 25 },
      { id: 'aprovacao', label: 'Em processo de aprovacao', points: 15 },
      { id: 'sem', label: 'Ainda nao tenho verba', points: 5 },
    ],
  },
];

/** Faixas de classificacao -> stage de entrada no pipeline. */
export const BANDS = [
  { id: 'quente', min: 70, label: 'Quente', stage: STAGES.quente, tag: 'lead-quente' },
  { id: 'morno', min: 45, label: 'Morno', stage: STAGES.morno, tag: 'lead-morno' },
  { id: 'frio', min: 0, label: 'Frio', stage: STAGES.frio, tag: 'lead-frio' },
];

export const MAX_SCORE = QUESTIONS.reduce(
  (total, q) => total + Math.max(...q.options.map((o) => o.points)),
  0,
);

/**
 * Recalcula o score no servidor a partir dos ids escolhidos.
 * @returns {{score:number, band:object, picked:Array, deal:number}}
 * @throws {Error} se alguma resposta faltar ou nao existir no catalogo.
 */
export function evaluate(answers) {
  const picked = [];
  let score = 0;
  let deal = 0;

  for (const question of QUESTIONS) {
    const chosenId = answers?.[question.id];
    const option = question.options.find((o) => o.id === chosenId);
    if (!option) {
      throw new Error(`Resposta invalida ou ausente para "${question.id}"`);
    }
    score += option.points;
    if (option.deal) deal = option.deal;
    picked.push({ questionId: question.id, question: question.label, optionId: option.id, answer: option.label, points: option.points });
  }

  const band = BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
  return { score, band, picked, deal };
}

/** Versao publica do catalogo — sem `points`, para o score nao vazar pro browser. */
export function publicForm() {
  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      label: q.label,
      hint: q.hint,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  };
}
