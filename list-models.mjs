import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
);

const res = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}` },
});
const { data } = await res.json();

const freeModels = data
  .filter(m => m.id.endsWith(':free'))
  .map(m => ({ id: m.id, context: m.context_length }));

console.log(`무료 모델 수: ${freeModels.length}`);
freeModels.forEach(m => console.log(`  ${m.id}  (context: ${m.context})`));
