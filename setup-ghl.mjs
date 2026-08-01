/**
 * Prepara a sub-conta do GHL para receber os leads da landing page.
 *
 * Idempotente: roda quantas vezes quiser. Campos que ja existem (casando pelo
 * nome) sao reaproveitados em vez de duplicados. Grava ghl-config.json com o
 * mapa de ids que o server.mjs consome.
 */
import { writeFile } from 'node:fs/promises';
import { ghl, LOCATION_ID } from './ghl.mjs';

/** Campos criados por esta POC. */
const WANTED = [
  { key: 'score', name: 'LP MCP - Score', dataType: 'NUMERICAL' },
  { key: 'classificacao', name: 'LP MCP - Classificacao', dataType: 'TEXT' },
  { key: 'autoridade', name: 'LP MCP - Autoridade', dataType: 'TEXT' },
  { key: 'prazo', name: 'LP MCP - Prazo', dataType: 'TEXT' },
  { key: 'orcamento', name: 'LP MCP - Orcamento', dataType: 'TEXT' },
];

/** Campo que JA existia na conta — reaproveitado em vez de criar um duplicado. */
const REUSED = { key: 'faturamento', name: 'Faturamento anual atual' };

const main = async () => {
  console.log(`> location: ${LOCATION_ID}`);

  const { customFields = [] } = await ghl.listCustomFields();
  const byName = new Map(customFields.map((f) => [f.name, f]));
  const fields = {};

  const reused = byName.get(REUSED.name);
  if (!reused) {
    throw new Error(
      `Campo esperado "${REUSED.name}" nao existe mais nesta sub-conta. ` +
        `Crie-o ou ajuste REUSED em setup-ghl.mjs.`,
    );
  }
  fields[REUSED.key] = reused.id;
  console.log(`  = reaproveitado "${REUSED.name}" (${reused.id})`);

  for (const spec of WANTED) {
    const existing = byName.get(spec.name);
    if (existing) {
      fields[spec.key] = existing.id;
      console.log(`  = ja existe   "${spec.name}" (${existing.id})`);
      continue;
    }
    const created = await ghl.createCustomField({ name: spec.name, dataType: spec.dataType });
    const id = created?.customField?.id ?? created?.id;
    if (!id) throw new Error(`Nao consegui ler o id do campo criado: ${JSON.stringify(created)}`);
    fields[spec.key] = id;
    console.log(`  + criado      "${spec.name}" (${id})`);
  }

  const pipelineId = process.env.GHL_PIPELINE_ID;
  const { pipelines = [] } = await ghl.getPipelines();
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline ${pipelineId} nao encontrado na sub-conta.`);
  }
  console.log(`  = pipeline    "${pipeline.name}" (${pipeline.id}), ${pipeline.stages.length} stages`);

  const config = { locationId: LOCATION_ID, pipelineId: pipeline.id, fields };
  await writeFile(new URL('./ghl-config.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
  console.log('\n> ghl-config.json gravado.');
};

main().catch((err) => {
  console.error(`\nFALHOU: ${err.message}`);
  process.exit(1);
});
